/**
 * Draws an `EvidenceCard` as a PNG.
 *
 * It lays out what `evidence.ts` gives it and decides nothing about the
 * content: if a warning is in the card it is on the image, and the card's own
 * tests are what guarantee it is there. Text is measured with Skia paragraphs
 * in a first pass so the canvas is exactly as tall as the content — a fixed
 * height would either clip the warnings or pad the card with emptiness, and
 * clipping is the failure that matters.
 *
 * The card is always drawn light, whatever the app's theme: it is going into
 * someone's report, not back onto this screen. Its own palette is the audited
 * one from `palette.ts`, so the artefact passes the check it documents.
 */
import {
  FilterMode,
  FontWeight,
  ImageFormat,
  MipmapMode,
  PaintStyle,
  Skia,
  TextAlign,
  type SkCanvas,
  type SkParagraph,
} from '@shopify/react-native-skia';
import type { Certainty } from './band';
import type { EvidenceCard, Rect } from './evidence';
import { LIGHT } from './palette';
import type { LoadedImage } from './pixels';

const W = 1080;
const PAD = 44;
const GAP = 22;
const CONTENT = W - 2 * PAD;
const CROP_W = 430;
const COL_GAP = 30;
const SIDE = CONTENT - CROP_W - COL_GAP;
const MARK_W = 168;
const CROP_MAX_H = 520;

const INK = {
  text: Skia.Color(LIGHT.text),
  muted: Skia.Color(LIGHT.muted),
  border: Skia.Color(LIGHT.border),
  pass: Skia.Color(LIGHT.pass),
  fail: Skia.Color(LIGHT.fail),
  warn: Skia.Color(LIGHT.warn),
  bg: Skia.Color(LIGHT.bg),
  surface: Skia.Color(LIGHT.surface),
};

const VERDICT_INK: Record<Certainty, Float32Array> = {
  pass: INK.pass,
  fail: INK.fail,
  undetermined: INK.warn,
};

function para(
  text: string,
  size: number,
  colour: Float32Array,
  weight: FontWeight,
  width: number,
): SkParagraph {
  const b = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Left });
  b.pushStyle({ color: colour, fontSize: size, fontStyle: { weight }, heightMultiplier: 1.3 });
  b.addText(text);
  b.pop();
  const p = b.build();
  p.layout(width);
  return p;
}

function fill(colour: Float32Array) {
  const p = Skia.Paint();
  p.setColor(colour);
  return p;
}

function stroke(colour: Float32Array, width: number) {
  const p = Skia.Paint();
  p.setColor(colour);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
}

/** Where A and B sit inside the drawn crop, so the markers land on the pixels. */
function markerAt(
  at: { x: number; y: number },
  crop: Rect,
  dest: { x: number; y: number; width: number; height: number },
) {
  return {
    x: dest.x + ((at.x - crop.x + 0.5) / crop.width) * dest.width,
    y: dest.y + ((at.y - crop.y + 0.5) / crop.height) * dest.height,
  };
}

function drawMarker(canvas: SkCanvas, x: number, y: number, label: string) {
  canvas.drawCircle(x, y, 17, stroke(Skia.Color('#FFFFFF'), 6));
  canvas.drawCircle(x, y, 17, stroke(Skia.Color('#000000'), 3));
  const tag = para(label, 22, Skia.Color('#000000'), FontWeight.Black, 40);
  const box = Skia.XYWHRect(x + 16, y - 36, 30, 30);
  canvas.drawRect(box, fill(Skia.Color('#FFFFFF')));
  tag.paint(canvas, x + 22, y - 34);
}

export interface EvidenceGeometry {
  height: number;
}

/**
 * Renders the card and returns PNG bytes.
 *
 * `points` carries the two pixel coordinates again (the card holds them as
 * display strings) so the markers can be placed on the crop.
 */
