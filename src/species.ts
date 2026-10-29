import sizeDatasetJson from "./data/species-sizes.json";
import type { SpeciesData } from "./types";
import { POKEMON_SPECIES_NAMES } from "./pokemon-names";

type SizeRow = [string, number, number, number, number, 1.55 | 1.75 | 2];
type SpeciesSizeDataset = {
  schemaVersion: number;
  source: { repository: string; revision: string; file: string; sha256: string; method: string };
  includedRows: number;
  excludedRows: { unverified: number; missingConstants: number; unsupportedClass: number };
  rows: SizeRow[];
};

const sizeDataset = sizeDatasetJson as unknown as SpeciesSizeDataset;
const dataSource = `Verified Pokémon GO Game Master size data (${sizeDataset.source.revision})`;

// Only complete, upstream-verified rows enter this table. Missing values never receive generic defaults.
export const SPECIES: SpeciesData[] = sizeDataset.rows.map(([identifier, dex, meanHeightM, meanWeightKg, weightDeviationKg, maxHeightClass]) => ({
  name: displaySpeciesName(identifier, dex),
  dex,
  meanHeightM,
  meanWeightKg,
  weightDeviationKg,
  maxHeightClass,
  source: dataSource,
}));

const speciesByName = new Map<string, SpeciesData>();
for (const [index, [identifier, dex]] of sizeDataset.rows.entries()) {
  const species = SPECIES[index];
  const formId = identifier.replace(/_ALL$/i, "");
  registerSpeciesName(identifier, species);
  registerSpeciesName(formId, species);
  registerSpeciesName(species.name, species);

  const baseName = POKEMON_SPECIES_NAMES[dex - 1];
  if (!baseName) continue;
  const normalizedBase = normalizeSpeciesName(baseName);
  const normalizedForm = normalizeSpeciesName(formId);
  if (normalizedForm === normalizedBase) registerSpeciesName(baseName, species);
  if (!normalizedForm.startsWith(`${normalizedBase} `)) continue;

  const formSuffix = normalizedForm.slice(normalizedBase.length + 1);
  registerSpeciesName(`${baseName} ${formSuffix}`, species);
  const [formFamily, ...remainingForm] = formSuffix.split(" ");
  const regionalAdjectives: Record<string, string> = {
    alola: "Alolan",
    alolan: "Alolan",
    galarian: "Galarian",
    hisuian: "Hisuian",
    paldea: "Paldean",
    paldean: "Paldean",
  };
  const regional = regionalAdjectives[formFamily];
  if (regional) {
    registerSpeciesName(`${regional} ${baseName} ${remainingForm.join(" ")}`.trim(), species);
  } else if (formFamily === "mega" || formFamily === "primal") {
    registerSpeciesName(`${formFamily} ${baseName} ${remainingForm.join(" ")}`.trim(), species);
  }
}

export function findSpecies(name: string): SpeciesData | undefined {
  return speciesByName.get(normalizeSpeciesName(name));
}

function registerSpeciesName(name: string, species: SpeciesData): void {
  const normalized = normalizeSpeciesName(name);
  if (normalized && !speciesByName.has(normalized)) speciesByName.set(normalized, species);
}

function displaySpeciesName(identifier: string, dex: number): string {
  const baseName = POKEMON_SPECIES_NAMES[dex - 1];
  const formId = identifier.replace(/_ALL$/i, "");
  const normalizedForm = normalizeSpeciesName(formId);
  if (baseName) {
    const normalizedBase = normalizeSpeciesName(baseName);
    if (normalizedForm === normalizedBase) return baseName;
    if (normalizedForm.startsWith(`${normalizedBase} `)) {
      const suffix = normalizedForm.slice(normalizedBase.length + 1)
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      return `${baseName} (${suffix})`;
    }
  }
  return formId.split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function recognizeSpecies(text: string): string {
  const caughtName = text.match(/\bThis\s+(.+?)\s+was\s+caught\b/i)?.[1];
  return (caughtName ? matchKnownSpecies(caughtName) : "") || matchKnownSpecies(text);
}

const NAME_ALIASES: Array<[string, string]> = [
  ["Nidoran F", "Nidoran♀"],
  ["Nidoran M", "Nidoran♂"],
];

const speciesMatchers = [
  ...POKEMON_SPECIES_NAMES.map((name) => ({ name, normalized: normalizeSpeciesName(name) })),
  ...NAME_ALIASES.map(([alias, name]) => ({ name, normalized: normalizeSpeciesName(alias) })),
].sort((a, b) => b.normalized.length - a.normalized.length);

function matchKnownSpecies(text: string): string {
  const normalized = normalizeSpeciesName(text);
  if (!normalized) return "";
  const exact = speciesMatchers.find((species) => species.normalized === normalized);
  if (exact) return exact.name;
  const padded = ` ${normalized} `;
  return speciesMatchers.find((species) => padded.includes(` ${species.normalized} `))?.name ?? "";
}

function normalizeSpeciesName(text: string): string {
  return text.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/♀/g, " female ")
    .replace(/♂/g, " male ")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
