/**
 * Tiny in-memory PNG generator so tests don't depend on binary assets in the repo.
 * Returns a valid PNG (solid color) of the requested size as a Buffer.
 */
import { PNG } from "pngjs";

export function makePng(width = 64, height = 48, rgb: [number, number, number] = [220, 50, 90]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      png.data[i] = rgb[0];
      png.data[i + 1] = rgb[1];
      png.data[i + 2] = rgb[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
