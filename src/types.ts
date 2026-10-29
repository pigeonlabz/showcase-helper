export type IVs = {
  attack: number | null;
  defense: number | null;
  hp: number | null;
};

export type ScanRecord = {
  scanId: string;
  fileName: string;
  scannedAt: string;
  species: string;
  cp: number | null;
  heightM: number | null;
  weightKg: number | null;
  xxl: boolean | null;
  ivs: IVs;
  confidence: number;
  reviewReasons: string[];
  ocrText: string;
};

export type OCRWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type SpeciesData = {
  name: string;
  dex: number;
  meanHeightM: number;
  meanWeightKg: number;
  weightDeviationKg: number;
  maxHeightClass: 1.55 | 1.75 | 2;
  source: string;
};
