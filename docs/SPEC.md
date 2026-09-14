# Signatum — product specification, v1.0.0

The single source of what the product is and what "done" means for it. Architecture rationale
lives in [`architecture/ADR.md`](architecture/ADR.md), the schema in
[`DATA_MODEL.md`](DATA_MODEL.md), the UI contract in [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md),
the threat model in [`../SECURITY.md`](../SECURITY.md).

## 0. The name — Signatum

**Signatum** — Latin, the neuter participle of _signare_ (to mark, to seal, to sign): _what has
been marked and sealed_. _Aes signatum_ was Rome's first stamped bronze — metal carrying the
state's mark as proof of its weight, a mark that certifies. Pronounced sig-NAH-tum in English and
sig-NÁ-tum in Portuguese, without ambiguity in either. It sits beside **Tessera** (Latin: the tile
of a mosaic, and in Rome the token that proved who a guest was) and **Deskstart** (a plain compound
that says what it does) in register, without reading as a sub-brand of either.

The name was decided on 2026-09-11, before this repository existed, and was cleared on that date
against the registries a public product has to live in: GitHub, npm, crates.io, the Microsoft
Store, the `.app`/`.dev`/`.com` domains, and the USPTO and INPI trademark databases. No live
software product, package or trademark in the software classes carried the name; the sweep is
repeated once before 1.0.0 is published (risk R8).

_QR Code_ is a registered trademark of DENSO WAVE INCORPORATED. It is not part of the name, and the
notice is in the README and in About.

## 1. Thesis

QR codes with a company logo in the middle are everywhere now — on business cards, menus,
packaging, slides, doors. Most of the tools that make them fail in one of four ways. **Online
generators** want an account, route the code through their own redirect so they can count the
scans, and stop working when the subscription does. **Design tools** place a logo over the code
and have no idea whether it still scans. **Libraries** encode correctly and leave the logo, the
colours and the print size to you. And **every one of them** will happily export a code that a
phone cannot read — the logo a little too big, the colours a little too close, the print a little
too small — and nobody finds out until it is on ten thousand flyers.

> A **code** is a payload, a look and a size. Signatum builds it, puts the brand in the middle, and
> **proves it scans before it lets it out** — local, offline, no account, no redirect, shaped
> like a native Windows 11 application.

The move none of them make: **nothing is exported that an independent decoder did not read back,
byte for byte, at the size it will be printed.** The logo is not decoration laid on top; it is
placed by an engine that knows which modules the code cannot lose.

## 2. Scope

### In 1.0.0

