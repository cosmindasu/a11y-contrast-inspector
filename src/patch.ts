import { linearizeChannel, relativeLuminance, type RGB } from './contrast';

export interface PatchResult {
  /**
   * DISPLAY ONLY. The linear-light average re-encoded to sRGB and rounded to
   * 8 bits. It is an approximation of an averaged colour that may not exist
   * anywhere in the image. The ratio is NOT computed from it.
   */
  colour: RGB;
  /**
   * Relative luminance of the UNROUNDED linear-light average. Relative
   * luminance is linear in linear-RGB, so this equals the mean of the
   * per-pixel luminances and is consistent with `colour` (up to its rounding).
   * Use this, not `colour`, to compute the contrast ratio.
   */
  luminance: number;
  /** Number of pixels actually averaged (may be < size*size at image edges). */
  count: number;
  /** How many of the sampled pixels are not fully opaque (alpha < 255). */
  nonOpaqueCount: number;
  /** Lowest alpha (0-255) among the sampled pixels. */
  minAlpha: number;
}

/**
 * Rectangle of an odd-sized square patch centred on (cx, cy), clipped to the
 * image. Returned as {x, y, width, height} in image pixels.
 */
export function patchBounds(
  cx: number,
  cy: number,
  size: number,
  imageWidth: number,
  imageHeight: number,
) {
  const half = Math.floor(size / 2);
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const x1 = Math.min(imageWidth - 1, cx + half);
  const y1 = Math.min(imageHeight - 1, cy + half);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Linear-light value (0-1) -> 8-bit sRGB integer. Display only. */
export function encodeChannel(linear: number): number {
  const l = Math.min(1, Math.max(0, linear));
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

/**
 * Average of RGBA bytes (unpremultiplied) computed in LINEAR light. This is an
 * EXPLICIT, user-requested average; the single-pixel path never calls this.
 *
 * Alpha is never averaged or composited; it is only REPORTED (`nonOpaqueCount`,
 * `minAlpha`) so the caller can refuse to give a verdict. A fully transparent
 * pixel reads back as RGB 0,0,0 and is included in the colour average as such,
 * which is exactly why a result containing one must not be trusted.
 */
export function averageRgba(bytes: Uint8Array): PatchResult {
  const count = Math.floor(bytes.length / 4);
  if (count === 0) throw new Error('Empty patch');
  let r = 0;
  let g = 0;
  let b = 0;
  let lum = 0;
  let nonOpaqueCount = 0;
  let minAlpha = 255;
  for (let i = 0; i < count; i++) {
    const pr = bytes[i * 4] ?? 0;
    const pg = bytes[i * 4 + 1] ?? 0;
    const pb = bytes[i * 4 + 2] ?? 0;
    const pa = bytes[i * 4 + 3] ?? 255;
    r += linearizeChannel(pr);
    g += linearizeChannel(pg);
    b += linearizeChannel(pb);
    lum += relativeLuminance({ r: pr, g: pg, b: pb });
    if (pa < 255) nonOpaqueCount++;
    if (pa < minAlpha) minAlpha = pa;
  }
  return {
    colour: { r: encodeChannel(r / count), g: encodeChannel(g / count), b: encodeChannel(b / count) },
    luminance: lum / count,
    count,
    nonOpaqueCount,
    minAlpha,
  };
}
