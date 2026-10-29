import type { IVs, ScanRecord } from "./types";

export function newScanId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function exportJSON(records: ScanRecord[]): string {
  return JSON.stringify({ format: "showcase-helper", version: 1, scans: records }, null, 2);
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCSV(records: ScanRecord[]): string {
  const headers = ["scanId", "fileName", "species", "cp", "heightM", "weightKg", "xxl", "attackIV", "defenseIV", "hpIV", "confidence", "reviewRequired", "scannedAt"];
  const rows = records.map((record) => [
    record.scanId,
    record.fileName,
    record.species,
    record.cp,
    record.heightM,
    record.weightKg,
    record.xxl,
    record.ivs.attack,
    record.ivs.defense,
    record.ivs.hp,
    record.confidence,
    record.reviewReasons.length > 0,
    record.scannedAt,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function asNumber(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function asIVs(value: unknown): IVs {
  if (!value || typeof value !== "object") return { attack: null, defense: null, hp: null };
  const ivs = value as Record<string, unknown>;
  return {
    attack: asNumber(ivs.attack, 0, 15),
    defense: asNumber(ivs.defense, 0, 15),
    hp: asNumber(ivs.hp, 0, 15),
  };
}

/** Imported rows are appended with fresh IDs; importing never merges or replaces scans. */
export function importJSON(text: string): ScanRecord[] {
  const parsed = JSON.parse(text) as { scans?: unknown } | unknown[];
  const scans = Array.isArray(parsed) ? parsed : (parsed as { scans?: unknown }).scans;
  if (!Array.isArray(scans)) throw new Error("This file does not contain a scan list.");

  return scans.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Imported scan ${index + 1} is not an object.`);
    const row = item as Record<string, unknown>;
    const species = typeof row.species === "string" ? row.species : "";
    const record: ScanRecord = {
      scanId: newScanId(),
      fileName: typeof row.fileName === "string" ? row.fileName : "Imported result",
      scannedAt: new Date().toISOString(),
      species,
      cp: asNumber(row.cp, 0, 99999),
      heightM: asNumber(row.heightM, 0, 1000),
      weightKg: asNumber(row.weightKg, 0, 100000),
      xxl: typeof row.xxl === "boolean" ? row.xxl : null,
      ivs: asIVs(row.ivs),
      confidence: asNumber(row.confidence, 0, 100) ?? 0,
      reviewReasons: Array.isArray(row.reviewReasons) ? row.reviewReasons.filter((reason): reason is string => typeof reason === "string") : [],
      ocrText: typeof row.ocrText === "string" ? row.ocrText : "",
    };
    return record;
  });
}
