import {
  contrastRatio,
  evaluate,
  formatRatio,
  linearizeChannel,
  ratioFromLuminances,
  relativeLuminance,
  toHex,
} from '../src/contrast';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const hex = (h: string) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

describe('relative luminance', () => {
  it('black = 0, white = 1 exactly', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
  });
  it('uses the linear branch below the threshold and the power branch above', () => {
    expect(linearizeChannel(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(linearizeChannel(128)).toBeCloseTo(0.21586, 5);
  });
  it('0.03928 and 0.04045 thresholds are identical for every 8-bit value', () => {
    const alt = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    for (let v = 0; v < 256; v++) expect(linearizeChannel(v)).toBe(alt(v));
  });
  it('weights channels 0.2126 / 0.7152 / 0.0722', () => {
    expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126, 10);
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeCloseTo(0.7152, 10);
    expect(relativeLuminance({ r: 0, g: 0, b: 255 })).toBeCloseTo(0.0722, 10);
  });
});

describe('contrast ratio', () => {
  it('pure black on white is exactly 21:1', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
    expect(contrastRatio(WHITE, BLACK)).toBe(21);
  });
  it('identical colours are exactly 1:1', () => {
    expect(contrastRatio(hex('#336699'), hex('#336699'))).toBe(1);
  });
  it.each([
    ['#767676', 4.54], // lightest grey that passes AA on white
    ['#777777', 4.48], // one step lighter fails AA
    ['#595959', 7.0],
    ['#808080', 3.95],
    ['#949494', 3.03],
    ['#FF0000', 4.0],
    ['#0000FF', 8.59],
  ])('%s on white = %f:1', (fg, expected) => {
    expect(contrastRatio(hex(fg), WHITE)).toBeCloseTo(expected, 2);
  });
  it('is symmetric', () => {
    const a = hex('#1A73E8');
    const b = hex('#F1F3F4');
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });
});

describe('verdicts', () => {
  const byId = (r: number) => Object.fromEntries(evaluate(r).map((v) => [v.id, v.pass]));
  it('21:1 passes everything', () => {
    expect(Object.values(byId(21)).every(Boolean)).toBe(true);
  });
  it('4.54:1 (#767676 on white): AA normal yes, AAA normal no, AAA large yes', () => {
    const v = byId(contrastRatio(hex('#767676'), WHITE));
    expect(v['aa-normal']).toBe(true);
    expect(v['aaa-normal']).toBe(false);
    expect(v['aaa-large']).toBe(true);
    expect(v['non-text']).toBe(true);
  });
  it('thresholds are inclusive and never rounded', () => {
    expect(byId(4.5)['aa-normal']).toBe(true);
    expect(byId(4.4999)['aa-normal']).toBe(false);
    expect(byId(3)['aa-large']).toBe(true);
    expect(byId(2.9999)['non-text']).toBe(false);
    expect(byId(7)['aaa-normal']).toBe(true);
    expect(byId(6.9999)['aaa-normal']).toBe(false);
  });
  it('lists the five requested criteria with correct SC numbers', () => {
    expect(evaluate(1).map((v) => `${v.sc}/${v.level}/${v.threshold}`)).toEqual([
      '1.4.3/AA/4.5',
      '1.4.3/AA/3',
      '1.4.6/AAA/7',
      '1.4.6/AAA/4.5',
      '1.4.11/AA/3',
    ]);
  });
});

describe('formatting', () => {
  it('hex is upper-case and zero padded', () => {
    expect(toHex({ r: 0, g: 10, b: 255 })).toBe('#000AFF');
  });
  it('never rounds a failing ratio up to the threshold', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(2.999)).toBe('2.99:1');
  });
  it('shows exact values faithfully', () => {
    expect(formatRatio(21)).toBe('21.00:1');
    expect(formatRatio(4.5)).toBe('4.50:1');
  });
});

describe('formatRatio contract (no epsilon)', () => {
  it('never shows a failing ratio as the threshold, even a hair below it', () => {
    expect(formatRatio(4.49999999999)).toBe('4.49:1');
    expect(formatRatio(4.5 - 4 * Number.EPSILON)).toBe('4.49:1'); // the double just below 4.5
    expect(formatRatio(4.5 - 1e-12)).toBe('4.49:1');
    expect(formatRatio(2.9999999999)).toBe('2.99:1');
    expect(formatRatio(6.999999999999)).toBe('6.99:1');
  });
  it('exact and float-noisy values still format faithfully', () => {
    for (const [v, s] of [[21, '21.00:1'], [4.5, '4.50:1'], [3, '3.00:1'], [7, '7.00:1'], [1, '1.00:1'], [4.35, '4.35:1'], [1.1, '1.10:1'], [4.57, '4.57:1']] as const) {
      expect(formatRatio(v)).toBe(s);
    }
  });
});

describe('ratioFromLuminances', () => {
  it('equals contrastRatio on 8-bit colours', () => {
    const a = hex('#1A73E8');
    const b = hex('#F1F3F4');
    expect(ratioFromLuminances(relativeLuminance(a), relativeLuminance(b))).toBe(contrastRatio(a, b));
  });
});

describe('end to end: two RGB values -> ratio -> verdict (real 8-bit pairs)', () => {
  const rgb = (r: number, g: number, b: number) => ({ r, g, b });
  const pass = (a: ReturnType<typeof rgb>, b: ReturnType<typeof rgb>, id: string) =>
    evaluate(contrastRatio(a, b)).find((v) => v.id === id)!.pass;
  // [colour on white, expected pass, ratio bracket]
  const cases: Array<[string, ReturnType<typeof rgb>, boolean, string]> = [
    ['aa-normal', rgb(0, 114, 240), true, '4.50'], // 4.50143
    ['aa-normal', rgb(0, 111, 251), false, '4.49'], // 4.49989
    ['aa-large', rgb(0, 159, 220), true, '3.00'], // 3.00312
    ['aa-large', rgb(0, 159, 221), false, '2.99'], // 2.99857
    ['aaa-normal', rgb(0, 90, 164), true, '7.00'], // 7.00342
    ['aaa-normal', rgb(0, 81, 199), false, '6.99'], // 6.99609
    ['aa-normal', rgb(0x76, 0x76, 0x76), true, '4.54'],
    ['aa-normal', rgb(0x77, 0x77, 0x77), false, '4.47'],
    ['aaa-normal', rgb(0x59, 0x59, 0x59), true, '7.00'],
    ['aaa-normal', rgb(0x5a, 0x5a, 0x5a), false, '6.89'],
    ['non-text', rgb(0x94, 0x94, 0x94), true, '3.03'],
    ['non-text', rgb(0x95, 0x95, 0x95), false, '2.99'],
  ];
  it.each(cases)('%s: %j on white -> pass=%s, shown as %s', (id, c, expected, shown) => {
    expect(pass(c, WHITE, id)).toBe(expected);
    expect(pass(WHITE, c, id)).toBe(expected); // order does not matter
    expect(formatRatio(contrastRatio(c, WHITE))).toBe(`${shown}:1`);
  });
  it('the displayed text never contradicts the verdict at the 4.5 boundary', () => {
    for (const [id, c, expected, shown] of cases) {
      const text = formatRatio(contrastRatio(c, WHITE));
      if (id === 'aa-normal' && !expected) expect(text).not.toBe('4.50:1');
      expect(text).toBe(`${shown}:1`);
    }
  });
});
