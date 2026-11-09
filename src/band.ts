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
import { chroma, fromYCbCr, luma, LOSSY_SPREAD_THRESHOLD, LUMA_TOLERANCE } from './lossy';

export interface BandPoint {
  /** The stored colour of the sample. */
  colour: RGB;
  /** Every pixel within one pixel of the sample, including it. */
  neighbourhood: readonly RGB[];
  /** Chroma variation across that neighbourhood — see `lossy.ts`. */
  chromaSpread: number;
  /** 1 for an exact single pixel; > 1 for an averaged patch. */
  count: number;
  /**
   * Lumas of nearby pixels that are far enough from any colour edge to be
   * undamaged — see `hasWitness`. Empty means none was found.
   */
  cleanLumas: readonly number[];
}

/**
 * How close an undamaged pixel's luma must be to the sample's to count as a
 * witness for the sample's region.
 *
 * Derived, not chosen: `lossy.ts` measured that a pixel two or more pixels from
 * an edge never moved by more than 3 levels, and the sample's own luma is
 * uncertain by LUMA_TOLERANCE. Three levels on each channel move luma by at
 * most 3, so a genuine witness cannot be further away than the sum.
 */
export const WITNESS_LUMA_TOLERANCE = LUMA_TOLERANCE + 3;

/**
 * Does the sample's own region appear anywhere undamaged?
 *
 * This is the precondition the band quietly assumed and never checked, and
 * missing it is how the app came to report a confident AAA pass on text that
 * fails AA. The candidates are built from the chroma values PRESENT around the
 * sample. On a stroke one or two pixels wide every pixel is rim: they all carry
 * the same blended chroma, which looks exactly like a consensus, so the band
 * comes out narrow, confident and wrong — all of it on the same side.
 *
 * What distinguishes that case is not the chroma, which agrees, but that
 * nothing nearby is CLEAN. `lossy.ts` measured the damage as confined to the
 * one-pixel rim, so a pixel whose own neighbourhood is chroma-flat is
 * undamaged. If no such pixel shares the sample's brightness, the sample's
 * region has no undamaged example in reach and its true colour is simply not
 * in the image.
 *
 * NECESSARY, NOT SUFFICIENT. A clean pixel at the same brightness might belong
 * to a different region that happens to be equally bright. This check removes
 * the case that was measured to be catastrophic; it does not make the band
 * sound in general, and the warning shown with every band still says so.
 */
