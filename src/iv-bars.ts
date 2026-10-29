import type { OCRWord } from "./types";

type Band = { y0: number; y1: number; x0: number; x1: number; score: number };

function isIVFill(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.22 || max < 105) return false;
  const hue = r === max
    ? ((g - b) / (max - min || 1)) * 60
    : g === max
      ? (2 + (b - r) / (max - min || 1)) * 60
      : (4 + (r - g) / (max - min || 1)) * 60;
  const normalizedHue = (hue + 360) % 360;
  return normalizedHue <= 60 || normalizedHue >= 345;
}

function isTrackGray(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) <= 242 && Math.min(r, g, b) >= 125 && Math.max(r, g, b) - Math.min(r, g, b) <= 18;
}

function rowSpan(data: Uint8ClampedArray, width: number, y: number, left = 0, right = width - 1): { x0: number; x1: number; count: number } | null {
  let x0 = right + 1;
  let x1 = -1;
  let count = 0;
  for (let x = left; x <= right; x += 1) {
    const index = (y * width + x) * 4;
    if (isIVFill(data[index], data[index + 1], data[index + 2])) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      count += 1;
    }
  }
  return count >= Math.max(7, Math.round(width * 0.008)) ? { x0, x1, count } : null;
}

function findBandForLabel(data: Uint8ClampedArray, width: number, height: number, label: OCRWord): Band | null {
  const left = Math.max(0, Math.floor(label.bbox.x0 - width * 0.004));
  const right = Math.min(width - 1, Math.ceil(label.bbox.x0 + width * 0.4));
  const labelHeight = Math.max(1, label.bbox.y1 - label.bbox.y0);
  const yStart = Math.max(0, Math.floor(label.bbox.y0 - labelHeight * 0.2));
  const yEnd = Math.min(height - 1, Math.ceil(label.bbox.y1 + Math.max(labelHeight * 3.5, height * 0.045)));
  const rows: Array<{ y: number; span: NonNullable<ReturnType<typeof rowSpan>> }> = [];
  for (let y = yStart; y <= yEnd; y += 1) {
    const span = rowSpan(data, width, y, left, right);
    if (span && span.x1 - span.x0 >= width * 0.025) rows.push({ y, span });
  }

  const bands: Band[] = [];
  for (const row of rows) {
    const last = bands[bands.length - 1];
    if (last && row.y <= last.y1 + 1) {
      last.y1 = row.y;
      last.x0 = Math.min(last.x0, row.span.x0);
      last.x1 = Math.max(last.x1, row.span.x1);
      last.score = Math.max(last.score, row.span.count);
    } else {
      bands.push({ y0: row.y, y1: row.y, x0: row.span.x0, x1: row.span.x1, score: row.span.count });
    }
  }
  const candidates = bands.filter((band) => band.y1 - band.y0 >= Math.max(3, height * 0.002)
    && band.y1 - band.y0 <= height * 0.025);
  if (!candidates.length) return null;
  const belowLabel = candidates.filter((band) => band.y0 >= label.bbox.y1 - 1);
  const pool = belowLabel.length ? belowLabel : candidates;
  return pool.sort((a, b) => (a.y0 - label.bbox.y1) - (b.y0 - label.bbox.y1) || b.score - a.score)[0];
}

function findTrackEnd(data: Uint8ClampedArray, width: number, y0: number, y1: number, trackStart: number, fillEnd: number): number {
  const y = Math.round((y0 + y1) / 2);
  let grayEnd = -1;
  let grayCount = 0;
  // These portrait screens render the full 15-point track at roughly 35% of image width.
  // Search that bounded lane and tolerate the small section dividers in the gray remainder.
  const maxTrackEnd = Math.min(width - 1, trackStart + Math.ceil(width * 0.35));
  for (let x = fillEnd + 1; x <= maxTrackEnd; x += 1) {
    const index = (y * width + x) * 4;
    if (isTrackGray(data[index], data[index + 1], data[index + 2])) {
      grayEnd = x;
      grayCount += 1;
    }
  }
  return grayCount >= 4 ? grayEnd : fillEnd;
}

function pointsForBand(data: Uint8ClampedArray, width: number, band: Band): number {
  const left = band.x0;
  const right = findTrackEnd(data, width, band.y0, band.y1, band.x0, band.x1);
  const totalWidth = right - left + 1;
  if (totalWidth <= 0) return 0;
  const filledWidth = band.x1 - left + 1;

  // Each of the three visible sections represents five IV points.
  const sectionWidth = totalWidth / 3;
  let points = 0;
  for (let section = 0; section < 3; section += 1) {
    const sectionFill = Math.min(sectionWidth, Math.max(0, filledWidth - section * sectionWidth));
    points += Math.max(0, Math.min(5, Math.round((sectionFill / sectionWidth) * 5)));
  }
  return Math.max(0, Math.min(15, points));
}

/** Read the three appraisal meters from image pixels, in Attack / Defense / HP order. */
export function readIVBars(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  words: OCRWord[],
): { attack: number; defense: number; hp: number } | null {
  const findLabel = (pattern: RegExp) => words.find((word) => pattern.test(word.text.trim()));
  const labels = [findLabel(/^attack$/i), findLabel(/^defen[cs]e$/i), findLabel(/^hp$/i)];
  if (labels.some((label) => !label)) return null;
  const bands = labels.map((label) => findBandForLabel(data, width, height, label!));
  if (bands.some((band) => !band)) return null;
  const verifiedBands = bands as Band[];
  if (verifiedBands[0].y0 >= verifiedBands[1].y0 || verifiedBands[1].y0 >= verifiedBands[2].y0) return null;
  const [attack, defense, hp] = verifiedBands.map((band) => pointsForBand(data, width, band));
  if ([attack, defense, hp].some((value) => value < 0 || value > 15)) return null;
  return { attack, defense, hp };
}
