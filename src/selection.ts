/**
 * Which of the two points the next touch should move.
 *
 * The first touch on a freshly loaded image places A and hands over to B, so
 * the usual two-point measurement needs no button press at all.
 *
 * It used to hand over whenever B was still unset, which made point A
 * impossible to adjust: selecting A and touching the image moved A but bounced
 * the selection straight back to B, and the nudge arrows then operated on a
 * point that did not exist yet. Found on a real phone — placing A, going back
 * to A and touching again always jumped away. After the first placement the
 * user's choice stands.
 */
export type Slot = 0 | 1;

export function nextActive(active: Slot, placedBefore: readonly [boolean, boolean]): Slot {
  const nothingPlacedYet = !placedBefore[0] && !placedBefore[1];
  return active === 0 && nothingPlacedYet ? 1 : active;
}
