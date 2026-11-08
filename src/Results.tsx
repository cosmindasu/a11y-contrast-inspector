import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ProfileInfo } from './colourProfile';
import { assess, opacityProblem, type Assessable } from './assess';
import { bandFor, evaluateBand, formatBand, type Certainty } from './band';
import { formatRatio, toHex, type Criterion, type RGB } from './contrast';
import type { PixelPoint } from './coords';
import { lossyWarning } from './lossy';
import type { Theme } from './theme';

export interface Measured extends Assessable {
  at: PixelPoint;
  /** Exact stored colour (count 1) or an APPROXIMATE display colour (count > 1). */
  colour: RGB;
  /** 1 = single exact pixel; >1 = explicit averaged patch. */
  count: number;
  /** Chroma variation around the sample; decides the JPEG warning. */
  chromaSpread: number;
  /** The pixels within one pixel of the sample; feeds the uncertainty band. */
  neighbourhood: readonly RGB[];
}

const LOOK: Record<Certainty, { key: 'pass' | 'fail' | 'warn'; mark: string; say: string }> = {
  pass: { key: 'pass', mark: '✔ Pass', say: 'pass' },
  fail: { key: 'fail', mark: '✘ Fail', say: 'fail' },
  undetermined: {
    key: 'warn',
    mark: '? Unknown',
    say: 'cannot be determined from this source',
  },
};

function VerdictRow({
  v,
  certainty,
  theme,
}: {
  v: Criterion;
  certainty: Certainty;
  theme: Theme;
}) {
  const look = LOOK[certainty];
  return (
    <View
      style={styles.verdict}
      accessible
      accessibilityLabel={`SC ${v.sc} ${v.level}, ${v.label}, needs ${v.threshold} to 1: ${look.say}`}
    >
      <Text style={{ color: theme[look.key], fontWeight: '800', width: 80, fontSize: 15 }}>
        {look.mark}
      </Text>
      <Text style={{ color: theme.text, flex: 1, fontSize: 15 }}>
        {`SC ${v.sc} ${v.level} · ${v.label} · ${v.threshold}:1`}
      </Text>
    </View>
  );
}

