import { describe, expect, it } from "vitest";
import { exportCSV, exportJSON, importJSON, newScanId } from "../src/data";
import type { ScanRecord } from "../src/types";

const sample: ScanRecord = {
  scanId: "scan-original",
  fileName: "machop, one.jpg",
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

describe("scan data handling", () => {
  it("creates distinct scan identifiers for repeated uploads", () => {
    const ids = new Set(Array.from({ length: 4 }, () => newScanId()));
    expect(ids.size).toBe(4);
  });

  it("exports JSON and imports as new appended scans", () => {
    const imported = importJSON(exportJSON([sample, sample]));
    expect(imported).toHaveLength(2);
    expect(imported[0].scanId).not.toBe("scan-original");
    expect(imported[0].scanId).not.toBe(imported[1].scanId);
  });

  it("escapes CSV values and includes extracted fields", () => {
    const csv = exportCSV([sample]);
    expect(csv).toContain('"machop, one.jpg"');
    expect(csv).toContain('scan-original,"machop, one.jpg"');
    expect(csv).toContain("15,6,14");
  });
});
