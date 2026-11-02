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
  formId: identifier.replace(/_ALL$/i, ""),
  dex,
  meanHeightM,
  meanWeightKg,
  weightDeviationKg,
  maxHeightClass,
  source: dataSource,
}));

const speciesByName = new Map<string, SpeciesData>();
const explicitSpeciesByName = new Map<string, SpeciesData>();
const speciesByDex = new Map<number, SpeciesData[]>();
for (const [index, [identifier, dex]] of sizeDataset.rows.entries()) {
  const species = SPECIES[index];
  const formId = identifier.replace(/_ALL$/i, "");
  const family = speciesByDex.get(dex) ?? [];
  family.push(species);
  speciesByDex.set(dex, family);
  registerSpeciesName(identifier, species);
  registerSpeciesName(formId, species);
  registerSpeciesName(species.name, species);

  const baseName = POKEMON_SPECIES_NAMES[dex - 1];
  if (!baseName) continue;
  const normalizedBase = normalizeSpeciesName(baseName);
  const normalizedForm = normalizeSpeciesName(formId);
  if (normalizedForm !== normalizedBase) {
    registerExplicitSpeciesName(formId, species);
    registerExplicitSpeciesName(species.name, species);
  }
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
    const regionalName = `${regional} ${baseName} ${remainingForm.join(" ")}`.trim();
    registerSpeciesName(regionalName, species);
    registerExplicitSpeciesName(regionalName, species);
  } else if (formFamily === "mega" || formFamily === "primal") {
    registerSpeciesName(`${formFamily} ${baseName} ${remainingForm.join(" ")}`.trim(), species);
    registerExplicitSpeciesName(`${formFamily} ${baseName} ${remainingForm.join(" ")}`.trim(), species);
  }
}

export type SpeciesFormOption = { formId: string; label: string; species: SpeciesData };

const scoringFormsByDex = new Map<number, SpeciesFormOption[]>();
for (const [dex, family] of speciesByDex) {
  const profiles = new Set(family.map(scoringProfileKey));
  if (profiles.size < 2) continue;
  const hasRegionalForms = family.some((entry) => /_(?:ALOLA|GALARIAN|HISUIAN|PALDEA)(?:_|$)/i.test(entry.formId));
  scoringFormsByDex.set(dex, family.map((entry) => ({
    formId: entry.formId,
    label: formLabel(entry, family, hasRegionalForms),
    species: entry,
  })));
}

export function findSpecies(name: string): SpeciesData | undefined {
  const normalized = normalizeSpeciesName(name);
  const explicit = explicitSpeciesByName.get(normalized);
  const species = explicit ?? speciesByName.get(normalized);
  if (!species || explicit) return species;
  return scoringFormsByDex.has(species.dex) ? undefined : species;
}

/** Forms are offered only when this Game Master family has different scoring inputs. */
export function getScoringFormOptions(name: string): SpeciesFormOption[] {
  const species = lookupSpecies(name);
  return species ? scoringFormsByDex.get(species.dex) ?? [] : [];
}

/** Resolve a score profile without silently choosing a base form for an ambiguous name. */
export function resolveSpeciesForScoring(name: string, formId?: string | null): SpeciesData | undefined {
  const normalizedName = normalizeSpeciesName(name);
  const explicit = explicitSpeciesByName.get(normalizedName);
  const species = explicit ?? lookupSpecies(name);
  if (!species) return undefined;

  const family = speciesByDex.get(species.dex) ?? [];
  if (formId) return family.find((entry) => entry.formId === formId);
  if (explicit) return explicit;
  if ((scoringFormsByDex.get(species.dex)?.length ?? 0) > 0) return undefined;
  return species;
}

/** Return a form only when its name was explicit in OCR or manual species input. */
export function getExplicitSpeciesForm(name: string): SpeciesData | undefined {
  return explicitSpeciesByName.get(normalizeSpeciesName(name));
}

export function getBaseSpeciesName(name: string): string | undefined {
  const species = lookupSpecies(name);
  return species ? POKEMON_SPECIES_NAMES[species.dex - 1] : undefined;
}

function registerSpeciesName(name: string, species: SpeciesData): void {
  const normalized = normalizeSpeciesName(name);
  if (normalized && !speciesByName.has(normalized)) speciesByName.set(normalized, species);
}

function lookupSpecies(name: string): SpeciesData | undefined {
  const normalized = normalizeSpeciesName(name);
  return explicitSpeciesByName.get(normalized) ?? speciesByName.get(normalized);
}

function registerExplicitSpeciesName(name: string, species: SpeciesData): void {
  const normalized = normalizeSpeciesName(name);
  if (normalized) explicitSpeciesByName.set(normalized, species);
}

function scoringProfileKey(species: SpeciesData): string {
  return [species.meanHeightM, species.meanWeightKg, species.weightDeviationKg, species.maxHeightClass].join("|");
}

function formLabel(species: SpeciesData, family: SpeciesData[], hasRegionalForms: boolean): string {
  const baseFormId = family.find((entry) => !entry.formId.includes("_"))?.formId;
  if (species.formId === baseFormId) return hasRegionalForms ? "Kantonian" : "Base form";
  const suffix = baseFormId && species.formId.startsWith(`${baseFormId}_`)
    ? species.formId.slice(baseFormId.length + 1)
    : species.formId.split("_").slice(1).join("_");
  const parts = suffix.split("_").filter(Boolean);
  const regionalLabels: Record<string, string> = {
    ALOLA: "Alolan",
    GALARIAN: "Galarian",
    HISUIAN: "Hisuian",
    PALDEA: "Paldean",
  };
  if (parts.length && regionalLabels[parts[0]]) {
    return [regionalLabels[parts[0]], ...parts.slice(1).map(titleCase)].join(" ");
  }
  return parts.map(titleCase).join(" ") || "Other form";
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
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
  ...SPECIES.flatMap((species) => {
    const baseName = POKEMON_SPECIES_NAMES[species.dex - 1];
    const aliases = [species.name];
    const formId = species.formId.replace(/_ALL$/i, "").toLowerCase();
    const normalizedBase = baseName ? normalizeSpeciesName(baseName).replace(/ /g, "_") : "";
    if (baseName && normalizedBase && formId.startsWith(`${normalizedBase}_`)) {
      const suffix = formId.slice(normalizedBase.length + 1).toLowerCase().split("_");
      const regionalAdjectives: Record<string, string> = {
        alola: "Alolan",
        galarian: "Galarian",
        hisuian: "Hisuian",
        paldea: "Paldean",
      };
      const adjective = regionalAdjectives[suffix[0]];
      if (adjective) aliases.push(`${adjective} ${baseName} ${suffix.slice(1).join(" ")}`.trim());
    }
    return aliases.map((name) => ({ name: species.name, normalized: normalizeSpeciesName(name) }));
  }),
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
