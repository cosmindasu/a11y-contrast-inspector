/**
 * Pixel access. This is the load-bearing module: it must return the true stored
 * value of a decoded pixel, with no scaling, filtering, compositing or colour
 * management.
 *
 * Route: file bytes -> Skia.Data -> SkImage.MakeImageFromEncoded (decode) ->
 * SkImage.readPixels(x, y, {RGBA_8888, Unpremul, w, h}).
 *
 *  - readPixels copies the requested rectangle out of the decoded bitmap at its
 *    NATIVE resolution. It never goes through a view, a canvas or a GPU
 *    texture sample, so display scaling cannot affect it.
 *  - ImageInfo is passed WITHOUT a colour space. Skia then treats the
 *    destination as having the source's colour space and applies no gamut
 *    transform: you get the numbers stored in the file.
 *  - AlphaType.Unpremul so colour channels are not multiplied by alpha.
 */
import {
  AlphaType,
  ColorType,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { RGB } from './contrast';
import { inspectColourProfile, type ProfileInfo } from './colourProfile';
import { averageRgba, patchBounds, type PatchResult } from './patch';
import { chromaSpreadOfColours, luma, LOSSY_SPREAD_THRESHOLD } from './lossy';

/**
 * How the file reached the app. It decides whether `fileName` can be trusted:
 * a share intent carries the real name, while `expo-image-picker` copies the
 * file into the app's cache first and reports THAT copy's name, which on
 * Android is the MediaStore id ("26.jpg") rather than the file's own name.
 */
export type ImageSource = 'share' | 'picker';

export interface LoadedImage {
  image: SkImage;
  width: number;
  height: number;
  profile: ProfileInfo;
  fileName: string;
  source: ImageSource;
}

export interface Sample {
  colour: RGB;
  alpha: number;
}

/** Read a picked/shared image (file:// or content:// URI) and decode it. */
export async function loadImage(
  uri: string,
  fileName: string,
  source: ImageSource,
): Promise<LoadedImage> {
  const bytes = await new File(uri).bytes();
  const data = Skia.Data.fromBytes(bytes);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('This file could not be decoded as an image.');
  return {
    image,
    width: image.width(),
    height: image.height(),
    profile: inspectColourProfile(bytes),
    fileName,
    source,
  };
}

function readRect(img: SkImage, x: number, y: number, w: number, h: number): Uint8Array {
  const out = img.readPixels(x, y, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!out || !(out instanceof Uint8Array) || out.length < w * h * 4) {
    throw new Error('Could not read pixels from the decoded image.');
  }
  return out;
}

/** Exact value of ONE pixel. */
export function samplePixel(img: LoadedImage, x: number, y: number): Sample {
  const px = readRect(img.image, x, y, 1, 1);
  return { colour: { r: px[0] ?? 0, g: px[1] ?? 0, b: px[2] ?? 0 }, alpha: px[3] ?? 255 };
}

/** Explicit averaged patch (size x size, clipped at the image edge). */
export function samplePatch(img: LoadedImage, x: number, y: number, size: number): PatchResult {
  const b = patchBounds(x, y, size, img.width, img.height);
  return averageRgba(readRect(img.image, b.x, b.y, b.width, b.height));
}

export interface Neighbourhood {
  /** Every pixel within one pixel of the sample, including the sample itself. */
  colours: RGB[];
  /** Chroma variation across those pixels. */
  chromaSpread: number;
  /**
   * Lumas of nearby pixels whose OWN neighbourhood is chroma-flat, i.e. that
   * sit far enough from any colour edge to be undamaged. `band.ts` uses these
   * to decide whether the sample's region exists anywhere in a readable state.
   */
  cleanLumas: number[];
}

/**
 * What surrounds a sample, read one pixel wider than the sample itself so an
 * edge just outside it still counts.
 *
 * This neighbourhood — and not the sampled pixel's own colour — is what decides
 * whether 4:2:0 chroma subsampling could have moved the reading (`lossy.ts`)
 * and how far it could have moved it (`band.ts`).
 *
 * Read-only and independent of the sampling path above: it never affects the
 * value returned for the point. Both outputs come from one `readPixels` call,
 * so the spread and the colours can never disagree about what was there.
 */
export function sampleNeighbourhood(
  img: LoadedImage,
  x: number,
  y: number,
  size: number,
): Neighbourhood {
  // Read wide enough that every pixel we want to judge has its OWN 3x3
  // available: the sample's neighbourhood is size+2, the pixels we test for
  // cleanliness reach one further, and each of those needs one more again.
  const outer = patchBounds(x, y, size + 6, img.width, img.height);
  const rgba = readRect(img.image, outer.x, outer.y, outer.width, outer.height);
  const at = (px: number, py: number): RGB => {
    const i = ((py - outer.y) * outer.width + (px - outer.x)) * 4;
    return { r: rgba[i] ?? 0, g: rgba[i + 1] ?? 0, b: rgba[i + 2] ?? 0 };
  };
  const inside = (px: number, py: number) =>
    px >= outer.x && py >= outer.y && px < outer.x + outer.width && py < outer.y + outer.height;

  const inner = patchBounds(x, y, size + 2, img.width, img.height);
  const colours: RGB[] = [];
  for (let py = inner.y; py < inner.y + inner.height; py++) {
    for (let px = inner.x; px < inner.x + inner.width; px++) colours.push(at(px, py));
  }

  // A pixel is undamaged when its own surroundings carry no colour edge:
  // `lossy.ts` measured the damage as confined to the one-pixel rim.
  const scan = patchBounds(x, y, size + 4, img.width, img.height);
  const cleanLumas: number[] = [];
  for (let py = scan.y; py < scan.y + scan.height; py++) {
    for (let px = scan.x; px < scan.x + scan.width; px++) {
      if (!inside(px - 1, py - 1) || !inside(px + 1, py + 1)) continue;
      const block: RGB[] = [];
      for (let by = py - 1; by <= py + 1; by++) {
        for (let bx = px - 1; bx <= px + 1; bx++) block.push(at(bx, by));
      }
      if (chromaSpreadOfColours(block) < LOSSY_SPREAD_THRESHOLD) cleanLumas.push(luma(at(px, py)));
    }
  }

  return { colours, chromaSpread: chromaSpreadOfColours(colours), cleanLumas };
}