export function hasWitness(
  sampleLuma: number,
  cleanLumas: readonly number[],
  tolerance: number = WITNESS_LUMA_TOLERANCE,
): boolean {
  return cleanLumas.some((y) => Math.abs(y - sampleLuma) <= tolerance);
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

  // Step 1: the lumas we have reason to believe in.
  //
  // A channel sitting exactly at 0 or 255 means the decoder may have CUT the
  // value, so the true luma is only bounded on that side and the neighbouring
  // lumas there are candidates too.
  //
  // Both at once (every saturated primary: #FF0000 has 255 and 0) used to open
  // the gate in both directions and let a light sample acquire a dark twin,
  // collapsing the band towards 1:1. A cut in both directions says nothing
  // about which way the luma moved, so it is treated as no information rather
  // than as licence to take everything.
  const bases = [y];
  if (atTop !== atBottom) {
    const seenBase = new Set([Math.round(y)]);
    for (const n of neighbourhood) {
      const ny = luma(n);
      if (!((atTop && ny > y) || (atBottom && ny < y))) continue;
      const key = Math.round(ny);
      if (seenBase.has(key)) continue;
      seenBase.add(key);
      bases.push(ny);
    }
  }

  // Step 2: every one of those is a MEASUREMENT, not the truth. `lossy.ts`
  // measured that a coloured pixel moves by one level, which moves luma by up
  // to LUMA_TOLERANCE. Treating the decoded luma as exact is what made the
  // band miss the true ratio on about half of all flat-block readings: the
  // true colour was never among the candidates because every candidate had the
  // wrong brightness.
  //
  // The error bar is applied AFTER the bases are chosen, and the two stages
  // deduplicate differently on purpose. Doing it in one pass with integer
  // rounding let a synthetic `y - 1` occupy the slot of a real neighbour luma
  // and silently discard it — which cost containment on exactly the readings
  // the tolerance was added to rescue.
  const out: number[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    for (const delta of [0, -LUMA_TOLERANCE, LUMA_TOLERANCE]) {
      const v = base + delta;
      const key = v.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
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
 * Luminance is computed once per candidate, not once per pair. Measured over
 * 14,664 gated readings on stroke-bearing content: 15 candidates a side at the
 * median, 41 at the 90th percentile, 303 at the worst — so the cross product
 * reaches about 92,000 pairs. Without the precompute the three `Math.pow`
 * calls inside `relativeLuminance` would run on every one of them, on every
 * re-render including each arrow-key nudge.
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
  // Narrower than the two decimals the app prints: a range of 4.5312 to 4.5319
  // tells the reader nothing a single reading does not, and dressing it up as
  // "4.53 - 4.54" invents uncertainty the maths does not support.
  //
  // This used to compare the FORMATTED ends, `roundUp2(high) <= truncate2(low)`,
  // which can only hold when high equals low — already returned above. The
  // guard was therefore unreachable and the documented behaviour never
  // happened. Comparing the width is what the comment always meant.
  return band.high - band.low < DISPLAY_RESOLUTION ? null : band;
}

/** Two decimals, the precision `formatBand` prints. */
export const DISPLAY_RESOLUTION = 0.01;

export const UNRECOVERABLE_NOTE =
  'A sampled point sits on a colour edge and nothing of its own colour survives ' +
  'undamaged nearby — a stroke one or two pixels wide has no inside. This file ' +
  'does not record what that colour was, so no ratio and no verdict can be ' +
  'given for it. Take the screenshot as PNG, or measure a thicker area of the ' +
  'same colour.';

/**
 * What this source can honestly support: a single number, a range, or nothing.
 *
 * The third answer is the one that was missing. `bandFor` alone will always
 * produce SOME band, and on a thin stroke that band is narrow, confident and
 * wrong — measured: a true 4.00:1 reported as a range of 7.17 to 8.59, which
 * reads as a pass at every level including AAA. A reading whose region has no
 * undamaged witness is not a range, it is an absence, and the app now says so
 * instead of answering.
 */
export type SourceReading =
  | { kind: 'exact' }
  | { kind: 'band'; band: Band }
  | { kind: 'unrecoverable' };

export function readSource(
  format: 'png' | 'jpeg' | 'other',
  a: BandPoint | null,
  b: BandPoint | null,
): SourceReading {
  if (format !== 'jpeg' || !a || !b) return { kind: 'exact' };
  if (a.count > 1 || b.count > 1) return { kind: 'exact' };
  const risky = (p: BandPoint) => p.chromaSpread >= LOSSY_SPREAD_THRESHOLD;
  if (!risky(a) && !risky(b)) return { kind: 'exact' };
  for (const p of [a, b]) {
    // Against the lumas the sample COULD have had, not the one it decoded to.
    // A pixel clamped at the gamut boundary reads back at the wrong brightness
    // — measured on a device: a white pixel beside a red block decodes as
    // #FFE3E1, whose luma is 235 rather than 255, because the red chroma
    // pushed R past 255 and the decoder cut it. Comparing that apparent luma
    // against the clean white around it refused a reading the band recovers
    // perfectly well.
    if (risky(p) && !candidateLumas(p.colour, p.neighbourhood).some((y) => hasWitness(y, p.cleanLumas))) {
      return { kind: 'unrecoverable' };
    }
  }
  const band = bandFor(format, a, b);
  return band ? { kind: 'band', band } : { kind: 'exact' };
}

/**
 * A threshold is only answered when the WHOLE band falls on one side of it.
 * This is the point of the band: a true 4.00:1 that decodes as 7.37:1 produces
 * a band spanning 4.5, and the app says it cannot tell instead of reporting a
 * AAA pass on an AA failure.
 */
export type Certainty = 'pass' | 'fail' | 'undetermined';

/** Shared by the on-screen verdicts and the exported evidence card. */
export const CERTAINTY_MARK: Record<Certainty, string> = {
  pass: '\u2714 Pass',
  fail: '\u2718 Fail',
  undetermined: '? Unknown',
};

/** Spoken form, for accessibility labels and for the export's alt text. */
export const CERTAINTY_SAY: Record<Certainty, string> = {
  pass: 'pass',
  fail: 'fail',
  undetermined: 'cannot be determined from this source',
};

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
