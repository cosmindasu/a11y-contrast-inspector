# Contrast Inspector (Android)

On-device WCAG colour-contrast inspector for **screenshots**. Open or share a
screenshot, touch two points, read the exact contrast ratio, both colours as
hex and RGB, and the WCAG verdicts.

- Expo SDK 58, React Native 0.88, TypeScript strict. **Android only.**
- Fully offline. The release manifest has `INTERNET` removed (see
  [Privacy](#privacy-and-play-data-safety)).
- Verdicts: SC 1.4.3 AA (4.5:1 normal, 3:1 large), SC 1.4.6 AAA (7:1 normal,
  4.5:1 large), SC 1.4.11 non-text (3:1).

## Honest limits (read before citing a number in an audit)

1. **Screenshots are not guaranteed to be sRGB.** WCAG contrast is defined on
   sRGB. On some Android devices (Display P3 panels, HDR content, some
   manufacturer screenshot paths) the pixel values stored in a screenshot can
   be in another colour space. The app reads the stored numbers and computes
   the sRGB formula on them; if the file is not sRGB, the result is only
   approximate. What the app does about it:
   - It reads the file header (PNG `sRGB`/`iCCP`/`cICP`/`gAMA`/`cHRM`, JPEG ICC)
     and shows a **warning** when the file is tagged non-sRGB or the profile is
     unidentifiable.
   - **An untagged file is not proof of sRGB.** Most Android screenshots are
     untagged; the app then assumes sRGB and says "untagged" on screen.
   - It cannot detect a device that writes P3 values into an untagged file.
     For a deliverable audit figure, confirm the value against the source
     (design tokens, CSS, a desktop colour picker on a known-sRGB capture).
1a. **A JPEG screenshot is not a faithful record of the screen.** MIUI, and
   other OEM skins, save screenshots as baseline JPEG with 4:2:0 chroma
   subsampling: colour is stored once per 2x2 block, luma per pixel. Measured
   by re-encoding `testdata/reference.png` with the settings read out of a real
   MIUI screenshot (quantisation tables all 1, 4:2:0) and comparing against the
   known originals:
   - **Neutral pixels are safe only while their BLOCK is neutral.** 0.18% of
     them changed at all. An earlier version of this README said a 1px
     alternating black/white stripe pattern "survived bit for bit", and gave
     the reason as `Cb = Cr = 128`, which subsampling cannot move. Both were
     wrong, and an independent audit caught it: 181 of the 72,000 pixels in
     that band changed, all of them in its last row, where the 2x2 chroma block
     reaches into the coloured band below and brings its chroma back.
     `#000000` decodes as `#2D0000`, turning a true 21.00:1 into 16.60:1 on an
     adjacent pair. The rows that are wholly inside the pattern did survive bit
     for bit. The mechanism is the one stated two bullets down — what matters
     is the chroma around a pixel, not the pixel's own colour — and the tool
     already behaves correctly here: the 3x3 spread at that pixel is 95, far
     over the threshold, so it warns and bands. Only the claim was wrong.
   - **Coloured pixels** moved by exactly one level in 98.42% of cases, but the
     **one-pixel rim at a colour edge** reached 93 levels. At two pixels or
     more from an edge the error falls back to one level for all but 14 pixels,
     and never exceeds 3 — which is the figure the threshold below is actually
     derived from. (This line used to say "falls back to one level" flatly,
     contradicting the correct statement a few lines later.)
   - Worst case: `#FF0000` decoded as `#A2243A`, turning a real **3.99:1**
     against white into a reported **7.36:1** — a 1.4.3 AA failure reported as
     a 1.4.6 AAA pass. The error is **not symmetric**: it overstates contrast,
     the one direction an accessibility tool must not drift in.
   What decides the risk is **not** whether the sampled pixel is coloured, but
   whether the colour around it *changes* — subsampling can only move a pixel
   by mixing it with a neighbour that differs. A large flat area of `#181C27`
   is safe; a grey pixel one step from a saturated edge is not. So the app
   measures the **chroma spread** over the sampled neighbourhood (one pixel
   wider than the sample) and acts only above a threshold taken from the
   measurements: every pixel whose real error reached 8 levels had a spread of
   at least 54.6, and no pixel under a spread of 16 exceeded 3 levels, so the
   threshold sits at **24**, in the empty gap.

   **That gap was a property of `testdata/reference.png`, not of JPEG**, and
   the window it was measured through was the wrong size. The reference image
   is large flat blocks and one neutral stripe band; it contains no thin
   coloured strokes, which is exactly the content an accessibility auditor
   measures. On text-like content the relationship inverts: the chroma field is
   smoothed across the whole stroke, so the error is large while the local
   variation left to measure is small.

   The fix was not a smaller threshold but a wider window. A 3x3 is the
   box-upsampling assumption — damage confined to the one-pixel rim. The
   decoder smears chroma about two pixels, so every window here is now sized
   from that radius instead. Measured across `reference.png` and two
   stroke-bearing images, same threshold of 24:

   | window | damaged pixels detected | undamaged pixels falsely flagged |
   | --- | --- | --- |
   | 3x3 (what shipped) | 81.1% | 0.4% |
   | **5x5 (now)** | **98.2%** | **2.2%** |
   | 7x7 | 98.2% | 4.4% |

   An independent audit re-ran this on its own corpus and got 85.0 / 97.6 /
   **99.3%** for detection: 7x7 does detect a little more, not nothing, and my
   own figures show it too — 6 pixels out of 10,392, which I rounded away. The
   false-alarm column is the one to be careful with: the same audit measured
   1.92 / 9.15 / 14.95% on a corpus that packs colour edges far more densely
   than real UI. **Both corpora agree on the ratio — about 5x going from 3x3 to
   5x5 — and disagree on the baseline, because the baseline is a property of
   the content.** On a realistic 320x480 dark-UI mock the gated share of all
   pixels goes 0.87% -> 1.73%, which is the figure worth quoting and is in line
   with the 1.97% measured on a real MIUI screenshot.

   5x5 is chosen on cost rather than on detection: 7x7 buys about 1.7 points
   and roughly doubles the false alarms again.

   The threshold itself is untouched, and that is now the open question rather
   than a settled choice — see "what remains" below.

   The same radius now feeds the candidate chromas. Previously the witness scan
   looked further than the chroma source, so a witness could certify that a
   colour existed undamaged nearby while its chroma was never offered as a
   candidate — existence without membership. One window removes that gap by
   construction.

   End to end, through the app's own code on real decoded pixels:

   | | text-like strokes | the 1px-stroke fixture |
   | --- | --- | --- |
   | damaged pixels tested | 7998 | 1276 |
   | slipped past the gate (silent) | **192** (was 1728) | **0** |
   | worst silent error | **37 levels** (was 104) | — |
   | silent errors of 40 levels or more | 0 *on this content* (was 320) | 0 |
   | refused outright | 3767 | 401 |
   | banded | 4039 | 875 |
   | **wrong verdicts from a band** | 0 *on this content* | 0 |
   | thresholds still answered | 99.3% | 89.3% |
   | mean band width | 1.33 | 1.37 |

   **What remains, and it is more than the table above suggests.** The two
   zeroes in that table are properties of my test content, not of the app. An
   independent audit re-ran the same code over a larger, edge-denser corpus
   and found:

   - **248 silent errors of 40 levels or more**, worst 84, of which 48 carry a
     wrong verdict. The concrete one: a `#1D4ED8` stroke decoding as `#3B4F84`,
     an 84-level error, shown as a single 7.23:1 with no warning at all against
     a true 6.08:1 — a pass at AAA on text that fails.
   - **20 wrong verdicts from bands**, where I measured none. Every one of them
     is a wrong *Fail*: the band understates contrast. So the claim that holds
     across both corpora is the narrower and more useful one — **no band has
     been observed to produce a wrong Pass.** For an auditor that is the
     direction that matters.

   **The threshold, re-derived.** Those surviving silent errors all sat just
   under the gate — the 84-level one at a spread of 23.4 against a threshold of
   24. That threshold was fitted to a 3x3 window on `reference.png` and was
   left alone when the window grew to 5x5, so it was gating a quantity it had
   never been measured against.

   `reference.png` cannot settle it: seven flat colours, no text, and one of
   them (`#FFFFFF`) sits 0.005 above the 4.5:1 threshold against the probe
   background, so a one-level wobble flips 90,000 pixels at once and swamps
   everything else. The measurement needed content this tool is actually used
   on, so it was made on a 360x640 mock of a settings screen: anti-aliased text
   at 12-18px, coloured labels and buttons on light cards over dark chrome,
   1591 distinct colours, 2.9% of pixels damaged after a 4:2:0 round trip.

   | threshold | silent wrong verdicts | undamaged pixels gated | refused |
   | --- | --- | --- | --- |
   | 24 (was) | 131 | 0.76% | 0.05% |
   | 16 | 30 | 1.13% | 0.06% |
   | **12 (now)** | **4** | 1.42% | 0.08% |
   | 8 | 4 | 1.82% | 0.08% |

   12 is where silent wrong verdicts reach their floor; below it nothing
   further is caught and the cost keeps rising. It is not a trade against
   utility either — among gated readings the share of criteria actually
   *answered* rises from 40.2% to 46.0%, because the extra readings it catches
   are mostly ones the band decides confidently. The whole cost is that 1.42%
   rather than 0.76% of undamaged pixels get a range instead of a single
   number.

   The same constant decides both "might this reading be damaged" and "is this
   pixel safe to witness another", deliberately: a pixel cannot coherently be
   at risk by one measure and a clean witness by the same measure at a
   different number.

   **Still true:** a reading taken on or near small coloured text can be
   silently wrong, and four such verdicts survive even at 12 on the content
   measured. Use a PNG screenshot for anything you intend to cite.

2. **Anti-aliasing and sub-pixel text.** The pixel you touch may be a blend of
   text and background. Zoom in and pick the solid core of a glyph stroke, or
   use the explicitly labelled averaged patch knowingly.
3. **Ratios are truncated, never rounded up.** 4.499 is shown as `4.49:1` and
   fails 4.5:1, as WCAG requires. Verdicts compare the unrounded ratio.
4. **Large text** (18pt / 14pt bold) is a human judgement; the app reports both
   the normal and the large thresholds and does not guess which applies.
5. The relative-luminance formula uses the `0.03928` threshold as written in
   WCAG 2.0/2.1. WCAG 2.2 errata mention `0.04045`; they give identical results
   for every 8-bit value (unit-tested).
6. Single-pixel and 3x3/5x5 average only, and only when you pick it. The average
   is taken in **linear light** (the mean of black and white is linear 0.5,
   about `#BCBCBC`, not `#808080`). The contrast ratio is computed from the
   **unrounded** average; the hex swatch is rounded for display only and is an
   approximation of a colour that may not exist anywhere in the image.
   Averaged points are marked with "≈" and "AVERAGE of N pixels" on screen.
6a. **Transparency.** If ANY sampled pixel (centre or neighbour) is not fully
   opaque, the app says so and shows **no ratio and no pass/fail**: the colour
   such a pixel shows depends on what is behind it, which a screenshot file
   cannot tell us. Pick an opaque area or a smaller sampling size.
7. Touch screen alignment: pixel-precise placement on a phone is hard. Zoom
   (pinch, or the +/- buttons; up to 64x) and use the nudge arrows to move the
   selected point by exactly one image pixel.

## How the pixel sampling works

`src/pixels.ts` is the only code that produces colours:

1. The image file's bytes are read (`expo-file-system`) and decoded by Skia
   (`Skia.Image.MakeImageFromEncoded`) to a bitmap at **full native resolution**.
2. `SkImage.readPixels(x, y, {width: 1, height: 1, RGBA_8888, Unpremul})`
   copies that one pixel out of the decoded bitmap. No view, canvas, GPU
   texture sample, or display scaling is involved.
3. The `ImageInfo` carries **no colour space** (the Skia JSI binding does not
   support setting one: `// TODO: color space not supported yet`). **UNVERIFIED:**
   what Skia does with a *tagged* source image in that case (return the stored
   numbers, or convert to sRGB) has not been confirmed and must be checked on a
   device with the reference images below. Until then, treat results for files
   tagged non-sRGB as unverified; the app warns about such files. The picker is called with
   `quality: 1` and no editing, so it hands over an unmodified copy.
4. Taps are mapped to pixels in `src/coords.ts`. The image is drawn into
   exactly the rectangle that `imageRect()` returns (contain-fit, centred,
   plus zoom/pan) and taps are inverted with the same rectangle, so
   letterboxing and zoom cannot make the picture and the sample disagree. A tap
   in the letterbox is ignored, not clamped onto an edge pixel.
5. The on-screen picture is only for aiming. Zoomed in, it uses
   nearest-neighbour so each pixel is a visible block.

### Verify it on your phone (do this once before trusting the app)

The pixel path is exercised by unit tests only for the maths and coordinate
mapping. The native Skia read has to be checked on a real device (this
project was scaffolded without an Android SDK or device). Two reference images
are in `testdata/`; copy them to the phone's gallery (USB, or any file
transfer) and open them in the app:

| Place A at (x, y) | Place B at (x, y) | Expected |
|---|---|---|
| 90, 50 | 270, 50 | `#000000` / `#FFFFFF`, **21.00:1**, all pass |
| 90, 150 | 270, 150 | `#767676` / `#FFFFFF`, **4.54:1**, AA normal pass, AAA normal fail |
| 90, 250 | 270, 250 | `#777777` / `#FFFFFF`, **4.47:1** (4.4778 truncated), AA normal FAIL |
| 100, 350 | 101, 350 | `#000000` / `#FFFFFF` (adjacent pixels), **21.00:1** |
| 90, 450 | 270, 450 | `#FF0000` / `#FFFFFF`, **3.99:1** (3.9985 truncated), AA normal fail, large text pass |
| 90, 550 | 270, 550 | `#1A73E8` / `#F1F3F4` |

Place points by touching, then nudge with the arrows until the on-screen
"Pixel x, y" matches. The 4th row proves there is no smoothing: if the app
resampled, adjacent pixels would read as grey, not pure black and white.

`reference-tagged.png` has the **same** pixels but carries `gAMA 1.0` (linear
light, not the sRGB transfer curve) and DCI-P3 primaries. The app must show the
**identical** hex values plus a "not sRGB" warning.

**Only rows 2, 3 and 6 can settle this.** Neutral black and white are invariant
under any colour transform, and saturated P3 red clips straight back to
`#FF0000`, so rows 1, 4 and 5 read the same whether or not the platform
converts. They prove the sampling and the absence of smoothing; they cannot
clear the colour-space question. These are the discriminating values:

| Row | Correct (no conversion) | What you see if the platform converts |
|---|---|---|
| 2 | `#767676` | `#B5B5B5` |
| 3 | `#777777` | `#B6B6B6` |
| 6 | `#1A73E8` / `#F1F3F4` | `#2AB6FB` / `#F9FAFA` |

The right-hand column is the exact result of treating the pixels as linear-light
DCI-P3 and converting to sRGB. If any of rows 2, 3 or 6 shows it, the platform
is colour managing behind our back: do not trust the app on that device and
report it.

Regenerate the images with `npm run reference-images` (needs `python3`).

## Install and run

Requires Node 20+ (tested with Node 22) and npm.

```bash
cd "16. aplicatie mobila android - inspector de accesibilitate"   # quote: spaces and dot
npm install
npm test             # contrast / coordinate / profile unit tests (no device needed)
npm run typecheck    # tsc --noEmit
```

### Run on a phone/emulator (no account needed, needs Android Studio SDK)

Expo Go cannot run this app (the share-target module is native), so you need a
development build. This needs the Android SDK (Android Studio), a USB-connected
device with USB debugging or an emulator, and **no Expo account**:

```bash
ALLOW_DEV_NETWORK=1 npx expo run:android      # debug build; keeps INTERNET so Metro can connect
npx expo run:android --variant release        # release build, offline manifest, signed with the debug key (testing only)
```

`ALLOW_DEV_NETWORK=1` is the only way INTERNET is allowed back in; never set it
for a build you distribute.

### Installable APK with EAS  (**needs an Expo account, which you do not have yet**)

```bash
npx eas-cli@latest login                       # NEEDS Expo account
npx eas-cli@latest build -p android --profile preview    # NEEDS Expo account; produces an installable APK
```

`eas.json` profiles: `development` (dev client APK), `preview` (**APK**,
internal distribution), `production` (AAB for Google Play; **needs a Play
Console account and a stable package name**, see below).

### Testing the share target

Install the app, take a screenshot, tap **Share** in the screenshot preview
notification (or in Photos) and choose **Contrast Inspector**. The image opens
directly. (`image/*`, single image.)

## Configuration notes

- `app.config.ts` (not `app.json`) so the network lock-down can depend on the
  build profile.
- Target **API 36 / Android 16** via `expo-build-properties`
  (`targetSdkVersion: 36`; verified in the generated Gradle config). Min SDK
  24 (React Native default). Edge-to-edge is handled with safe-area insets.
- **Package name** is `ro.dbg.a11y.contrast`, decided 2026-11-08 and now
  fixed. A Play package name can never change after the first upload: changing
  it ships a different app, with its installs, reviews and rating back at zero.
  The `a11y` segment leaves room for the rest of the set.
- Dark mode follows the system (`userInterfaceStyle: automatic` +
  `expo-system-ui`). Text uses default font scaling (no caps, no fixed heights
  on text); touch targets are 48 dp. Palettes are unit-tested for contrast.
- Orientation is unlocked. `allowBackup` is off.
- Permissions in the release APK: **none that a user ever sees.** Verified
  with `aapt2 dump permissions` on a real build, the only entry is
  `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, a private signature permission
  AndroidX adds for its own non-exported receivers. Removed explicitly:
  `INTERNET`, `ACCESS_NETWORK_STATE`, `SYSTEM_ALERT_WINDOW`, `CAMERA`,
  `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE`, `VIBRATE`. Images arrive
  through the picker and share sheet as per-file grants.
- `android/` and `ios/` are generated by `expo prebuild` and git-ignored.

## Privacy and Play Data Safety

No backend, accounts, analytics, crash reporting, ads or network calls. The
release manifest has no `INTERNET` permission, so the app cannot open a socket;
this is enforced by the build, not just by the code. Images are read in place
or from an app-private cache copy and never leave the device. The Data Safety
form can truthfully say: no data collected, no data shared. (Re-check the
merged manifest of the final AAB/APK with `aapt dump permissions` before
submitting, and re-check whenever you add a dependency.)

## Exporting a finding

"Share this finding" renders the reading as a PNG and hands it to the Android
share sheet. It exists because a screenshot of the app is a *worse* record:
the panel scrolls, so the warnings and the source details are usually not in
the picture, and the number travels without them.

![An exported evidence card: the crop with both points marked, both sampled
colours, the contrast ratio reported as the range 4.02 to 5.51 to 1, five WCAG
criteria of which two read Unknown, the full JPEG warning, and a footer naming
the file, its format, the sampling mode and the time.](docs/sample-evidence-card.png)

*An actual export, pulled back out of the device after it went through the
share sheet. Two criteria read **Unknown** because the band straddles their
threshold — the single stored value, 4.02:1, would have answered both. The
footer carries the picker-name caveat described below, which is what a card
looks like when the app cannot vouch for the filename.*

The card carries the crop with both points marked, the two sampled colours with
their hex, channels and pixel coordinates, the ratio **or the range**, the
per-criterion verdicts, every warning verbatim, and a footer naming the file,
its format and colour space, the sampling mode, the time with its UTC offset,
and the app version.

Three rules are enforced in `src/evidence.ts` rather than left to the layout,
and each has a test:

- **warnings are never dropped**, including when there is no ratio at all;
- where a band exists **the range is the headline**, and the figure read
  straight off the file appears only as a subordinate note;
- a suppressed result exports as one, with its reason and with no verdicts to
  be quoted out of context.

What the screen shows and what the card says come from one pure function
(`src/report.ts`), so they cannot drift apart.

**The filename is only as good as the route in.** A share intent carries the
real name. `expo-image-picker` copies the file into the app's cache first and
reports the COPY's name, which on Android is the MediaStore id — `26.jpg`, not
`edge-420.jpg`. Printing that as the filename would make the record quietly
false, so a card from the picker route carries a line saying where the name
came from and how to get a traceable one. Use Share → Contrast Inspector when
the finding has to be cited.

The file is written to the app's cache and shared from there, which needs no
storage permission — `READ/WRITE_EXTERNAL_STORAGE` stay blocked.

## Not included

- **STRETCH, left out: 44x44 dp target-size overlay (SC 2.5.5).** Omitted to
  avoid any risk to sampling accuracy. Note that SC 2.5.5 is AAA; AA is
  SC 2.5.8 (24x24 CSS px).
- Camera capture (deliberately, see the brief).
- iOS (not configured, not tested).
- Multi-image share (`SEND_MULTIPLE`), WebP/HEIC colour-space inspection
  (decoding works if the OS decodes them; the warning says "not inspected").
- TalkBack: buttons, results and warnings are labelled, and the nudge arrows
  allow non-touch point adjustment, but placing the first point requires
  touching the image.

## Layout

```
App.tsx               screen, picker, share-intent handling
app.config.ts         Expo config (API 36, share target, network lock-down)
eas.json              development / preview (APK) / production (AAB)
src/contrast.ts       WCAG maths and verdicts (pure, tested)
src/coords.ts         view <-> pixel mapping, zoom, pan (pure, tested)
src/patch.ts          explicit averaged patch (pure, tested)
src/colourProfile.ts  PNG/JPEG colour-space detection (pure, tested)
src/pixels.ts         Skia decode + readPixels  (the load-bearing file)
src/Viewer.tsx        Skia canvas, gestures, markers
src/Results.tsx       swatches, ratio, verdicts, warnings
testdata/             reference images + tools/make-reference-images.py
__tests__/            Jest tests
```
