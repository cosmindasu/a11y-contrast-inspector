import { contrastRatio } from '../src/contrast';
import { DARK, LIGHT } from '../src/palette';

const hex = (h: string) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

describe.each([['light', LIGHT], ['dark', DARK]])('%s theme audits clean', (_n, t) => {
  const text = [
    [t.text, t.bg], [t.text, t.surface], [t.muted, t.bg], [t.muted, t.surface],
    [t.onPrimary, t.primary], 
    [t.pass, t.bg], [t.fail, t.bg], [t.warn, t.bg],
  ] as const;
  it.each(text)('text %s on %s >= 4.5:1', (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });
  it('borders >= 3:1 against bg and surface (SC 1.4.11)', () => {
    expect(contrastRatio(hex(t.border), hex(t.bg))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hex(t.border), hex(t.surface))).toBeGreaterThanOrEqual(3);
  });
});
