/**
 * View-space <-> image-pixel mapping. Pure functions.
 *
 * The image is drawn by Skia into EXACTLY the rectangle returned by
 * `imageRect()`, and taps are mapped back with `viewToPixel()` using the same
 * rectangle, so what the user sees and what is sampled cannot drift apart.
 * Units: view coordinates are dp (React Native layout units); image coordinates
 * are integer pixels of the decoded bitmap, origin top-left.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  /** Extra zoom on top of "fit". 1 = whole image visible (letterboxed). */
  zoom: number;
  /** Pan offset in dp, applied after centring. */
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

/** Where the whole image lands inside the view (dp). Contain-fit, centred, plus zoom/pan. */
export function imageRect(view: Size, image: Size, vp: Viewport): Rect {
  const fit = Math.min(view.width / image.width, view.height / image.height);
  const scale = fit * vp.zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (view.width - width) / 2 + vp.panX,
    y: (view.height - height) / 2 + vp.panY,
    width,
    height,
  };
}

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Map a point in view space to the image pixel under it.
 * Returns null when the point is in the letterbox / outside the image, so a tap
 * on empty margin is ignored instead of being clamped onto an edge pixel.
 */
export function viewToPixel(
  vx: number,
  vy: number,
  rect: Rect,
  image: Size,
): PixelPoint | null {
  const px = Math.floor(((vx - rect.x) / rect.width) * image.width);
  const py = Math.floor(((vy - rect.y) / rect.height) * image.height);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
  return { x: px, y: py };
}

/** Centre of an image pixel in view space (for drawing markers). */
export function pixelCentreToView(p: PixelPoint, rect: Rect, image: Size): { x: number; y: number } {
  return {
    x: rect.x + ((p.x + 0.5) / image.width) * rect.width,
    y: rect.y + ((p.y + 0.5) / image.height) * rect.height,
  };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Change zoom keeping the view-space point (cx, cy) fixed on screen.
 */
export function zoomAbout(
  view: Size,
  image: Size,
  vp: Viewport,
  newZoom: number,
  cx: number,
  cy: number,
): Viewport {
  const zoom = clampZoom(newZoom);
  const before = imageRect(view, image, vp);
  // Fractional position in the image under (cx, cy).
  const fx = (cx - before.x) / before.width;
  const fy = (cy - before.y) / before.height;
  const probe = imageRect(view, image, { zoom, panX: 0, panY: 0 });
  return {
    zoom,
    panX: cx - fx * probe.width - (view.width - probe.width) / 2,
    panY: cy - fy * probe.height - (view.height - probe.height) / 2,
  };
}

/** Keep at least part of the image on screen when panning. */
export function clampPan(view: Size, image: Size, vp: Viewport): Viewport {
  const r = imageRect(view, image, { ...vp, panX: 0, panY: 0 });
  const maxX = Math.max(0, (r.width - view.width) / 2) + view.width * 0.25;
  const maxY = Math.max(0, (r.height - view.height) / 2) + view.height * 0.25;
  return {
    zoom: vp.zoom,
    panX: Math.min(maxX, Math.max(-maxX, vp.panX)),
    panY: Math.min(maxY, Math.max(-maxY, vp.panY)),
  };
}
