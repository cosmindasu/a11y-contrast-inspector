import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type Assessable } from './assess';
import {
  evaluateBand,
  formatBand,
  CERTAINTY_MARK,
  CERTAINTY_SAY,
  type Certainty,
} from './band';
import { formatRatio, toHex, type Criterion, type RGB } from './contrast';
import { Button } from './ui';
import type { PixelPoint } from './coords';
import type { Report } from './report';
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

const THEME_KEY: Record<Certainty, 'pass' | 'fail' | 'warn'> = {
  pass: 'pass',
  fail: 'fail',
  undetermined: 'warn',
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
  const colourKey = THEME_KEY[certainty];
  return (
    <View
      style={styles.verdict}
      accessible
      accessibilityLabel={`SC ${v.sc} ${v.level}, ${v.label}, needs ${v.threshold} to 1: ${CERTAINTY_SAY[certainty]}`}
    >
      <Text style={{ color: theme[colourKey], fontWeight: '800', width: 80, fontSize: 15 }}>
        {CERTAINTY_MARK[certainty]}
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

export function Results({
  a,
  b,
  report,
  formatLine,
  theme,
  share,
}: {
  a: Measured | null;
  b: Measured | null;
  report: Report;
  formatLine: string;
  theme: Theme;
  share?: { label: string; busy: boolean; onPress: () => void };
}) {
  const { assessment: result, band, warnings } = report;
  const ratio = result?.kind === 'result' ? result.ratio : null;

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

      {share && result && (
        <Button
          label={share.label}
          a11yLabel="Share this finding as an image, with its warnings and the source file details"
          theme={theme}
          kind="primary"
          disabled={share.busy}
          onPress={share.onPress}
        />
      )}

      {warnings.map((w) => (
        <View key={w} style={[styles.card, { borderColor: theme.warn }]} accessibilityRole="alert">
          <Text style={{ color: theme.warn, fontSize: 14, fontWeight: '600' }}>{`Warning: ${w}`}</Text>
        </View>
      ))}

      <Swatch name="A" m={a} theme={theme} />
      <Swatch name="B" m={b} theme={theme} />
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        {formatLine}
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
