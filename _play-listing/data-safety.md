# Data safety answers — Contrast Inspector

How to answer Play Console's Data safety form, and why each answer is what it
is. Google holds you to these answers, so each one below says what it rests on.

## Does your app collect or share any of the required user data types?

**No.**

Play defines "collect" as transmitting data off the device, and "share" as
transferring it to a third party. This app does neither, and cannot: it holds
no INTERNET permission, so the operating system refuses network access to it.
That is checkable by anyone — `aapt2 dump permissions` on the APK lists one
entry, the internal broadcast-receiver permission Android generates for every
app.

Reading a photo is not collecting it. The app opens the screenshot you choose,
measures two pixels, and keeps nothing. Play's own guidance draws the line at
transmission off the device, and nothing leaves.

Because the first answer is No, the form ends here. The sections below are the
reasoning you may be asked for, and the answers to the questions that appear
anyway.

## Data types — none

| Category | Collected | Shared | Why |
| --- | --- | --- | --- |
| Photos and videos | No | No | The chosen image is read and measured on the device, then discarded |
| Files and docs | No | No | Same; the exported card goes only where you send it |
| Personal info, financial info, location, contacts, messages, calendar | No | No | Never touched |
| App activity, app info and performance | No | No | No analytics or crash reporting is present |
| Device or other identifiers | No | No | None is read |

## The export, explained in case it is queried

Exporting a finding writes one PNG into the app's private cache and hands it to
the system share sheet. The user then chooses where it goes. That transfer is
the user's action through an OS surface, not a transmission by this app, and
the card carries no identifier of the user or the device. The previous export
is deleted when a new one is made.

## Security practices

- **Is data encrypted in transit?** Not applicable: no data is transmitted.
- **Can users request data deletion?** Not applicable: nothing is held. Removing
  the app removes its cache with it.
- **Committed to Play Families policy?** No — this is not a children's app, and
  it is not targeted at them.
- **Independent security review?** No.

## Ads, purchases, account

- Contains ads: **No**
- In-app purchases: **No**
- Account creation or sign-in: **No**

## Content rating questionnaire

A utility with no user-generated content, no communication features, no
purchases and no ads. Every question about violence, sexuality, substances,
gambling and user interaction answers No. The expected outcome is the lowest
rating in every region.
