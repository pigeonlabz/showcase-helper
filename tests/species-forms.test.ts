import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { calculateScore, formatPoints } from "../src/scoring";
import {
  findSpecies,
  getBaseSpeciesName,
  getScoringFormOptions,
  resolveSpeciesForScoring,
  SPECIES,
} from "../src/species";
import { parseOCR } from "../src/ocr";

const screenshotRegression = JSON.parse(
  await readFile(new URL("./fixtures/form-score-regressions.json", import.meta.url), "utf8"),
).farfetchdScreenshot as {
  species: string;
  formId: string;
  cp: number;
  heightM: number;
  weightKg: number;
  ivs: { attack: number; defense: number; hp: number };
  xxl: boolean;
  expectedScore: number;
  expectedNickname: string;
  ivsAreVerifiedFromImage: boolean;
};

describe("form-aware Showcase scoring", () => {
  it("uses the Galarian Farfetch'd form for the supplied screenshot measurements", () => {
    const options = getScoringFormOptions(screenshotRegression.species);
    expect(options.map(({ formId, label, species }) => ({
      formId,
      label,
      height: species.meanHeightM,
      weight: species.meanWeightKg,
    }))).toEqual([
      { formId: "FARFETCHD", label: "Kantonian", height: 0.8, weight: 15 },
      { formId: "FARFETCHD_GALARIAN", label: "Galarian", height: 0.8, weight: 42 },
    ]);
    expect(resolveSpeciesForScoring(screenshotRegression.species)).toBeUndefined();

    const galarian = resolveSpeciesForScoring(screenshotRegression.species, screenshotRegression.formId);
    expect(galarian).toMatchObject({ meanHeightM: 0.8, meanWeightKg: 42, maxHeightClass: 1.75 });
    const score = calculateScore({
      heightM: screenshotRegression.heightM,
      weightKg: screenshotRegression.weightKg,
      ivs: screenshotRegression.ivs,
      xxl: screenshotRegression.xxl,
    }, galarian);

    expect(score.exact).toBeCloseTo(screenshotRegression.expectedScore, 7);
    expect(formatPoints(score.exact!)).toBe(screenshotRegression.expectedNickname.slice(4));
    const kantonian = resolveSpeciesForScoring(screenshotRegression.species, "FARFETCHD");
    const baseProfileScore = calculateScore({
      heightM: screenshotRegression.heightM,
      weightKg: screenshotRegression.weightKg,
      ivs: screenshotRegression.ivs,
      xxl: screenshotRegression.xxl,
    }, kantonian);
    expect(formatPoints(baseProfileScore.exact!)).toBe("1289");
    expect(baseProfileScore.exact).toBeGreaterThan(1178); // Do not clamp a wrong-form result to hide the mismatch.
    const baseProfileWithIVSum24 = calculateScore({
      heightM: screenshotRegression.heightM,
      weightKg: screenshotRegression.weightKg,
      ivs: { attack: 15, defense: 3, hp: 6 },
      xxl: screenshotRegression.xxl,
    }, kantonian);
    expect(formatPoints(baseProfileWithIVSum24.exact!)).toBe("1305");
    expect(screenshotRegression.cp).toBe(692); // CP is retained as data and is not a score input.
    expect(screenshotRegression.ivsAreVerifiedFromImage).toBe(false);
  });

  it("recognizes a form only when OCR actually includes its qualifier", () => {
    expect(parseOCR("This Farfetch'd was caught 79.22kg 1.31m XXL").species).toBe("Farfetch'd");
    expect(parseOCR("This Galarian Farfetch'd was caught 79.22kg 1.31m XXL").species)
      .toBe("Farfetch'd (Galarian)");
    expect(resolveSpeciesForScoring("Galarian Farfetch'd")).toMatchObject({ formId: "FARFETCHD_GALARIAN" });
  });

  it("scores Galarian and Kantonian Ponyta against their own Game Master rows", () => {
    const options = getScoringFormOptions("Ponyta");
    expect(options.map(({ formId, species }) => [formId, species.meanHeightM, species.meanWeightKg])).toEqual([
      ["PONYTA", 1, 30],
      ["PONYTA_GALARIAN", 0.8, 24],
    ]);
    const measurements = {
      heightM: 1.31,
      weightKg: 79.22,
      ivs: { attack: 0, defense: 3, hp: 6 },
      xxl: true,
    };
    const kantonianScore = calculateScore(measurements, resolveSpeciesForScoring("Ponyta", "PONYTA")).exact!;
    const galarianScore = calculateScore(measurements, resolveSpeciesForScoring("Ponyta", "PONYTA_GALARIAN")).exact!;
    expect(kantonianScore).not.toBe(galarianScore);
  });

  it("requires an explicit selection for every bundled family with distinct score profiles", () => {
    const families = new Map<number, string>();
    for (const species of SPECIES) families.set(species.dex, getBaseSpeciesName(species.name) ?? species.name);
    const ambiguous = [...families.values()].filter((name) => getScoringFormOptions(name).length > 0);
    expect(ambiguous).toContain("Farfetch'd");
    expect(ambiguous).toContain("Ponyta");
    for (const name of ambiguous) {
      expect(resolveSpeciesForScoring(name), `${name} must not silently default`).toBeUndefined();
      for (const option of getScoringFormOptions(name)) {
        expect(resolveSpeciesForScoring(name, option.formId), `${name} ${option.label}`).toBe(option.species);
      }
    }
  });

  it("keeps the Kantonian lookup available for explicit selections", () => {
    expect(findSpecies("Farfetch'd")).toBeUndefined();
    expect(resolveSpeciesForScoring("Farfetch'd", "FARFETCHD")).toMatchObject({ meanWeightKg: 15 });
  });
});
