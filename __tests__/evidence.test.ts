import {
  cropRect,
  evidenceCard,
  stamp,
  PICKER_NAME_CAVEAT,
  type EvidenceInput,
} from '../src/evidence';
import { evaluate, type RGB } from '../src/contrast';
import type { Assessment } from '../src/assess';
import type { ProfileInfo } from '../src/colourProfile';
import { LOSSY_WARNING_BANDED } from '../src/lossy';

const RED: RGB = { r: 0xa2, g: 0x24, b: 0x3a };
const WHITE: RGB = { r: 255, g: 255, b: 255 };

const JPEG: ProfileInfo = { status: 'srgb', format: 'jpeg', detail: 'JFIF, no ICC' };
const PNG: ProfileInfo = { status: 'srgb', format: 'png', detail: 'sRGB chunk' };

const resultAt = (ratio: number): Assessment => ({ kind: 'result', ratio, verdicts: evaluate(ratio) });

const base = (over: Partial<EvidenceInput> = {}): EvidenceInput => ({
  fileName: 'edge-420.jpg',
  imageWidth: 360,
  imageHeight: 600,
  profile: JPEG,
  source: 'share',
  mode: 1,
  a: { at: { x: 180, y: 400 }, colour: RED, count: 1 },
  b: { at: { x: 240, y: 400 }, colour: WHITE, count: 1 },
  assessment: resultAt(7.1842),
  band: { low: 4.0, high: 8.5874 },
  warnings: [LOSSY_WARNING_BANDED],
  takenAt: new Date(2026, 10, 8, 21, 14),
  appVersion: '1.0.0',
  ...over,
});

describe('evidenceCard: what the export is not allowed to lose', () => {
  it('carries every warning verbatim', () => {
    const w = ['first warning', 'second warning'];
    expect(evidenceCard(base({ warnings: w })).warnings).toEqual(w);
  });

  it('still carries them when there is no ratio at all', () => {
    const card = evidenceCard(
      base({
        assessment: { kind: 'suppressed', reasons: ['Point A: not fully opaque.'] },
        band: null,
        warnings: ['a warning that must survive'],
      }),
    );
    expect(card.warnings).toEqual(['a warning that must survive']);
    expect(card.verdicts).toEqual([]);
    expect(card.reading.label).toBe('No contrast result');
    expect(card.reading.note).toContain('not fully opaque');
  });

  it('makes the RANGE the headline and demotes the stored value to a note', () => {
    const card = evidenceCard(base());
    expect(card.reading.value).toBe('4.00 – 8.59:1');
    expect(card.reading.label).toContain('range');
    // The figure read off the file must not be the number on the card.
    expect(card.reading.value).not.toContain('7.18');
    expect(card.reading.note).toContain('7.18:1');
  });

  it('answers only what the band answers', () => {
    const by = Object.fromEntries(
      evidenceCard(base()).verdicts.map((v) => [v.text, v.certainty]),
    );
    expect(by['SC 1.4.3 AA · Normal text · 4.5:1']).toBe('undetermined');
    expect(by['SC 1.4.3 AA · Large text · 3:1']).toBe('pass');
    const marks = evidenceCard(base()).verdicts.map((v) => v.mark);
    expect(marks).toContain('? Unknown');
    expect(marks).toContain('✔ Pass');
  });

  it('reports a single number when the source supports one', () => {
    const card = evidenceCard(base({ profile: PNG, band: null, warnings: [], assessment: resultAt(4.5) }));
    expect(card.reading.label).toBe('Contrast ratio');
    expect(card.reading.value).toBe('4.50:1');
    expect(card.verdicts.map((v) => v.certainty)).not.toContain('undetermined');
  });

  it('marks an averaged point as an average rather than a pixel', () => {
    const card = evidenceCard(
      base({ mode: 3, a: { at: { x: 5, y: 5 }, colour: RED, count: 9 } }),
    );
    expect(card.points[0]!.note).toMatch(/Average of 9 pixels/);
    expect(card.points[1]!.note).toBe('Exact single pixel');
    expect(card.footer.join(' ')).toContain('average of a 3×3 patch');
  });

  it('names the source, its format and colour space, the sampling and the time', () => {
    const f = evidenceCard(base()).footer.join(' | ');
    expect(f).toContain('edge-420.jpg');
    expect(f).toContain('360 × 600 px');
    expect(f).toContain('JPEG (lossy)');
    expect(f).toContain('JFIF, no ICC');
    expect(f).toContain('single pixel (exact)');
    expect(f).toContain('2026-11-08 21:14');
    expect(f).toContain('Contrast Inspector 1.0.0');
  });

  it('does not pass a picker id off as the file\u2019s name', () => {
    // The picker reports the name of a cached COPY: "26.jpg", not the real
    // name. Evidence that silently prints it as the filename is a false record.
    const picked = evidenceCard(base({ source: 'picker', fileName: '26.jpg' }));
    expect(picked.footer).toContain(PICKER_NAME_CAVEAT);
    expect(picked.footer[0]).toContain('26.jpg');
    expect(PICKER_NAME_CAVEAT).toMatch(/Share a screenshot/);

    // The share route carries the real name, so it gets no caveat.
    const shared = evidenceCard(base({ source: 'share', fileName: 'edge-420.jpg' }));
    expect(shared.footer).not.toContain(PICKER_NAME_CAVEAT);
    expect(shared.footer[0]).toContain('edge-420.jpg');
  });

  it('does not call a PNG lossy', () => {
    expect(evidenceCard(base({ profile: PNG, band: null })).footer.join(' ')).not.toContain('lossy');
  });

  it('gives both points their hex, channels and coordinates', () => {
    const [a, b] = evidenceCard(base()).points;
    expect(a).toMatchObject({ name: 'A', hex: '#A2243A', rgb: 'RGB 162, 36, 58', at: 'x 180, y 400' });
    expect(b).toMatchObject({ name: 'B', hex: '#FFFFFF', at: 'x 240, y 400' });
  });
});