1. **Payload kinds** — web link (with presets: WhatsApp, Instagram, LinkedIn, Google Maps),
   plain text, e-mail, phone, SMS, Wi-Fi network, geographic location, and **contact card**
   (vCard 3.0 and 4.0, MECARD for density). Each kind validates and escapes to its format, and
   the preview says in one line what scanning it will do: _"Opens example.com"_, _"Joins
   Office-5G"_, _"Adds Ana Souza to contacts"_. A number on a card carries its country code —
   a card travels, and a national number is a local number on whatever phone reads it
   ([ADR-022](architecture/ADR.md#adr-022)).
2. **The logo** — import PNG, JPEG, GIF (first frame, and it says so), WebP and SVG. Centred on
   a plate (none, square, rounded, circle) with its own padding and colour. Sized automatically
   to the largest the code can carry, or smaller by choice — never larger.
3. **The scan gate** — every code is decoded by an independent decoder before it can be exported;
   a code that does not decode to the exact payload cannot be saved, copied or exported, and the
   screen says why. A **scan margin** reports how it holds up when shrunk, blurred and
   recompressed.
4. **Look** — foreground and background colours with a contrast gate, module shape (square,
   rounded, dot), finder shape, quiet zone, and error-correction level (chosen automatically when
   there is a logo, overridable upward only).
5. **Size is an input** — the code is designed for a physical size (millimetres or inches) and a
   resolution, with the module size shown and a warning when it is too small to scan at a sensible
   distance.
6. **Export** — SVG (vector, logo embedded), PNG (at a resolution, with the physical size written
   into the file), PDF (at the exact physical size), and copy to the clipboard.
7. **Library and brand kits** — saved codes, reopened exactly as they were; a **brand kit** is a
   logo, colours and a style, applied to a new code in one click.
8. **Batch** — a CSV of contacts or links becomes one verified file per row, with a report of
   every row that could not be made and why.
9. **Read** — open any image of a QR code and see what it contains, what it would do, how it was
   built (version, error correction, mask) and whether it would scan at a given size.

### Deliberately not in 1.0.0

Dynamic codes, redirects and scan analytics · URL shorteners · an account or sync · AI-generated
"artistic" codes · animated output · other symbologies (Micro QR, rMQR, Data Matrix, barcodes) ·
payment codes (PIX BR Code, EPC) · a business-card layout designer · calendar events · macOS and
Linux · plugins · auto-update.

> **Dynamic codes are not deferred for lack of time.** A dynamic code is a redirect through a
> server that learns who scanned what, when. That is precisely the product this is not.

> **Nothing enters 1.0.0 without something leaving it.** The payload, the logo and the scan gate
> are the product; everything else waits for a release that earns it.

### The release train

| Release   | Theme               | Contents                                                                                                  |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The mark            | the list above                                                                                            |
| 1.1.0     | The card            | business-card and badge layouts (print-ready PDF sheets) · frames with a call to action · calendar events |
| 1.2.0     | The payment         | PIX BR Code (EMV, CRC16) · EPC SEPA · payload templates per country                                       |
| 2.0       | Only if it earns it | macOS and Linux                                                                                           |

## 3. Architecture

```
src-tauri/  (Rust — only what needs the operating system, or must not trust the webview)
  db/        migrations · repositories (codes, brand kits, logos, batches, batch rows)
  imaging/   logo decoding with limits (raster) · SVG normalisation (no scripts, no external
             resources) · rasterisation · the INDEPENDENT decoder · degraded-scan variants ·
             PNG (with pHYs) and PDF writers
  commands/  #[tauri::command] — the typed boundary; export refuses bytes it did not verify
src/  (TypeScript)
  data/      command client + TanStack Query — the only layer that knows @tauri-apps
  domain/    payload builders, validators and escaping (URL, vCard, MECARD, Wi-Fi, SMS, geo…) ·
             the QR matrix (versions 1–40, error correction L/M/Q/H, modes, masks and penalty) ·
             the function-pattern map · the logo placement engine (safe region, knock-out,
             plate, budget) · style → an SVG scene · physical sizing · CSV batch planner — PURE
  ui/        design system: tokens and canonical primitives
  features/  one directory per module (create, library, brands, batch, read, settings, about)
  app/       composition, routes, shortcuts, window lifecycle
```

**The boundary rule** (ADR-003): `src/domain/` never imports `data/`, `ui/`, `features/`, `react`
or `@tauri-apps/*`, and performs no I/O. Enforced by ESLint and by an architecture test.

**The scan gate** (ADR-010, ADR-011): the domain produces the code and its scene; the **host**
rasterises the exact bytes that will be written, decodes them with a decoder of a **different
lineage** from the encoder, and compares the result with the payload byte for byte. Only then does
the export command write the file — and it writes the bytes it verified, not a re-render. A
verifier built from the same code as the encoder would share its mistakes; independence is the
point.

**The placement engine** (ADR-013; the middle alignment pattern, ADR-024): the logo is a region
of the matrix, not an image on top. The engine knows every function pattern — the three finders
and their separators, timing, the alignment patterns, format and version information, the dark
module — and **never covers one**, with the single exception that second record names.
It sizes the logo from the error-correction budget with a safety factor, knocks out the covered
modules so no half-module shows at the edge of the plate, re-evaluates the mask with the knock-out
in place, and raises the error-correction level if the logo needs it. A logo that cannot fit is
refused with the reason, not squeezed.

**Libraries** (ADR-019, Accepted — versions, licences and the reasoning are in that record, and
the list a person sees is `NOTICE`): the encoder is Project Nayuki's QR Code generator (MIT),
vendored into `domain/` and pinned to an upstream commit by hash; the decoder in the host is
`rqrr` (pure Rust, a port of quirc); SVG is rasterised by `resvg`/`usvg` with default features
off, so no font or raster decoder is compiled in; PNG in and out is `image` with only the `png`
feature. The end-to-end suite decodes exported files with **a third** decoder, `jsQR`, in the test
process — a lineage shared with neither of the other two. PDF is not chosen yet: it belongs to
F7.

The schema is in [`DATA_MODEL.md`](DATA_MODEL.md).

## 4. Non-functional requirements

| Requirement                          | Target                                           | How it is measured                          |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------- |
| Cold start                           | < 1.5 s to a usable window                       | release build, timed                        |
| Preview after a keystroke            | < 50 ms for version ≤ 10                         | benchmark in Vitest, **3× headroom** for CI |
| Verify and export one code           | < 500 ms at 2 000 px                             | end-to-end, release build                   |
| Batch                                | 500 contact cards verified and written in < 60 s | end-to-end, release build                   |
| Hostile logo refused                 | < 1 s, never a crash or a hang                   | corpus test in `cargo test`                 |
| Installer                            | < 20 MB                                          | release gate (`check:bundle`)               |
| **Nothing leaves that did not scan** | **requirement one**                              | gate in the domain **and** in the host      |

A code generator that exports a code that does not scan is not a code generator. The scan gate is
a correctness requirement, not a feature.

## 5. Security and privacy

This product **opens files people receive from other people** — logos from a marketing folder, an
SVG from a website, a CSV from HR — and **writes codes that other people's phones will act on**.
The threat model in [`../SECURITY.md`](../SECURITY.md) is written in F0, before the first logo is
opened, and holds:

- **No network.** No account, no telemetry, no crash reporting, no update check, no link preview,
  no favicon fetched for a URL, no shortener. The product never contacts the address a code opens.
- **SVG is hostile.** Parsed into a normalised tree that has no scripts, no event handlers, no
  external references, no `foreignObject` and no entities; limits on size and node count. What is
  exported is **re-serialised from that tree**, never the bytes that came in.
- **Raster is hostile.** Dimensions read from the header and capped before a pixel is decoded
  (decompression bombs); frame count capped for GIF; a truncated or mislabelled file is a sentence.
- **Payloads are escaped to their format** — vCard, MECARD and Wi-Fi each have reserved
  characters, and a name with a semicolon must not become a second field; in a `mailto:`, the name
  before the @ is percent-encoded exactly as the subject and the body are, so a `?` inside an
  address cannot become a second field either.
- **Links are shown as they will resolve.** Only `http` and `https` (and the payload kinds' own
  schemes: `mailto`, `tel`, `SMSTO`, `geo`, `WIFI`); an internationalised domain is shown in
  Unicode **and** punycode — `bücher.example (xn--bcher-kva.example)` — on the Create screen and
  on Read alike (F10), so a look-alike domain is visible before it is printed.
- **Batch files stay in the folder chosen.** File names built from CSV cells are sanitised; no path
  separator, no `..`, no reserved Windows name reaches the filesystem. The batch **report** is
  itself a CSV and is written with formula injection neutralised (`=`, `+`, `-`, `@`).
- **Wi-Fi passwords are stored locally, in the clear, unless the person chooses not to save them.**
  The screen says so where the password is typed.
- **Minimum capabilities.** Tauri capabilities declared one by one; files are read and written only
  through paths the person chose in a dialog.

Out of the threat model, stated plainly: an attacker with write access to the Windows user account
can edit the database and the logos in it. The database is not encrypted at rest.

## 6. Testing and gates

| Level         | Tool                       | Target                                                                                                                                                                                           |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rules         | Vitest over `domain/`      | **≥ 90%** — every payload kind and its escaping, the matrix (known-answer vectors), the function-pattern map for versions 1–40, the placement engine, contrast, physical sizing, the CSV planner |
| Host          | `cargo test`               | randomised round-trips through the independent decoder, the hostile-file corpus, PNG `pHYs`, PDF physical size, export refusing unverified bytes, append-only batch report, migration round-trip |
| Contract      | Vitest over `data/`        | the interface's shape matches the Rust serde shape                                                                                                                                               |
| End-to-end    | WebDriver + `tauri-driver` | type a link → import a logo → export PNG and SVG and PDF → **a third decoder reads each file on disk** and gets the link back → restart → the library still has it                               |
| Architecture  | own test                   | fails if `domain/` imports React, Tauri or an outer layer                                                                                                                                        |
| Accessibility | axe-core in the e2e suite  | every screen, both themes, serious/critical = fail; keyboard-only journey from payload to export                                                                                                 |
| Host proof    | **Alex, with two phones**  | per release: iOS camera and Android camera, at the printed size, from 30 cm — a matrix of payload kinds × logo × style. **Not simulated.**                                                       |

**Mandatory negative cases** for the placement engine: a logo exactly at the budget and one module
over it; version 1 with a logo; the first version with a centre alignment pattern; a transparent
logo; a white logo on a white plate; a code with no quiet zone; inverted colours; colours one step
under the contrast threshold; a payload that fits at L but not at H once the logo needs H.

**Mandatory hostile corpus** for import: SVG with `<script>`, with `onload`, with an XML entity,
with an external `href`, with `foreignObject`, with a million nodes; a PNG that inflates to
gigapixels; a truncated JPEG; a GIF with ten thousand frames; a zero-byte file; a PNG named `.svg`.

```
version · cargo fmt --check · cargo clippy -D warnings · cargo test
tsc --noEmit · eslint (react-hooks/rules-of-hooks = ERROR) · prettier --check · vitest
```

One script, `npm run gates`, run identically by a developer and by CI.

The host's randomised round-trips are the ten-thousand-code corpus, and they sit outside that script
on purpose: `npm run corpus` generates the corpus and decodes it in a release build, on demand and
once a week, because minutes per run do not belong in a gate (ADR-020). The sweep of every version,
level, mode and mask stays in `vitest`, where every push meets it.

## 7. Vertical slices

Depth before breadth. F0 crosses Rust → SQLite → commands → domain → UI in a single feature: a
link really becomes a code, the code really leaves the product as a file, and a decoder that did
not make it really reads it back. If the scan gate is wrong, that shows on day one.

| #      | Slice                                       | Proof of done                                                                                                                                                                                                           |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F0** | Foundation, Fluent shell, one link, one PNG | **a link typed becomes a code on screen, is exported as a PNG, and an independent decoder reads the file on disk back as the same link** · gates green · e2e against the binary · MSI in budget · `SECURITY.md` written |
| F1     | The matrix, correct                         | all 40 versions × L/M/Q/H × numeric, alphanumeric and byte modes × 8 masks; known-answer vectors match; **10 000 randomised payloads decode byte-exact through the host decoder**                                       |
| F2     | Payload kinds                               | link, text, e-mail, phone, SMS, Wi-Fi, location: each output string matches its format byte for byte, the escaping negative cases are green, and the preview names what scanning does                                   |
| F3     | Contact cards                               | vCard 3.0/4.0 and MECARD with every field escaped; a density warning when modules get too small at the chosen size; **host proof (Alex): the card imports into Outlook and Google Contacts intact**                     |
| F4     | Logo import                                 | PNG/JPEG/GIF/WebP/SVG; **the hostile corpus is refused or neutralised with a sentence, never a crash**; an exported SVG is parsed in the test and contains no script and no external reference                          |
| F5     | Logo placement                              | **for every version 1–40 at Q and H, the largest logo the engine allows covers no function pattern (asserted on the matrix) and decodes**; one module over the budget is refused with the reason                        |
| F6     | Look                                        | colours with the contrast gate, module and finder shapes, quiet zone; **a style that stops the code decoding cannot be exported, and the export button says why**                                                       |
| F7     | Size and export                             | SVG, PNG with `pHYs`, PDF, clipboard; **a 25 mm code at 300 dpi is 295 px wide, the PDF measures 25 mm in its own units, and every file decodes**; the scan margin is shown                                             |
| F8     | Library and brand kits                      | a saved code reopens after a restart with the identical scene (hashed); a brand kit applied to a new link gives the same look; deleting a logo used by a kit says which kits                                            |
| F9     | Batch                                       | **a 200-row CSV produces 200 verified files; a malformed row is reported by line and does not stop the rest; no file is written outside the chosen folder** (traversal names in the fixture)                            |
| F10    | Read                                        | a corpus of real photographs and screenshots of codes decodes with kind, version, error correction and mask named; an image with no code says so; "would it scan at X mm" answered                                      |
| F11    | Fluent polish and accessibility             | axe-core clean on every screen in both themes; the keyboard reaches everything from the payload to the export; focus shows                                                                                              |
| F12    | Release 1.0.0                               | the installer runs on a clean machine and F0's proof passes on it; **the phone matrix (Alex) passes for every payload kind with a logo**                                                                                |

## 8. Definition of done

A slice is done when **all nine** are true.

1. Gates green. No exceptions, no "I'll fix it after".
2. Tests cover the new rule, **including the negative case**.
3. Documentation synchronised with the code that actually shipped.
4. **Verified running** — the screen was opened in both themes and **captured**; the file was
   actually written. Done is somebody looking at the screen, not a green pipeline.
5. **Every exported artefact the slice touches was decoded by a decoder that did not make it.**
6. Design system gate: one token source, canonical primitive, official icon set.
7. Accessibility: keyboard reachable, focus visible, contrast checked.
8. No secrets and no internal references in the public repository; the DENSO WAVE trademark
   notice is in the README and in About.
9. Conventional Commits, one concern each, staged per file; the pull request says what could not
   be verified.

## 9. Risks

| #   | Risk                                                                                                              | Severity     | Mitigation                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **A code that does not scan leaves the product**                                                                  | **Critical** | scan gate in domain and host; decoder of a different lineage; export writes only verified bytes; third decoder in e2e; phone matrix per release  |
| R2  | A code passes the decoder and still scans badly on a phone — a clean raster is kinder than a camera in a dim room | High         | conservative logo budget with a safety factor; the scan margin (shrunk, blurred, recompressed); the phone matrix is a release gate, not a nicety |
| R3  | A hostile SVG or raster (scripts, entities, external references, decompression bombs)                             | High         | normalised tree, never the original bytes; header-first caps; corpus in `cargo test`; threat model before F4                                     |
| R4  | Scanner apps disagree on vCard, MECARD and Wi-Fi escaping                                                         | Medium       | the widely supported subset; conformance tests per format; the phone matrix covers both platforms' default cameras                               |
| R5  | Printed too small for the payload's density                                                                       | Medium       | size is an input; module size in millimetres shown; warning below a threshold validated by the phone matrix                                      |
| R6  | Library licences, maintenance, or a C++ toolchain requirement on Windows                                          | Medium       | pure-Rust decoder preferred; every dependency through the audit gate and `NOTICE`; vendored encoder with its licence                             |
| R7  | Scope overruns — dynamic codes, analytics, AI art, barcodes, payments                                             | High         | the release train; 1.0.0 is a closed list; dynamic codes are refused on principle, not deferred                                                  |
| R8  | The name collides with a product or a trademark after it is public                                                | Medium       | §0 — collision evidence shown before the repository existed; no "QR Code" in the name; the sweep is repeated once before 1.0.0 is published      |
