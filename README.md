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
   - **Neutral pixels are safe.** 0.18% changed at all, and a 1px alternating
     black/white stripe pattern survived bit for bit. Neutral means
     `Cb = Cr = 128`, which subsampling cannot move.
   - **Coloured pixels** moved by exactly one level in 98.42% of cases, but the
     **one-pixel rim at a colour edge** reached 93 levels. At two pixels or
     more from an edge the error falls back to one level.
   - Worst case: `#FF0000` decoded as `#A2243A`, turning a real **4.00:1**
     against white into a reported **7.37:1** — a 1.4.3 AA failure reported as
     a 1.4.6 AAA pass. The error is **not symmetric**: it overstates contrast,
     the one direction an accessibility tool must not drift in.
   What decides the risk is **not** whether the sampled pixel is coloured, but
   whether the colour around it *changes* — subsampling can only move a pixel
   by mixing it with a neighbour that differs. A large flat area of `#181C27`
   is safe; a grey pixel one step from a saturated edge is not. So the app
   measures the **chroma spread** over the sampled neighbourhood (one pixel
   wider than the sample) and warns only above a threshold taken from the
   measurements: every pixel whose real error reached 8 levels had a spread of
   at least 54.6, and no pixel under a spread of 16 exceeded 3 levels, so the
   threshold sits at **24**, in the empty gap. On a real MIUI screenshot that
   fires on 1.97% of pixels; on flat dark chrome (`#181C27`) the median spread
   is 1.2. Move the point two or more pixels inside a single flat colour — but
   **thin coloured text has no inside**, so for a figure you intend to cite,
   use a PNG screenshot.
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
- **Package name** is `ro.dbg.contrastinspector`: a placeholder chosen from
  your domain. **Change it before the first Play upload if you want something
  else; it can never be changed afterwards.**
- Dark mode follows the system (`userInterfaceStyle: automatic` +
  `expo-system-ui`). Text uses default font scaling (no caps, no fixed heights
  on text); touch targets are 48 dp. Palettes are unit-tested for contrast.
- Orientation is unlocked. `allowBackup` is off.
- Permissions in the release manifest: only `VIBRATE`. Removed explicitly:
  `INTERNET`, `ACCESS_NETWORK_STATE`, `SYSTEM_ALERT_WINDOW`, `CAMERA`,
  `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE`. Images arrive through the
  picker and share sheet as per-file grants.
- `android/` and `ios/` are generated by `expo prebuild` and git-ignored.

## Privacy and Play Data Safety

No backend, accounts, analytics, crash reporting, ads or network calls. The
release manifest has no `INTERNET` permission, so the app cannot open a socket;
this is enforced by the build, not just by the code. Images are read in place
or from an app-private cache copy and never leave the device. The Data Safety
form can truthfully say: no data collected, no data shared. (Re-check the
merged manifest of the final AAB/APK with `aapt dump permissions` before
submitting, and re-check whenever you add a dependency.)

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