describe('stamp', () => {
  it('spells the offset out so a reading is not ambiguous', () => {
    const d = new Date(2026, 10, 8, 21, 14);
    expect(stamp(d, 120)).toBe('2026-11-08 21:14 UTC+02:00');
    expect(stamp(d, -330)).toBe('2026-11-08 21:14 UTC-05:30');
    expect(stamp(d, 0)).toBe('2026-11-08 21:14 UTC+00:00');
  });

  it('pads every field', () => {
    expect(stamp(new Date(2026, 0, 2, 3, 4), 60)).toBe('2026-01-02 03:04 UTC+01:00');
  });

  it('uses the machine offset by default, in the documented shape', () => {
    expect(stamp(new Date())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/);
  });
});

describe('cropRect', () => {
  const W = 360;
  const H = 600;
  const inside = (r: ReturnType<typeof cropRect>) =>
    r.x >= 0 && r.y >= 0 && r.x + r.width <= W && r.y + r.height <= H;
  const holds = (r: ReturnType<typeof cropRect>, p: { x: number; y: number }) =>
    p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

  it('contains both points and stays inside the image, wherever they are', () => {
    const coords = [0, 1, 7, 179, 180, 358, 359];
    const ys = [0, 1, 299, 300, 598, 599];
    for (const ax of coords) {
      for (const ay of ys) {
        for (const bx of coords) {
          for (const by of ys) {
            const a = { x: ax, y: ay };
            const b = { x: bx, y: by };
            const r = cropRect(a, b, W, H);
            expect(inside(r)).toBe(true);
            expect(holds(r, a)).toBe(true);
            expect(holds(r, b)).toBe(true);
            expect(r.width).toBeGreaterThan(0);
            expect(r.height).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('does not return a sliver for two adjacent pixels', () => {
    // The failure this floor exists for: a 2x1 crop shows nothing of the edge.
    const r = cropRect({ x: 180, y: 400 }, { x: 181, y: 400 }, W, H);
    expect(r.width).toBeGreaterThanOrEqual(64);
    expect(r.height).toBeGreaterThanOrEqual(64);
  });

  it('falls back to the whole image when the image is smaller than the floor', () => {
    const r = cropRect({ x: 0, y: 0 }, { x: 9, y: 3 }, 10, 4);
    expect(r).toEqual({ x: 0, y: 0, width: 10, height: 4 });
  });

  it('keeps room around a far-apart pair instead of hugging them', () => {
    const r = cropRect({ x: 100, y: 200 }, { x: 140, y: 240 }, W, H);
    expect(r.x).toBeLessThan(100);
    expect(r.y).toBeLessThan(200);
    expect(r.x + r.width).toBeGreaterThan(141);
    expect(r.y + r.height).toBeGreaterThan(241);
  });
});
