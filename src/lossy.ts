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
 *     3.99:1 into a reported 7.36:1 — a 1.4.3 AA failure reported as a 1.4.6
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
 * BT.601 full-range luma — the component JPEG keeps PER PIXEL, and therefore
 * the one part of a subsampled reading that survives.
 */
export function luma(c: RGB): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/**
 * Inverse of `luma` + `chroma`, i.e. what a decoder does. Exact inverse: the
 * constants are 2(1-Kr) = 1.402, 2(1-Kb) = 1.772, Kr*2(1-Kr)/Kg = 0.714136 and
 * Kb*2(1-Kb)/Kg = 0.344136 for Kr/Kg/Kb = 0.299/0.587/0.114, so a round trip
 * through integer RGB returns the same integers (asserted in the tests).
 *
 * Channels are clamped to 0-255 and rounded, exactly as a decoder must: a luma
 * combined with a chroma from elsewhere can land outside the cube, and that
 * combination is still a colour the file could have decoded to.
 */
export function fromYCbCr(y: number, cb: number, cr: number): RGB {
  const u = cb - 128;
  const v = cr - 128;
  const ch = (x: number) => Math.min(255, Math.max(0, Math.round(x)));
  return {
    r: ch(y + 1.402 * v),
    g: ch(y - 0.344136 * u - 0.714136 * v),
    b: ch(y + 1.772 * u),
  };
}

/**
 * Largest Cb or Cr range across an RGBA buffer, i.e. how much the colour
 * information varies over the sampled neighbourhood. 0 for a chroma-flat area,
 * whatever colour that area is.
 */
export function chromaSpreadOfColours(colours: readonly RGB[]): number {
  let cbMin = Infinity;
  let cbMax = -Infinity;
  let crMin = Infinity;
  let crMax = -Infinity;
  for (const c of colours) {
    const { cb, cr } = chroma(c);
    if (cb < cbMin) cbMin = cb;
    if (cb > cbMax) cbMax = cb;
    if (cr < crMin) crMin = cr;
    if (cr > crMax) crMax = cr;
  }
  if (cbMax < cbMin) return 0; // nothing sampled
  return Math.max(cbMax - cbMin, crMax - crMin);
}

export function chromaSpreadOfRgba(rgba: Uint8Array): number {
  const colours: RGB[] = [];
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    colours.push({ r: rgba[i] ?? 0, g: rgba[i + 1] ?? 0, b: rgba[i + 2] ?? 0 });
  }
  return chromaSpreadOfColours(colours);
}

/** Derived above: no damaged pixel sat below 54.6, no safe pixel above 16. */
export const LOSSY_SPREAD_THRESHOLD = 24;

/**
 * How far a decoded pixel's luma can be from the luma it had on screen.
 *
 * This is a BOUND, not a tuned constant. The measurement above says a coloured
 * pixel moves by one level; one level on each channel moves
 * Y' = 0.299R + 0.587G + 0.114B by at most 0.299 + 0.587 + 0.114 = 1.
 *
 * It matters because the uncertainty band used to treat the decoded luma as
 * exact — "luma is stored per pixel, so the decoded value IS the true value" —
 * which contradicts this file's own measurement. On flat blocks that made the
 * band miss the true ratio about half the time: every candidate was built from
 * a luma one level off, so the true colour was never among them.
 */
export const LUMA_TOLERANCE = 1;

export interface LossyPoint {
  /** Chroma spread over the sampled neighbourhood, from `chromaSpreadOfRgba`. */
  chromaSpread: number;
}

export const LOSSY_WARNING =
  'This is a JPEG, which stores colour at half resolution. A sample taken ' +
  'where the colour changes can decode a long way from the real screen ' +
  'colour, and the error usually reports MORE contrast than there is: ' +
  'measured worst case, a true 3.99:1 read as 7.36:1. Move the point two or ' +
  'more pixels inside a single flat colour — but thin coloured text has no ' +
  'inside. For a result you intend to cite, use a PNG screenshot.';

/**
 * Shown instead of the above when an uncertainty band IS being displayed (see
 * `band.ts`). The band already states the consequence, so this only has to say
 * where the band comes from and how to narrow it; repeating the worst case
 * would just push the band's own numbers off the screen.
 */
export const LOSSY_WARNING_BANDED =
  'This is a JPEG, which stores colour at half resolution, so the single ' +
  'stored value is not a reading of the screen — the range above is. Narrow ' +
  'it by moving a point two or more pixels inside a single flat colour, but ' +
  'thin coloured text has no inside. For a result you intend to cite, use a ' +
  'PNG screenshot: Android captures PNG, and it is the OEM skin that ' +
  're-encodes it.';

/**
 * Returns the warning when the file is lossy AND the sampled neighbourhood has
 * enough chroma variation for subsampling to have moved the reading.
 *
 * `banded` selects the shorter text for the case where a band is on screen.
 */
export function lossyWarning(
  format: 'png' | 'jpeg' | 'other',
  points: readonly (LossyPoint | null)[],
  banded = false,
): string | null {
  if (format !== 'jpeg') return null;
  const atRisk = points.some((p) => p !== null && p.chromaSpread >= LOSSY_SPREAD_THRESHOLD);
  if (!atRisk) return null;
  return banded ? LOSSY_WARNING_BANDED : LOSSY_WARNING;
}
