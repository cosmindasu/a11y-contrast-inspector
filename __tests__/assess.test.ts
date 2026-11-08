import { assess } from '../src/assess';
import { relativeLuminance } from '../src/contrast';
import { averageRgba } from '../src/patch';

const WHITE = { r: 255, g: 255, b: 255 };
const solid = (c: { r: number; g: number; b: number }) => ({
  luminance: relativeLuminance(c),
  nonOpaque: 0,
  count: 1,
  alpha: 255,
});

describe('assess', () => {
  it('gives a ratio and verdicts for opaque points', () => {
    const r = assess(solid({ r: 0, g: 0, b: 0 }), solid(WHITE));
    expect(r.kind).toBe('result');
    if (r.kind === 'result') {
      expect(r.ratio).toBeCloseTo(21, 10);
      expect(r.verdicts.every((v) => v.pass)).toBe(true);
    }
  });
  it('SUPPRESSES the verdict when a non-centre patch pixel is transparent', () => {
    const cells: number[][] = Array.from({ length: 9 }, () => [10, 10, 10, 255]);
    cells[8] = [0, 0, 0, 0]; // corner; centre is opaque
    const p = averageRgba(Uint8Array.from(cells.flat()));
    const a = { luminance: p.luminance, nonOpaque: p.nonOpaqueCount, count: p.count, alpha: p.minAlpha };
    const r = assess(a, solid(WHITE));
    expect(r.kind).toBe('suppressed');
    if (r.kind === 'suppressed') {
      expect(r.reasons).toHaveLength(1);
      expect(r.reasons[0]).toContain('1 of the 9 sampled pixels are not fully opaque');
    }
  });
  it('suppresses for a single semi-transparent pixel on either side', () => {
    const t = { luminance: 0.1, nonOpaque: 1, count: 1, alpha: 200 };
    expect(assess(solid(WHITE), t).kind).toBe('suppressed');
    expect(assess(t, solid(WHITE)).kind).toBe('suppressed');
  });
  it('end to end through the averaged path matches the single-pixel ratio for a uniform opaque patch', () => {
    const grey = { r: 0x76, g: 0x76, b: 0x76 };
    const p = averageRgba(Uint8Array.from(Array.from({ length: 9 }, () => [0x76, 0x76, 0x76, 255]).flat()));
    const viaPatch = assess({ luminance: p.luminance, nonOpaque: 0, count: 9, alpha: 255 }, solid(WHITE));
    const viaPixel = assess(solid(grey), solid(WHITE));
    if (viaPatch.kind !== 'result' || viaPixel.kind !== 'result') throw new Error('expected results');
    expect(viaPatch.ratio).toBeCloseTo(viaPixel.ratio, 12);
  });
});
