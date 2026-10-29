import { describe, expect, it } from "vitest";
import { calculateScore } from "../src/scoring";
import { findSpecies } from "../src/species";

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