export function renderEvidence(
  card: EvidenceCard,
  image: LoadedImage,
  crop: Rect,
  points: readonly [{ x: number; y: number }, { x: number; y: number }],
): Uint8Array {
  // ---- pass 1: build every paragraph and measure it.
  const title = para(card.title, 26, INK.muted, FontWeight.Bold, CONTENT);
  const readingLabel = para(card.reading.label, 22, INK.muted, FontWeight.SemiBold, CONTENT);
  const readingValue = para(card.reading.value, 68, INK.text, FontWeight.Black, CONTENT);
  const readingNote = para(card.reading.note, 19, INK.muted, FontWeight.Normal, CONTENT);

  const swatchBlocks = card.points.map((p) => ({
    colour: Skia.Color(p.hex),
    head: para(`Point ${p.name}   ${p.hex}`, 24, INK.text, FontWeight.Bold, SIDE - 110),
    lines: para(`${p.rgb}\nPixel ${p.at}\n${p.note}`, 18, INK.muted, FontWeight.Normal, SIDE - 110),
  }));

  const verdicts = card.verdicts.map((v) => ({
    mark: para(v.mark, 22, VERDICT_INK[v.certainty], FontWeight.Black, MARK_W),
    text: para(v.text, 22, INK.text, FontWeight.Normal, CONTENT - MARK_W),
  }));

  const warnings = card.warnings.map((w) =>
    para(`Warning: ${w}`, 19, INK.warn, FontWeight.SemiBold, CONTENT - 36),
  );
  const footer = card.footer.map((f) => para(f, 17, INK.muted, FontWeight.Normal, CONTENT));

  // The crop is FITTED into its column, never stretched to fill it: a tall
  // crop (two points far apart vertically) would otherwise be squashed to the
  // column's width and misrepresent the thing being measured.
  const cropScale = Math.min(CROP_W / crop.width, CROP_MAX_H / crop.height);
  const cropW = Math.max(1, Math.round(crop.width * cropScale));
  const cropH = Math.max(1, Math.round(crop.height * cropScale));
  const cropDest = { x: PAD + Math.round((CROP_W - cropW) / 2), y: 0, width: cropW, height: cropH };

  const swatchH = swatchBlocks.reduce(
    (t, s) => t + Math.max(96, s.head.getHeight() + s.lines.getHeight() + 10) + 18,
    0,
  );
  const topBlock = Math.max(cropH, swatchH);
  const verdictH = verdicts.reduce((t, v) => t + Math.max(v.mark.getHeight(), v.text.getHeight()) + 12, 0);
  const warnH = warnings.reduce((t, w) => t + w.getHeight() + 28 + 12, 0);
  const footH = footer.reduce((t, f) => t + f.getHeight(), 0);

  const height = Math.round(
    PAD +
      title.getHeight() +
      GAP +
      topBlock +
      GAP +
      readingLabel.getHeight() +
      readingValue.getHeight() +
      8 +
      readingNote.getHeight() +
      GAP +
      verdictH +
      (warnings.length ? GAP + warnH : 0) +
      GAP +
      footH +
      PAD,
  );

  // ---- pass 2: draw.
  const surface = Skia.Surface.Make(W, height);
  if (!surface) throw new Error('Could not create a surface for the evidence image.');
  const canvas = surface.getCanvas();
  canvas.drawColor(INK.bg);

  let y = PAD;
  title.paint(canvas, PAD, y);
  y += title.getHeight() + GAP;

  // crop
  cropDest.y = y;
  const src = Skia.XYWHRect(crop.x, crop.y, crop.width, crop.height);
  const dst = Skia.XYWHRect(cropDest.x, cropDest.y, cropDest.width, cropDest.height);
  canvas.drawRect(dst, fill(INK.surface));
  canvas.drawImageRectOptions(
    image.image,
    src,
    dst,
    cropScale >= 1 ? FilterMode.Nearest : FilterMode.Linear,
    MipmapMode.None,
  );
  canvas.drawRect(dst, stroke(INK.border, 2));
  points.forEach((p, i) => {
    const c = markerAt(p, crop, cropDest);
    drawMarker(canvas, c.x, c.y, i === 0 ? 'A' : 'B');
  });

  // swatches
  let sy = y;
  const sx = PAD + CROP_W + COL_GAP;
  swatchBlocks.forEach((s) => {
    const sw = Skia.XYWHRect(sx, sy, 84, 84);
    canvas.drawRect(sw, fill(s.colour));
    canvas.drawRect(sw, stroke(INK.border, 2));
    s.head.paint(canvas, sx + 104, sy);
    s.lines.paint(canvas, sx + 104, sy + s.head.getHeight() + 4);
    sy += Math.max(96, s.head.getHeight() + s.lines.getHeight() + 10) + 18;
  });

  y += topBlock + GAP;

  readingLabel.paint(canvas, PAD, y);
  y += readingLabel.getHeight();
  readingValue.paint(canvas, PAD, y);
  y += readingValue.getHeight() + 8;
  readingNote.paint(canvas, PAD, y);
  y += readingNote.getHeight() + GAP;

  verdicts.forEach((v) => {
    v.mark.paint(canvas, PAD, y);
    v.text.paint(canvas, PAD + MARK_W, y);
    y += Math.max(v.mark.getHeight(), v.text.getHeight()) + 12;
  });

  if (warnings.length) {
    y += GAP - 12;
    warnings.forEach((w) => {
      const h = w.getHeight() + 28;
      const box = Skia.XYWHRect(PAD, y, CONTENT, h);
      canvas.drawRect(box, stroke(INK.warn, 2));
      w.paint(canvas, PAD + 18, y + 14);
      y += h + 12;
    });
  }

  y += GAP - 12;
  footer.forEach((f) => {
    f.paint(canvas, PAD, y);
    y += f.getHeight();
  });

  surface.flush();
  const png = surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG, 100);
  if (!png) throw new Error('Could not encode the evidence image.');
  return png;
}
