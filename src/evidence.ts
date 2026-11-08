/**
 * What an exported finding says.
 *
 * A screenshot of the app would be a worse record than this: it is cropped to
 * whatever happened to be on screen, and the panel scrolls, so the warnings and
 * the provenance are usually not in the picture. An auditor pasting a number
 * into a report needs the number AND everything that qualifies it, in one
 * artefact that cannot be separated from it.
 *
 * So this module is deliberately the only place that decides WHAT goes on the
 * card, and it is pure, so the rules can be tested:
 *
 *   - warnings are carried verbatim and are never dropped, whatever else the
 *     card contains. An export that quietly loses "this is a JPEG" would undo
 *     the whole point of the uncertainty band;
 *   - where a band exists the headline IS the range. The value read straight
 *     off the file appears only as a subordinate note, never as the figure;
 *   - a suppressed result exports as a suppressed result, with its reason and
 *     with no ratio and no verdicts to quote out of context;
 *   - the footer always names the source file, its format and colour space,
 *     the sampling mode and when the reading was taken.
 *
 * Drawing it is `evidenceImage.ts`, which only lays out what it is given.
 */
import { CERTAINTY_MARK, evaluateBand, formatBand, type Band, type Certainty } from './band';
import { formatRatio, toHex, type RGB } from './contrast';
import type { Assessment } from './assess';
import type { ProfileInfo } from './colourProfile';
import type { PixelPoint } from './coords';
import type { ImageSource } from './pixels';

export type SamplingMode = 1 | 3 | 5;

/** Structural: `Measured` from Results.tsx satisfies it, without importing React. */
export interface EvidencePoint {
  at: PixelPoint;
  colour: RGB;
  count: number;
}

export interface EvidenceInput {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  profile: ProfileInfo;
  source: ImageSource;
  mode: SamplingMode;
  a: EvidencePoint;
  b: EvidencePoint;
  assessment: Assessment;
  band: Band | null;
  warnings: readonly string[];
  takenAt: Date;
  appVersion: string;
}

export interface EvidenceReading {
  label: string;
  value: string;
  note: string;
}

export interface EvidencePointLine {
  name: string;
  hex: string;
  colour: RGB;
  rgb: string;
  at: string;
  note: string;
}

export interface EvidenceVerdict {
  certainty: Certainty;
  mark: string;
  text: string;
}

export interface EvidenceCard {
  title: string;
  reading: EvidenceReading;
  points: EvidencePointLine[];
  verdicts: EvidenceVerdict[];
  warnings: string[];
  footer: string[];
}

/**
 * The gallery picker hands over a cached COPY and reports the copy's name, so
 * the name on the card may be a MediaStore id. Evidence must not present that
 * as the file's name, and the share route does carry the real one — so the
 * card says which route it was and how to get a traceable name.
 */
export const PICKER_NAME_CAVEAT =
  'Name as reported by the gallery picker, which on Android is often an id ' +
  'rather than the file\u2019s own name. Share a screenshot to this app ' +
  'instead to record its real name.';

const SAMPLING: Record<SamplingMode, string> = {
  1: 'single pixel (exact)',
  3: 'average of a 3×3 patch',
  5: 'average of a 5×5 patch',
};

/**
 * Local time with the offset spelled out, so a reading taken in one place and
 * read in another is not ambiguous. The offset is a parameter so the format can
 * be tested without depending on the machine's time zone.
 */
