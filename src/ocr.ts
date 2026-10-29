import { createWorker, PSM } from "tesseract.js";
import type { OCRWord, ScanRecord } from "./types";
import { recognizeSpecies } from "./species";
import { readIVBars } from "./iv-bars";

export type OCRResult = {
  text: string;
  confidence: number;
  words: OCRWord[];
  ivLabels: OCRWord[];
  cpHint: number | null;
  failedCrops: OCRCropName[];
};

export type OCRCropRead = { text: string; words?: OCRWord[] };

export const OCR_CROPS = {
  cp: { x: 0.27, y: 0.035, width: 0.46, height: 0.09 },
  size: { x: 0.05, y: 0.49, width: 0.9, height: 0.12 },
  catchInfo: { x: 0.02, y: 0.9, width: 0.96, height: 0.09 },
  speciesInfo: { x: 0.03, y: 0.6, width: 0.94, height: 0.19 },
  xxl: { x: 0.25, y: 0.37, width: 0.5, height: 0.14 },
  bars: { x: 0.05, y: 0.73, width: 0.5, height: 0.2 },
} as const;

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
      const scale = 3;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
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
        if (name === "cp" && parseCPHint(text) === null) {
          try {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
            const alternateCanvas = cropAndScale(source, width * crop.x, height * crop.y, width * crop.width, height * crop.height, 4);
            try {
              const alternate = await worker.recognize(alternateCanvas, {}, { text: true });
              if (parseCPHint(alternate.data.text) !== null) text = alternate.data.text;
            } finally {
              alternateCanvas.width = 0;
              alternateCanvas.height = 0;
            }
          } catch {
            // Keep the first crop text and leave CP unknown if the alternate pass fails.
          } finally {
            try { await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }); } catch { /* Keep the worker usable. */ }
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
        return { text, words: regionWords };
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
  let cpHint: number | null = null;
  let ivLabels: OCRWord[] = [];
  for (const [index, name] of cropNames.entries()) {
    try {
      const result = await readCrop(name, index);
      texts.push(result.text);
      words.push(...(result.words ?? []));
      if (name === "cp") cpHint = parseCPHint(result.text);
      if (name === "bars") ivLabels = result.words ?? [];
    } catch {
      failedCrops.push(name);
    } finally {
      logger?.((index + 1) / cropNames.length);
    }
  }
  const usefulWords = words.filter((word) => word.text.trim().length > 0);
  const confidence = usefulWords.length
    ? usefulWords.reduce((sum, word) => sum + word.confidence, 0) / usefulWords.length
    : 0;
  return { text: texts.join("\n"), confidence, words, ivLabels, cpHint, failedCrops };
}

export function parseCPHint(text: string): number | null {
  const corrected = text.replace(/([A-Z])[Il|](?=\d)/gi, (_match, prefix: string) => `${prefix}1`);
  const match = corrected.match(/(?:CP|CR)[^0-9]{0,3}((?:\d\s*){2,5})\b/i);
  const bareNumber = corrected.trim().match(/^(\d(?:\s*\d){1,4})\s*[|!.,]?$/)?.[1];
  const value = match ? Number(match[1].replace(/\s/g, "")) : bareNumber ? Number(bareNumber.replace(/\s/g, "")) : null;
  return value !== null && value > 0 && value < 10000 ? value : null;
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
  const weight = cleaned.match(/(?:WEIGHT\s*)?([0-9]{1,5}[.,][0-9]{1,3})\s*KG\b/i)?.[1];
  const height = cleaned.match(/(?:HEIGHT\s*)?([0-9]{1,4}[.,][0-9]{1,3})\s*M\b/i)?.[1];
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
  let foundIVs: ReturnType<typeof readIVBars> = null;
  let ivFailure = false;
  try {
    foundIVs = detectIVs();
  } catch {
    ivFailure = true;
  }

  const reviewReasons: string[] = [];
  if (!extracted.species) reviewReasons.push("Species was not read; choose it manually.");
  if (extracted.cp === null) reviewReasons.push("CP was not read (optional; not used for scoring).");
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
    ivs: foundIVs ?? { attack: null, defense: null, hp: null },
    confidence: Math.round(ocr.confidence),
    reviewReasons,
    ocrText: ocr.text,
  };
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
