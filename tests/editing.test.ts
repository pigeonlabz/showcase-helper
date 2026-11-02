import { describe, expect, it } from "vitest";
import { submitManualEdits, type ManualScanEdits } from "../src/editing";
import { calculateScore, formatPoints } from "../src/scoring";
import { findSpecies, resolveSpeciesForScoring } from "../src/species";
import type { ScanRecord } from "../src/types";

const sample: ScanRecord = {
  scanId: "scan-machop-original",
  fileName: "machop.jpg",
  scannedAt: "2026-10-29T00:00:00.000Z",
  species: "Machop",
  cp: 163,
  heightM: 1.33,
  weightKg: 36.06,
  xxl: true,
  ivs: { attack: 15, defense: 6, hp: 14 },
  confidence: 92,
  reviewReasons: [],
  ocrText: "This Machop was caught",
};

const corrected: ManualScanEdits = {
  species: "Machop",
  cp: "163",
  heightM: "1.33",
  weightKg: "36.06",
  xxl: "yes",
  attackIV: "14",
  defenseIV: "6",
  hpIV: "14",
};

describe("manual scan edits", () => {
  it("submits corrections, keeps the scan ID, and recalculates the score and nickname", () => {
    const before = calculateScore(sample, findSpecies(sample.species)).exact;
    const result = submitManualEdits(sample, corrected);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.scanId).toBe(sample.scanId);
    expect(result.record.ivs.attack).toBe(14);
    expect(result.score.exact).not.toBe(before);
    expect(result.nickname).toBe(`XXL ${formatPoints(result.score.exact!)}`);
    expect(sample.ivs.attack).toBe(15);
  });

  it("allows CP to remain unknown without blocking score recalculation", () => {
    const result = submitManualEdits(sample, { ...corrected, cp: "" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.cp).toBeNull();
    expect(result.score.exact).not.toBeNull();
    expect(result.nickname).not.toBeNull();
  });

  it("preserves a selected regional form, scan ID, and measurements through manual correction", () => {
    const farfetchd: ScanRecord = {
      ...sample,
      scanId: "scan-farfetchd-galarian",
      species: "Farfetch'd",
      formId: "FARFETCHD_GALARIAN",
      cp: 692,
      heightM: 1.31,
      weightKg: 79.22,
      ivs: { attack: 0, defense: 3, hp: 6 },
    };
    const result = submitManualEdits(farfetchd, {
      ...corrected,
      species: "Farfetch'd",
      cp: "692",
      heightM: "1.31",
      weightKg: "79.22",
      xxl: "yes",
      attackIV: "0",
      defenseIV: "3",
      hpIV: "6",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      scanId: farfetchd.scanId,
      species: "Farfetch'd",
      formId: "FARFETCHD_GALARIAN",
      cp: 692,
      heightM: 1.31,
      weightKg: 79.22,
      ivs: { attack: 0, defense: 3, hp: 6 },
    });
    expect(result.score.exact).toBeCloseTo(1062.366240805, 7);
    expect(result.nickname).toBe("XXL 1062");
    expect(resolveSpeciesForScoring(result.record.species, result.record.formId)?.meanWeightKg).toBe(42);
  });

  it("returns actionable errors without changing the scan when values are invalid", () => {
    const result = submitManualEdits(sample, {
      ...corrected,
      species: "",
      cp: "0",
      heightM: "not a number",
      weightKg: "",
      xxl: "maybe",
      attackIV: "16",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      species: expect.any(String),
      cp: expect.any(String),
      heightM: expect.any(String),
      weightKg: expect.any(String),
      xxl: expect.any(String),
      attackIV: expect.any(String),
    });
    expect(sample.scanId).toBe("scan-machop-original");
    expect(sample.ivs.attack).toBe(15);
  });
});
