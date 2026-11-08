import {
  clampZoom,
  imageRect,
  pixelCentreToView,
  viewToPixel,
  zoomAbout,
  type Viewport,
} from '../src/coords';

const VP: Viewport = { zoom: 1, panX: 0, panY: 0 };

describe('imageRect (contain-fit)', () => {
  it('letterboxes a tall screenshot inside a wide view', () => {
    // 1080x2400 image in a 400x400 view: height-limited, 180 dp wide, centred.
    const r = imageRect({ width: 400, height: 400 }, { width: 1080, height: 2400 }, VP);
    expect(r.height).toBeCloseTo(400, 9);
    expect(r.width).toBeCloseTo(180, 9);
    expect(r.x).toBeCloseTo(110, 9);
    expect(r.y).toBeCloseTo(0, 9);
  });
  it('letterboxes top/bottom when the image is wider than the view', () => {
    const r = imageRect({ width: 300, height: 600 }, { width: 600, height: 300 }, VP);
    expect(r.width).toBeCloseTo(300, 9);
    expect(r.height).toBeCloseTo(150, 9);
    expect(r.y).toBeCloseTo(225, 9);
  });
});

describe('viewToPixel', () => {
  const view = { width: 400, height: 400 };
  const img = { width: 1080, height: 2400 };
  const rect = imageRect(view, img, VP);

  it('ignores taps in the letterbox instead of clamping', () => {
    expect(viewToPixel(50, 200, rect, img)).toBeNull();
    expect(viewToPixel(350, 200, rect, img)).toBeNull();
  });
  it('maps the corners to the first and last pixels', () => {
    expect(viewToPixel(rect.x + 0.01, 0.01, rect, img)).toEqual({ x: 0, y: 0 });
    expect(viewToPixel(rect.x + rect.width - 0.01, 399.99, rect, img)).toEqual({ x: 1079, y: 2399 });
  });
  it('rejects points exactly on the far edge (outside the last pixel)', () => {
    expect(viewToPixel(rect.x + rect.width, 10, rect, img)).toBeNull();
  });
  it('maps the centre to the middle pixel', () => {
    expect(viewToPixel(200, 200, rect, img)).toEqual({ x: 540, y: 1200 });
  });
  it('round-trips through pixelCentreToView for every sampled pixel', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 123, y: 2000 }, { x: 1079, y: 2399 }, { x: 540, y: 1 }]) {
      const v = pixelCentreToView(p, rect, img);
      expect(viewToPixel(v.x, v.y, rect, img)).toEqual(p);
    }
  });
  it('round-trips when zoomed and panned', () => {
    const vp = { zoom: 7, panX: -83.3, panY: 41.7 };
    const r = imageRect(view, img, vp);
    for (const p of [{ x: 500, y: 1100 }, { x: 501, y: 1100 }, { x: 502, y: 1101 }]) {
      const v = pixelCentreToView(p, r, img);
      expect(viewToPixel(v.x, v.y, r, img)).toEqual(p);
    }
  });
});

describe('zoomAbout', () => {
  it('keeps the pixel under the focal point fixed', () => {
    const view = { width: 360, height: 640 };
    const img = { width: 1080, height: 2400 };
    const before = viewToPixel(120, 300, imageRect(view, img, VP), img);
    const vp2 = zoomAbout(view, img, VP, 8, 120, 300);
    const after = viewToPixel(120, 300, imageRect(view, img, vp2), img);
    expect(after).toEqual(before);
    expect(vp2.zoom).toBe(8);
  });
  it('clamps zoom to the allowed range', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(1000)).toBe(64);
  });
});

