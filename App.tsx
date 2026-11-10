import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { relativeLuminance } from './src/contrast';
import type { PixelPoint } from './src/coords';
import { cropRect, evidenceCard, stamp, type SamplingMode } from './src/evidence';
import { renderEvidence } from './src/evidenceImage';
import { buildReport } from './src/report';
import { ignoredNotice, selectSharedImage } from './src/share';
import {
  loadImage,
  samplePatch,
  samplePixel,
  sampleNeighbourhood,
  type ImageSource,
  type LoadedImage,
} from './src/pixels';
import { Results, type Measured } from './src/Results';
import { nextActive } from './src/selection';
import { useTheme } from './src/theme';
import { Button } from './src/ui';
import { Viewer } from './src/Viewer';

// 1 = exact single pixel; 3/5 = explicit averaged patch.
type Mode = SamplingMode;

/** How far one press of an arrow moves the active point, in image pixels. */
type Step = (typeof STEPS)[number];
const STEPS = [1, 10, 100] as const;

/** Arrow glyph, the word a screen reader hears, and the direction. */
const NUDGES = [
  ['◀', 'left', -1, 0],
  ['▲', 'up', 0, -1],
  ['▼', 'down', 0, 1],
  ['▶', 'right', 1, 0],
] as const satisfies readonly (readonly [string, string, number, number])[];

function measure(img: LoadedImage, at: PixelPoint | null, mode: Mode): Measured | null {
  if (!at) return null;
  const exact = samplePixel(img, at.x, at.y); // always read: gives alpha too
  const around = sampleNeighbourhood(img, at.x, at.y, mode);
  if (mode === 1) {
    return {
      at,
      colour: exact.colour,
      luminance: relativeLuminance(exact.colour),
      alpha: exact.alpha,
      nonOpaque: exact.alpha < 255 ? 1 : 0,
      count: 1,
      chromaSpread: around.chromaSpread,
      neighbourhood: around.colours,
      cleanLumas: around.cleanLumas,
    };
  }
  // Alpha is checked across EVERY sampled pixel, not just the centre one.
  const patch = samplePatch(img, at.x, at.y, mode);
  return {
    at,
    colour: patch.colour,
    luminance: patch.luminance,
    alpha: patch.minAlpha,
    nonOpaque: patch.nonOpaqueCount,
    count: patch.count,
    chromaSpread: around.chromaSpread,
    neighbourhood: around.colours,
    cleanLumas: around.cleanLumas,
  };
}

