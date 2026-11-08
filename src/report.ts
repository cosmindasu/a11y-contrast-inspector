/**
 * Everything the app concludes from two measured points.
 *
 * Both the screen and the exported evidence card read from here. They used to
 * be able to disagree: the warnings were assembled inside the view, so an
 * export that rebuilt them itself could have shown a different set — and the
 * one warning that must never go missing is the one that says the number is
 * not trustworthy. One pure function, one answer, testable.
 */
import { assess, opacityProblem, type Assessable, type Assessment } from './assess';
import { bandFor, type Band, type BandPoint } from './band';
import type { ProfileInfo } from './colourProfile';
import { lossyWarning } from './lossy';

export type ReportPoint = Assessable & BandPoint;

export interface Report {
  /** Null until both points are placed. */
  assessment: Assessment | null;
  /** Null when a single number is the honest answer — see `band.ts`. */
  band: Band | null;
  warnings: string[];
}

export function profileWarning(p: ProfileInfo): string | null {
  switch (p.status) {
    case 'non-srgb':
      return `This file is tagged ${p.detail}. Values are NOT sRGB, so the ratio below is approximate and should not be cited as a WCAG result.`;
    case 'unknown-icc':
      return `This file has an embedded colour profile that could not be identified (${p.detail}). It may not be sRGB.`;
    case 'unsupported-format':
      return 'The colour space of this file format is not inspected. sRGB is assumed.';
    default:
      return null;
  }
}

export function buildReport(
  a: ReportPoint | null,
  b: ReportPoint | null,
  profile: ProfileInfo,
): Report {
  const assessment = a && b ? assess(a, b) : null;
  const band = assessment?.kind === 'result' ? bandFor(profile.format, a, b) : null;
  const warnings: string[] = [];
  const pw = profileWarning(profile);
  if (pw) warnings.push(pw);
  // A JPEG can be correctly tagged sRGB and still not be what was on screen:
  // 4:2:0 subsampling moves the one-pixel rim at every colour edge.
  const lw = lossyWarning(profile.format, [a, b], band !== null);
  if (lw) warnings.push(lw);
  // A point that is already measured but whose partner is not yet set still
  // deserves its transparency warning.
  for (const [name, m] of [['A', a], ['B', b]] as const) {
    const w = m ? opacityProblem(name, m) : null;
    if (w) warnings.push(w);
  }
  return { assessment, band, warnings };
}
