import { describe, expect, it } from "vitest";
import { submitManualEdits, type ManualScanEdits } from "../src/editing";
import { calculateScore, formatPoints } from "../src/scoring";
import { findSpecies } from "../src/species";
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
