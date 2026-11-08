import { buildReport, profileWarning, type ReportPoint } from '../src/report';
import { relativeLuminance, type RGB } from '../src/contrast';
import type { ProfileInfo } from '../src/colourProfile';
import { LOSSY_WARNING, LOSSY_WARNING_BANDED } from '../src/lossy';
import { chroma, fromYCbCr, luma } from '../src/lossy';

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const RED: RGB = { r: 255, g: 0, b: 0 };
const DAMAGED: RGB = { r: 0xa2, g: 0x24, b: 0x3a };

const JPEG: ProfileInfo = { status: 'srgb', format: 'jpeg', detail: 'JFIF' };
const PNG: ProfileInfo = { status: 'srgb', format: 'png', detail: 'sRGB chunk' };
const P3: ProfileInfo = { status: 'non-srgb', format: 'png', detail: 'Display P3' };

// `ReportPoint` deliberately has no coordinates: the report is about colours
// and their trustworthiness, not about where they were taken from.
const pt = (colour: RGB, over: Partial<ReportPoint> = {}): ReportPoint => ({
  colour,
  luminance: relativeLuminance(colour),
  alpha: 255,
  nonOpaque: 0,
  count: 1,
  chromaSpread: 0,
  neighbourhood: [colour],
  ...over,
});

const rim = pt(DAMAGED, {
  chromaSpread: 999,
  neighbourhood: [DAMAGED, RED, RED, WHITE, WHITE, RED, DAMAGED, RED, WHITE],
});

describe('buildReport', () => {
  it('reaches no verdict until both points exist', () => {
    expect(buildReport(pt(RED), null, PNG).assessment).toBeNull();
    expect(buildReport(null, pt(WHITE), PNG).assessment).toBeNull();
    expect(buildReport(null, null, PNG).band).toBeNull();
    expect(buildReport(pt(RED), pt(WHITE), PNG).assessment?.kind).toBe('result');
  });

  it('warns about a point that is set even while its partner is not', () => {
    const r = buildReport(pt(RED, { alpha: 120, nonOpaque: 1 }), null, PNG);
    expect(r.warnings.join(' ')).toMatch(/Point A:.*not fully opaque/);
  });

  it('pairs the band with the SHORT lossy warning, never both texts', () => {
    const r = buildReport(rim, pt(WHITE), JPEG);
    expect(r.band).not.toBeNull();
    expect(r.warnings).toContain(LOSSY_WARNING_BANDED);
    expect(r.warnings).not.toContain(LOSSY_WARNING);
  });

  it('uses the long warning when no band is shown, so the facts are not lost', () => {
    // An averaged patch gets no band (see band.ts), so the full text applies.
    const r = buildReport({ ...rim, count: 9 }, { ...pt(WHITE), count: 9 }, JPEG);
    expect(r.band).toBeNull();
    expect(r.warnings).toContain(LOSSY_WARNING);
  });

  it('says nothing about lossiness for a PNG, and gives no band', () => {
    const r = buildReport({ ...rim }, pt(WHITE), PNG);
    expect(r.band).toBeNull();
    expect(r.warnings.join(' ')).not.toMatch(/JPEG/);
  });

  it('carries a colour-profile warning alongside the rest', () => {
    const r = buildReport(pt(RED, { alpha: 10, nonOpaque: 1 }), pt(WHITE), P3);
    expect(r.warnings[0]).toMatch(/Display P3/);
    expect(r.warnings.join(' ')).toMatch(/not fully opaque/);
    expect(r.assessment?.kind).toBe('suppressed');
  });

  it('gives no band for a suppressed result, which has no ratio to bracket', () => {
    const r = buildReport({ ...rim, alpha: 0, nonOpaque: 1 }, pt(WHITE), JPEG);
    expect(r.assessment?.kind).toBe('suppressed');
    expect(r.band).toBeNull();
  });
});

describe('profileWarning', () => {
  it('is silent for a file that says it is sRGB', () => {
    expect(profileWarning(PNG)).toBeNull();
    expect(profileWarning(JPEG)).toBeNull();
  });

  it('names what it found, so the reader can judge', () => {
    expect(profileWarning(P3)).toContain('Display P3');
    expect(profileWarning({ status: 'unknown-icc', format: 'png', detail: 'ICC v4' })).toContain('ICC v4');
    expect(profileWarning({ status: 'unsupported-format', format: 'other', detail: 'webp' })).toMatch(/not inspected/);
  });
});

describe('the screen and the export cannot disagree', () => {
  it('is one call: a white pixel at a red edge reports the same band and warning twice', () => {
    const px = fromYCbCr(luma(WHITE), chroma(RED).cb, chroma(WHITE).cr);
    const a = pt(px, { chromaSpread: 999, neighbourhood: [px, WHITE, WHITE, RED, RED] });
    const first = buildReport(a, pt(RED), JPEG);
    const second = buildReport(a, pt(RED), JPEG);
    expect(second).toEqual(first);
    expect(first.warnings.length).toBeGreaterThan(0);
  });
});
