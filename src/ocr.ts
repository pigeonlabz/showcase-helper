import { createWorker, PSM } from "tesseract.js";
import type { OCRWord, ScanRecord } from "./types";
import { getExplicitSpeciesForm, recognizeSpecies } from "./species";
import { readIVBars } from "./iv-bars";

export type OCRResult = {
  text: string;
  confidence: number;
  words: OCRWord[];
  ivLabels: OCRWord[];
  cpHint: number | null;
  failedCrops: OCRCropName[];
  regions?: OCRRegionDiagnostic[];
};

export type OCRCropRead = { text: string; words?: OCRWord[]; attempts?: string[]; cpHint?: number | null };
export type OCRRegionDiagnostic = {
  name: OCRCropName;
  rawText: string;
  text: string;
  attempts: string[];
  failed: boolean;
};

export const OCR_CROPS = {
  cp: { x: 0.27, y: 0.035, width: 0.46, height: 0.09 },
  size: { x: 0.05, y: 0.49, width: 0.9, height: 0.12 },
  catchInfo: { x: 0.02, y: 0.9, width: 0.96, height: 0.09 },
  speciesInfo: { x: 0.03, y: 0.6, width: 0.94, height: 0.19 },
  xxl: { x: 0.25, y: 0.37, width: 0.5, height: 0.14 },
  // Recent card layouts place the size badge beside the height near the lower edge.
  xxlBadge: { x: 0.775, y: 0.515, width: 0.1, height: 0.03 },
  bars: { x: 0.05, y: 0.73, width: 0.5, height: 0.2 },
} as const;

export const OCR_SIZE_RETRY = { x: 0.05, y: 0.53, width: 0.9, height: 0.12, scale: 6 } as const;

export type OCRCropName = keyof typeof OCR_CROPS;

type OCRBlock = {
  paragraphs: Array<{
    lines: Array<{
      words: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    }>;
  }>;
};

export async function recognizeImage(
  source: HTMLImageElement,
  width: number,
  height: number,
  logger?: (progress: number) => void,
): Promise<OCRResult> {
  let activeCropIndex = 0;
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        logger?.((activeCropIndex + Math.max(0, Math.min(1, message.progress))) / Object.keys(OCR_CROPS).length);
      }
    },
  });
  try {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    } catch {
      // Continue with Tesseract's default page segmentation if configuration fails.
    }
    return await recognizeOCRCrops(async (name, index) => {
      activeCropIndex = index;
      const crop = OCR_CROPS[name];
      const scale = name === "xxlBadge" ? 6 : 3;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: name === "xxlBadge" ? PSM.SINGLE_WORD : PSM.SINGLE_BLOCK });
      } catch {
        // The crop can still be attempted with the worker's previous page segmentation mode.
      }
      const canvas = cropAndScale(
        source,
        width * crop.x,
        height * crop.y,
        width * crop.width,
        height * crop.height,
        scale,
      );
      try {
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        let text = result.data.text;
        const attempts = [text];
        let cpHint: number | null | undefined;
        if (name === "cp") {
          const firstText = text;
          const firstHint = parseCPHint(firstText);
          if (firstHint !== null && hasCPLabel(firstText) && firstHint >= 1000) {
            cpHint = firstHint;
            text = `CP ${firstHint}`;
          } else {
            try {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
              const alternateCanvas = cropAndScale(source, width * crop.x, height * crop.y, width * crop.width, height * crop.height, 4);
              try {
                const alternate = await worker.recognize(alternateCanvas, {}, { text: true });
                attempts.push(alternate.data.text);
                cpHint = resolveCPHint(firstText, alternate.data.text);
                text = cpHint === null ? "" : `CP ${cpHint}`;
              } finally {
                alternateCanvas.width = 0;
                alternateCanvas.height = 0;
              }
            } catch {
              // Leave CP unknown if the corroborating pass cannot complete.
              cpHint = null;
              text = "";
            } finally {
              try { await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }); } catch { /* Keep the worker usable. */ }
            }
          }
        } else if (name === "size") {
          const firstFields = parseOCR(text);
          if (firstFields.weightKg === null || firstFields.heightM === null) {
            try {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
              const alternateCanvas = cropAndScale(
                source,
                width * OCR_SIZE_RETRY.x,
                height * OCR_SIZE_RETRY.y,
                width * OCR_SIZE_RETRY.width,
                height * OCR_SIZE_RETRY.height,
                OCR_SIZE_RETRY.scale,
              );
              try {
                const alternate = await worker.recognize(alternateCanvas, {}, { text: true });
                attempts.push(alternate.data.text);
                const alternateFields = parseOCR(alternate.data.text);
                const recoveredWeight = firstFields.weightKg === null && alternateFields.weightKg !== null;
                const recoveredHeight = firstFields.heightM === null && alternateFields.heightM !== null;
                if (recoveredWeight || recoveredHeight) text = `${text}\n${alternate.data.text}`;
              } finally {
                alternateCanvas.width = 0;
                alternateCanvas.height = 0;
              }
            } catch {
              // Keep all values from the first measurement crop if the alternate pass fails.
            } finally {
              try { await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }); } catch { /* Keep the worker usable. */ }
            }
          }
        }
        const regionWords = wordsFromBlocks(result.data.blocks ?? []).map((word) => ({
          ...word,
          bbox: {
          x0: word.bbox.x0 / scale + width * crop.x,
          y0: word.bbox.y0 / scale + height * crop.y,
          x1: word.bbox.x1 / scale + width * crop.x,
          y1: word.bbox.y1 / scale + height * crop.y,
          },
        }));
        return { text, words: regionWords, attempts, ...(name === "cp" ? { cpHint } : {}) };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }, logger);
  } finally {
    try {
      await worker.terminate();
    } catch {
      // Worker shutdown must not erase crop results already recovered.
    }
  }
}

