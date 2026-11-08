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
import { chromaSpreadOfRgba } from './lossy';

export interface LoadedImage {
  image: SkImage;
  width: number;
  height: number;
  profile: ProfileInfo;
  fileName: string;
}

export interface Sample {
  colour: RGB;
  alpha: number;
}

/** Read a picked/shared image (file:// or content:// URI) and decode it. */
export async function loadImage(uri: string, fileName: string): Promise<LoadedImage> {
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
  const b = patchBounds(x, y, size + 2, img.width, img.height);
  const rgba = readRect(img.image, b.x, b.y, b.width, b.height);
  const colours: RGB[] = [];
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    colours.push({ r: rgba[i] ?? 0, g: rgba[i + 1] ?? 0, b: rgba[i + 2] ?? 0 });
  }
  return { colours, chromaSpread: chromaSpreadOfRgba(rgba) };
}
