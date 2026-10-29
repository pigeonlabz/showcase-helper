import { describe, expect, it } from "vitest";
import { calculateScore } from "../src/scoring";
import { findSpecies, SPECIES } from "../src/species";

describe("single-species Biggest Showcase scoring", () => {
  it("matches the published Squirtle worked example", () => {
    const squirtle = {
      name: "Squirtle",
      dex: 7,
      meanHeightM: 0.5,
      meanWeightKg: 9,
      weightDeviationKg: 1.125,
      maxHeightClass: 1.75 as const,
      source: "Pokémon GO Hub worked example",
    };
    const score = calculateScore({
      heightM: 0.84,
      weightKg: 16.54,
      ivs: { attack: 7, defense: 13, hp: 0 },
      xxl: false,
    }, squirtle);

    expect(score.exact).toBeCloseTo(912.7407, 3);
    expect(score.parts?.height).toBeCloseTo(768, 5);
    expect(score.parts?.weight).toBeCloseTo(122.5185, 3);
    expect(score.parts?.ivs).toBeCloseTo(22.2222, 3);
    expect(score.parts?.xxl).toBe(0);
  });

  it("uses species-specific constants for supported fixture species", () => {
    const machop = findSpecies("Machop")!;
    const score = calculateScore({
      heightM: 1.33,
      weightKg: 36.06,
      ivs: { attack: 15, defense: 6, hp: 14 },
      xxl: true,
    }, machop);
    expect(score.exact).not.toBeNull();
    expect(score.parts?.xxl).toBeCloseTo(178.04878, 4);
  });

  it("preserves verified fixture scores and matches the independent calculator", () => {
    const cases = [
      { species: "Bulbasaur", heightM: 1.18, weightKg: 11.55, ivs: [10, 7, 8] as const, expected: 1088.0330060620927 },
      { species: "Machop", heightM: 1.33, weightKg: 36.06, ivs: [15, 6, 14] as const, expected: 1100.219720658745 },
      { species: "Staryu", heightM: 1.32, weightKg: 56.36, ivs: [12, 15, 12] as const, expected: 1084.5760406672389 },
    ];

    for (const sample of cases) {
      const species = findSpecies(sample.species);
      expect(species, sample.species).toBeDefined();
      const score = calculateScore({
        heightM: sample.heightM,
        weightKg: sample.weightKg,
        ivs: { attack: sample.ivs[0], defense: sample.ivs[1], hp: sample.ivs[2] },
        xxl: true,
      }, species);
      expect(score.exact, sample.species).toBeCloseTo(sample.expected, 7);
    }
  });

  it("loads verified form rows but excludes incomplete and custom-band size profiles", () => {
    expect(SPECIES.length).toBeGreaterThan(1_000);
    expect(findSpecies("Galarian Articuno")).toMatchObject({ dex: 144, maxHeightClass: 1.75 });
    expect(findSpecies("Pumpkaboo")).toBeUndefined();
    expect(findSpecies("Gourgeist (Super)")).toBeUndefined();
    expect(findSpecies("Dragonite Mega")).toBeUndefined();
    expect(calculateScore({
      heightM: 0.6,
      weightKg: 8,
      ivs: { attack: 15, defense: 15, hp: 15 },
      xxl: true,
    }, findSpecies("Pumpkaboo")).supported).toBe(false);
  });

  it("changes the estimate immediately when an IV is manually corrected", () => {
    const bulbasaur = findSpecies("Bulbasaur")!;
    const base = { heightM: 1.18, weightKg: 11.55, ivs: { attack: 10, defense: 7, hp: 8 }, xxl: true };
    const before = calculateScore(base, bulbasaur).exact!;
    const after = calculateScore({ ...base, ivs: { ...base.ivs, attack: 15 } }, bulbasaur).exact!;
    expect(after - before).toBeCloseTo((5 / 45) * 50, 5);
  });

  it("returns a range instead of inventing unknown appraisal values", () => {
    const bulbasaur = findSpecies("Bulbasaur")!;
    const score = calculateScore({
      heightM: 1.18,
      weightKg: 11.55,
      ivs: { attack: null, defense: null, hp: null },
      xxl: true,
    }, bulbasaur);
    expect(score.exact).toBeNull();
    expect(score.low).not.toBeNull();
    expect(score.high).not.toBeNull();
    expect(score.high! - score.low!).toBeGreaterThan(49);
  });

  it("does not substitute a generic class for unsupported species", () => {
    expect(calculateScore({
      heightM: 1,
      weightKg: 1,
      ivs: { attack: 15, defense: 15, hp: 15 },
      xxl: true,
    }).supported).toBe(false);
  });
});
