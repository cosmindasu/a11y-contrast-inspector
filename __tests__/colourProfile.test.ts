import { inspectColourProfile } from '../src/colourProfile';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: number[]) => [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0];
const png = (...chunks: number[][]) =>
  Uint8Array.from([...SIG, ...chunk('IHDR', new Array(13).fill(0)), ...chunks.flat(), ...chunk('IDAT', [0]), ...chunk('IEND', [])]);

describe('inspectColourProfile (PNG)', () => {
  it('untagged PNG', () => {
    expect(inspectColourProfile(png()).status).toBe('untagged');
  });
  it('sRGB chunk', () => {
    expect(inspectColourProfile(png(chunk('sRGB', [0]))).status).toBe('srgb');
  });
  it('iCCP named Display P3 is flagged non-sRGB', () => {
    const r = inspectColourProfile(png(chunk('iCCP', [...text('Display P3'), 0, 0, 1, 2])));
    expect(r.status).toBe('non-srgb');
    expect(r.detail).toContain('Display P3');
  });
  it('iCCP named sRGB is sRGB', () => {
    const r = inspectColourProfile(png(chunk('iCCP', [...text('sRGB IEC61966-2.1'), 0, 0, 1])));
    expect(r.status).toBe('srgb');
  });
  it('gAMA 1.0 or non-sRGB cHRM primaries are flagged; sRGB-like gAMA is not', () => {
    expect(inspectColourProfile(png(chunk('gAMA', be32(100000)))).status).toBe('non-srgb');
    expect(inspectColourProfile(png(chunk('cHRM', [31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000].flatMap(be32)))).status).toBe('non-srgb');
    expect(inspectColourProfile(png(chunk('gAMA', be32(45455)))).status).toBe('untagged');
  });
  it('cICP with P3 primaries is non-sRGB; BT.709/sRGB is sRGB', () => {
    expect(inspectColourProfile(png(chunk('cICP', [12, 13, 0, 1]))).status).toBe('non-srgb');
    expect(inspectColourProfile(png(chunk('cICP', [1, 13, 0, 1]))).status).toBe('srgb');
  });
});

describe('inspectColourProfile (other)', () => {
  it('JPEG without ICC is untagged', () => {
    expect(inspectColourProfile(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])).status).toBe('untagged');
  });
  it('JPEG with an unparseable blob that merely contains "Display P3" warns (unknown), never reassures', () => {
    const payload = [...text('ICC_PROFILE\0'), 1, 1, ...text('xxxxDisplay P3xxxx')];
    const len = payload.length + 2;
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe2, len >> 8, len & 255, ...payload, 0xff, 0xda, 0, 2]);
    expect(inspectColourProfile(jpeg).status).toBe('unknown-icc');
  });
  it('unknown formats are reported as not inspected', () => {
    expect(inspectColourProfile(Uint8Array.from(text('RIFFxxxxWEBP'))).status).toBe('unsupported-format');
  });
});

// ---- ICC fixtures: a real header, tag table, desc/mluc text and XYZ colorants.
const SRGB_XYZ = { rXYZ: [0.4361, 0.2225, 0.0139], gXYZ: [0.3851, 0.7169, 0.0971], bXYZ: [0.1431, 0.0606, 0.7141] };
const P3_XYZ = { rXYZ: [0.5151, 0.2412, -0.0011], gXYZ: [0.292, 0.6922, 0.0419], bXYZ: [0.1571, 0.0666, 0.7841] };
const s15 = (v: number) => be32(Math.round(v * 65536) >>> 0);
function icc(opts: { desc: string; v4?: boolean; xyz?: Record<string, number[]>; space?: string }): number[] {
  const tags: Array<[string, number[]]> = [];
  const descBytes = opts.v4
    ? (() => {
        const u = Array.from(opts.desc, (c) => [0, c.charCodeAt(0)]).flat();
        return [...text('mluc'), 0, 0, 0, 0, ...be32(1), ...be32(12), ...text('enUS'), ...be32(u.length), ...be32(28), ...u];
      })()
    : [...text('desc'), 0, 0, 0, 0, ...be32(opts.desc.length + 1), ...text(opts.desc), 0];
  tags.push(['desc', descBytes]);
  for (const [k, v] of Object.entries(opts.xyz ?? {})) tags.push([k, [...text('XYZ '), 0, 0, 0, 0, ...v.flatMap(s15)]]);
  const tableLen = 4 + tags.length * 12;
  let off = 128 + tableLen;
  const table: number[] = [...be32(tags.length)];
  const bodies: number[] = [];
  for (const [sig, body] of tags) {
    table.push(...text(sig), ...be32(off), ...be32(body.length));
    bodies.push(...body);
    off += body.length;
  }
  const header = new Array(128).fill(0);
  text(opts.space ?? 'RGB ').forEach((c, i) => (header[16 + i] = c));
  text('acsp').forEach((c, i) => (header[36 + i] = c));
  return [...header, ...table, ...bodies];
}
function jpegWith(profile: number[]): Uint8Array {
  const payload = [...text('ICC_PROFILE\0'), 1, 1, ...profile];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe2, len >> 8, len & 255, ...payload, 0xff, 0xda, 0, 2]);
}

