/**
 * Lossy-source risk for a contrast reading.
 *
 * `pixels.ts` returns the true stored value of a decoded pixel. That promise
 * holds for a JPEG too — but a JPEG screenshot is not a faithful record of what
 * was on screen, so an exact read of it can still be the wrong answer.
 *
 * MIUI, and other OEM skins, save screenshots as baseline JPEG with 4:2:0
 * chroma subsampling: colour is stored once per 2x2 block, luma per pixel.
 * Measured by re-encoding `testdata/reference.png` with the settings read out
 * of a real MIUI screenshot (baseline, quantisation tables all 1, 4:2:0) and
 * comparing against the known originals:
 *
 *   - 98.42% of coloured pixels moved by exactly one level. The damage is
 *     confined to the one-pixel rim at a colour edge, where the 2x2 chroma
 *     block straddles two colours: there the deviation reached 93 levels. At
 *     two pixels or more from an edge it falls back to one level.
 *   - Worst case: #FF0000 decoded as #A2243A. Against white that turns a real
 *     4.00:1 into a reported 7.37:1 — a 1.4.3 AA failure reported as a 1.4.6
 *     AAA pass. The error is not symmetric: it overstates contrast, the one
 *     direction an accessibility tool must never drift in.
 *
 * WHAT DECIDES THE RISK is not whether a pixel is coloured, but whether the
 * chroma around it CHANGES — subsampling can only move a pixel by mixing it
 * with a neighbour that differs. A large flat area of #181C27 is perfectly
 * safe; a grey pixel one step from a saturated edge is not.
 *
 * An earlier version of this file tested the sampled pixel for `r === g === b`
 * and treated anything else as at risk. That is wrong twice over: it fires on
 * safe flat colour, and on a real screenshot almost nothing is exactly neutral
 * anyway (measured on a real MIUI capture: 2.3% of all pixels, and only 0.4%
 * inside dark areas). The warning then fired on every screenshot, which is the
 * same as not warning at all.
 *
 * So we measure the chroma spread across the sampled neighbourhood and warn
 * only when it is large enough that subsampling could have moved the reading.
 * The threshold is taken from the measurements, not chosen by feel:
 *
 *   - On the reference image, every pixel whose real error reached 8 levels or
 *     more had a 3x3 chroma spread of at least 54.6. Pixels with a spread
 *     under 16 never exceeded 3 levels of error.
 *   - A threshold of 24 therefore sits in an empty gap, with margin on both
 *     sides, and catches 1118 of 1118 damaged pixels.
 *   - On a real MIUI screenshot it fires on 1.97% of pixels. For pixels of
 *     #181C27 (a real dark UI background) the median spread is 1.2 and the
 *     90th percentile 2.2, so flat dark chrome stays silent.
 */
import type { RGB } from './contrast';

/** BT.601 full-range chroma — the space JPEG actually subsamples. */
export function chroma(c: RGB): { cb: number; cr: number } {
  return {
    cb: 128 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
    cr: 128 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b,
  };
}

/**
 * Largest Cb or Cr range across an RGBA buffer, i.e. how much the colour
 * information varies over the sampled neighbourhood. 0 for a chroma-flat area,
 * whatever colour that area is.
 */
export function chromaSpreadOfRgba(rgba: Uint8Array): number {
  let cbMin = Infinity;
  let cbMax = -Infinity;
  let crMin = Infinity;
  let crMax = -Infinity;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const { cb, cr } = chroma({ r: rgba[i] ?? 0, g: rgba[i + 1] ?? 0, b: rgba[i + 2] ?? 0 });
    if (cb < cbMin) cbMin = cb;
    if (cb > cbMax) cbMax = cb;
    if (cr < crMin) crMin = cr;
    if (cr > crMax) crMax = cr;
  }
  if (cbMax < cbMin) return 0; // nothing sampled
  return Math.max(cbMax - cbMin, crMax - crMin);
}

/** Derived above: no damaged pixel sat below 54.6, no safe pixel above 16. */
export const LOSSY_SPREAD_THRESHOLD = 24;

export interface LossyPoint {
  /** Chroma spread over the sampled neighbourhood, from `chromaSpreadOfRgba`. */
  chromaSpread: number;
}

export const LOSSY_WARNING =
  'This is a JPEG, which stores colour at half resolution. A sample taken ' +
  'where the colour changes can decode a long way from the real screen ' +
  'colour, and the error usually reports MORE contrast than there is: ' +
  'measured worst case, a true 4.00:1 read as 7.37:1. Move the point two or ' +
  'more pixels inside a single flat colour — but thin coloured text has no ' +
  'inside. For a result you intend to cite, use a PNG screenshot.';

/**
 * Returns the warning when the file is lossy AND the sampled neighbourhood has
 * enough chroma variation for subsampling to have moved the reading.
 */
export function lossyWarning(
  format: 'png' | 'jpeg' | 'other',
  points: readonly (LossyPoint | null)[],
): string | null {
  if (format !== 'jpeg') return null;
  const atRisk = points.some((p) => p !== null && p.chromaSpread >= LOSSY_SPREAD_THRESHOLD);
  return atRisk ? LOSSY_WARNING : null;
}
