import type { IVs, SpeciesData } from "./types";

export type ScoreParts = {
  height: number;
  weight: number;
  ivs: number;
  xxl: number;
  total: number;
};

export type ScoreEstimate = {
  supported: boolean;
  exact: number | null;
  low: number | null;
  high: number | null;
  parts: ScoreParts | null;
};

export type ScoreInput = {
  heightM: number | null;
  weightKg: number | null;
  ivs: IVs;
  xxl: boolean | null;
};

const SCORE_CONSTANTS = { height: 800, weight: 150, ivs: 50, xxl: (150 * 1.75) / 2.05 + 50 } as const;
const DISPLAY_ROUNDING = 0.005;

function calcParts(
  heightM: number,
  weightKg: number,
  ivSum: number,
  xxl: boolean,
  species: SpeciesData,
): ScoreParts {
  const maxWeightKg = species.meanWeightKg * species.maxHeightClass + 4 * species.weightDeviationKg;
  const heightPoints = (heightM / species.meanHeightM / species.maxHeightClass) * SCORE_CONSTANTS.height;
  const weightPoints = (weightKg / maxWeightKg) * SCORE_CONSTANTS.weight;
  const ivPoints = (ivSum / 45) * SCORE_CONSTANTS.ivs;
  const xxlPoints = xxl ? SCORE_CONSTANTS.xxl : 0;
  return {
    height: heightPoints,
    weight: weightPoints,
    ivs: ivPoints,
    xxl: xxlPoints,
    total: heightPoints + weightPoints + ivPoints + xxlPoints,
  };
}

function ivBounds(ivs: IVs): [number, number, boolean] {
  const values = [ivs.attack, ivs.defense, ivs.hp];
  const known = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const missing = values.filter((value) => value === null).length;
  return [known, known + missing * 15, missing === 0];
}

/** Estimate a standard single-species Biggest Showcase score from displayed values. */
export function calculateScore(input: ScoreInput, species?: SpeciesData): ScoreEstimate {
  if (!species || input.heightM === null || input.weightKg === null) {
    return { supported: Boolean(species), exact: null, low: null, high: null, parts: null };
  }

  const [minIV, maxIV, hasAllIVs] = ivBounds(input.ivs);
  const hasXXL = input.xxl !== null;
  const rounding = DISPLAY_ROUNDING;
  const lowParts = calcParts(
    Math.max(0, input.heightM - rounding),
    Math.max(0, input.weightKg - rounding),
    minIV,
    input.xxl === true,
    species,
  );
  const highParts = calcParts(
    input.heightM + rounding,
    input.weightKg + rounding,
    maxIV,
    input.xxl !== false,
    species,
  );
  const exactParts = hasAllIVs && hasXXL
    ? calcParts(input.heightM, input.weightKg, minIV, input.xxl === true, species)
    : null;

  return {
    supported: true,
    exact: exactParts?.total ?? null,
    low: lowParts.total,
    high: highParts.total,
    parts: exactParts,
  };
}

export function formatPoints(value: number): string {
  return String(Math.round(value));
}