/** Read every OCR region independently so one crop failure does not discard the others. */
export async function recognizeOCRCrops(
  readCrop: (name: OCRCropName, index: number) => Promise<OCRCropRead>,
  logger?: (progress: number) => void,
): Promise<OCRResult> {
  const cropNames = Object.keys(OCR_CROPS) as OCRCropName[];
  const texts: string[] = [];
  const words: OCRWord[] = [];
  const failedCrops: OCRCropName[] = [];
  const regions: OCRRegionDiagnostic[] = [];
  let cpHint: number | null = null;
  let ivLabels: OCRWord[] = [];
  for (const [index, name] of cropNames.entries()) {
    try {
      const result = await readCrop(name, index);
      const normalizedText = normalizeOCRCropText(name, result.text);
      texts.push(normalizedText);
      regions.push({
        name,
        rawText: result.attempts?.[0] ?? result.text,
        text: normalizedText,
        attempts: result.attempts ?? [result.text],
        failed: false,
      });
      words.push(...(result.words ?? []));
      if (name === "cp") cpHint = result.cpHint === undefined ? parseCPHint(result.text) : result.cpHint;
      if (name === "bars") ivLabels = result.words ?? [];
    } catch {
      failedCrops.push(name);
      regions.push({ name, rawText: "", text: "", attempts: [], failed: true });
    } finally {
      logger?.((index + 1) / cropNames.length);
    }
  }
  const usefulWords = words.filter((word) => word.text.trim().length > 0);
  const confidence = usefulWords.length
    ? usefulWords.reduce((sum, word) => sum + word.confidence, 0) / usefulWords.length
    : 0;
  return { text: texts.join("\n"), confidence, words, ivLabels, cpHint, failedCrops, regions };
}

export function parseCPHint(text: string): number | null {
  const corrected = text.replace(/([A-Z])[Il|](?=\d)/gi, (_match, prefix: string) => `${prefix}1`);
  const match = corrected.match(/(?:CP|CR|P)[^0-9]{0,3}((?:\d\s*){2,5})\b/i);
  const bareNumber = corrected.trim().match(/^(\d(?:\s*\d){1,4})\s*[|!.,]?$/)?.[1];
  const value = match ? Number(match[1].replace(/\s/g, "")) : bareNumber ? Number(bareNumber.replace(/\s/g, "")) : null;
  return value !== null && value > 0 && value < 10000 ? value : null;
}

export function resolveCPHint(firstText: string, alternateText: string): number | null {
  const first = parseCPHint(firstText);
  const alternate = parseCPHint(alternateText);
  if (first === null || first !== alternate) return null;
  return first >= 1000 || (hasCPLabel(firstText) && hasCPLabel(alternateText)) ? first : null;
}

function hasCPLabel(text: string): boolean {
  return /(?:CP|CR)[^0-9]{0,3}\d/i.test(text);
}

/** Correct the consistent X→L/o confusion seen in the isolated XXL badge crop. */
export function normalizeOCRCropText(name: OCRCropName, text: string): string {
  return name === "xxlBadge" && /^\s*LoL\s*$/i.test(text) ? "XXL" : text;
}

function wordsFromBlocks(blocks: OCRBlock[]): OCRWord[] {
  return blocks.flatMap((block) => block.paragraphs
    .flatMap((paragraph) => paragraph.lines)
    .flatMap((line) => line.words)).map((word) => ({
    text: word.text,
    confidence: word.confidence,
    bbox: word.bbox,
  }));
}

