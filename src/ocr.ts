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
};

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
  const cropNames = Object.keys(OCR_CROPS) as OCRCropName[];
  let activeCropIndex = 0;
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        logger?.((activeCropIndex + Math.max(0, Math.min(1, message.progress))) / cropNames.length);
      }
    },
  });
  const texts: string[] = [];
  const words: OCRWord[] = [];
  let cpHint: number | null = null;
  let ivLabels: OCRWord[] = [];
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    for (const [index, name] of cropNames.entries()) {
      activeCropIndex = index;
      const crop = OCR_CROPS[name];
      const canvas = cropAndScale(
        source,
        width * crop.x,
        height * crop.y,
        width * crop.width,
        height * crop.height,
        3,
      );
      try {
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        texts.push(result.data.text);
        const regionWords = wordsFromBlocks(result.data.blocks ?? []).map((word) => ({
          ...word,
          bbox: {
            x0: word.bbox.x0 / 3 + width * crop.x,
            y0: word.bbox.y0 / 3 + height * crop.y,
            x1: word.bbox.x1 / 3 + width * crop.x,
            y1: word.bbox.y1 / 3 + height * crop.y,
          },
        }));
        words.push(...regionWords);
        if (name === "cp") cpHint = parseCPHint(result.data.text);
        if (name === "bars") ivLabels = regionWords;
        logger?.((index + 1) / cropNames.length);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } finally {
    await worker.terminate();
  }
  const usefulWords = words.filter((word) => word.text.trim().length > 0);
  const confidence = usefulWords.length
    ? usefulWords.reduce((sum, word) => sum + word.confidence, 0) / usefulWords.length
    : 0;
  return { text: texts.join("\n"), confidence, words, ivLabels, cpHint };
}

export function parseCPHint(text: string): number | null {
  const corrected = text.replace(/([A-Z])[Il|](?=\d)/gi, (_match, prefix: string) => `${prefix}1`);
  const match = corrected.match(/(?:CP|CR)[^0-9]{0,3}((?:\d\s*){2,5})\b/i);
  const value = match ? Number(match[1].replace(/\s/g, "")) : null;
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
    cp: cp ? Number(cp) : cpHint,
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
  const image = await loadImagePixels(file);
  let ocr: OCRResult;
  let foundIVs: ReturnType<typeof readIVBars>;
  try {
    ocr = await recognizeImage(image.source, image.width, image.height, logger);
    foundIVs = readIVBars(image.data, image.width, image.height, ocr.ivLabels);
  } finally {
    image.dispose();
  }
  const extracted = parseOCR(ocr.text, ocr.cpHint);

  const reviewReasons: string[] = [];
  if (!extracted.species) reviewReasons.push("Choose the Pokémon species.");
  if (extracted.cp === null) reviewReasons.push("CP was not read; check it manually.");
  if (extracted.heightM === null) reviewReasons.push("Height was not read; check it manually.");
  if (extracted.weightKg === null) reviewReasons.push("Weight was not read; check it manually.");
  if (extracted.xxl === null) reviewReasons.push("XXL status was not clear; check it manually.");
  if (!foundIVs) reviewReasons.push("Appraisal bars were not clear; enter IVs manually if visible.");
  if (ocr.confidence < 55) reviewReasons.push("OCR confidence is low; review extracted values.");

  return {
    scanId: id,
    fileName: file.name,
    scannedAt: new Date().toISOString(),
    ...extracted,
    ivs: foundIVs ?? { attack: null, defense: null, hp: null },
    confidence: Math.round(ocr.confidence),
    reviewReasons,
    ocrText: ocr.text,
  };
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
