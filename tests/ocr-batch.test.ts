import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, PSM } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OCR_CROPS, OCR_SIZE_RETRY, parseCPHint, parseOCR, recognizeOCRCrops, resolveCPHint } from "../src/ocr";
import { readIVBars } from "../src/iv-bars";
import type { OCRWord, IVs } from "../src/types";

type OCRBatchExpectation = {
  file: string;
  species: string | null;
  cp: number | null;
  heightM: number | null;
  weightKg: number | null;
  size: boolean | null;
  ivs: IVs | null;
  manualCorrectionFields?: Array<"species" | "heightM" | "weightKg" | "size" | "ivs">;
  rootCauses?: Partial<Record<"cp" | "species" | "heightM" | "weightKg" | "size" | "ivs", string>>;
};

const expectedResults = JSON.parse(
  await readFile(new URL("./fixtures/ocr-batch-expected.json", import.meta.url), "utf8"),
) as OCRBatchExpectation[];

describe("batch OCR regression screenshots", () => {
  let worker: Awaited<ReturnType<typeof createWorker>>;
  const observed: Array<{ sample: OCRBatchExpectation; actual: Record<string, unknown> }> = [];

  beforeAll(async () => {
    await mkdir(join(process.cwd(), "node_modules", ".cache", "tesseract"), { recursive: true });
    worker = await createWorker("eng", 1, { cachePath: join(process.cwd(), "node_modules", ".cache", "tesseract") });
  }, 120_000);

  afterAll(async () => {
    await worker?.terminate();
    const fields = ["species", "cp", "heightM", "weightKg", "size", "ivs"] as const;
    const accuracy = Object.fromEntries(fields.map((field) => {
      const expectedKey = field === "size" ? "size" : field;
      const actualKey = field === "size" ? "size" : field;
      const eligible = observed.filter(({ sample }) => sample[expectedKey] !== null);
      const correct = eligible.filter(({ sample, actual }) => JSON.stringify(sample[expectedKey]) === JSON.stringify(actual[actualKey])).length;
      const unreadable = observed.filter(({ sample }) => sample[expectedKey] === null).length;
      const falseReads = observed.filter(({ sample, actual }) => sample[expectedKey] === null && actual[actualKey] !== null).length;
      return [field, { correct, known: eligible.length, unreadable, falseReads }];
    }));
    const extractionFailures = observed.flatMap(({ sample, actual }) => fields.flatMap((field) => {
      const expected = sample[field];
      const recognized = actual[field];
      if (JSON.stringify(expected) === JSON.stringify(recognized)) return [];
      return [{ file: sample.file, field, expected, recognized, rootCause: sample.rootCauses?.[field] ?? "No additional OCR failure was confirmed." }];
    }));
    const manualCorrections = observed
      .filter(({ sample }) => sample.manualCorrectionFields?.length)
      .map(({ sample }) => ({
        file: sample.file,
        fields: sample.manualCorrectionFields,
        reasons: Object.fromEntries((sample.manualCorrectionFields ?? []).map((field) => [field, sample.rootCauses?.[field] ?? "This value is not readable from the supplied screenshot."])),
      }));
    process.stdout.write(`[OCR batch field accuracy] ${JSON.stringify({ accuracy, extractionFailures, manualCorrections }, null, 2)}\n`);
  });

  it.each(expectedResults)("extracts fields from $file", async (sample) => {
    const path = fileURLToPath(new URL(`./fixtures/${sample.file}`, import.meta.url));
    const image = await loadImage(await readFile(path));
    const ocr = await recognizeOCRCrops(async (name) => {
      const crop = OCR_CROPS[name];
      const scale = name === "xxlBadge" ? 6 : 3;
      await worker.setParameters({ tessedit_pageseg_mode: name === "xxlBadge" ? PSM.SINGLE_WORD : PSM.SINGLE_BLOCK });
      const canvas = createCanvas(
        Math.round(image.width * crop.width * scale),
        Math.round(image.height * crop.height * scale),
      );
      canvas.getContext("2d").drawImage(
        image,
        image.width * crop.x,
        image.height * crop.y,
        image.width * crop.width,
        image.height * crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      try {
        const first = await worker.recognize(canvas.toBuffer("image/png"), {}, { text: true, blocks: true });
        let text = first.data.text;
        const attempts = [text];
        let cpHint: number | null | undefined;
        if (name === "cp") {
          const firstText = text;
          const firstHint = parseCPHint(firstText);
          const hasLabel = /(?:CP|CR)[^0-9]{0,3}\d/i.test(firstText);
          if (firstHint !== null && hasLabel && firstHint >= 1000) {
            cpHint = firstHint;
            text = `CP ${firstHint}`;
          } else {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
            const alternate = createCanvas(Math.round(image.width * crop.width * 4), Math.round(image.height * crop.height * 4));
            alternate.getContext("2d").drawImage(
              image,
              image.width * crop.x,
              image.height * crop.y,
              image.width * crop.width,
              image.height * crop.height,
              0,
              0,
              alternate.width,
              alternate.height,
            );
            try {
              const second = await worker.recognize(alternate.toBuffer("image/png"), {}, { text: true });
              attempts.push(second.data.text);
              cpHint = resolveCPHint(firstText, second.data.text);
              text = cpHint === null ? "" : `CP ${cpHint}`;
            } finally {
              alternate.width = 0;
              alternate.height = 0;
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
            }
          }
        } else if (name === "size") {
          const firstFields = parseOCR(text);
          if (firstFields.weightKg === null || firstFields.heightM === null) {
            try {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
              const alternate = createCanvas(
                Math.round(image.width * OCR_SIZE_RETRY.width * OCR_SIZE_RETRY.scale),
                Math.round(image.height * OCR_SIZE_RETRY.height * OCR_SIZE_RETRY.scale),
              );
              alternate.getContext("2d").drawImage(
                image,
                image.width * OCR_SIZE_RETRY.x,
                image.height * OCR_SIZE_RETRY.y,
                image.width * OCR_SIZE_RETRY.width,
                image.height * OCR_SIZE_RETRY.height,
                0,
                0,
                alternate.width,
                alternate.height,
              );
              try {
                const second = await worker.recognize(alternate.toBuffer("image/png"), {}, { text: true });
                attempts.push(second.data.text);
                const alternateFields = parseOCR(second.data.text);
                const recoveredWeight = firstFields.weightKg === null && alternateFields.weightKg !== null;
                const recoveredHeight = firstFields.heightM === null && alternateFields.heightM !== null;
                if (recoveredWeight || recoveredHeight) text = `${text}\n${second.data.text}`;
              } finally {
                alternate.width = 0;
                alternate.height = 0;
              }
            } finally {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
            }
          }
        }
        const words: OCRWord[] = (first.data.blocks ?? []).flatMap((block) => block.paragraphs
          .flatMap((paragraph) => paragraph.lines)
          .flatMap((line) => line.words).map((word) => ({
            text: word.text,
            confidence: word.confidence,
            bbox: {
              x0: word.bbox.x0 / scale + image.width * crop.x,
              y0: word.bbox.y0 / scale + image.height * crop.y,
              x1: word.bbox.x1 / scale + image.width * crop.x,
              y1: word.bbox.y1 / scale + image.height * crop.y,
            },
          })));
        return { text, words, attempts, ...(name === "cp" ? { cpHint } : {}) };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    });

    const fields = parseOCR(ocr.text, ocr.cpHint);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    const ivs = readIVBars(pixels.data, image.width, image.height, ocr.ivLabels);
    const actual = { ...fields, size: fields.xxl, ivs };
    observed.push({ sample, actual });
    if (process.env.SHOWCASE_OCR_DIAGNOSTICS === "1") {
      process.stdout.write(`${JSON.stringify({ file: sample.file, regions: ocr.regions, fields, ivs }, null, 2)}\n`);
    }

    const manuallyNeeded = [
      ...(fields.species !== sample.species ? ["species"] : []),
      ...(sample.heightM === null || fields.heightM !== sample.heightM ? ["heightM"] : []),
      ...(sample.weightKg === null || fields.weightKg !== sample.weightKg ? ["weightKg"] : []),
      ...(sample.size === null || fields.xxl !== sample.size ? ["size"] : []),
      ...(sample.ivs === null || JSON.stringify(ivs) !== JSON.stringify(sample.ivs) ? ["ivs"] : []),
    ].sort();
    expect(manuallyNeeded, `${sample.file} manual correction fields`).toEqual([...(sample.manualCorrectionFields ?? [])].sort());

    // CP errors are reported in the accuracy summary, but never block valid scan fields.
    expect(fields.cp === sample.cp || fields.cp === null, `${sample.file} CP may be absent but not guessed`).toBe(true);
  }, 120_000);
});
