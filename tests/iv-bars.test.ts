import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { readIVBars } from "../src/iv-bars";

async function readFixtureBars(fileName: string) {
  const filePath = fileURLToPath(new URL(`./fixtures/${fileName}`, import.meta.url));
  const image = await loadImage(await readFile(filePath));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  return readIVBars(imageData.data, image.width, image.height, []);
}

describe("appraisal bar pixel analysis", () => {
  it("does not read pixels as appraisal values without matching OCR labels", async () => {
    await expect(readFixtureBars("machop-appraisal.jpg")).resolves.toBeNull();
    await expect(readFixtureBars("bulbasaur-appraisal.jpg")).resolves.toBeNull();
  });

  it("does not return IVs when three appraisal bars are absent", () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4);
    expect(readIVBars(pixels, 100, 100, [])).toBeNull();
  });
});