function Swatch({ name, m, theme }: { name: string; m: Measured | null; theme: Theme }) {
  if (!m) {
    return (
      <View style={[styles.card, { borderColor: theme.border }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>{`Point ${name}`}</Text>
        <Text style={{ color: theme.muted, fontSize: 15 }}>Not set. Touch the image to place it.</Text>
      </View>
    );
  }
  const hex = toHex(m.colour);
  const { r, g, b } = m.colour;
  const avg = m.count > 1;
  return (
    <View
      style={[styles.card, { borderColor: theme.border }]}
      accessible
      accessibilityLabel={`Point ${name}, ${avg ? 'approximate display colour' : 'colour'} ${hex}, red ${r} green ${g} blue ${b}, ${
        avg ? `average of ${m.count} pixels, hex is only an approximation` : 'single pixel'
      }, at x ${m.at.x} y ${m.at.y}`}
    >
      <View style={styles.swatchRow}>
        <View style={[styles.swatch, { backgroundColor: hex, borderColor: theme.border }]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{avg ? `Point ${name}  ≈ ${hex}` : `Point ${name}  ${hex}`}</Text>
          <Text style={{ color: theme.muted, fontSize: 14 }}>{`${avg ? 'Display RGB ≈' : 'RGB'} ${r}, ${g}, ${b}`}</Text>
          <Text style={{ color: theme.muted, fontSize: 14 }}>{`Pixel x ${m.at.x}, y ${m.at.y}`}</Text>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
            {m.count === 1 ? 'Exact single pixel' : `AVERAGE of ${m.count} pixels (not a single pixel)`}
          </Text>
          {avg && (
            <Text style={{ color: theme.muted, fontSize: 12 }}>
              Averaged in linear light. The hex is rounded for display only and may not exist in the image; the ratio
              is computed from the unrounded average, not from this hex.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function profileWarning(p: ProfileInfo): string | null {
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

export function Results({
  a,
  b,
  profile,
  theme,
}: {
  a: Measured | null;
  b: Measured | null;
  profile: ProfileInfo;
  theme: Theme;
}) {
  const result = a && b ? assess(a, b) : null;
  const ratio = result?.kind === 'result' ? result.ratio : null;
  // What the stored pixels pin down, as opposed to what they read as. Null
  // whenever a single number is the honest answer — see `band.ts`.
  const band = result?.kind === 'result' ? bandFor(profile.format, a, b) : null;
  const warnings: string[] = [];
  const pw = profileWarning(profile);
  if (pw) warnings.push(pw);
  // A JPEG can be correctly tagged sRGB and still not be what was on screen:
  // 4:2:0 subsampling moves the one-pixel rim at every colour edge.
  const lw = lossyWarning(profile.format, [a, b], band !== null);
  if (lw) warnings.push(lw);
  // A point that is already measured but whose partner is not yet set still
  // deserves its transparency warning.
  for (const [n, m] of [['A', a], ['B', b]] as const) {
    const w = m ? opacityProblem(n, m) : null;
    if (w) warnings.push(w);
  }

  return (
    <View style={{ gap: 10 }}>
      {result?.kind === 'result' && ratio !== null && band !== null && (
        <View
          style={[styles.card, { borderColor: theme.warn }]}
          accessible
          accessibilityLabel={`Contrast ratio is between ${formatBand(band)}. The source does not pin it down further.`}
        >
          <Text style={{ color: theme.muted, fontSize: 14 }}>Contrast ratio — range</Text>
          <Text style={{ color: theme.text, fontSize: 30, fontWeight: '800' }} selectable>
            {formatBand(band)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {`A range, not a reading: this JPEG cannot pin the ratio down further, and a verdict is given only where the whole range falls on one side. Read straight off the file: ${formatRatio(ratio)}.`}
          </Text>
          {evaluateBand(band).map((v) => (
            <VerdictRow key={v.id} v={v} certainty={v.certainty} theme={theme} />
          ))}
        </View>
      )}

      {result?.kind === 'result' && ratio !== null && band === null && (
        <View
          style={[styles.card, { borderColor: theme.border }]}
          accessible
          accessibilityLabel={`Contrast ratio ${formatRatio(ratio)}`}
        >
          <Text style={{ color: theme.muted, fontSize: 14 }}>Contrast ratio</Text>
          <Text style={{ color: theme.text, fontSize: 34, fontWeight: '800' }} selectable>
            {formatRatio(ratio)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            Truncated, never rounded up. WCAG does not round: 4.499 fails 4.5.
            {(a?.count ?? 1) > 1 || (b?.count ?? 1) > 1
              ? ' Averaged points use the unrounded linear-light average.'
              : ''}
          </Text>
          {result.verdicts.map((v) => (
            <VerdictRow key={v.id} v={v} certainty={v.pass ? 'pass' : 'fail'} theme={theme} />
          ))}
        </View>
      )}

      {result?.kind === 'suppressed' && (
        <View
          style={[styles.card, { borderColor: theme.fail }]}
          accessible
          accessibilityLabel="No contrast result: a sampled pixel is not fully opaque"
        >
          <Text style={{ color: theme.fail, fontSize: 16, fontWeight: '800' }}>No contrast result</Text>
          <Text style={{ color: theme.text, fontSize: 14 }}>
            At least one sampled pixel is not fully opaque, so no ratio or pass/fail is shown. See the warning below.
          </Text>
        </View>
      )}

      {warnings.map((w) => (
        <View key={w} style={[styles.card, { borderColor: theme.warn }]} accessibilityRole="alert">
          <Text style={{ color: theme.warn, fontSize: 14, fontWeight: '600' }}>{`Warning: ${w}`}</Text>
        </View>
      ))}

      <Swatch name="A" m={a} theme={theme} />
      <Swatch name="B" m={b} theme={theme} />
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        {`File: ${profile.format.toUpperCase()}${profile.format === 'jpeg' ? ' (lossy)' : ''}. Colour space in file: ${profile.status} (${profile.detail}). Values are read as sRGB.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  swatchRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  swatch: { width: 56, height: 56, borderRadius: 8, borderWidth: 1 },
  verdict: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingTop: 4 },
});
