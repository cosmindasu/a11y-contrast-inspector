import { nextActive, type Slot } from '../src/selection';

const NONE = [false, false] as const;
const A_ONLY = [true, false] as const;
const B_ONLY = [false, true] as const;
const BOTH = [true, true] as const;

describe('nextActive', () => {
  it('hands over to B after the very first touch of a fresh image', () => {
    expect(nextActive(0, NONE)).toBe(1);
  });

  it('keeps A selected when A is touched again (the bug found on the phone)', () => {
    // A placed, B not yet: selecting A and touching used to bounce back to B,
    // leaving the nudge arrows pointed at a point that did not exist.
    expect(nextActive(0, A_ONLY)).toBe(0);
    // And once both exist, adjusting A must obviously stay on A.
    expect(nextActive(0, BOTH)).toBe(0);
  });

  it('never moves the selection off B', () => {
    for (const placed of [NONE, A_ONLY, B_ONLY, BOTH]) {
      expect(nextActive(1, placed)).toBe(1);
    }
  });

  it('hands over only when nothing at all is placed', () => {
    // B alone placed (possible if the user selected B first): A is still
    // unplaced, but this is no longer the first touch, so A stays selected.
    expect(nextActive(0, B_ONLY)).toBe(0);
  });

  it('is a pure choice between the two slots', () => {
    const slots: Slot[] = [0, 1];
    for (const a of slots) {
      for (const placed of [NONE, A_ONLY, B_ONLY, BOTH]) {
        expect(slots).toContain(nextActive(a, placed));
        // Called twice with the same input it must answer the same.
        expect(nextActive(a, placed)).toBe(nextActive(a, placed));
      }
    }
  });

  it('settles after one touch: the handover never repeats', () => {
    // Fresh image: first touch moves to B, and from B nothing moves again.
    let active: Slot = 0;
    active = nextActive(active, NONE);
    expect(active).toBe(1);
    active = nextActive(active, A_ONLY);
    expect(active).toBe(1);

    // User goes back to A and touches twice: both touches keep A.
    active = 0;
    active = nextActive(active, BOTH);
    expect(active).toBe(0);
    active = nextActive(active, BOTH);
    expect(active).toBe(0);
  });
});
