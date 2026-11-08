import { ignoredNotice, selectSharedImage } from '../src/share';

const f = (mimeType: string | null | undefined, n = 'a.png') => ({ path: `/x/${n}`, fileName: n, mimeType });

describe('selectSharedImage', () => {
  it('does not throw on a null or undefined mime type', () => {
    expect(() => selectSharedImage([f(null)])).not.toThrow();
    expect(() => selectSharedImage([f(undefined)])).not.toThrow();
    expect(selectSharedImage([f(null)]).file?.fileName).toBe('a.png');
  });
  it('picks the first image and counts the ignored ones', () => {
    const s = selectSharedImage([f('image/png', '1.png'), f('image/jpeg', '2.jpg'), f('image/png', '3.png')]);
    expect(s.file?.fileName).toBe('1.png');
    expect(s.ignoredImages).toBe(2);
    expect(ignoredNotice(s)).toContain('2 other shared images were ignored');
  });
  it('skips explicit non-images and says so', () => {
    const s = selectSharedImage([f('text/plain', 't.txt'), f('image/png', 'p.png')]);
    expect(s.file?.fileName).toBe('p.png');
    expect(s.ignoredOther).toBe(1);
    expect(ignoredNotice(s)).toContain('not an image');
  });
  it('no notice for a single image; null file when nothing is an image', () => {
    expect(ignoredNotice(selectSharedImage([f('image/png')]))).toBeNull();
    expect(selectSharedImage([f('video/mp4')]).file).toBeNull();
    expect(selectSharedImage(undefined).file).toBeNull();
  });
});
