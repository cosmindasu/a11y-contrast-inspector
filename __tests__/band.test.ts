import {
  bandFor,
  hasWitness,
  readSource,
  WITNESS_LUMA_TOLERANCE,
  candidateColours,
  candidateLumas,
  certaintyFor,
  evaluateBand,
  formatBand,
  ratioBand,
  type Band,
  type BandPoint,
} from '../src/band';
import { contrastRatio, toHex, type RGB } from '../src/contrast';
import { chroma, fromYCbCr, luma, LOSSY_SPREAD_THRESHOLD, LUMA_TOLERANCE } from '../src/lossy';

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const RED: RGB = { r: 255, g: 0, b: 0 };
/** #FF0000 as a real MIUI JPEG decoded it, one pixel from a white edge. */
const DAMAGED_RED: RGB = { r: 0xa2, g: 0x24, b: 0x3a };
const PRIMARY: RGB = { r: 0x1d, g: 0x4e, b: 0xd8 }; // this app's own blue
const CHROME: RGB = { r: 0x18, g: 0x1c, b: 0x27 }; // a real dark UI background

const point = (p: Partial<BandPoint> & { colour: RGB }): BandPoint => ({
  neighbourhood: [p.colour],
  chromaSpread: 0,
  count: 1,
  // Witnessed by default: these fixtures are about the candidate maths. The
  // witness rule has its own tests below, and the readings that lack a witness
  // say so explicitly.
  cleanLumas: [luma(p.colour)],
  ...p,
});

/**
 * The measured 4:2:0 mechanism, used to generate honest test inputs: luma is
 * kept per pixel, chroma becomes the average over the 2x2 block, and the
 * decoder clamps. `nFg` of the 4 pixels in the block belong to `fg`.
 */
function decodeAtEdge(fg: RGB, bg: RGB, nFg: number): RGB {
  const a = chroma(fg);
  const b = chroma(bg);
  const w = nFg / 4;
  return fromYCbCr(luma(fg), a.cb * w + b.cb * (1 - w), a.cr * w + b.cr * (1 - w));
}

/** A 3x3 around a rim pixel: its own region, the other region, and more rim. */
const rimNeighbourhood = (px: RGB, fg: RGB, bg: RGB): RGB[] => [
  px, fg, fg, fg, bg, bg, bg, px, fg,
];

describe('the YCbCr round trip the band rests on', () => {
  it('returns the exact same integers for every colour on a dense grid', () => {
    let worst = 0;
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) {
          const c = { r, g, b };
          const { cb, cr } = chroma(c);
          const back = fromYCbCr(luma(c), cb, cr);
          worst = Math.max(
            worst,
            Math.abs(back.r - r),
            Math.abs(back.g - g),
            Math.abs(back.b - b),
          );
        }
      }
    }
    expect(worst).toBe(0);
  });

  it('is exact for every grey, including both gamut ends', () => {
    for (let v = 0; v < 256; v++) {
      const c = { r: v, g: v, b: v };
      const { cb, cr } = chroma(c);
      expect(fromYCbCr(luma(c), cb, cr)).toEqual(c);
    }
  });

  it('clamps rather than wrapping when a foreign chroma leaves the cube', () => {
    // White's luma with red's chroma cannot exist: it would need r = 433.
    const { cb, cr } = chroma(RED);
    const out = fromYCbCr(luma(WHITE), cb, cr);
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(out.r).toBe(255);
  });
});