export function stamp(d: Date, offsetMinutes = -d.getTimezoneOffset()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${date} ${time} UTC${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

function pointLine(name: string, m: EvidencePoint, mode: SamplingMode): EvidencePointLine {
  const averaged = m.count > 1;
  return {
    name,
    hex: toHex(m.colour),
    colour: m.colour,
    rgb: `RGB ${m.colour.r}, ${m.colour.g}, ${m.colour.b}`,
    at: `x ${m.at.x}, y ${m.at.y}`,
    note: averaged
      ? `Average of ${m.count} pixels — the hex is rounded for display and may not exist in the image`
      : 'Exact single pixel',
  };
}

function reading(input: EvidenceInput): EvidenceReading {
  if (input.assessment.kind === 'suppressed') {
    return {
      label: 'No contrast result',
      value: '—',
      note: input.assessment.reasons.join(' '),
    };
  }
  const exact = formatRatio(input.assessment.ratio);
  if (input.band) {
    return {
      label: 'Contrast ratio — range',
      value: formatBand(input.band),
      note:
        'A range, not a reading. The source cannot pin the ratio down further, ' +
        `and a verdict is given only where the whole range falls on one side of ` +
        `the threshold. Read straight off the file: ${exact}.`,
    };
  }
  return {
    label: 'Contrast ratio',
    value: exact,
    note: 'Truncated, never rounded up. WCAG does not round: 4.499 fails 4.5.',
  };
}

function verdicts(input: EvidenceInput): EvidenceVerdict[] {
  if (input.assessment.kind === 'suppressed') return [];
  const label = (sc: string, level: string, text: string, threshold: number) =>
    `SC ${sc} ${level} · ${text} · ${threshold}:1`;
  if (input.band) {
    return evaluateBand(input.band).map((v) => ({
      certainty: v.certainty,
      mark: CERTAINTY_MARK[v.certainty],
      text: label(v.sc, v.level, v.label, v.threshold),
    }));
  }
  return input.assessment.verdicts.map((v) => {
    const certainty: Certainty = v.pass ? 'pass' : 'fail';
    return {
      certainty,
      mark: CERTAINTY_MARK[certainty],
      text: label(v.sc, v.level, v.label, v.threshold),
    };
  });
}

export function evidenceCard(input: EvidenceInput): EvidenceCard {
  const lossy = input.profile.format === 'jpeg';
  return {
    title: 'Contrast Inspector · WCAG colour-contrast evidence',
    reading: reading(input),
    points: [pointLine('A', input.a, input.mode), pointLine('B', input.b, input.mode)],
    verdicts: verdicts(input),
    // Verbatim and unconditional. See the note at the top of this file.
    warnings: [...input.warnings],
    footer: [
      `${input.fileName} · ${input.imageWidth} × ${input.imageHeight} px`,
      ...(input.source === 'picker' ? [PICKER_NAME_CAVEAT] : []),
      `${input.profile.format.toUpperCase()}${lossy ? ' (lossy)' : ''} · ` +
        `colour space in file: ${input.profile.status} (${input.profile.detail}) · ` +
        'values read as sRGB',
      `Sampling: ${SAMPLING[input.mode]}`,
      `Measured ${stamp(input.takenAt)} · Contrast Inspector ${input.appVersion}`,
    ],
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of the image to show on the card: both points, with enough around
 * them to see what was being measured.
 *
 * Guarantees, all unit-tested: the rectangle contains both points, lies inside
 * the image, and is never degenerate. Two adjacent pixels must not produce a
 * 2x1 crop that shows nothing, so the box is padded and has a floor; where the
 * image is smaller than that floor, the whole image is used.
 */
export function cropRect(
  a: PixelPoint,
  b: PixelPoint,
  imageWidth: number,
  imageHeight: number,
  minSize = 64,
): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const pad = Math.max(16, Math.round(0.25 * Math.max(x1 - x0, y1 - y0)));
  let left = x0 - pad;
  let top = y0 - pad;
  let right = x1 + pad;
  let bottom = y1 + pad;

  // Grow to the floor around the centre, then push back inside the image.
  const grow = (lo: number, hi: number, limit: number): [number, number] => {
    const want = Math.min(minSize, limit);
    const short = want - (hi - lo + 1);
    if (short > 0) {
      lo -= Math.floor(short / 2);
      hi += Math.ceil(short / 2);
    }
    if (lo < 0) {
      hi -= lo;
      lo = 0;
    }
    if (hi > limit - 1) {
      lo -= hi - (limit - 1);
      hi = limit - 1;
    }
    return [Math.max(0, lo), Math.min(limit - 1, hi)];
  };
  [left, right] = grow(left, right, imageWidth);
  [top, bottom] = grow(top, bottom, imageHeight);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