describe('exact pixel boundaries (no half-pixel bias)', () => {
  // 100x50 image in a 400x400 view: fit = 4, scale 4 dp per pixel, rect y offset (400-200)/2 = 100.
  const view = { width: 400, height: 400 };
  const img = { width: 100, height: 50 };
  const rect = imageRect(view, img, VP);
  it('has the expected geometry', () => {
    expect(rect).toEqual({ x: 0, y: 100, width: 400, height: 200 });
  });
  it('x = k*scale belongs to pixel k; just below belongs to k-1', () => {
    const scale = 4;
    for (const k of [0, 1, 2, 49, 50, 98, 99]) {
      expect(viewToPixel(k * scale, 150, rect, img)?.x).toBe(k);
      if (k > 0) expect(viewToPixel(k * scale - 1e-9, 150, rect, img)?.x).toBe(k - 1);
    }
  });
  it('the same holds on y from the rect origin', () => {
    expect(viewToPixel(10, 100, rect, img)?.y).toBe(0);
    expect(viewToPixel(10, 100 - 1e-9, rect, img)).toBeNull();
    expect(viewToPixel(10, 104, rect, img)?.y).toBe(1);
    expect(viewToPixel(10, 296, rect, img)?.y).toBe(49);
  });
  it('first and last edge pixels are reachable; one past is not', () => {
    expect(viewToPixel(0, 100, rect, img)).toEqual({ x: 0, y: 0 });
    expect(viewToPixel(400 - 1e-9, 300 - 1e-9, rect, img)).toEqual({ x: 99, y: 49 });
    expect(viewToPixel(400, 150, rect, img)).toBeNull();
    expect(viewToPixel(-1e-9, 150, rect, img)).toBeNull();
  });
  it('a pixel centre sits exactly (k + 0.5) * scale from the rect origin', () => {
    const c = pixelCentreToView({ x: 3, y: 2 }, rect, img);
    expect(c.x).toBeCloseTo(3.5 * 4, 12);
    expect(c.y).toBeCloseTo(100 + 2.5 * 4, 12);
  });
});

describe('non-integer, asymmetric zoom + pan vs an independently computed pixel', () => {
  it('matches hand-derived geometry', () => {
    // View 360x640, image 1080x2400. fit = min(360/1080, 640/2400) = min(0.3333.., 0.26666..) = 4/15.
    // zoom 5.5 -> scale = 4/15 * 5.5 = 22/15 dp per pixel (1.46666..).
    // Image size in dp: 1080*22/15 = 1584 wide, 2400*22/15 = 3520 high.
    // Origin = ((360-1584)/2 + panX, (640-3520)/2 + panY) = (-612 + -83.3, -1440 + 41.7).
    const view = { width: 360, height: 640 };
    const img = { width: 1080, height: 2400 };
    const vp = { zoom: 5.5, panX: -83.3, panY: 41.7 };
    const r = imageRect(view, img, vp);
    expect(r.x).toBeCloseTo(-695.3, 9);
    expect(r.y).toBeCloseTo(-1398.3, 9);
    expect(r.width).toBeCloseTo(1584, 9);
    expect(r.height).toBeCloseTo(3520, 9);
    const scale = 22 / 15;
    const tap = { x: 123.4, y: 301.9 };
    // pixel = floor((tap - origin) / scale)
    const expectedX = Math.floor((tap.x - -695.3) / scale); // (818.7)/1.46667 = 558.2 -> 558
    const expectedY = Math.floor((tap.y - -1398.3) / scale); // 1700.2/1.46667 = 1159.2 -> 1159
    expect(expectedX).toBe(558);
    expect(expectedY).toBe(1159);
    expect(viewToPixel(tap.x, tap.y, r, img)).toEqual({ x: expectedX, y: expectedY });
  });
  it('a tap exactly on the computed boundary between two pixels lands on the later one', () => {
    const view = { width: 360, height: 640 };
    const img = { width: 1080, height: 2400 };
    const r = imageRect(view, img, { zoom: 5.5, panX: -83.3, panY: 41.7 });
    const scale = 22 / 15;
    const bx = -695.3 + 558 * scale; // left edge of pixel 558
    expect(viewToPixel(bx + 1e-6, 400, r, img)?.x).toBe(558);
    expect(viewToPixel(bx - 1e-6, 400, r, img)?.x).toBe(557);
  });
});
