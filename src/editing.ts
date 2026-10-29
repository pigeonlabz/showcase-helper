import { calculateScore, formatPoints } from "./scoring";
import { findSpecies } from "./species";
import type { ScanRecord } from "./types";

export type ManualScanEdits = {
  species: string;
  cp: string;
  heightM: string;
  weightKg: string;
  xxl: string;
  attackIV: string;
  defenseIV: string;
  hpIV: string;
};

export type ManualEditErrors = Partial<Record<keyof ManualScanEdits, string>>;

export type ManualEditResult =
  | { ok: true; record: ScanRecord; score: ReturnType<typeof calculateScore>; nickname: string | null }
  | { ok: false; errors: ManualEditErrors };

/** Validate one edit form, then produce the saved scan and its recalculated score. */
export function submitManualEdits(record: ScanRecord, values: ManualScanEdits): ManualEditResult {
  const errors: ManualEditErrors = {};
  const speciesName = values.species.trim();
  if (!speciesName) errors.species = "Enter a Pokémon species.";
  else if (speciesName.length > 50) errors.species = "Use a species name up to 50 characters.";

  const cp = parseOptionalCP(values.cp, errors);
  const heightM = parseRequiredNumber(values.heightM, "heightM", 0, 1000, false, errors, "Enter a height greater than 0 m.");
  const weightKg = parseRequiredNumber(values.weightKg, "weightKg", 0, 100000, false, errors, "Enter a weight greater than 0 kg.");
  const xxl = values.xxl;
  if (!["yes", "no", "unknown"].includes(xxl)) errors.xxl = "Choose XXL, Not XXL, or Unknown.";

  const attack = parseIV(values.attackIV, "attackIV", errors);
  const defense = parseIV(values.defenseIV, "defenseIV", errors);
  const hp = parseIV(values.hpIV, "hpIV", errors);

  if (Object.keys(errors).length) return { ok: false, errors };

  const speciesData = findSpecies(speciesName);
  const normalizedSpecies = speciesData?.name ?? speciesName;
  const updatedRecord: ScanRecord = {
    ...record,
    species: normalizedSpecies,
    cp,
    heightM: heightM!,
    weightKg: weightKg!,
    xxl: xxl === "unknown" ? null : xxl === "yes",
    ivs: { attack, defense, hp },
    reviewReasons: speciesData ? [] : [`Scoring data unavailable for ${normalizedSpecies}.`],
  };
  const score = calculateScore(updatedRecord, speciesData);
  const nickname = score.exact === null
    ? null
    : `${updatedRecord.xxl ? "XXL" : "GO"} ${formatPoints(score.exact)}`;

  return { ok: true, record: updatedRecord, score, nickname };
}

function parseRequiredNumber(
  rawValue: string,
  field: "heightM" | "weightKg",
  min: number,
  max: number,
  integer: boolean,
  errors: ManualEditErrors,
  message: string,
): number | null {
  const normalized = rawValue.trim().replace(",", ".");
  const parsed = normalized === "" ? Number.NaN : Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= min || parsed > max || (integer && !Number.isInteger(parsed))) {
    errors[field] = message;
    return null;
  }
  return parsed;
}

function parseOptionalCP(rawValue: string, errors: ManualEditErrors): number | null {
  const normalized = rawValue.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 99999) {
    errors.cp = "Enter a whole CP from 10 to 99,999, or leave it blank if unknown.";
    return null;
  }
  return parsed;
}

function parseIV(rawValue: string, field: "attackIV" | "defenseIV" | "hpIV", errors: ManualEditErrors): number | null {
  const normalized = rawValue.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 15) {
    errors[field] = "Enter a whole IV from 0 to 15, or leave it blank if unknown.";
    return null;
  }
  return parsed;
}
