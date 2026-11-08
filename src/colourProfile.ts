/**
 * Best-effort detection of the colour space a screenshot file is TAGGED with.
 *
 * The pixel path (Skia) returns the stored channel values untouched. If the
 * file is tagged as something other than sRGB (e.g. Display P3), those values
 * are NOT sRGB and a WCAG ratio computed from them is only approximate. This
 * module inspects the file header so the app can say so, instead of guessing.
 *
 * It reads headers only; it does not decode or alter pixels.
 * An UNTAGGED file is not proof of sRGB; it only means the file does not say.
 */

export type ProfileStatus =
  /** File explicitly says sRGB. */
  | 'srgb'
  /** No colour-space information in the file (the usual case for screenshots). */
  | 'untagged'
  /** File is tagged with a non-sRGB space. Values are NOT sRGB. */
  | 'non-srgb'
  /** An embedded ICC profile exists but we could not tell which space it is. */
  | 'unknown-icc'
  /** Format we do not inspect (e.g. WebP, HEIF). */
  | 'unsupported-format';

export interface ProfileInfo {
  status: ProfileStatus;
  format: 'png' | 'jpeg' | 'other';
  /** Human-readable detail, e.g. the profile name found. */
  detail: string;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

function u32(bytes: Uint8Array, o: number): number {
  return (
    ((bytes[o] ?? 0) * 0x1000000) +
    (((bytes[o + 1] ?? 0) << 16) | ((bytes[o + 2] ?? 0) << 8) | (bytes[o + 3] ?? 0))
  );
}

/** Names that identify a wide-gamut / non-sRGB space. Checked BEFORE any sRGB test. */
const WIDE_GAMUT =
  /p3|dci|adobe|prophoto|pro\s*photo|2020|2100|rec\.?\s*2|display|wide|gamut|aces|ntsc|smpte|ebu|apple\s*rgb|colou?r\s*match|romm|bt\.?\s*2/i;

/**
 * Descriptions that are exactly a known plain sRGB profile name. Anything else
 * that merely mentions "sRGB" (e.g. "DCI-P3 D65 with sRGB transfer") does NOT
 * match, so it cannot reassure the user.
 */
const PLAIN_SRGB =
  /^srgb(?:\s+(?:iec\s?61966[-\s]?2[-.\s]?1(?:\s+black\s+scaled)?|built-in|2014|v[24](?:\s+icc)?(?:\s+(?:preference|perceptual|relative|appearance|rgb))*))?$/;

const normalise = (n: string) => n.replace(/\0/g, '').replace(/\s+/g, ' ').trim();

/**
 * Classify a profile NAME/description. Never returns 'srgb' for a mixed name.
 * (For PNG the iCCP profile is zlib-compressed and we do not inflate it, so
 * only its name is available: a label, not proof.)
 */
function classifyProfileName(name: string): 'srgb' | 'non-srgb' | 'unknown-icc' {
  const n = normalise(name);
  if (WIDE_GAMUT.test(n)) return 'non-srgb';
  if (PLAIN_SRGB.test(n.toLowerCase())) return 'srgb';
  return 'unknown-icc';
}

// ---- ICC profile parsing (header + tag table; enough to read description & colorants)

interface IccTag {
  offset: number;
  size: number;
}

function readTags(p: Uint8Array): Map<string, IccTag> | null {
  if (p.length < 132 || ascii(p, 36, 40) !== 'acsp') return null;
  const n = u32(p, 128);
  if (n > 200 || 132 + n * 12 > p.length) return null;
  const tags = new Map<string, IccTag>();
  for (let i = 0; i < n; i++) {
    const o = 132 + i * 12;
    const offset = u32(p, o + 4);
    const size = u32(p, o + 8);
    if (offset + size > p.length) continue; // damaged tag: ignore it
    tags.set(ascii(p, o, o + 4), { offset, size });
  }
  return tags;
}

/** Description strings from a 'desc' (ICC v2) or 'mluc' (ICC v4) tag. */
function readDescriptions(p: Uint8Array, t: IccTag): string[] {
  const type = ascii(p, t.offset, t.offset + 4);
  const out: string[] = [];
  if (type === 'desc') {
    const len = u32(p, t.offset + 8);
    if (len > 0 && len < 1000) out.push(ascii(p, t.offset + 12, t.offset + 12 + len));
  } else if (type === 'mluc') {
    const count = u32(p, t.offset + 8);
    if (count > 50) return out;
    for (let i = 0; i < count; i++) {
      const rec = t.offset + 16 + i * 12;
      const len = u32(p, rec + 4);
      const off = t.offset + u32(p, rec + 8);
      let s = '';
      for (let j = 0; j + 1 < len && off + j + 1 < p.length; j += 2) {
        s += String.fromCharCode(((p[off + j] ?? 0) << 8) | (p[off + j + 1] ?? 0));
      }
      out.push(s);
    }
  }
  return out;
}

function readXyz(p: Uint8Array, t: IccTag | undefined): [number, number, number] | null {
  if (!t || t.size < 20 || ascii(p, t.offset, t.offset + 4) !== 'XYZ ') return null;
  const fx = (o: number) => {
    const v = u32(p, o);
    return (v > 0x7fffffff ? v - 0x100000000 : v) / 65536; // s15Fixed16
  };
  return [fx(t.offset + 8), fx(t.offset + 12), fx(t.offset + 16)];
}

/** sRGB colorants as stored in a D50-adapted ICC profile. */
const SRGB_D50: Record<string, [number, number, number]> = {
  rXYZ: [0.4361, 0.2225, 0.0139],
  gXYZ: [0.3851, 0.7169, 0.0971],
  bXYZ: [0.1431, 0.0606, 0.7141],
};

/** true = match, false = clearly different, null = no colorant tags to compare. */
function primariesMatchSrgb(p: Uint8Array, tags: Map<string, IccTag>): boolean | null {
  let seen = 0;
  for (const [sig, ref] of Object.entries(SRGB_D50)) {
    const xyz = readXyz(p, tags.get(sig));
    if (!xyz) continue;
    seen++;
    if (xyz.some((v, i) => Math.abs(v - (ref[i] ?? 0)) > 0.01)) return false;
  }
  return seen === 3 ? true : null;
}

/**
 * Classify an embedded ICC profile. Order matters: wide-gamut evidence (name or
 * primaries) is tested FIRST; 'srgb' needs a plain sRGB description AND (where
 * the profile carries colorant tags) matching primaries. Anything we cannot
 * classify confidently is 'unknown-icc', which the UI turns into a warning.
 */
function classifyIcc(p: Uint8Array): ProfileInfo {
  const unknown = (why: string): ProfileInfo => ({ status: 'unknown-icc', format: 'jpeg', detail: why });
  const tags = readTags(p);
  if (!tags) return unknown('embedded ICC profile could not be parsed');
  const descTag = tags.get('desc');
  const names = (descTag ? readDescriptions(p, descTag) : []).map(normalise).filter(Boolean);
  const label = names[0] ?? 'no description';

  const primaries = primariesMatchSrgb(p, tags);
  if (primaries === false) {
    return { status: 'non-srgb', format: 'jpeg', detail: `ICC profile "${label}" (primaries differ from sRGB)` };
  }
  const kinds = names.map(classifyProfileName);
  const wide = kinds.indexOf('non-srgb');
  if (wide >= 0) return { status: 'non-srgb', format: 'jpeg', detail: `ICC profile "${names[wide]}"` };
  if (ascii(p, 16, 20) !== 'RGB ') return unknown(`ICC profile "${label}" is not an RGB profile`);
  if (names.length > 0 && kinds.every((k) => k === 'srgb')) {
    return { status: 'srgb', format: 'jpeg', detail: `ICC profile "${label}"${primaries ? ', sRGB primaries' : ''}` };
  }
  return unknown(`ICC profile "${label}" not recognised as sRGB`);
}

function inspectPng(bytes: Uint8Array): ProfileInfo {
  let pos = 8;
  let hasSrgbChunk = false;
  let iccName: string | null = null;
  let cicp: [number, number] | null = null;
  let gama: number | null = null;
  let chrm: number[] | null = null;
  while (pos + 8 <= bytes.length) {
    const len = u32(bytes, pos);
    const type = ascii(bytes, pos + 4, pos + 8);
    const data = pos + 8;
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'sRGB') hasSrgbChunk = true;
    else if (type === 'iCCP') {
      let end = data;
      while (end < data + 80 && end < bytes.length && bytes[end] !== 0) end++;
      iccName = ascii(bytes, data, end);
    } else if (type === 'gAMA') {
      gama = u32(bytes, data);
    } else if (type === 'cHRM') {
      chrm = Array.from({ length: 8 }, (_, i) => u32(bytes, data + i * 4));
    } else if (type === 'cICP') {
      cicp = [bytes[data] ?? 0, bytes[data + 1] ?? 0]; // [primaries, transfer]
    }
    pos = data + len + 4; // + CRC
  }
  // Precedence follows the PNG spec: cICP > iCCP > sRGB > gAMA/cHRM.
  if (cicp) {
    const [primaries, transfer] = cicp;
    if (primaries === 1 && transfer === 13) {
      return { status: 'srgb', format: 'png', detail: 'cICP: BT.709 primaries, sRGB transfer' };
    }
    return {
      status: 'non-srgb',
      format: 'png',
      detail: `cICP: primaries ${primaries}, transfer ${transfer}${primaries === 12 ? ' (Display P3)' : ''}`,
    };
  }
  if (iccName !== null) {
    return { status: classifyProfileName(iccName), format: 'png', detail: `ICC profile "${iccName}"` };
  }
  if (hasSrgbChunk) return { status: 'srgb', format: 'png', detail: 'sRGB chunk' };
  // Legacy gamma/chromaticity chunks. sRGB-equivalent values: gAMA 45455, red x 64000.
  if (gama !== null && Math.abs(gama - 45455) > 1500) {
    return { status: 'non-srgb', format: 'png', detail: `gAMA ${gama / 100000} (not the sRGB curve)` };
  }
  if (chrm !== null && Math.abs((chrm[2] ?? 0) - 64000) > 1500) {
    return { status: 'non-srgb', format: 'png', detail: 'cHRM primaries differ from sRGB' };
  }
  return { status: 'untagged', format: 'png', detail: 'no colour-space chunk' };
}

function inspectJpeg(bytes: Uint8Array): ProfileInfo {
  let pos = 2;
  const icc: number[] = [];
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end
    const len = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0);
    if (marker === 0xe2 && ascii(bytes, pos + 4, pos + 16) === 'ICC_PROFILE\0') {
      for (let i = pos + 18; i < pos + 2 + len && i < bytes.length; i++) icc.push(bytes[i] ?? 0);
    }
    pos += 2 + len;
  }
  if (icc.length === 0) return { status: 'untagged', format: 'jpeg', detail: 'no ICC profile' };
  return classifyIcc(Uint8Array.from(icc));
}

export function inspectColourProfile(bytes: Uint8Array): ProfileInfo {
  if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return inspectPng(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  return { status: 'unsupported-format', format: 'other', detail: 'format not inspected' };
}