describe('candidateLumas', () => {
  it('carries the decoded luma AND its error bar when nothing was clamped', () => {
    // The decoded luma is a measurement: lossy.ts measured one level of
    // movement, which is up to LUMA_TOLERANCE of luma. Treating it as exact is
    // what made the band miss the truth on about half of all flat readings.
    const y = luma(DAMAGED_RED);
    const lumas = candidateLumas(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    expect(lumas).toEqual([y, y - LUMA_TOLERANCE, y + LUMA_TOLERANCE]);
  });

  it('keeps a real neighbour luma that the error bar would round onto', () => {
    // Regression: deduplicating bases and error bars in one pass with integer
    // rounding let a synthetic `y - 1` occupy the slot of a genuine neighbour
    // luma and discard it, costing containment on the readings the tolerance
    // exists to rescue.
    const px: RGB = { r: 0, g: 0x67, b: 0x71 }; // clamped at the bottom
    const fg: RGB = { r: 0x16, g: 0x65, b: 0x34 }; // luma ~1.55 below px
    const lumas = candidateLumas(px, [px, fg, fg, WHITE]);
    expect(lumas.some((v) => Math.abs(v - luma(fg)) < 1e-9)).toBe(true);
  });

  it('extends upwards only, when a channel was cut off at 255', () => {
    const px = decodeAtEdge(WHITE, PRIMARY, 2);
    expect(Math.max(px.r, px.g, px.b)).toBe(255); // precondition: it WAS cut
    const lumas = candidateLumas(px, rimNeighbourhood(px, WHITE, PRIMARY));
    expect(lumas).toContain(luma(WHITE));
    // Nothing from the dark side beyond the error bar: a light sample must not
    // acquire a dark twin.
    expect(Math.min(...lumas)).toBeCloseTo(luma(px) - LUMA_TOLERANCE, 9);
    expect(lumas.every((y) => y >= luma(px) - LUMA_TOLERANCE)).toBe(true);
  });

  it('extends downwards only, when a channel was cut off at 0', () => {
    const px = decodeAtEdge(CHROME, RED, 2);
    expect(Math.min(px.r, px.g, px.b)).toBe(0);
    const lumas = candidateLumas(px, rimNeighbourhood(px, CHROME, RED));
    expect(lumas).toContain(luma(CHROME));
    expect(lumas.every((y) => y <= luma(px) + LUMA_TOLERANCE)).toBe(true);
  });
});

describe('candidateColours', () => {
  it('always offers the sampled colour itself first', () => {
    const cs = candidateColours(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    expect(cs[0]).toEqual(DAMAGED_RED);
  });

  it('stays within one level of the sample across a chroma-flat area', () => {
    // One chroma, three lumas: the colour is pinned, its brightness is not.
    const cs = candidateColours(CHROME, [CHROME, CHROME, CHROME]);
    expect(cs[0]).toEqual(CHROME);
    for (const c of cs) {
      expect(Math.abs(luma(c) - luma(CHROME))).toBeLessThanOrEqual(LUMA_TOLERANCE + 0.5);
    }
    // Positive control: the same pixel next to something else expands further.
    expect(candidateColours(CHROME, [CHROME, RED]).length).toBeGreaterThan(cs.length);
  });

  it('recovers the true colour of the measured worst case exactly', () => {
    // The point of the whole feature: #FF0000 decoded as #A2243A, and the red
    // region's own chroma is one pixel away. Holding the decoded luma and
    // taking that chroma reconstructs #FF0000 itself.
    const cs = candidateColours(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    expect(cs.map(toHex)).toContain('#FF0000');
  });
});

describe('ratioBand', () => {
  it('contains the ratio of the stored colours', () => {
    const a = candidateColours(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    const band = ratioBand(a, [WHITE]);
    const stored = contrastRatio(DAMAGED_RED, WHITE);
    expect(band.low).toBeLessThanOrEqual(stored);
    expect(band.high).toBeGreaterThanOrEqual(stored);
  });

  it('is a single point when neither side has anything to vary', () => {
    const band = ratioBand([RED], [WHITE]);
    expect(band.low).toBeCloseTo(band.high, 12);
    expect(band.low).toBeCloseTo(contrastRatio(RED, WHITE), 12);
  });

  it('refuses an empty candidate set instead of returning ±Infinity', () => {
    expect(() => ratioBand([], [WHITE])).toThrow(/at least one candidate/);
    expect(() => ratioBand([WHITE], [])).toThrow(/at least one candidate/);
  });
});

describe('the band contains the truth', () => {
  // The guarantee the feature claims, checked against the damage model rather
  // than against itself: for each pair, the rim pixel is what the file stores
  // and the real pair is what was on screen.
  const COLOURS: RGB[] = [
    WHITE,
    { r: 0, g: 0, b: 0 },
    RED,
    PRIMARY,
    CHROME,
    { r: 0x16, g: 0x65, b: 0x34 },
    { r: 0x76, g: 0x76, b: 0x76 },
    { r: 0xb9, g: 0x1c, b: 0x1c },
    { r: 0xfc, g: 0xd3, b: 0x4d },
    { r: 0x8a, g: 0xb4, b: 0xff },
    { r: 0x2a, g: 0xb6, b: 0xfb },
    { r: 0xf3, g: 0xf4, b: 0xf6 },
  ];

  it('holds for every foreground/background pair and every block mix', () => {
    const misses: string[] = [];
    let banded = 0;
    for (const fg of COLOURS) {
      for (const bg of COLOURS) {
        if (toHex(fg) === toHex(bg)) continue;
        for (const nFg of [1, 2, 3]) {
          const px = decodeAtEdge(fg, bg, nFg);
          const nb = rimNeighbourhood(px, fg, bg);
          const band = bandFor(
            'jpeg',
            point({ colour: px, neighbourhood: nb, chromaSpread: 999 }),
            point({ colour: bg }),
          );
          if (!band) continue; // chroma-flat pair: no band, nothing to contain
          banded++;
          const truth = contrastRatio(fg, bg);
          if (truth < band.low - 1e-9 || truth > band.high + 1e-9) {
            misses.push(
              `${toHex(fg)} on ${toHex(bg)} (${nFg}/4): truth ${truth.toFixed(3)} outside ` +
                `${band.low.toFixed(3)}-${band.high.toFixed(3)} (stored ${toHex(px)})`,
            );
          }
        }
      }
    }
    expect(banded).toBeGreaterThan(100); // the check actually ran
    expect(misses).toEqual([]);
  });

  it('does not answer "unknown" to everything, which would be the same as silence', () => {
    // A band that always straddles every threshold carries no information. On
    // the realistic pairs above, most readings must still decide AA 4.5:1.
    let decided = 0;
    let total = 0;
    for (const fg of COLOURS) {
      for (const bg of COLOURS) {
        if (toHex(fg) === toHex(bg)) continue;
        const px = decodeAtEdge(fg, bg, 2);
        const band = bandFor(
          'jpeg',
          point({ colour: px, neighbourhood: rimNeighbourhood(px, fg, bg), chromaSpread: 999 }),
          point({ colour: bg }),
        );
        if (!band) continue;
        total++;
        if (certaintyFor(band, 4.5) !== 'undetermined') decided++;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(decided / total).toBeGreaterThan(0.6);
  });
});

describe('a reading with no undamaged witness is refused, not answered', () => {
  // THE DEFECT THIS EXISTS FOR, found by an independent audit:
  // a one-pixel red stroke on white is truly 4.00:1 and FAILS AA for normal
  // text. The app reported a band of 7.17 to 8.59 and therefore a confident
  // PASS at every level, AAA included. The band was narrow and wrong because
  // every pixel in the neighbourhood is rim: they all carry the same blended
  // chroma, which looks exactly like a consensus.
  const px = decodeAtEdge(RED, WHITE, 2);
  const allRim = [px, px, px, px, WHITE, WHITE, WHITE, px, px];

  it('refuses the reading instead of reporting a pass on text that fails', () => {
    const reading = readSource(
      'jpeg',
      point({ colour: px, neighbourhood: allRim, chromaSpread: 999, cleanLumas: [luma(WHITE)] }),
      point({ colour: WHITE }),
    );
    expect(reading.kind).toBe('unrecoverable');

    // The band maths on its own still produces the wrong confident answer,
    // which is exactly why the witness rule sits in front of it.
    const band = bandFor(
      'jpeg',
      point({ colour: px, neighbourhood: allRim, chromaSpread: 999 }),
      point({ colour: WHITE }),
    );
    expect(certaintyFor(band!, 4.5)).toBe('pass');
    expect(contrastRatio(RED, WHITE)).toBeLessThan(4.5); // ...on a pair that fails
  });

  it('answers again as soon as one undamaged pixel of that colour exists', () => {
    // A thicker stroke has an inside, and the inside is a witness.
    const withInterior = [px, RED, px, px, WHITE, WHITE, WHITE, px, px];
    const reading = readSource(
      'jpeg',
      point({
        colour: px,
        neighbourhood: withInterior,
        chromaSpread: 999,
        cleanLumas: [luma(RED), luma(WHITE)],
      }),
      point({ colour: WHITE }),
    );
    expect(reading.kind).toBe('band');
    if (reading.kind !== 'band') return;
    const truth = contrastRatio(RED, WHITE);
    expect(reading.band.low).toBeLessThanOrEqual(truth);
    expect(reading.band.high).toBeGreaterThanOrEqual(truth);
  });
});

describe('hasWitness', () => {
  it('accepts a clean pixel of the same brightness and rejects a distant one', () => {
    expect(hasWitness(100, [100])).toBe(true);
    expect(hasWitness(100, [100 + WITNESS_LUMA_TOLERANCE])).toBe(true);
    expect(hasWitness(100, [100 + WITNESS_LUMA_TOLERANCE + 0.001])).toBe(false);
    expect(hasWitness(100, [20, 240])).toBe(false);
  });

  it('is false when nothing nearby is undamaged at all', () => {
    expect(hasWitness(100, [])).toBe(false);
  });

  it('uses a tolerance derived from the measurements, not a round number', () => {
    // 3 levels is the most a pixel two or more from an edge was measured to
    // move; the sample's own luma is uncertain by LUMA_TOLERANCE on top.
    expect(WITNESS_LUMA_TOLERANCE).toBe(LUMA_TOLERANCE + 3);
  });
});

describe('bandFor gating', () => {
  const risky = (colour: RGB, neighbourhood: RGB[]) =>
    point({ colour, neighbourhood, chromaSpread: 999 });

  it('says nothing for a lossless source, however much the colour varies', () => {
    const a = risky(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    const b = point({ colour: WHITE });
    expect(bandFor('png', a, b)).toBeNull();
    expect(bandFor('other', a, b)).toBeNull();
    expect(bandFor('jpeg', a, b)).not.toBeNull(); // positive control
  });

  it('says nothing before both points are placed', () => {
    const a = risky(DAMAGED_RED, rimNeighbourhood(DAMAGED_RED, RED, WHITE));
    expect(bandFor('jpeg', a, null)).toBeNull();
    expect(bandFor('jpeg', null, point({ colour: WHITE }))).toBeNull();
  });

  it('says nothing when neither sample sits where the colour changes', () => {
    expect(
      bandFor(
        'jpeg',
        point({ colour: CHROME, neighbourhood: [CHROME], chromaSpread: 2.2 }),
        point({ colour: WHITE, neighbourhood: [WHITE], chromaSpread: 0 }),
      ),
    ).toBeNull();
  });

  it('uses the same threshold as the warning, inclusively', () => {
    const nb = rimNeighbourhood(DAMAGED_RED, RED, WHITE);
    const at = (chromaSpread: number) =>
      bandFor(
        'jpeg',
        point({ colour: DAMAGED_RED, neighbourhood: nb, chromaSpread }),
        point({ colour: WHITE }),
      );
    expect(at(LOSSY_SPREAD_THRESHOLD)).not.toBeNull();
    expect(at(LOSSY_SPREAD_THRESHOLD - 0.001)).toBeNull();
  });

  it('gives no band for an averaged patch, whose per-pixel claim does not hold', () => {
    const nb = rimNeighbourhood(DAMAGED_RED, RED, WHITE);
    expect(
      bandFor(
        'jpeg',
        point({ colour: DAMAGED_RED, neighbourhood: nb, chromaSpread: 999, count: 9 }),
        point({ colour: WHITE }),
      ),
    ).toBeNull();
    expect(
      bandFor(
        'jpeg',
        point({ colour: DAMAGED_RED, neighbourhood: nb, chromaSpread: 999 }),
        point({ colour: WHITE, count: 25 }),
      ),
    ).toBeNull();
  });

  it('leaves a flat point alone: it contributes its stored colour only', () => {
    // B is flat, so only A's side of the band may move. If B were expanded too,
    // the low end would fall further.
    const nb = rimNeighbourhood(DAMAGED_RED, RED, WHITE);
    const band = bandFor(
      'jpeg',
      point({ colour: DAMAGED_RED, neighbourhood: nb, chromaSpread: 999 }),
      point({ colour: WHITE, neighbourhood: [WHITE, RED, CHROME], chromaSpread: 0 }),
    );
    expect(band).not.toBeNull();
    // Within the luma error bar of the true ratio, and never above it.
    expect(band!.low).toBeLessThanOrEqual(contrastRatio(RED, WHITE));
    expect(band!.low).toBeGreaterThan(contrastRatio(RED, WHITE) - 0.1);
  });

  it('reports no band when it would be narrower than the two decimals shown', () => {
    // Inventing "4.53 – 4.53" would dress a single reading up as a range.
    const almost: RGB = { r: 0x76, g: 0x76, b: 0x77 };
    const band = bandFor(
      'jpeg',
      point({ colour: almost, neighbourhood: [almost, { r: 0x76, g: 0x76, b: 0x78 }], chromaSpread: 999 }),
      point({ colour: WHITE }),
    );
    if (band !== null) {
      // If a band IS returned it must be wide enough to display as a range.
      expect(formatBand(band).split(' – ')[0]).not.toBe(
        formatBand(band).split(' – ')[1]?.replace(':1', ''),
      );
    }
  });
});

describe('certaintyFor', () => {
  const band = (low: number, high: number): Band => ({ low, high });

  it('answers only when the whole band is on one side', () => {
    expect(certaintyFor(band(4.6, 9), 4.5)).toBe('pass');
    expect(certaintyFor(band(2, 4.4), 4.5)).toBe('fail');
    expect(certaintyFor(band(4, 7.4), 4.5)).toBe('undetermined');
  });

  it('treats the threshold as reachable but not as rounding up', () => {
    expect(certaintyFor(band(4.5, 4.5), 4.5)).toBe('pass');
    expect(certaintyFor(band(4.4999, 4.4999), 4.5)).toBe('fail');
    expect(certaintyFor(band(4.4999, 4.5), 4.5)).toBe('undetermined');
  });

  it('turns the measured worst case into "unknown" instead of a AAA pass', () => {
    // Without the band this reading is 7.37:1 and reports pass at every level,
    // when the truth is 4.00:1 and fails AA for normal text.
    const b = bandFor(
      'jpeg',
      point({
        colour: DAMAGED_RED,
        neighbourhood: rimNeighbourhood(DAMAGED_RED, RED, WHITE),
        chromaSpread: 999,
      }),
      point({ colour: WHITE }),
    );
    expect(b).not.toBeNull();
    const by = Object.fromEntries(evaluateBand(b!).map((v) => [v.id, v.certainty]));
    expect(by['aa-normal']).toBe('undetermined');
    expect(by['aaa-normal']).toBe('undetermined');
    // 3:1 is cleared even by the pessimistic end, so it is still answered.
    expect(by['aa-large']).toBe('pass');
    expect(by['non-text']).toBe('pass');
  });
});

describe('formatBand', () => {
  it('truncates the bottom and rounds the top up, so display never narrows it', () => {
    expect(formatBand({ low: 4.567, high: 7.891 })).toBe('4.56 – 7.90:1');
    expect(formatBand({ low: 4.5, high: 7 })).toBe('4.50 – 7.00:1');
  });

  it('keeps the no-epsilon contract at both ends', () => {
    expect(formatBand({ low: 4.5 - 1e-12, high: 4.5 + 1e-12 })).toBe('4.49 – 4.51:1');
  });
});
