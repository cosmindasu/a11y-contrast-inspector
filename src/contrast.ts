/**
 * WCAG 2.x colour-contrast maths. Pure functions, no dependencies.
 * Reference: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

export interface RGB {
  /** 8-bit sRGB channel values, integers 0-255. */
  r: number;
  g: number;
  b: number;
}

/** sRGB channel (0-255) -> linear-light value (0-1). */
export function linearizeChannel(value8: number): number {
  const c = value8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
  );
}

/** Contrast ratio, 1 .. 21. Order of arguments does not matter. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/**
 * Format a ratio for display WITHOUT rounding up. WCAG does not allow rounding
 * (4.499:1 fails 4.5:1), so we truncate to 2 decimals.
 *
 * Contract: the result is k/100 where k/100 <= ratio < (k+1)/100, compared as
 * doubles. There is NO epsilon: `ratio * 100` can land a hair below or above
 * the true product (4.35 * 100 = 434.99999999999994), so the floor is corrected
 * by comparing against k/100 itself. Exact values such as 21 or 4.5 format
 * faithfully, and anything strictly below 4.5 (even 4.4999999999999996) can
 * never display as "4.50".
 */
export function formatRatio(ratio: number): string {
  let k = Math.floor(ratio * 100);
  if (k / 100 > ratio) k -= 1;
  else if ((k + 1) / 100 <= ratio) k += 1;
  return `${(k / 100).toFixed(2)}:1`;
}

/**
 * Contrast ratio from two relative luminances. Same formula as
 * `contrastRatio`, for callers (averaged patches) that hold an UNROUNDED
 * luminance rather than an 8-bit colour. `contrastRatio` is unchanged.
 */
export function ratioFromLuminances(la: number, lb: number): number {
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Criterion {
  id: string;
  /** Short human label. */
  label: string;
  /** WCAG success criterion number. */
  sc: string;
  level: 'AA' | 'AAA';
  threshold: number;
}

export const CRITERIA: readonly Criterion[] = [
  { id: 'aa-normal', label: 'Normal text', sc: '1.4.3', level: 'AA', threshold: 4.5 },
  { id: 'aa-large', label: 'Large text', sc: '1.4.3', level: 'AA', threshold: 3 },
  { id: 'aaa-normal', label: 'Normal text', sc: '1.4.6', level: 'AAA', threshold: 7 },
  { id: 'aaa-large', label: 'Large text', sc: '1.4.6', level: 'AAA', threshold: 4.5 },
  { id: 'non-text', label: 'UI components and graphics', sc: '1.4.11', level: 'AA', threshold: 3 },
];

export interface Verdict extends Criterion {
  pass: boolean;
}

/** Compare the exact (unrounded) ratio against each threshold. */
export function evaluate(ratio: number): Verdict[] {
  return CRITERIA.map((c) => ({ ...c, pass: ratio >= c.threshold }));
}
