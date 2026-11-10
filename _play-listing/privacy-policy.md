# Privacy policy — Contrast Inspector

**Effective date:** [DATE OF PUBLICATION]
**Developer:** [LEGAL NAME OF THE PFA, as it will appear on the Play account]
**Contact:** [CONTACT EMAIL — the one you are willing to show publicly]

## The short version

Contrast Inspector collects nothing, sends nothing, and stores nothing about
you. It has no network permission, so it cannot transmit anything even if it
were asked to.

## What the app does with your images

You give the app a screenshot, either by sharing one to it or by choosing one
through the system picker. The app reads that image to measure the colour of
the two points you select.

- The image is read from where you chose it. It is not copied into the app's
  own storage, except where the system picker itself makes a temporary copy to
  hand it over.
- Measurement happens entirely on the device.
- Nothing about the image, its contents, or your measurements is sent anywhere.
- The app keeps no history. Closing it discards the image and the points.

## The evidence card you export

When you export a finding, the app renders one PNG into its private cache
folder and hands it to Android's share sheet. From that point it is yours: it
goes wherever you send it, and the app has no part in that. The previous
exported file is deleted when you export again.

The card contains what you measured — the two colours, their coordinates, the
ratio, the WCAG verdicts, the source file's name and dimensions, and any
warnings that applied. It contains no identifier of you or of your device.

## Permissions

The app requests **no permissions**. The single entry in its manifest is the
internal broadcast-receiver permission Android generates for every application;
there is nothing for you to grant or refuse.

In particular it does **not** hold the INTERNET permission. The operating
system will refuse any network access by this app, which is a stronger
guarantee than a promise in a document.

Storage permissions are blocked deliberately. Images reach the app through the
system picker or the share sheet, which grant access to one file at a time.

## Analytics, advertising, accounts

There are none. No analytics or crash-reporting library is included, there is
no advertising, and there is no account to create or sign in to.

## Children

The app collects no data from anyone, including children.

## Changes

If this policy changes, the new version will be published at this address with
a new effective date.

## Contact

[CONTACT EMAIL]
