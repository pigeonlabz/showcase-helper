import type { SpeciesData } from "./types";

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
  const normalized = text.toLocaleLowerCase();
  return SPECIES.find((species) => {
    const escaped = species.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
  })?.name ?? "";
}
