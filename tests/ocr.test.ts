import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, PSM } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { assembleScanRecord, OCR_CROPS, parseCPHint, parseOCR, recognizeOCRCrops } from "../src/ocr";
import { readIVBars } from "../src/iv-bars";
import { calculateScore } from "../src/scoring";
import { findSpecies, recognizeSpecies } from "../src/species";
import { POKEMON_SPECIES_NAMES } from "../src/pokemon-names";

describe("OCR text extraction", () => {
  it("extracts the expected fields and species from appraisal catch text", () => {
    expect(parseOCR("CP 163 This Machop was caught on 10/06/2026 36.06kg 1.33m XXL"))
      .toEqual({ species: "Machop", cp: 163, heightM: 1.33, weightKg: 36.06, xxl: true });
    expect(parseOCR("CP 434 This Bulbasaur was caught on 02/06/2026 Weight 11.55kg Height 1.18m XXL"))
      .toEqual({ species: "Bulbasaur", cp: 434, heightM: 1.18, weightKg: 11.55, xxl: true });
    expect(parseOCR("CP 479 This Staryu was caught on 01/08/2025 Weight 56.36kg Height 1.32m XXL"))
      .toEqual({ species: "Staryu", cp: 479, heightM: 1.32, weightKg: 56.36, xxl: true });
    expect(recognizeSpecies("This Staryu was caught on 01/08/2025.")).toBe("Staryu");
    expect(recognizeSpecies("This Mr. Mime was caught yesterday.")).toBe("Mr. Mime");
    expect(POKEMON_SPECIES_NAMES).toHaveLength(1025);
    expect(findSpecies("Staryu")).toMatchObject({
      dex: 120,
      meanHeightM: 0.8,
      meanWeightKg: 34.5,
      weightDeviationKg: 4.3125,
      maxHeightClass: 1.75,
    });
  });

  it("keeps successful OCR regions when one crop fails", async () => {
    const result = await recognizeOCRCrops(async (name) => {
      if (name === "cp") throw new Error("simulated CP crop failure");
      if (name === "size") return { text: "56.36kg 1.32m XXL" };
      if (name === "catchInfo") return { text: "This Staryu was caught on 01/08/2025" };
      return { text: "" };
    });

    expect(result.failedCrops).toContain("cp");
    expect(parseOCR(result.text, result.cpHint)).toMatchObject({
      species: "Staryu",
      cp: null,
      heightM: 1.32,
      weightKg: 56.36,
      xxl: true,
    });
  });

  it("preserves OCR fields when IV pixel detection throws", () => {
    const text = "CP 479 This Staryu was caught on 01/08/2025 Weight 56.36kg Height 1.32m XXL";
    const record = assembleScanRecord(
      { name: "staryu-appraisal.jpg" },
      "staryu-scan",
      { text, confidence: 91, words: [], ivLabels: [], cpHint: null, failedCrops: [] },
      () => { throw new Error("simulated IV pixel failure"); },
      undefined,
      "2026-10-29T00:00:00.000Z",
    );

    expect(record).toMatchObject({ species: "Staryu", cp: 479, heightM: 1.32, weightKg: 56.36, xxl: true });
    expect(record.ivs).toEqual({ attack: null, defense: null, hp: null });
    expect(record.reviewReasons).toContain("IV bar detection failed; enter the appraisal IVs manually.");
    const score = calculateScore(record, findSpecies(record.species));
    expect(score.supported).toBe(true);
    expect(score.exact).toBeNull();
    expect(score.low).not.toBeNull();
    expect(score.high).not.toBeNull();
  });

  it("leaves IVs unknown when appraisal bars are not provided", () => {
    const fields = parseOCR("CP 163 This Machop was caught 36.06kg 1.33m XXL");
    expect(fields.species).toBe("Machop");
    expect(fields.cp).toBe(163);
    // IVs are not part of OCR text parsing; they only come from bar pixels or manual input.
  });

  it("recovers CP when the white CP label is misread on the colored catch screen", () => {
    expect(parseCPHint("cpr163")).toBe(163);
    expect(parseCPHint("crl63")).toBe(163);
    expect(parseCPHint("cr434")).toBe(434);
    expect(parseCPHint("479 |")).toBe(479);
  });

  it("accepts large displayed weights and heights without truncating digits", () => {
    expect(parseOCR("CP 1234 XXL Weight 1042.50kg Height 25.00m")).toMatchObject({
      cp: 1234,
      weightKg: 1042.5,
      heightM: 25,
      xxl: true,
    });
  });

  it("recognizes the appraisal and catch screenshots without using appraisal assumptions", async () => {
    const tesseractCache = join(process.cwd(), "node_modules", ".cache", "tesseract");
    await mkdir(tesseractCache, { recursive: true });
    const cases = [
      { file: "machop-appraisal.jpg", cp: 163, weightKg: 36.06, heightM: 1.33, species: "Machop", ivs: { attack: 15, defense: 6, hp: 14 } },
      { file: "machop-no-appraisal.jpg", cp: 163, weightKg: 36.06, heightM: 1.33, species: "Machop", ivs: null },
      { file: "bulbasaur-appraisal.jpg", cp: 434, weightKg: 11.55, heightM: 1.18, species: "Bulbasaur", ivs: { attack: 10, defense: 7, hp: 8 } },
      { file: "bulbasaur-no-appraisal.jpg", cp: 434, weightKg: 11.55, heightM: 1.18, species: "Bulbasaur", ivs: null },
      { file: "staryu-appraisal.jpg", cp: 479, weightKg: 56.36, heightM: 1.32, species: "Staryu", ivs: { attack: 12, defense: 15, hp: 12 } },
    ];
    for (const sample of cases) {
      const worker = await createWorker("eng", 1, { cachePath: tesseractCache });
      const path = fileURLToPath(new URL(`./fixtures/${sample.file}`, import.meta.url));
      const imageBuffer = await readFile(path);
      const image = await loadImage(imageBuffer);
      const texts: string[] = [];
      let cpHint: number | null = null;
      let barWords: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        for (const name of Object.keys(OCR_CROPS) as Array<keyof typeof OCR_CROPS>) {
          const crop = OCR_CROPS[name];
          const scale = 3;
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
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
          const { data } = await worker.recognize(canvas.toBuffer("image/png"), {}, { text: true, blocks: true });
          let cropText = data.text;
          if (name === "cp" && parseCPHint(cropText) === null) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
            const alternate = createCanvas(Math.round(image.width * crop.width * 4), Math.round(image.height * crop.height * 4));
            alternate.getContext("2d").drawImage(image, image.width * crop.x, image.height * crop.y, image.width * crop.width, image.height * crop.height, 0, 0, alternate.width, alternate.height);
            const alternateText = (await worker.recognize(alternate.toBuffer("image/png"), {}, { text: true })).data.text;
            if (parseCPHint(alternateText) !== null) cropText = alternateText;
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
            alternate.width = 0;
            alternate.height = 0;
          }
          texts.push(cropText);
          const words = (data.blocks ?? []).flatMap((block) => block.paragraphs
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
          if (name === "cp") cpHint = parseCPHint(cropText);
          if (name === "bars") barWords = words;
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        await worker.terminate();
      }

      const extracted = parseOCR(texts.join("\n"), cpHint);
      expect(extracted, sample.file).toMatchObject({
        species: sample.species,
        cp: sample.cp,
        weightKg: sample.weightKg,
        heightM: sample.heightM,
        xxl: true,
      });
      const canvas = createCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, image.width, image.height);
      expect(readIVBars(imageData.data, image.width, image.height, barWords), sample.file).toEqual(sample.ivs);
    }
  }, 120_000);
});
