# Play Store listing — Contrast Inspector

Everything the listing needs that does NOT require the Play Console account,
prepared so that publishing is a copy-and-upload rather than a day's work.

## Ready

| Item | File | Checked against |
| --- | --- | --- |
| App name (18/30) | `name.txt` | limit from Google's store-listing help page |
| Short description (77/80) | `short-description.txt` | same |
| Full description (3035/4000) | `full-description.txt` | same; privacy claims read off the built APK with `aapt2 dump permissions` |
| Store icon | `graphics/icon-512.png` | 512×512, 32-bit PNG with alpha |
| Feature graphic | `graphics/feature-graphic-1024x500.png` | 1024×500, 24-bit PNG, no alpha; its own text measured at 13.72:1 and 5.83:1 |
| Screenshots (8) | `screenshots/` | 1250×2400, 24-bit, no alpha |
| Data safety answers | `data-safety.md` | each answer says what it rests on |
| Content rating | in `data-safety.md` | |

**The screenshots were re-sized on purpose.** Play requires each side between
320 and 3840 px, with the longer side at most twice the shorter. The originals
are 1080×2400, a ratio of 2.22, and would have been refused. They are padded to
1250×2400 (1.92) with each image's own background colour rather than cropped,
so no content is lost and the join is invisible.

## Needs a decision before it can be finished

`privacy-policy.md` is written and complete except for three things that are
not mine to choose:

- **The legal name** that will appear on the Play account.
- **A contact email** that you are willing to show publicly — Play displays the
  developer contact on the listing, and the policy needs one too.
- **The effective date**, which is the day it goes up.

It then has to be served at a public URL. `dbg.ro` is the obvious host.

## Still blocked

- The Play Console account itself (waiting on D-U-N-S).
- Play App Signing enrolment, and therefore the upload key.
- A release **AAB** — new apps cannot be uploaded as APKs. The build currently
  produces an APK; the switch is a build-config change, best made at the same
  time as the signing key so the whole thing is verified once.
