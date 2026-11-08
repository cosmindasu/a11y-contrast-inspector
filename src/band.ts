/**
 * The uncertainty band: what a contrast reading may and may not claim when the
 * source is a lossy screenshot.
 *
 * `lossy.ts` establishes WHY a JPEG reading can be wrong. This module says HOW
 * WRONG it can be, and turns that into a verdict the tool is actually entitled
 * to give. It replaces a point value plus a dismissible warning — which still
 * puts one authoritative-looking number on screen — with the range the reading
 * could really be, and a third verdict for the case where the range straddles
 * the threshold.
 *
 * THE LEVER is that 4:2:0 subsampling is asymmetric:
 *
 *   - LUMA (Y') is stored per pixel. With the quantisation tables a MIUI
 *     screenshot actually uses (all 1) it survives: 98.42% of pixels moved by
 *     exactly one level.
 *   - CHROMA (Cb, Cr) is stored once per 2x2 block. A pixel at a colour edge
 *     receives the block average, which belongs to no colour on the screen.
 *
 * So for a sampled pixel we know its brightness and we do not know its colour.
 * The colours it could have been are therefore
 *
 *     { fromYCbCr(its own Y', cb, cr) : (cb, cr) present in its neighbourhood }
 *
 * — its own luma held, its chroma replaced by each chroma value actually found
 * within one pixel of it. The truth is in that set whenever the pixel's own
 * region appears in the neighbourhood, which it does unless the stroke is a
 * single pixel wide; where it does not, the band comes out wide, and "this
 * source cannot answer that" is the correct result rather than a defect.
 *
 * The band is the range of contrast ratios over the cross product of the two
 * points' candidate sets. It SELF-SILENCES: across a chroma-flat area every
 * candidate collapses onto the sampled colour and the band has zero width, so
 * a flat #181C27 background still reports a single number.
 *
 * WHY AVERAGED PATCHES GET NO BAND. The claim above is a per-pixel claim.
 * Substituting one chroma value across a whole patch would assume the patch is
 * a single colour — true exactly when the chroma spread is low, i.e. when no
 * band is needed, and false exactly when it is. Rather than ship a derivation
 * that fails on the case it exists for, averaged patches keep the warning and
 * get no band. Single-pixel sampling is the default mode.
 */
import {
  CRITERIA,
  ratioFromLuminances,
  relativeLuminance,
  roundUp2,
  truncate2,
  type Criterion,
  type RGB,
} from './contrast';
import { chroma, fromYCbCr, luma, LOSSY_SPREAD_THRESHOLD } from './lossy';

export interface BandPoint {
  /** The stored colour of the sample. */
  colour: RGB;
  /** Every pixel within one pixel of the sample, including it. */
  neighbourhood: readonly RGB[];
  /** Chroma variation across that neighbourhood — see `lossy.ts`. */
  chromaSpread: number;
  /** 1 for an exact single pixel; > 1 for an averaged patch. */
  count: number;
}

/**
 * Lumas the sampled pixel could have had on screen.
 *
 * Usually exactly one: luma is stored per pixel, so the decoded value IS the
 * true value. The exception is the gamut boundary. A decoder reconstructs RGB
 * from (Y', Cb, Cr) and CLAMPS to 0-255, so a white pixel that was given a
 * foreign chroma cannot come back out white — it comes back darker, and its
 * luma is no longer the luma it had. Measured on white text over this app's own
 * primary colour: true 6.70:1, and a band built on the decoded luma alone spans
 * 5.74 to 6.38, missing the truth entirely.
 *
 * A channel sitting exactly at 0 or 255 is the signature of that cut. Where it
 * is absent, no clamping happened and the luma is exact. Where it is present,
 * the true luma is only BOUNDED — at 255 it is at least the decoded luma, at 0
 * at most — so the candidates extend to the neighbouring lumas on that side,
 * which is where the same region's undamaged interior is. Nothing is added on
 * the other side, so a light sample never acquires a dark candidate and the
 * band cannot collapse towards 1:1.
 */
export function candidateLumas(pixel: RGB, neighbourhood: readonly RGB[]): number[] {
  const y = luma(pixel);
  const atTop = pixel.r === 255 || pixel.g === 255 || pixel.b === 255;
  const atBottom = pixel.r === 0 || pixel.g === 0 || pixel.b === 0;
  if (!atTop && !atBottom) return [y];
  const seen = new Set([Math.round(y)]);
  const out = [y];
  for (const n of neighbourhood) {
    const ny = luma(n);
    if (!((atTop && ny > y) || (atBottom && ny < y))) continue;
    const key = Math.round(ny);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ny);
  }
  return out;
}

