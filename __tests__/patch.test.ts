import { averageRgba, patchBounds } from '../src/patch';

describe('patchBounds', () => {
  it('centres an odd patch', () => {
    expect(patchBounds(10, 10, 3, 100, 100)).toEqual({ x: 9, y: 9, width: 3, height: 3 });
    expect(patchBounds(10, 10, 5, 100, 100)).toEqual({ x: 8, y: 8, width: 5, height: 5 });
  });
  it('clips at the image edges', () => {
    expect(patchBounds(0, 0, 3, 100, 100)).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(patchBounds(99, 99, 5, 100, 100)).toEqual({ x: 97, y: 97, width: 3, height: 3 });
  });
});

import { relativeLuminance, toHex } from '../src/contrast';

const px = (...p: number[][]) => Uint8Array.from(p.flat());

describe('averageRgba (linear light)', () => {
  it('averages black and white to linear 0.5 (#BCBCBC), not #808080', () => {
    const r = averageRgba(px([0, 0, 0, 255], [255, 255, 255, 255]));
    expect(toHex(r.colour)).toBe('#BCBCBC');
    expect(r.luminance).toBeCloseTo(0.5, 12);
    expect(r.count).toBe(2);
  });
  it('luminance is the mean of per-pixel luminances, UNROUNDED', () => {
    const a = { r: 18, g: 200, b: 7 };
    const b = { r: 240, g: 3, b: 99 };
    const c = { r: 77, g: 77, b: 78 };
    const r = averageRgba(px([18, 200, 7, 255], [240, 3, 99, 255], [77, 77, 78, 255]));
    const mean = (relativeLuminance(a) + relativeLuminance(b) + relativeLuminance(c)) / 3;
    expect(r.luminance).toBeCloseTo(mean, 14);
    // The ratio comes from the unrounded value, not from the rounded hex.
    expect(r.luminance).not.toBe(relativeLuminance(r.colour));
  });
  it('a uniform patch averages to itself and equals the single-pixel luminance', () => {
    const bytes = new Uint8Array(25 * 4).map((_, i) => [18, 52, 86, 255][i % 4] as number);
    const r = averageRgba(bytes);
    expect(r.colour).toEqual({ r: 18, g: 52, b: 86 });
    expect(r.luminance).toBeCloseTo(relativeLuminance({ r: 18, g: 52, b: 86 }), 14);
    expect(r.nonOpaqueCount).toBe(0);
    expect(r.minAlpha).toBe(255);
  });
  it('throws on empty input', () => {
    expect(() => averageRgba(new Uint8Array(0))).toThrow();
  });
});

describe('averageRgba alpha reporting (every sampled pixel, not just the centre)', () => {
  it('reports a transparent NEIGHBOUR even when the centre pixel is opaque', () => {
    // 3x3 patch, centre (index 4) opaque, one corner fully transparent (reads back as 0,0,0).
    const cells: number[][] = Array.from({ length: 9 }, () => [200, 200, 200, 255]);
    cells[0] = [0, 0, 0, 0];
    const r = averageRgba(px(...cells));
    expect(r.nonOpaqueCount).toBe(1);
    expect(r.minAlpha).toBe(0);
  });
  it('counts semi-transparent pixels too', () => {
    const r = averageRgba(px([1, 2, 3, 254], [1, 2, 3, 255], [1, 2, 3, 128]));
    expect(r.nonOpaqueCount).toBe(2);
    expect(r.minAlpha).toBe(128);
  });
});
