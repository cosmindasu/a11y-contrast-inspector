#!/usr/bin/env python3
"""Generate the reference screenshots in ../testdata (stdlib only).

Both files contain IDENTICAL stored pixel values. The second one carries
gAMA 1.0 + wide-gamut cHRM chunks. A colour-managing pipeline would change the
numbers read from it; the app must report exactly the same hex values for both.
Run:  python3 tools/make-reference-images.py
"""
import os, struct, zlib

W, H = 360, 600
BLACK, WHITE = (0, 0, 0), (255, 255, 255)

def band(y):
    """Return a function x -> RGB for the horizontal band containing row y."""
    if y < 100:  return lambda x: BLACK if x < 180 else WHITE                 # 21:1
    if y < 200:  return lambda x: (0x76, 0x76, 0x76) if x < 180 else WHITE    # 4.54:1
    if y < 300:  return lambda x: (0x77, 0x77, 0x77) if x < 180 else WHITE    # 4.48:1
    if y < 400:  return lambda x: BLACK if x % 2 == 0 else WHITE              # 1-px columns
    if y < 500:  return lambda x: (0xFF, 0x00, 0x00) if x < 180 else WHITE    # 4.00:1
    return lambda x: (0x1A, 0x73, 0xE8) if x < 180 else (0xF1, 0xF3, 0xF4)    # Google blue / grey

def chunk(t, d):
    c = struct.pack(">I", len(d)) + t + d
    return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

def make(extra=b""):
    raw = bytearray()
    for y in range(H):
        f = band(y)
        raw.append(0)
        for x in range(W):
            raw += bytes(f(x))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
            + extra
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "testdata")
os.makedirs(out, exist_ok=True)
open(os.path.join(out, "reference.png"), "wb").write(make())
tagged = (chunk(b"gAMA", struct.pack(">I", 100000))
          + chunk(b"cHRM", struct.pack(">8I", 31270, 32900, 68000, 32000, 26500, 69000, 15000, 6000)))
open(os.path.join(out, "reference-tagged.png"), "wb").write(make(tagged))
print("written", out)