describe('JPEG ICC parsing', () => {
  it('real sRGB profile (v2 desc + sRGB colorants) is sRGB', () => {
    const r = inspectColourProfile(jpegWith(icc({ desc: 'sRGB IEC61966-2.1', xyz: SRGB_XYZ })));
    expect(r.status).toBe('srgb');
  });
  it('v4 mluc sRGB description without colorants is sRGB', () => {
    expect(inspectColourProfile(jpegWith(icc({ desc: 'sRGB v4 ICC preference', v4: true }))).status).toBe('srgb');
  });
  it('"DCI-P3 D65 with sRGB transfer" is NOT sRGB (the reported defect)', () => {
    for (const v4 of [false, true]) {
      const r = inspectColourProfile(jpegWith(icc({ desc: 'DCI-P3 D65 with sRGB transfer', v4, xyz: P3_XYZ })));
      expect(r.status).toBe('non-srgb');
    }
  });
  it('same misleading name but NO colorant tags is still not sRGB', () => {
    expect(inspectColourProfile(jpegWith(icc({ desc: 'DCI-P3 D65 with sRGB transfer' }))).status).toBe('non-srgb');
  });
  it('an innocent-sounding name with P3 primaries is caught by the primaries', () => {
    const r = inspectColourProfile(jpegWith(icc({ desc: 'sRGB IEC61966-2.1', xyz: P3_XYZ })));
    expect(r.status).toBe('non-srgb');
  });
  it('a name that only mentions sRGB, with no wide-gamut keyword, is unknown (warn), not sRGB', () => {
    for (const desc of ['Custom RGB with sRGB curve', 'my sRGB-ish monitor', 'sRGB (modified)']) {
      expect(inspectColourProfile(jpegWith(icc({ desc }))).status).toBe('unknown-icc');
    }
  });
  it('Display P3 / Adobe RGB / Rec. 2020 names are non-sRGB', () => {
    for (const desc of ['Display P3', 'Adobe RGB (1998)', 'Rec. 2020', 'ProPhoto RGB']) {
      expect(inspectColourProfile(jpegWith(icc({ desc }))).status).toBe('non-srgb');
    }
  });
  it('non-RGB, garbage and truncated profiles warn instead of reassuring', () => {
    expect(inspectColourProfile(jpegWith(icc({ desc: 'sRGB IEC61966-2.1', space: 'GRAY' }))).status).toBe('unknown-icc');
    expect(inspectColourProfile(jpegWith(text('sRGB sRGB sRGB sRGB'))).status).toBe('unknown-icc');
    expect(inspectColourProfile(jpegWith(icc({ desc: 'sRGB IEC61966-2.1' }).slice(0, 140))).status).toBe('unknown-icc');
  });
  it('the old failure mode: "sRGB" text anywhere in the bytes no longer decides', () => {
    const p = icc({ desc: 'Some Profile' });
    p.push(...text('sRGB'), 0, 0, 0, ...Array.from('sRGB', (c) => [0, c.charCodeAt(0)]).flat());
    expect(inspectColourProfile(jpegWith(p)).status).toBe('unknown-icc');
  });
});

describe('PNG iCCP names use the same strict rule', () => {
  it('a mixed name is not sRGB; an unrecognised name warns', () => {
    const png1 = png(chunk('iCCP', [...text('DCI-P3 D65 with sRGB transfer'), 0, 0, 1]));
    expect(inspectColourProfile(png1).status).toBe('non-srgb');
    const png2 = png(chunk('iCCP', [...text('Custom with sRGB curve'), 0, 0, 1]));
    expect(inspectColourProfile(png2).status).toBe('unknown-icc');
  });
});

describe('reference files in testdata/', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const load = (n: string) => new Uint8Array(fs.readFileSync(`${__dirname}/../testdata/${n}`));
  it('reference.png is untagged, reference-tagged.png is flagged non-sRGB', () => {
    expect(inspectColourProfile(load('reference.png')).status).toBe('untagged');
    expect(inspectColourProfile(load('reference-tagged.png')).status).toBe('non-srgb');
  });
});