function cropAndScale(source: HTMLImageElement, x: number, y: number, width: number, height: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function parseOCR(text: string, cpHint: number | null = null): Pick<ScanRecord, "species" | "cp" | "heightM" | "weightKg" | "xxl"> {
  const cleaned = text.replace(/\s+/g, " ");
  const cp = cleaned.match(/\bCP\s*[:#]?\s*(\d{1,5})\b/i)?.[1];
  const weight = cleaned.match(/\b(?:WEIGHT\s*)?(\d{1,4}(?:[.,]\d{1,3})?)\s*K[GE]\b/i)?.[1];
  const height = cleaned.match(/(?:HEIGHT\s*)?(\d{1,4}(?:[.,]\d{1,3})?)\s*M\b/i)?.[1];
  return {
    species: recognizeSpecies(cleaned),
    cp: cpHint ?? (cp ? Number(cp) : null),
    heightM: height ? Number(height.replace(",", ".")) : null,
    weightKg: weight ? Number(weight.replace(",", ".")) : null,
    xxl: /\bXXL\b/i.test(cleaned) ? true : null,
  };
}

export async function createScanRecord(
  file: File,
  id: string,
  logger?: (progress: number) => void,
): Promise<ScanRecord> {
  let image: Awaited<ReturnType<typeof loadImagePixels>>;
  try {
    image = await loadImagePixels(file);
  } catch {
    return assembleScanRecord(file, id, emptyOCRResult(), () => null, "Could not open this image. Choose another photo or enter known values manually.");
  }
  let ocr = emptyOCRResult();
  let ocrFailure: string | undefined;
  try {
    ocr = await recognizeImage(image.source, image.width, image.height, logger);
  } catch {
    ocrFailure = "Text recognition could not complete. Enter values manually where needed.";
  }
  try {
    return assembleScanRecord(
      file,
      id,
      ocr,
      () => readIVBars(image.data, image.width, image.height, ocr.ivLabels),
      ocrFailure,
    );
  } finally {
    image.dispose();
  }
}

/** Build a result from successful OCR fields, isolating any IV pixel-analysis failure. */
export function assembleScanRecord(
  file: Pick<File, "name">,
  id: string,
  ocr: OCRResult,
  detectIVs: () => ReturnType<typeof readIVBars>,
  ocrFailure?: string,
  scannedAt = new Date().toISOString(),
): ScanRecord {
  const extracted = parseOCR(ocr.text, ocr.cpHint);
  const formId = getExplicitSpeciesForm(extracted.species)?.formId ?? null;
  let foundIVs: ReturnType<typeof readIVBars> = null;
  let ivFailure = false;
  try {
    foundIVs = detectIVs();
  } catch {
    ivFailure = true;
  }

  const isDevelopment = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;
  if (isDevelopment && typeof window !== "undefined") {
    console.debug("Showcase Helper OCR diagnostics", {
      scanId: id,
      regions: (ocr.regions ?? []).map((region) => ({
        ...region,
        parsed: parsedValuesForRegion(region.name, region.text, ocr.cpHint, foundIVs),
      })),
      parsed: { ...extracted, ivs: foundIVs },
      failedCrops: ocr.failedCrops,
    });
  }

  const reviewReasons: string[] = [];
  if (!extracted.species) reviewReasons.push("Species was not read; choose it manually.");
  if (extracted.heightM === null) reviewReasons.push("Height was not read; enter it manually.");
  if (extracted.weightKg === null) reviewReasons.push("Weight was not read; enter it manually.");
  if (extracted.xxl === null) reviewReasons.push("XXL status was not clear; choose it manually.");
  if (!foundIVs) reviewReasons.push(ivFailure
    ? "IV bar detection failed; enter the appraisal IVs manually."
    : "Appraisal IV values were not found; enter them manually if visible.");
  if (ocr.confidence < 55 && ocr.text.trim()) reviewReasons.push("OCR confidence is low; review the extracted fields.");
  if (ocrFailure) reviewReasons.unshift(ocrFailure);

  return {
    scanId: id,
    fileName: file.name,
    scannedAt,
    ...extracted,
    formId,
    ivs: foundIVs ?? { attack: null, defense: null, hp: null },
    confidence: Math.round(ocr.confidence),
    reviewReasons,
    ocrText: ocr.text,
  };
}

function parsedValuesForRegion(
  name: OCRCropName,
  text: string,
  cpHint: number | null,
  ivs: ReturnType<typeof readIVBars>,
): Record<string, unknown> {
  if (name === "cp") return { cp: parseOCR(text, cpHint).cp };
  if (name === "size") {
    const parsed = parseOCR(text);
    return { heightM: parsed.heightM, weightKg: parsed.weightKg };
  }
  if (name === "catchInfo") return { species: recognizeSpecies(text) };
  if (name === "xxl" || name === "xxlBadge") return { xxl: /\bXXL\b/i.test(text) ? true : null };
  if (name === "bars") return { ivs };
  return {};
}

function emptyOCRResult(): OCRResult {
  return { text: "", confidence: 0, words: [], ivLabels: [], cpHint: null, failedCrops: [] };
}

async function loadImagePixels(file: File): Promise<{ data: Uint8ClampedArray; width: number; height: number; source: HTMLImageElement; dispose: () => void }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable in this browser.");
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    return {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
      source: image,
      dispose: () => {
        URL.revokeObjectURL(url);
        image.removeAttribute("src");
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
