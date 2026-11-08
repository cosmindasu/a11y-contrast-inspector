/**
 * Image viewer with tap-to-sample.
 *
 * Skia draws the decoded image into the rectangle from `imageRect()` and taps
 * are converted back with `viewToPixel()` using that SAME rectangle. The
 * on-screen picture is for aiming only; sampled values come from pixels.ts,
 * never from this view.
 */
import { Canvas, FilterMode, Image as SkiaImage, MipmapMode } from '@shopify/react-native-skia';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  clampPan,
  clampZoom,
  imageRect,
  pixelCentreToView,
  viewToPixel,
  zoomAbout,
  type PixelPoint,
  type Size,
  type Viewport,
} from './coords';
import type { LoadedImage } from './pixels';
import type { Theme } from './theme';
import { Button } from './ui';

const TAP_SLOP = 10; // dp of movement before a touch counts as a pan, not a tap
const INITIAL: Viewport = { zoom: 1, panX: 0, panY: 0 };

interface Props {
  image: LoadedImage;
  points: [PixelPoint | null, PixelPoint | null];
  theme: Theme;
  onTapPixel: (p: PixelPoint) => void;
}

export function Viewer({ image, points, theme, onTapPixel }: Props) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [vp, setVp] = useState<Viewport>(INITIAL);

  // Latest values for the (created-once) PanResponder callbacks.
  const live = useRef({ size, vp, image, onTapPixel });
  live.current = { size, vp, image, onTapPixel };
  const imgSize: Size = { width: image.width, height: image.height };

  const gesture = useRef({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    multi: false,
    pinchDist: 0,
  });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const t = e.nativeEvent.touches[0];
          const g = gesture.current;
          g.startX = g.lastX = t?.locationX ?? 0;
          g.startY = g.lastY = t?.locationY ?? 0;
          g.moved = false;
          g.multi = false;
          g.pinchDist = 0;
        },
        onPanResponderMove: (e) => {
          const g = gesture.current;
          const touches = e.nativeEvent.touches;
          const { size: s, vp: cur, image: im } = live.current;
          const isz: Size = { width: im.width, height: im.height };
          if (touches.length >= 2) {
            const a = touches[0]!;
            const b = touches[1]!;
            const dist = Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
            const mx = (a.locationX + b.locationX) / 2;
            const my = (a.locationY + b.locationY) / 2;
            g.multi = true;
            g.moved = true;
            if (g.pinchDist > 0 && dist > 0) {
              const next = clampPan(s, isz, zoomAbout(s, isz, cur, clampZoom(cur.zoom * (dist / g.pinchDist)), mx, my));
              setVp(next);
            }
            g.pinchDist = dist;
            g.lastX = mx;
            g.lastY = my;
            return;
          }
          g.pinchDist = 0;
          const t = touches[0];
          if (!t) return;
          if (!g.moved && Math.hypot(t.locationX - g.startX, t.locationY - g.startY) > TAP_SLOP) {
            g.moved = true;
            g.lastX = t.locationX;
            g.lastY = t.locationY;
          }
          if (g.moved && !g.multi) {
            const dx = t.locationX - g.lastX;
            const dy = t.locationY - g.lastY;
            g.lastX = t.locationX;
            g.lastY = t.locationY;
            setVp(clampPan(s, isz, { ...cur, panX: cur.panX + dx, panY: cur.panY + dy }));
          } else if (g.moved) {
            g.lastX = t.locationX;
            g.lastY = t.locationY;
          }
        },
        onPanResponderRelease: () => {
          const g = gesture.current;
          if (g.moved || g.multi) return;
          const { size: s, vp: cur, image: im, onTapPixel: cb } = live.current;
          const rect = imageRect(s, { width: im.width, height: im.height }, cur);
          const p = viewToPixel(g.startX, g.startY, rect, { width: im.width, height: im.height });
          if (p) cb(p); // taps on the letterbox are ignored
        },
      }),
    [],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const ready = size.width > 0 && size.height > 0;
  const rect = ready ? imageRect(size, imgSize, vp) : null;
  const pxPerPixel = rect ? rect.width / image.width : 1;
  // Display filtering is cosmetic. When magnified we use nearest-neighbour so
  // each source pixel is a visible block; sampling never uses this path.
  const sampling = pxPerPixel >= 1 ? { filter: FilterMode.Nearest } : { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

  const zoomBy = (factor: number) => {
    if (!ready) return;
    setVp((cur) => clampPan(size, imgSize, zoomAbout(size, imgSize, cur, cur.zoom * factor, size.width / 2, size.height / 2)));
  };

  return (
    <View style={styles.wrap}>
      {/* The border lives on this wrapper. onLayout is read from the INNER
          stage, so the reported size is exactly the size of the Canvas and touch
          overlay (absoluteFill) that imageRect/viewToPixel are computed for. */}
      <View style={[styles.frame, { borderColor: theme.border }]}>
      <View style={[styles.stage, { backgroundColor: theme.surface }]} onLayout={onLayout}>
        {rect && (
          <Canvas style={StyleSheet.absoluteFill}>
            <SkiaImage
              image={image.image}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fit="fill"
              sampling={sampling}
            />
          </Canvas>
        )}
        {rect &&
          points.map((p, i) => {
            if (!p) return null;
            const c = pixelCentreToView(p, rect, imgSize);
            return (
              <View
                key={i}
                pointerEvents="none"
                style={[styles.marker, { left: c.x - 14, top: c.y - 14 }]}
              >
                <View style={styles.markerInner} />
                <Text style={styles.markerLabel}>{i === 0 ? 'A' : 'B'}</Text>
              </View>
            );
          })}
        <View
          {...responder.panHandlers}
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Screenshot. Touch to place the selected point. Use the nudge buttons to move a point by one pixel."
        />
      </View>
      </View>
      <View style={styles.zoomRow}>
        <Button label="−" a11yLabel="Zoom out" theme={theme} onPress={() => zoomBy(1 / 2)} />
        <Button label="+" a11yLabel="Zoom in" theme={theme} onPress={() => zoomBy(2)} />
        <Button label="Fit" a11yLabel="Fit whole image" theme={theme} onPress={() => setVp(INITIAL)} />
        <Text style={[styles.zoomText, { color: theme.muted }]} accessibilityLiveRegion="polite">
          {`${pxPerPixel.toFixed(pxPerPixel < 10 ? 2 : 0)} dp per image pixel`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 240 },
  frame: { flex: 1, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  stage: { flex: 1 },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerInner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#000000',
  },
  markerLabel: {
    position: 'absolute',
    top: -18,
    left: 20,
    fontSize: 13,
    fontWeight: '800',
    color: '#000000',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  zoomRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  zoomText: { fontSize: 13, flexShrink: 1 },
});