/**
 * Colours the sampled pixel could have been: every luma it could have had,
 * combined with every distinct chroma found around it.
 *
 * The sampled colour itself is always first and always present — the block
 * average may well be the truth. Chroma is deduplicated to one unit and the
 * neighbourhood is nine pixels, so an unclamped sample has at most nine
 * candidates.
 */
export function candidateColours(pixel: RGB, neighbourhood: readonly RGB[]): RGB[] {
  const lumas = candidateLumas(pixel, neighbourhood);
  const chromas: { cb: number; cr: number }[] = [];
  const seen = new Set<string>();
  for (const c of [pixel, ...neighbourhood]) {
    const { cb, cr } = chroma(c);
    const key = `${Math.round(cb)},${Math.round(cr)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chromas.push({ cb, cr });
  }
  const out: RGB[] = [];
  const placed = new Set<string>();
  for (const y of lumas) {
    for (const { cb, cr } of chromas) {
      const c = fromYCbCr(y, cb, cr);
      const key = `${c.r},${c.g},${c.b}`;
      if (placed.has(key)) continue;
      placed.add(key);
      out.push(c);
    }
  }
  return out;
}

export interface Band {
  low: number;
  high: number;
}

/**
 * Range of contrast ratios over every pairing of the two candidate sets.
 *
 * Luminance is computed once per candidate, not once per pair: with both
 * samples clamped there can be 81 candidates a side, and the four `Math.pow`
 * calls inside `relativeLuminance` would otherwise run 6561 times on every
 * re-render, including every arrow-key nudge.
 */
export function ratioBand(a: readonly RGB[], b: readonly RGB[]): Band {
  const la = a.map(relativeLuminance);
  const lb = b.map(relativeLuminance);
  let low = Infinity;
  let high = -Infinity;
  for (const x of la) {
    for (const y of lb) {
      const r = ratioFromLuminances(x, y);
      if (r < low) low = r;
      if (r > high) high = r;
    }
  }
  if (high < low) throw new Error('ratioBand needs at least one candidate on each side.');
  return { low, high };
}

/**
 * The band to show, or null when a single number is the honest answer.
 *
 * Null for a lossless format, for averaged patches (see the note at the top of
 * this file), when neither point sits where the colour changes, and when the
 * band is narrower than the two decimals the app displays — in that last case
 * showing a range would invent uncertainty the maths does not support.
 *
 * A point that is not itself at risk contributes only its stored colour, so one
 * flat point and one risky point give a band that moves on one side only.
 */
export function bandFor(
  format: 'png' | 'jpeg' | 'other',
  a: BandPoint | null,
  b: BandPoint | null,
): Band | null {
  if (format !== 'jpeg' || !a || !b) return null;
  if (a.count > 1 || b.count > 1) return null;
  const risky = (p: BandPoint) => p.chromaSpread >= LOSSY_SPREAD_THRESHOLD;
  if (!risky(a) && !risky(b)) return null;
  const candidates = (p: BandPoint) =>
    risky(p) ? candidateColours(p.colour, p.neighbourhood) : [p.colour];
  const band = ratioBand(candidates(a), candidates(b));
  if (band.high <= band.low) return null; // every candidate agreed
  return roundUp2(band.high) <= truncate2(band.low) ? null : band;
}

/**
 * A threshold is only answered when the WHOLE band falls on one side of it.
 * This is the point of the band: a true 4.00:1 that decodes as 7.37:1 produces
 * a band spanning 4.5, and the app says it cannot tell instead of reporting a
 * AAA pass on an AA failure.
 */
export type Certainty = 'pass' | 'fail' | 'undetermined';

export function certaintyFor(band: Band, threshold: number): Certainty {
  if (band.low >= threshold) return 'pass';
  if (band.high < threshold) return 'fail';
  return 'undetermined';
}

export interface BandVerdict extends Criterion {
  certainty: Certainty;
}

export function evaluateBand(band: Band): BandVerdict[] {
  return CRITERIA.map((c) => ({ ...c, certainty: certaintyFor(band, c.threshold) }));
}

/**
 * Bottom truncated, top rounded up, so what is displayed always contains the
 * computed band. See `roundUp2`.
 */
export function formatBand(band: Band): string {
  return `${truncate2(band.low).toFixed(2)} – ${roundUp2(band.high).toFixed(2)}:1`;
}
