/** Choosing which shared file to open. Pure, so native nulls are unit-tested. */
export interface SharedFileLike {
  path: string;
  fileName: string;
  /** Typed `string` upstream, but native can hand back null/undefined. */
  mimeType?: string | null;
}

export interface SharedSelection {
  file: SharedFileLike | null;
  /** Images beyond the first that will NOT be opened. */
  ignoredImages: number;
  /** Shared items that are not images. */
  ignoredOther: number;
}

/**
 * A missing mime type is not proof of "not an image": it is let through and the
 * decoder rejects non-images with its own message. An explicit non-image type is
 * skipped.
 */
export function selectSharedImage(files: readonly SharedFileLike[] | null | undefined): SharedSelection {
  const list = files ?? [];
  const images = list.filter((f) => !f.mimeType || f.mimeType.startsWith('image/'));
  return { file: images[0] ?? null, ignoredImages: Math.max(0, images.length - 1), ignoredOther: list.length - images.length };
}

export function ignoredNotice(s: SharedSelection): string | null {
  const parts: string[] = [];
  if (s.ignoredImages > 0) {
    parts.push(`${s.ignoredImages} other shared image${s.ignoredImages === 1 ? ' was' : 's were'} ignored`);
  }
  if (s.ignoredOther > 0) {
    parts.push(`${s.ignoredOther} shared item${s.ignoredOther === 1 ? ' was not an image and was' : 's were not images and were'} ignored`);
  }
  if (parts.length === 0) return null;
  return `Only the first image was opened. ${parts.join('; ')}. Share them one at a time to inspect each.`;
}
