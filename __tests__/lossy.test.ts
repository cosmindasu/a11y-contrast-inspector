import {
  chroma,
  chromaSpreadOfRgba,
  lossyWarning,
  LOSSY_WARNING,
  LOSSY_SPREAD_THRESHOLD,
} from '../src/lossy';

type C = { r: number; g: number; b: number };

const RED: C = { r: 255, g: 0, b: 0 }; // #FF0000
const WHITE: C = { r: 255, g: 255, b: 255 };
const BLACK: C = { r: 0, g: 0, b: 0 };
const GREY: C = { r: 118, g: 118, b: 118 }; // #767676
/** A real dark UI background read off the user's own phone. */
const CHROME: C = { r: 0x18, g: 0x1c, b: 0x27 }; // #181C27

/** Build an opaque RGBA buffer from a list of colours. */
const rgba = (cs: C[]): Uint8Array => {
  const out = new Uint8Array(cs.length * 4);
  cs.forEach((c, i) => {
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 255;
  });
  return out;
};

const flat = (c: C, n = 9) => rgba(Array.from({ length: n }, () => c));

describe('chroma', () => {
  it('puts every neutral on the 128/128 axis', () => {
    for (const c of [BLACK, GREY, WHITE, { r: 7, g: 7, b: 7 }]) {
      const { cb, cr } = chroma(c);
      expect(cb).toBeCloseTo(128, 6);
      expect(cr).toBeCloseTo(128, 6);
    }
  });

  it('moves off the axis for colour', () => {
    expect(chroma(RED).cr).toBeCloseTo(255.5, 3);
    expect(chroma(RED).cb).toBeCloseTo(84.97, 1);
    // A dark tinted chrome colour is NOT neutral, but it is barely off-axis.
    expect(Math.abs(chroma(CHROME).cb - 128)).toBeLessThan(7);
    expect(Math.abs(chroma(CHROME).cr - 128)).toBeLessThan(3);
  });
});

describe('chromaSpreadOfRgba', () => {
  it('is zero across a flat area, whatever colour it is', () => {
    expect(chromaSpreadOfRgba(flat(CHROME))).toBeCloseTo(0, 9);
    expect(chromaSpreadOfRgba(flat(RED))).toBeCloseTo(0, 9);
    expect(chromaSpreadOfRgba(flat(BLACK))).toBeCloseTo(0, 9);
  });

  it('is large where the colour changes', () => {
    // A red/white boundary: this is the case that actually corrupts readings.
    const spread = chromaSpreadOfRgba(rgba([RED, RED, WHITE, WHITE]));
    expect(spread).toBeGreaterThan(LOSSY_SPREAD_THRESHOLD);
    expect(spread).toBeCloseTo(127.5, 1);
  });

  it('stays small across a neutral edge, which subsampling cannot damage', () => {
    // Black against white is a hard LUMA edge but carries no chroma at all.
    expect(chromaSpreadOfRgba(rgba([BLACK, WHITE, BLACK, WHITE]))).toBeCloseTo(0, 6);
  });

  it('returns zero for an empty buffer instead of ±Infinity', () => {
    expect(chromaSpreadOfRgba(new Uint8Array(0))).toBe(0);
  });

  it('ignores the alpha byte', () => {
    const opaque = rgba([RED, WHITE]);
    const transparent = rgba([RED, WHITE]);
    transparent[3] = 0;
    transparent[7] = 17;
    expect(chromaSpreadOfRgba(transparent)).toBeCloseTo(chromaSpreadOfRgba(opaque), 9);
  });
});

describe('lossyWarning', () => {
  const at = (chromaSpread: number) => ({ chromaSpread });

  it('says nothing for a lossless format, however much the colour varies', () => {
    expect(lossyWarning('png', [at(200), at(200)])).toBeNull();
    expect(lossyWarning('other', [at(200), at(200)])).toBeNull();

    // Positive control: the same points DO warn on a JPEG, so the nulls above
    // come from the format and not from a guard that never fires.
    expect(lossyWarning('jpeg', [at(200), at(200)])).toBe(LOSSY_WARNING);
  });

  it('stays quiet on a JPEG across a flat area', () => {
    // The case that made the previous version useless: a large flat #181C27
    // background is coloured, but nothing around it changes, so it is safe.
    expect(lossyWarning('jpeg', [at(0), at(0)])).toBeNull();
    expect(lossyWarning('jpeg', [at(1.2), at(2.2)])).toBeNull(); // measured real values
  });

  it('warns on a JPEG as soon as one sample sits where colour changes', () => {
    expect(lossyWarning('jpeg', [at(127.5), at(0)])).toBe(LOSSY_WARNING);
    expect(lossyWarning('jpeg', [at(0), at(54.6)])).toBe(LOSSY_WARNING);
  });

  it('treats the threshold as inclusive, and the step below it as safe', () => {
    expect(lossyWarning('jpeg', [at(LOSSY_SPREAD_THRESHOLD)])).toBe(LOSSY_WARNING);
    expect(lossyWarning('jpeg', [at(LOSSY_SPREAD_THRESHOLD - 0.001)])).toBeNull();
  });

  it('keeps the measured gap: no damaged pixel below 54.6, no safe one above 16', () => {
    expect(LOSSY_SPREAD_THRESHOLD).toBeGreaterThan(16);
    expect(LOSSY_SPREAD_THRESHOLD).toBeLessThan(54.6);
  });

  it('says nothing before any point is placed', () => {
    expect(lossyWarning('jpeg', [null, null])).toBeNull();
    expect(lossyWarning('jpeg', [])).toBeNull();
  });

  it('carries the facts a reader needs to act, not just an alarm', () => {
    // Guarding the key is not guarding the output: assert the produced text.
    expect(LOSSY_WARNING).toContain('JPEG');
    expect(LOSSY_WARNING).toContain('PNG');
    expect(LOSSY_WARNING).toContain('4.00:1');
    expect(LOSSY_WARNING).toContain('7.37:1');
    expect(LOSSY_WARNING).toMatch(/two or more pixels inside/);
  });
});
