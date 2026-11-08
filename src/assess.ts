/**
 * Decides whether two measured points may be given a contrast verdict at all.
 * Pure, so the "no authoritative-looking number from a composite the user never
 * saw" rule is unit-tested.
 */
import { evaluate, ratioFromLuminances, type Verdict } from './contrast';

export interface Assessable {
  /** Relative luminance (unrounded for averaged patches). */
  luminance: number;
  /** Number of sampled pixels that are not fully opaque. */
  nonOpaque: number;
  /** Number of sampled pixels. */
  count: number;
  /** Lowest alpha (0-255) among the sampled pixels. */
  alpha: number;
}

export type Assessment =
  | { kind: 'result'; ratio: number; verdicts: Verdict[] }
  | { kind: 'suppressed'; reasons: string[] };

export function opacityProblem(name: string, m: Assessable): string | null {
  if (m.nonOpaque === 0) return null;
  const which =
    m.count === 1
      ? 'The sampled pixel is not fully opaque'
      : `${m.nonOpaque} of the ${m.count} sampled pixels are not fully opaque`;
  return `Point ${name}: ${which} (lowest alpha ${m.alpha}/255). The colour it would show depends on what is behind it, which this app cannot know, so no contrast ratio or verdict is given. Choose an opaque area, or use a smaller sampling size.`;
}

export function assess(a: Assessable, b: Assessable): Assessment {
  const reasons = [opacityProblem('A', a), opacityProblem('B', b)].filter((x): x is string => x !== null);
  if (reasons.length > 0) return { kind: 'suppressed', reasons };
  const ratio = ratioFromLuminances(a.luminance, b.luminance);
  return { kind: 'result', ratio, verdicts: evaluate(ratio) };
}
