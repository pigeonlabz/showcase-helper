import type { SpeciesData } from "./types";
import { POKEMON_SPECIES_NAMES } from "./pokemon-names";

// Initial verified MVP data. Unknown species deliberately have no fallback multiplier.
export const SPECIES: SpeciesData[] = [
  {
    name: "Bulbasaur",
    dex: 1,
    meanHeightM: 0.7,
    meanWeightKg: 6.9,
    weightDeviationKg: 0.8625,
    maxHeightClass: 1.75,
    source: "Pokémon GO base size data; XXL maximum 1.225 m (1.75×)",
  },
  {
    name: "Machop",
    dex: 66,
    meanHeightM: 0.8,
    meanWeightKg: 19.5,
    weightDeviationKg: 2.4375,
    maxHeightClass: 1.75,
    source: "Pokémon GO base size data; XXL maximum 1.40 m (1.75×)",
  },
];

export function findSpecies(name: string): SpeciesData | undefined {
  return SPECIES.find((species) => species.name.toLowerCase() === name.trim().toLowerCase());
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
