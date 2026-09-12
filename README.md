<div align="center">

# Signatum

**QR codes with your brand in the middle — proven to scan before they leave your machine.**

Payload kinds · Logo placement engine · Independent scan gate · Brand kits · Batch · Print sizing
No cloud. No account. No telemetry. No redirect. The code is a file you own.

[![CI](https://github.com/alexjustino/signatum/actions/workflows/ci.yml/badge.svg)](https://github.com/alexjustino/signatum/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg)](#requirements)

</div>

---

> **Status: pre-release.** Signatum is being built in public, one vertical slice at a time.
> Nothing on this page is claimed as working until the slice that carries it has landed and
> says so. See [the roadmap](#roadmap) for what each release holds.

## Why

QR codes with a company logo in the middle are everywhere now — on business cards, menus,
packaging, slides, doors. Most of the tools that make them fail in one of four ways.

**Online generators** want an account, route the code through their own redirect so they can
count the scans, and stop working when the subscription does.
**Design tools** place a logo over the code and have no idea whether it still scans.
**Libraries** encode correctly and leave the logo, the colours and the print size to you.
And **every one of them** will happily export a code that a phone cannot read — the logo a
little too big, the colours a little too close, the print a little too small — and nobody finds
out until it is on ten thousand flyers.

A code is a payload, a look and a size. Signatum builds it, puts the brand in the middle, and
**proves it scans before it lets it out** — local, offline, no account, no redirect, shaped like
a native Windows 11 application.

The move none of them make: **nothing is exported that an independent decoder did not read back,
byte for byte, at the size it will be printed.** The logo is not decoration laid on top; it is
placed by an engine that knows which modules the code cannot lose.

## What exists today

F0 has landed, and it is the whole promise on one screen: type a web link, watch it become a QR
code, and export it as a PNG — but only after an independent decoder has rasterised that exact
drawing, read it back, and matched it against the link byte for byte. A code that does not read
back is refused, with the reason in a sentence, and no file is written. The end-to-end suite
proves it against the real binary, decoding the exported file from disk with a third decoder that
shares no code with either of the other two.

Behind it, F1 has proven the matrix itself: every one of the forty versions, at each of the four
levels of error correction, under each of the eight mask patterns, checked against the standard's
own tables — and ten thousand randomised codes read back, byte for byte, by the same decoder that
ships inside the product.

F2 has widened what a code can carry: seven kinds — link, plain text, e-mail, phone, SMS, Wi-Fi
network and location — each written in the exact form phones read, each escaped to its own format,
and each with one line under the form saying what scanning it will do. The kind is chosen at the
top of the screen, and every kind keeps its own draft, so trying one does not cost what was typed
in another.

F3 has added the eighth kind, and the one that is most often printed on paper: a contact card. The
eight kinds now include it, in whichever of three forms the address book on the other side reads —
vCard 3.0 by default, vCard 4.0, or MECARD when the code has to be small — with every field escaped
to its format and long lines wrapped where the standard wraps them. A number on a card must carry
its country code, because a card travels. And beside the preview, the screen now says when a code
would be printed too dense to scan: how small its modules would be at a nominal 25 mm, and a
warning below half a millimetre. That is a warning and never a refusal; the decoder still decides
whether a code may leave.

F4 has put the brand in the middle. A logo is imported from a PNG, JPEG, GIF, WebP or SVG — what
the file is comes from its bytes, never from its name — and nothing that arrives is kept as it
arrived: a photograph is decoded, capped and written out again as a PNG this product made, and an
SVG is parsed into a drawing and re-serialised from it. A file that cannot be used is refused with
a sentence about that file, and nothing is stored from it. The logo is then drawn onto the pixels
**before** the decoder is asked, so the code that read back is the code that carries it, and the
exported file is those same bytes. A plate — none, square, rounded or circle — is part of the code
itself rather than a decoration over it, and a code with a logo is encoded at the strongest error
correction the standard offers.

F5 has worked out how large the logo may really be, and it is arithmetic rather than taste. A QR
code carries a fixed amount of error correction, and a logo spends it: the engine counts, before
anything is drawn, how much of that budget a given size would cost the worst-affected block, and
allows the largest centred square that stays within it — keeping four tenths of what the code could
correct in reserve for the smudged print, the bad angle and the cheap camera. It knows where every
part of a code that cannot be lost sits, on all forty sizes — the corner squares, the timing lines,
the alignment squares, the strip that says how the code was drawn — and stops before reaching one.
The modules the logo covers are cleared, whole ones only, so no half module survives at the edge of
the plate; the pattern the code is drawn through is then chosen again, on the code as it will
really be printed; and the error-correction level and the size of the code are chosen for the logo,
never the smallest code and never weaker than the content forces. A logo that will not fit is
refused with the reason — which pattern it would reach, or by how much it is over the budget —
rather than quietly shrunk, and a smaller logo can be asked for, never a larger one. One decision
in it is not yet settled and is written down as such: the small alignment square that some sizes of
code place exactly in the middle is allowed to go under the logo, because refusing it would push
the code to a far larger size, and whether real phone cameras agree is proved with two phones
before it is accepted.

F6 has given the code a look, and put a gate in front of it. Both colours can be chosen — they are
the colours of the print rather than of the application's theme, and they are the same in a light
window as in a dark one, because paper has no theme — and the pair is measured before the code is
built: colours too close together are refused with the contrast they reached against the 4.5 a
camera needs, and a code lighter than the plate it sits on is refused however strong the contrast,
because phone cameras look for a dark code on a light background and several will not turn the
picture over to find one. The modules can be square, softened at the corners or drawn as separate
dots, and the three large squares in the corners square, rounded or round. What keeps its shape is
what a camera navigates by — the lines of alternating modules between those corners, the small
alignment squares, the strip that records how the code was drawn — because a scanner finds the grid
by measuring those runs, and a row of dots is not a run. All nine combinations of module and corner
shape are rasterised and read back by an independent decoder on every run of the suite, and a code
nobody restyled is drawn exactly as it was before, to the byte. The blank margin around the code is
a choice too, with a sentence under the four modules the standard asks for and a blunter one when
there is none at all — a warning and never a refusal, since what decides whether a code may leave is
still the decoder that reads it back.

What it does not do yet: a fixed 1024-pixel square rather than a physical size; PNG and nothing
else; an error-correction level chosen for you rather than raised by hand; and no code is saved — close the window and the code is gone,
though the logos imported stay in the workspace. Those are the slices that follow.

The specification, with a proof of done per slice, is [`docs/SPEC.md`](docs/SPEC.md).

## What is planned

For 1.0.0, and nothing beyond it:

- **Payload kinds** — web link (with presets for WhatsApp, Instagram, LinkedIn and Google
  Maps), plain text, e-mail, phone, SMS, Wi-Fi network, geographic location and contact card
  (vCard 3.0 and 4.0, MECARD for density). Each kind validates and escapes to its own format,
  and the preview says in one line what scanning it will do.
- **The logo** — imported from PNG, JPEG, GIF (first frame, and it says so), WebP or SVG;
  centred on a plate (none, square, rounded, circle) with its own padding and colour; sized
  automatically to the largest the code can carry, or smaller by choice — never larger.
- **The scan gate** — every code is decoded by an independent decoder before it can be
  exported. A code that does not decode to the exact payload cannot be saved, copied or
  exported, and the screen says why. A scan margin reports how it holds up when shrunk, blurred
  and recompressed.
- **Look** — foreground and background colours with a contrast gate, module shape (square,
  rounded, dot), finder shape, quiet zone, and an error-correction level chosen automatically
  when there is a logo and overridable upward only.
- **Size as an input** — the code is designed for a physical size in millimetres or inches at a
  chosen resolution, with the module size shown and a warning when it is too small to scan at a
  sensible distance.
- **Export** — SVG (vector, logo embedded), PNG (at a resolution, with the physical size written
  into the file), PDF (at the exact physical size), and copy to the clipboard.
- **Library and brand kits** — saved codes reopened exactly as they were; a brand kit is a logo,
  colours and a style, applied to a new code in one click.
- **Batch** — a CSV of contacts or links becomes one verified file per row, with a report of
  every row that could not be made and why.
- **Read** — open any image of a QR code and see what it contains, what it would do, how it was
  built (version, error correction, mask), and whether it would scan at a given size.

## The name

**Signatum** is Latin, the neuter participle of _signare_ — to mark, to seal, to sign: _what has
been marked and sealed_. _Aes signatum_ was Rome's first stamped bronze, metal carrying the
state's mark as proof of its weight — a mark that certifies.

Pronounced sig-NAH-tum in English and sig-NÁ-tum in Portuguese, without ambiguity in either.

## Security

This product opens files people receive from other people — a logo from a marketing folder, an
SVG from a website, a CSV from a colleague — and writes codes that other people's phones will
act on. The rules, from the first slice:

- **No network.** The product never contacts the address a code opens, fetches no favicon,
  previews no link and checks for no update.
- **SVG is hostile.** It is parsed into a normalised tree with no scripts, no event handlers, no
  external references and no entities. What is exported is re-serialised from that tree, never
  the bytes that came in.
- **Raster is hostile.** Dimensions are read from the header and capped before a pixel is
  decoded.
- **Payloads are escaped to their format.** A name with a semicolon does not become a second
  vCard field.
- **Links are shown as they will resolve**, in Unicode and punycode, so a look-alike domain is
  visible before it is printed.

The threat model is [`SECURITY.md`](SECURITY.md). The decisions behind it are
[`docs/architecture/ADR.md`](docs/architecture/ADR.md).

## Privacy

Signatum makes **no network requests**. There is no account, no sync, no analytics, no crash
reporting and no update check. Nothing you type is sent anywhere, and no code it makes routes a
scan through a server that could count it.

Your data lives in a single SQLite file under your user profile. Wi-Fi passwords, if you choose
to save them, are stored locally in the clear — the screen says so where the password is typed.

## Design

Signatum is built to look like it belongs on Windows 11, not like a web page in a frame: Mica
window material, the **system accent colour** read from Windows and followed live, rounded
corners, a custom title bar, Segoe UI Variable, Fluent motion curves, and a single icon set
(Fluent UI System Icons). Light and dark themes follow the system. Everything is reachable from
the keyboard with focus shown, and `prefers-reduced-motion` is honoured everywhere.

The UI contract is [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Requirements

- Windows 11 (Windows 10 21H2+ works; Mica falls back to a solid surface)
- The WebView2 runtime, which Windows 11 always has. On a machine without it the installer
  fetches it, which needs a network connection **once, at install time**. Nothing the product
  does afterwards touches a network.

Installers, when they arrive, will not be code-signed, so SmartScreen will warn on first run.
Verify the download came from the Releases page of this repository.

Building needs Node.js 22+, a stable Rust toolchain with the MSVC build tools, and PowerShell 7.

## Getting started

```bash
git clone https://github.com/alexjustino/signatum.git
cd signatum
npm install
npm run tauri dev
```

Run the full validation battery exactly as CI does:

```bash
npm run gates
```

## Roadmap

| Release   | Theme               | Contents                                                                                                  |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The mark            | the list above                                                                                            |
| 1.1.0     | The card            | business-card and badge layouts (print-ready PDF sheets) · frames with a call to action · calendar events |
| 1.2.0     | The payment         | PIX BR Code (EMV, CRC16) · EPC SEPA · payload templates per country                                       |
| 2.0       | Only if it earns it | macOS and Linux                                                                                           |

Deliberately out of scope: **dynamic codes are refused on principle, not deferred** — a dynamic
code is a redirect through a server that learns who scanned what, when, and that is precisely the
product this is not. Along with them: redirects and scan analytics, URL shorteners, an account or
sync, AI-generated "artistic" codes, animated output, other symbologies (Micro QR, rMQR, Data
Matrix, barcodes), payment codes before 1.2, a business-card layout designer, plugins and
auto-update.

The full specification lives in [`docs/SPEC.md`](docs/SPEC.md); binding architecture decisions in
[`docs/architecture/ADR.md`](docs/architecture/ADR.md); the schema in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md); the UI contract in
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it covers the branch model, Conventional
Commits, the architectural boundary rule, the security rule, and the validation gates that must
be green before anything is merged. Security reports go through [`SECURITY.md`](SECURITY.md),
never a public issue.

## Licence

Licensed under the **Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

Copyright 2026 Alex Justino.

_"Signatum" is a trademark of Alex Justino. The licence grants rights to the source code; it does
not grant permission to use the project name, logo or wordmark to endorse or promote derived
products (Apache-2.0 §6)._

_"QR Code" is a registered trademark of DENSO WAVE INCORPORATED. Signatum is not affiliated with
or endorsed by DENSO WAVE._