function Main() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntent();

  const [img, setImg] = useState<LoadedImage | null>(null);
  const [points, setPoints] = useState<[PixelPoint | null, PixelPoint | null]>([null, null]);
  const [active, setActive] = useState<0 | 1>(0);
  const [mode, setMode] = useState<Mode>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  /**
   * How far one nudge moves, in image pixels. A screen reader cannot place a
   * point by touch at all (TalkBack's double tap sends ACTION_CLICK, which the
   * image's touch responder never receives — measured, see the README), so the
   * nudge buttons are the only way to move one. At one pixel a time, crossing a
   * 1080x2400 screenshot is not a route.
   */
  const [step, setStep] = useState<Step>(1);
  /** Text being typed into the coordinate fields for the ACTIVE point. */
  const [draft, setDraft] = useState<{ x: string; y: string }>({ x: '', y: '' });
  /**
   * The y field, so the x field's "Next" key can reach it. Measured on an
   * emulator with TalkBack running: once the keyboard is open it covers the
   * Set button and shifts the row, so reaching either by touch is a fight.
   * Next-then-Done finishes the job from the keyboard alone, which is also the
   * only comfortable route with a screen reader.
   */
  const yField = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  // The last file we wrote into the cache, so a session does not leave a pile.
  const lastExport = useRef<File | null>(null);

  const open = useCallback(async (uri: string, name: string, source: ImageSource) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadImage(uri, name, source);
      setImg(loaded);
      setPoints([null, null]);
      setActive(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const pick = useCallback(async () => {
    setNotice(null);
    // quality 1 + no editing: the picker hands over an unmodified copy of the
    // file (it only re-encodes when quality < 1 or cropping is on).
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      base64: false,
    });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) await open(asset.uri, asset.fileName ?? 'image', 'picker');
  }, [open]);

  // Android share target: screenshot notification -> Share -> this app.
  useEffect(() => {
    if (!hasShareIntent) return;
    const sel = selectSharedImage(shareIntent.files);
    if (sel.file) {
      void open(sel.file.path, sel.file.fileName, 'share');
      setNotice(ignoredNotice(sel));
    } else {
      setNotice(null);
      setError('The shared item is not an image.');
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent, open]);

  const onTapPixel = useCallback(
    (p: PixelPoint) => {
      // Read before the update: the handover depends on what was already there.
      const placedBefore = [points[0] !== null, points[1] !== null] as const;
      setPoints((cur) => (active === 0 ? [p, cur[1]] : [cur[0], p]));
      setActive(nextActive(active, placedBefore));
    },
    [active, points],
  );

  // Keep the coordinate fields showing wherever the active point actually is,
  // including after a nudge or a touch. Typing does not change `points`, so
  // this never fights the user mid-edit.
  useEffect(() => {
    const p = points[active];
    setDraft({ x: p ? String(p.x) : '', y: p ? String(p.y) : '' });
  }, [active, points]);

  /**
   * Put the active point at typed coordinates. The only way to START a
   * measurement without sight: touch cannot do it under a screen reader, and
   * nudging only moves a point that already exists.
   */
  const applyCoords = () => {
    if (!img) return;
    const x = Number.parseInt(draft.x, 10);
    const y = Number.parseInt(draft.y, 10);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      setError(`Type whole numbers for x and y. This image is ${img.width} by ${img.height} pixels.`);
      return;
    }
    setError(null);
    const n = {
      x: Math.min(img.width - 1, Math.max(0, x)),
      y: Math.min(img.height - 1, Math.max(0, y)),
    };
    setPoints((cur) => (active === 0 ? [n, cur[1]] : [cur[0], n]));
  };

  const activeName = active === 0 ? 'A' : 'B';

  const nudge = (dx: number, dy: number) => {
    if (!img) return;
    setPoints((cur) => {
      const p = cur[active];
      if (!p) return cur;
      const n = {
        x: Math.min(img.width - 1, Math.max(0, p.x + dx)),
        y: Math.min(img.height - 1, Math.max(0, p.y + dy)),
      };
      return active === 0 ? [n, cur[1]] : [cur[0], n];
    });
  };

  const measured = useMemo(() => {
    if (!img) return null;
    try {
      return [measure(img, points[0], mode), measure(img, points[1], mode)] as const;
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [img, points, mode]);

  const ok = measured && !(measured instanceof Error) ? measured : null;
  // One source for the verdicts AND the export: see src/report.ts.
  const report = useMemo(
    () => (img ? buildReport(ok?.[0] ?? null, ok?.[1] ?? null, img.profile) : null),
    [img, ok],
  );

  const shareEvidence = useCallback(async () => {
    const a = ok?.[0];
    const b = ok?.[1];
    if (!img || !a || !b || !report?.assessment) return;
    setSharing(true);
    setError(null);
    try {
      const now = new Date();
      const card = evidenceCard({
        fileName: img.fileName,
        imageWidth: img.width,
        imageHeight: img.height,
        profile: img.profile,
        source: img.source,
        mode,
        a,
        b,
        assessment: report.assessment,
        reading: report.reading,
        warnings: report.warnings,
        takenAt: now,
        appVersion: Constants.expoConfig?.version ?? 'unknown',
      });
      const png = renderEvidence(card, img, cropRect(a.at, b.at, img.width, img.height), [a.at, b.at]);
      // Named for whoever receives it, not for this app.
      const name = `contrast-${stamp(now).slice(0, 16).replace(/[: ]/g, '-')}.png`;
      const file = new File(Paths.cache, name);
      file.create({ overwrite: true });
      await file.write(png);
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('This device has nothing to share to.');
      }
      try {
        lastExport.current?.delete();
      } catch {
        // A cache file the system already removed is not a problem.
      }
      lastExport.current = file;
      await Sharing.shareAsync(file.uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share this contrast finding',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  }, [img, ok, report, mode]);
  const shownError = error ?? shareError ?? (measured instanceof Error ? measured.message : null);

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 },
      ]}
    >
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Contrast Inspector
        </Text>
        <Button label="Open screenshot" theme={theme} kind="primary" onPress={() => void pick()} />
      </View>

      {busy && <ActivityIndicator accessibilityLabel="Loading image" color={theme.primary} />}
      {notice && (
        <Text accessibilityRole="alert" style={{ color: theme.warn, fontWeight: '600', marginVertical: 4 }}>
          {notice}
        </Text>
      )}
      {shownError && (
        <Text accessibilityRole="alert" style={{ color: theme.fail, fontWeight: '600', marginVertical: 4 }}>
          {shownError}
        </Text>
      )}

      {!img ? (
        <View style={styles.empty}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
            No screenshot loaded
          </Text>
          <Text style={{ color: theme.muted, fontSize: 15, textAlign: 'center' }}>
            Tap “Open screenshot”, or take a screenshot and use Share → Contrast Inspector from the screenshot
            notification. Screenshots only: photographing a screen gives wrong colours.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.viewerArea}>
            <Viewer image={img} points={points} theme={theme} onTapPixel={onTapPixel} />
          </View>
          <ScrollView
            style={styles.panel}
            // Android draws the scrollbar only while scrolling, so without this
            // nothing says the panel has more in it. Measured: the content is
            // ~824dp in a ~342dp window.
            persistentScrollbar
            contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
          >
            <View style={styles.row}>
              <Button label="Point A" theme={theme} selected={active === 0} onPress={() => setActive(0)} />
              <Button label="Point B" theme={theme} selected={active === 1} onPress={() => setActive(1)} />
              <Text style={{ color: theme.muted, fontSize: 13, flexShrink: 1 }}>
                {`Nudge point ${activeName} by ${step} image pixel${step === 1 ? '' : 's'}:`}
              </Text>
              {NUDGES.map(([label, dir, dx, dy]) => (
                <Button
                  key={label}
                  label={label}
                  a11yLabel={`Nudge ${dir} by ${step} pixel${step === 1 ? '' : 's'}`}
                  theme={theme}
                  onPress={() => nudge(dx * step, dy * step)}
                />
              ))}
            </View>

            <View style={styles.row}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Step:</Text>
              {STEPS.map((n) => (
                <Button
                  key={n}
                  label={String(n)}
                  a11yLabel={`Nudge step ${n} pixel${n === 1 ? '' : 's'}`}
                  theme={theme}
                  selected={step === n}
                  onPress={() => setStep(n)}
                />
              ))}
            </View>

            {/* Typed coordinates. Touch cannot place a point under a screen
                reader, so without this the tool can be read but not started. */}
            <View style={styles.row}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {`Point ${activeName} at`}
              </Text>
              <TextInput
                value={draft.x}
                onChangeText={(t) => setDraft((d) => ({ ...d, x: t }))}
                onSubmitEditing={() => yField.current?.focus()}
                submitBehavior="submit"
                keyboardType="number-pad"
                returnKeyType="next"
                accessibilityLabel={`X for point ${activeName}, in image pixels, 0 to ${img.width - 1}`}
                placeholder="x"
                placeholderTextColor={theme.muted}
                style={[styles.coord, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              />
              <TextInput
                ref={yField}
                value={draft.y}
                onChangeText={(t) => setDraft((d) => ({ ...d, y: t }))}
                onSubmitEditing={applyCoords}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel={`Y for point ${activeName}, in image pixels, 0 to ${img.height - 1}`}
                placeholder="y"
                placeholderTextColor={theme.muted}
                style={[styles.coord, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              />
              <Button
                label="Set"
                a11yLabel={`Put point ${activeName} at the typed coordinates`}
                theme={theme}
                onPress={applyCoords}
              />
              <Text style={{ color: theme.muted, fontSize: 12, flexShrink: 1 }}>
                {`0 to ${img.width - 1} across, 0 to ${img.height - 1} down.`}
              </Text>
            </View>

            {/* The reading comes before the controls that produced it: the panel
                is ~342dp tall and its content is ~824dp, so whatever is second
                is already off-screen. Only point selection and nudging stay
                above, because they are used WHILE reading the result. */}
            {report && (
              <Results
                a={ok?.[0] ?? null}
                b={ok?.[1] ?? null}
                report={report}
                formatLine={`File: ${img.profile.format.toUpperCase()}${img.profile.format === 'jpeg' ? ' (lossy)' : ''}. Colour space in file: ${img.profile.status} (${img.profile.detail}). Values are read as sRGB.`}
                theme={theme}
                share={{
                  label: sharing ? 'Preparing…' : 'Share this finding',
                  busy: sharing,
                  onPress: () => void shareEvidence(),
                }}
              />
            )}

            <View style={styles.row}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Sampling:</Text>
              <Button label="Single pixel (exact)" theme={theme} selected={mode === 1} onPress={() => setMode(1)} />
              <Button label="Average 3×3" theme={theme} selected={mode === 3} onPress={() => setMode(3)} />
              <Button label="Average 5×5" theme={theme} selected={mode === 5} onPress={() => setMode(5)} />
            </View>

            <Text style={{ color: theme.muted, fontSize: 12 }}>
              {`${img.fileName} · ${img.width}×${img.height} px`}
            </Text>
          </ScrollView>
        </>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  viewerArea: { flex: 5 },
  // NOT `flex: 4`. Measured on a device: the shorthand is not honoured on a
  // ScrollView — it laid out as `flex: 1`, giving the panel 128dp instead of
  // 342dp, which is why the contrast ratio sat off-screen. Written out, the
  // 5:4 split is exact.
  panel: { flexGrow: 4, flexShrink: 1, flexBasis: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  coord: { minHeight: 48, minWidth: 84, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
});
