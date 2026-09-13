# Architecture Decision Records

Binding decisions. A record here is not a suggestion: changing one requires a new record that
supersedes it, not an edit in passing. Each entry states the context, the decision, and — the
part that matters most later — the cost we accepted.

| #               | Decision                                                                         | Status                        |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| [001](#adr-001) | Tauri 2 with a deliberately thin Rust host                                       | Accepted                      |
| [002](#adr-002) | SQLite, one file, WAL                                                            | Accepted                      |
| [003](#adr-003) | The domain layer is pure TypeScript                                              | Accepted                      |
| [004](#adr-004) | Fluent is the visual language, with one icon set                                 | Accepted                      |
| [005](#adr-005) | Apache-2.0, and two trademark statements                                         | Accepted                      |
| [006](#adr-006) | No network, no telemetry                                                         | Accepted                      |
| [007](#adr-007) | Installers are not code-signed in 1.0.0                                          | Accepted                      |
| [008](#adr-008) | End-to-end tests drive the real binary                                           | Accepted                      |
| [009](#adr-009) | Accessibility is gated, not reviewed                                             | Accepted                      |
| [010](#adr-010) | The scan gate: nothing leaves that a decoder did not read back                   | Accepted                      |
| [011](#adr-011) | The decoder is of a different lineage from the encoder                           | Accepted                      |
| [012](#adr-012) | The library picks for encoder, decoders, imaging and PDF                         | Superseded by [019](#adr-019) |
| [013](#adr-013) | The logo is a region of the matrix, placed by an engine                          | Accepted                      |
| [014](#adr-014) | Dynamic codes are refused on principle                                           | Accepted                      |
| [015](#adr-015) | Size is an input, not a pixel count                                              | Accepted                      |
| [016](#adr-016) | Hostile input is normalised, never passed through                                | Accepted                      |
| [017](#adr-017) | Error correction is automatic with a logo, overridable upward only               | Accepted                      |
| [018](#adr-018) | Wi-Fi passwords are stored in the clear unless the person opts out               | Accepted                      |
| [019](#adr-019) | The library picks, confirmed                                                     | Accepted                      |
| [020](#adr-020) | The matrix is proven against the standard, and the corpus is a proof, not a gate | Accepted                      |
| [021](#adr-021) | One builder per payload kind, and the summary comes from the builder             | Accepted                      |
| [022](#adr-022) | Three card formats, and a density warning at a nominal size                      | Accepted                      |
| [023](#adr-023) | The logo is composed by the host into the bytes the gate decodes                 | Accepted                      |
| [024](#adr-024) | The middle alignment pattern may sit under the plate                             | Proposed                      |
| [025](#adr-025) | A look is gated before the scan gate, and function patterns are never reshaped   | Accepted                      |
| [026](#adr-026) | What is written is what was verified, with one named exception                   | Accepted                      |
| [027](#adr-027) | The scan margin is a report, never a gate                                        | Accepted                      |
| [028](#adr-028) | A saved code is its fields and the name of its scene, never an image             | Accepted                      |
| [029](#adr-029) | A batch is the Create pipeline in a loop, written only inside the chosen folder  | Accepted                      |

---

## ADR-001 — Tauri 2 with a deliberately thin Rust host {#adr-001}

**Context.** The product must feel native on Windows 11: Mica, the system accent, the system's
own file dialogs, the clipboard. It must also do three things the webview must not be trusted
with — decode images that arrived from strangers, render the exact bytes that will be written,
and read those bytes back with an independent decoder — and it must start fast and stay under
20 MB.

**Decision.** Tauri 2. The Rust side holds storage, the operating system, imaging and the scan
gate, and exposes a typed `#[tauri::command]` boundary. The product's **rules** — what a payload
means, how it is escaped, where a logo may sit, what a style does to a matrix — stay in
TypeScript (ADR-003). The host is where bytes are handled; the domain is where decisions are
made.

**Why not Electron.** A ~10 MB binary against ~150 MB, and WebView2 is already on every
Windows 11 machine. **Why not WPF/WinUI.** The editor, the live preview and the library are far
cheaper to build well in the web stack, and the matrix and the placement engine are far cheaper
to test as pure functions than as anything else.

**Cost accepted.** Rust is a second language in the build, and the WebView is not identical
across Windows versions. This host is also thicker than a note-taking product's, because imaging
and verification belong in it — the line is drawn at rules, not at line count, and ADR-003's
test is what keeps the line where it was drawn.

## ADR-002 — SQLite, one file, WAL {#adr-002}

**Decision.** `rusqlite` with the bundled SQLite, so the build does not depend on a system
library. WAL journaling, `synchronous = NORMAL`, foreign keys on. Logos are stored as blobs in
the same file, with their `sha256` beside them.

**Why.** A local-first product needs a store that is transactional, serverless, and a single
file a person can copy to another machine. One file also means a brand kit and the logo it
points at cannot be separated by a backup that copied one folder and not the other. WAL keeps
readers from blocking the writer and survives a hard kill far better than the rollback journal.

**Cost accepted.** `NORMAL` is durable across an application crash but can lose the last
transactions on sudden power loss. What is lost in that case is an edit, never an exported file:
the artefacts this product makes are written to the filesystem by the host, not kept in the
database. Blobs in the database rather than a folder of files is a second cost, paid for the
single-file property; the exit, if a library of thousands of logos ever makes the file
uncomfortable, is a content-addressed folder keyed by the `sha256` the row already carries.

## ADR-003 — The domain layer is pure TypeScript {#adr-003}

**Decision.** `src/domain/` holds the payload builders, validators and escaping for every kind
(URL, vCard, MECARD, Wi-Fi, SMS, geographic location, e-mail, telephone); the QR matrix —
versions 1 to 40, error correction L/M/Q/H, numeric, alphanumeric and byte modes, the eight
masks and the penalty score; the function-pattern map; the logo placement engine; style applied
to an SVG scene; physical sizing; and the CSV batch planner. It imports no React, no
`@tauri-apps/*`, no outer layer, and performs no I/O.

**Why.** These are the parts of the product that are actually hard, and the parts where code
generators go wrong — an escaping rule that turns a surname with a semicolon into a second vCard
field, a mask chosen for a matrix that no longer exists, an alignment pattern in the wrong place
at version 32. Purity makes every one of them testable against known-answer vectors without
mounting a component or opening a window, which is the difference between a suite that catches a
format-information bug and one that does not. It is also what lets ten thousand randomised
payloads run in a unit test (F1).

**Enforcement.** Twice, deliberately: ESLint `no-restricted-imports` while editing, and
`src/domain/boundary.test.ts` in CI, where it cannot be silenced with a disable comment.

**Cost accepted.** Knowledge of the QR standard exists twice in this product — in the domain's
encoder and in the host's decoder. That is not duplication to be removed; it is ADR-011, and it
is the point.

## ADR-004 — Fluent is the visual language, with one icon set {#adr-004}

**Decision.** Fluent 2 as Windows 11 draws it: Mica as the window backdrop, the system accent
ramp read from the host, Segoe UI Variable, Windows 11 geometry, four elevation steps, and
**Fluent UI System Icons** as the only icon family. The contract is `DESIGN_SYSTEM.md`; the
token layer is `src/styles/tokens.css`; the primitives are `src/ui/`.

**Why.** The product should look like it belongs on the desktop it runs on, not like a web page
in a frame. One token source and one icon set are what keep a product looking like one product.

**The preview is the exception, and it is a correctness rule.** The code is drawn on an opaque
surface, never over Mica, never over Acrylic, never over a theme tint. The background of a code
is part of the code: it is one half of the contrast the decoder needs, and a preview shown over
a translucent material would show a contrast the exported file does not have. What is on screen
is what the file will be.

**Cost accepted.** No off-the-shelf component library; the primitives are ours, built once and
reused. Native capability that is unavailable degrades **visibly** — Mica falls back to a solid
token surface and reports that it did, rather than pretending.

## ADR-005 — Apache-2.0, and two trademark statements {#adr-005}

**Decision.** Apache License 2.0, `Copyright 2026 Alex Justino`, with a `NOTICE` file and two
statements carried in the README and in About:

1. The licence grants no right to the project's name or marks (Apache-2.0 §6). The code is
   free; the name is not part of the grant.
2. **_QR Code_ is a registered trademark of DENSO WAVE INCORPORATED.** This product is not
   affiliated with, endorsed by or sponsored by DENSO WAVE. The mark appears only descriptively,
   to say what the product makes, and never in the product's name, its icon or its wordmark —
   which is one of the reasons the name is Signatum.

**Why, over MIT.** Both are permissive and both keep authorship. Apache-2.0 adds three things
MIT does not: the explicit statement above about names and marks; an obligation on
redistributors of modified copies to say that they modified it; and an explicit patent grant
with a retaliation clause. For a named product that reads and writes a standardised symbology,
the patent language is worth having written down rather than assumed.

**Why not GPL.** Preventing closed forks is not a goal here; adoption is.

**Cost accepted.** A `NOTICE` file that has to be kept true. Every third-party implementation
this product carries — the vendored encoder above all (ADR-012) — reproduces its licence there,
and a dependency added without that line is an incomplete dependency.

## ADR-006 — No network, no telemetry {#adr-006}

**Decision.** The application makes no outbound request, ever. No account, no sync, no
analytics, no crash reporting, no update check — and, specific to this product, **no contact
with the address a code opens**: no link preview, no favicon, no reachability check, no
shortener, no reputation lookup. The Tauri CSP blocks external origins and capabilities are
declared one by one; the webview never loads a remote resource, which is also why an imported
SVG that references one is refused rather than fetched (ADR-016).

**Why.** Privacy is a feature of this product, stated in the README, not an omission — and here
it is a stronger claim than usual, because the tools this one is defined against exist precisely
to sit between a printed code and the person who scans it (ADR-014). It is also what makes the
security posture simple enough to be true: a product with no socket has no exfiltration path to
argue about.

**Cost accepted.** No automatic updates in 1.0.0; releases are downloaded from GitHub. And the
product cannot tell a person that the link they typed is dead or misspelt — so it does the one
thing it can do offline instead: it shows the address exactly as it will resolve, in Unicode
**and** punycode, so a look-alike domain is visible before it is printed.

## ADR-007 — Installers are not code-signed in 1.0.0 {#adr-007}

**Decision.** The MSI and NSIS installers ship unsigned. SmartScreen warns on first run; the
README and the release notes say so, and tell the person to verify that the download came from
this repository's Releases page and to check the published SHA-256.

**Why.** A code-signing certificate is a recurring commercial cost and an identity process;
neither is justified before the product has users, and neither changes the security properties
of the software — only the first-run experience. The mitigation is transparency, not pretence.

**Cost accepted.** A worse first run, stated rather than hidden. Reversible at any time.

## ADR-008 — End-to-end tests drive the real binary {#adr-008}

**Decision.** The end-to-end suite (`e2e/`, `npm run e2e`) launches the debug binary through
`tauri-driver` and the platform's WebDriver (`msedgedriver`, matched to the installed WebView2
runtime), on a workspace relocated by `SIGNATUM_DATA_DIR` to an empty temporary directory. The
client is a small W3C WebDriver implementation kept in the repository, not a framework. The
suite's proof is not a screenshot: it reads the **files the product wrote** off the disk and
decodes them with a **third** decoder, different from the encoder and from the host's verifier
(ADR-011), and asserts that the payload comes back byte for byte.

**Why.** Unit tests prove rules; they cannot see the seams. The defects that survive green unit
suites live between two correct components — a scene verified and a file written from a
different render, a PNG whose `pHYs` says one thing and whose pixels say another, a library row
that reopens as a slightly different scene. Only a test through the real host, the real page and
the real file can find those. The relocated workspace makes the suite safe to run on a machine
that has a real library open, and it doubles as a migration test: every session starts from an
empty file.

**Cost accepted.** The suite needs a built binary and a driver matched to the WebView2 runtime,
so it is not in the pull-request gate — `npm run gates` stays fast and hermetic. It runs on a
developer machine and from a manually triggered workflow. And it cannot hold a phone: whether a
printed code scans with a camera across a room is proved per release by a person, with two
phones, and is written down as such (SPEC §6).

## ADR-009 — Accessibility is gated, not reviewed {#adr-009}

**Decision.** Three gates hold the design system's accessibility section: a unit test that
parses the token file and checks every text-on-surface pair in both themes against WCAG AA; an
axe-core audit run by the end-to-end suite on every screen in both themes, failing on any
serious or critical violation and reporting the rest; and a keyboard-only journey in the same
suite, from typing a payload to writing a file.

**Why.** A review remembers accessibility the week it is discussed. A gate remembers it on every
pull request.

**Two contrasts, never confused.** WCAG governs the **interface** — text on surfaces, focus
rings, states. The contrast between a code's foreground and its background is a **decoder**
requirement, with a different threshold and a different reason, and it is a pure rule in
`src/domain/` with its own tests (F6). axe never judges the code; the domain never quotes WCAG
at it. Mixing the two would produce a code that passes an accessibility audit and does not scan.

**Cost accepted.** axe-core is a development dependency injected into the page by the suite,
never shipped. The audit cannot judge how a screen reader _sounds_; that stays a person's job,
and is written down as such.

## ADR-010 — The scan gate: nothing leaves that a decoder did not read back {#adr-010}

**Context.** Every tool in this category will export a code that a phone cannot read — the logo
a little too big, the colours a little too close, the print a little too small — and nobody
finds out until it is on ten thousand flyers. A generator that exports a code that does not scan
is not a generator: this is requirement one (SPEC §4), not a feature.

**Decision.** An export writes only bytes that have already been read back. The order is fixed,
and there is no other way out of the product:

1. The domain produces the matrix and the scene, and marks neither exportable.
2. The host renders the artefact **in its final bytes**, in memory — the PNG, the SVG or the
   PDF exactly as it would be written, headers, metadata and all.
3. The host rasterises **those bytes** and decodes the raster with an independent decoder
   (ADR-011).
4. What was decoded is compared with the code's payload **byte for byte**, not by string
   equality after normalisation, and the comparison is recorded as a verification row
   (`DATA_MODEL.md`) carrying the decoder's name and version and the hashes of the scene and of
   the artefact.
5. The export command writes **that buffer**. Never a re-render, never a second pass, never
   "the same thing again, at the export resolution".

Copy to the clipboard and every row of a batch go through the same command. A code that does not
verify cannot be exported, copied or saved as verified, and the screen says which step failed
and what was decoded instead.

**Why step 5 is the load-bearing one.** Verifying one render and writing another is the bug this
record exists to make impossible. Two renders of the same scene are identical until the day one
of them rounds a module differently, picks a different anti-aliasing, or writes a colour
profile — and then the file on disk is not the file that was proved.

**Enforcement.** In the host: a `cargo test` named _export refuses unverified bytes_ hands the
export command a buffer with no verification and asserts that nothing is written. In the domain:
a scene is exportable only against a **verification token**, so the interface cannot offer the
button for a scene that has changed since it was proved. In the end-to-end suite: a third
decoder reads the written file (ADR-008).

**Cost accepted.** Every export costs a rasterisation and a decode — budgeted under 500 ms at
2 000 px (SPEC §4). Every change to the payload, the style, the logo or the size invalidates the
verification, so the export button is briefly unavailable while the code is verified again, and
the screen says so rather than going quiet. Verifying vector output means the host must
rasterise its own SVG and PDF bytes, which is weight in the binary and a renderer to keep
current. All three are the price of the only claim this product makes that the others do not.

## ADR-011 — The decoder is of a different lineage from the encoder {#adr-011}

**Decision.** Three implementations of the QR standard, deliberately, with no shared lineage:

| Role                     | Where         | Constraint                                            |
| ------------------------ | ------------- | ----------------------------------------------------- |
| Encoder                  | `src/domain/` | a vendored TypeScript port of a reference generator   |
| Verifier (the scan gate) | `src-tauri/`  | shares no code and no author lineage with the encoder |
| Third decoder (tests)    | `e2e/`        | differs from both of the above                        |

A verifier built from the encoder's code shares the encoder's mistakes: an off-by-one in the
alignment table, a penalty score computed the wrong way round, a byte-mode boundary handled
generously. Both sides would agree, the suite would be green, and the phone would still fail.
**Independence is the property being bought, not convenience.**

**Enforcement.** `NOTICE` names each implementation and its origin; the dependency audit (F0 and
F1) rejects any candidate that turns out to be a port of the encoder's lineage, however good it
is. The architecture test keeps the verifier out of `src/`, where the domain could reach it.

**Cost accepted.** Three QR implementations in the supply chain, three licences to reproduce,
three sets of release notes to watch. And a false refusal becomes possible — a good code that
one decoder cannot read — which is the right direction for this product's failures to point, and
the reason a refusal always says what was decoded instead of the payload, rather than only that
it failed.

## ADR-012 — The library picks for encoder, decoders, imaging and PDF {#adr-012}

**Status: Superseded by [ADR-019](#adr-019).** These were candidates, not adoptions, and the
record stayed Proposed so that the audit was allowed to say no. F0 built with them and ADR-019
names what was actually taken, at which version and under which licence. The table below is kept
as it was written — it is the reasoning the picks were made against, and the PDF row is still a
candidate, because F7 has not happened. ADR-011's independence rule was Accepted throughout and
depends on none of these names.

| Role               | Candidate                                        | Why it is the candidate                                                 |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Encoder            | Project Nayuki's QR Code generator (MIT), ported | reference-quality, small, readable, with published test vectors         |
| Verifier           | `rqrr` (pure Rust, a port of quirc)              | pure Rust, so no C++ toolchain on Windows; lineage far from the encoder |
| Verifier, fallback | `zxing-cpp`                                      | the most exercised decoder there is, at the cost of a C++ toolchain     |
| Third decoder      | `jsQR` or `zxing-wasm`                           | runs inside the test process, and differs from both of the above        |
| SVG                | `usvg` / `resvg`                                 | a normalising parser and a renderer from one project (ADR-016)          |
| Raster             | `image`                                          | header-first metadata, so dimensions are read before pixels are         |
| PDF                | `pdf-writer` or `svg2pdf`                        | writes a page at a physical size without a print pipeline               |

**Why the encoder is vendored rather than depended upon.** It lives in `src/domain/`, under the
boundary rule and the coverage gate, because the placement engine has to reach inside it: the
function-pattern map, the penalty score and the knock-out (ADR-013) are not things a packaged
encoder exposes. A vendored copy is a copy this product is responsible for — its licence goes in
`NOTICE`, and every local change is recorded beside it.

**Cost accepted.** Naming candidates before auditing them creates a pull towards them. This
record is Proposed precisely so that the audit is allowed to say no; if it does, the replacement
is a new record, not an edit to this one. A vendored encoder also means an upstream fix is a
manual merge rather than a version bump.

## ADR-013 — The logo is a region of the matrix, placed by an engine {#adr-013}

**Context.** The usual way to put a brand in the middle of a code is to draw the image on top
and hope the error correction absorbs it. It usually does — on a clean raster, on a bright
screen, held still. That is exactly the failure that reaches paper.

**Decision.** The logo is a **region of the matrix**, computed in `src/domain/`:

1. **The function patterns are known for every version 1 to 40** — the three finders and their
   separators, both timing lines, every alignment pattern, the format information, the version
   information blocks, and the dark module. None of them is ever covered. Not "rarely"; never,
   asserted against the matrix.
2. **The size comes from the error-correction budget**, with a safety factor: the modules the
   logo would consume must stay under a fraction of the codewords the chosen level can afford to
   lose. The factor is conservative, and it is a stated constant rather than a feeling.
3. **Covered modules are knocked out** — cleared to the plate, whole modules only — so that no
   half module shows at the edge of the plate and no accidental pattern is made by a clipped
   one.
4. **The mask is chosen after the knock-out**, by running the penalty score over the matrix as
   it will actually be printed. A mask picked before the knock-out was picked for a matrix that
   no longer exists.
5. **The error-correction level is raised when the logo needs it** (ADR-017).
6. **A logo that cannot fit is refused, with the reason** — which pattern it would reach, or by
   how much it exceeds the budget — and never quietly shrunk until it does.

**Why.** Making the logo a region turns a bet into arithmetic. The budget is countable before
anything is rendered, a refusal is explainable in a sentence a person can act on, and the scan
gate (ADR-010) then proves the arithmetic on the bytes rather than standing in for it.

**Enforcement.** F5: for every version 1–40 at Q and H, the largest logo the engine allows
covers no function pattern — asserted on the matrix, not on a rendered image — and the result
decodes. One module over the budget is refused with the reason. The negative battery in SPEC §6
(version 1 with a logo, the first version with a centre alignment pattern, a transparent logo, a
white logo on a white plate) belongs to the same suite. The engine is
`src/domain/placement.ts` and the battery that holds it is `src/domain/placement.test.ts`; the one
function pattern that may be covered, and only behind a constant, is [ADR-024](#adr-024).

**Cost accepted.** The logo is smaller than a design tool would draw it, deliberately, and some
people will want the bigger one; the product says why they cannot have it. The engine carries an
alignment-pattern table for all forty versions, which is a table with its own known-answer test
and its own way of being wrong. And raising the level can push a payload to a larger version,
which makes each module smaller at a fixed physical size — visible only because ADR-015 makes
the module size something the screen states.

## ADR-014 — Dynamic codes are refused on principle {#adr-014}

**Decision.** The product will never make a dynamic code. No redirect, no short link, no
tracking parameter added to a payload, no scan analytics, no "change where this code points" —
not in 1.0.0, and not on the release train. The bytes in the code are the bytes the person
typed, and the product never contacts the address a code opens (ADR-006).

**Why this is a principle and not a backlog item.** A dynamic code is a server standing between
a printed thing and the person who scanned it: it learns who scanned what and when, and the code
stops working the day the subscription does. That is the product this one is defined against
(SPEC §1). Written as "deferred", it would be reopened every release by the same reasonable
argument; written as refused, the answer is already given.

**Cost accepted, stated plainly.** A printed code cannot be repointed later. If the address
changes, the code is remade and reprinted. The screen says so where a link is typed — one
sentence, at the moment the decision is being taken, not buried in an answers page — because a
person choosing this product deserves to know the trade before the flyers are printed rather
than after. Comparison tables will show a row this product does not have; that is the intended
outcome.

## ADR-015 — Size is an input, not a pixel count {#adr-015}

**Decision.** A code is designed for a **physical size** — millimetres or inches — and a
resolution. Everything else follows from those two numbers:

- **PNG** carries `pHYs`, so the file itself states its physical size rather than leaving it to
  whatever opens it next.
- **PDF** is written at the exact physical size, in its own units.
- **SVG** carries physical `width`/`height` with a `viewBox`, so placing it in a layout tool
  gives the size it was designed at.
- The **module size in millimetres** is shown while the code is being designed, and below a
  threshold the screen warns — naming the risk (distance, camera, print process), not merely
  colouring a number red.

**Why.** Density is decided by the payload's length and the error-correction level, and it
changes under the person's hands as they type. The same code is comfortable at 40 mm and
unreadable at 15 mm. A tool that exports "2 000 × 2 000 px" has handed the only decision that
matters — how big this will be on paper — to whoever opens the file next, usually a printer who
was never told.

**Cost accepted.** One more input to ask for, so the product offers a sensible default rather
than an empty field. The warning threshold is a rule of thumb validated by the phone matrix, not
a figure from a standard, and it is written as such. `pHYs` is advisory and some software
ignores it — which is why PDF is in the export list, and is the answer for print.

## ADR-016 — Hostile input is normalised, never passed through {#adr-016}

**Context.** This product opens files that people received from other people — a logo from a
marketing folder, an SVG downloaded from a website, a CSV out of somebody's spreadsheet — and
its own output is an SVG that will be opened in a browser.

**Decision.** Nothing that arrives is passed through.

- **SVG** is parsed into a normalised tree: no scripts, no event handlers, no external
  references, no `foreignObject`, no entities, with caps on document size and node count. What
  is stored and what is exported are **re-serialised from that tree**; the bytes that came in
  are never written anywhere (`DATA_MODEL.md`).
- **Raster** dimensions and frame counts are read from the **header** and capped before a pixel
  is decoded, so a decompression bomb is refused at kilobytes rather than at gigapixels. What is
  stored is the decoded, capped image, re-encoded as PNG.
- **The format is the bytes, not the extension.** A PNG named `.svg` is a PNG.
- **A refusal is a sentence**, naming what was wrong with the file, in under a second, and never
  a crash and never a hang (SPEC §4).

**Enforcement.** The hostile corpus lives in `cargo test` and is a list, not a sample: SVG with
`<script>`, with `onload`, with an XML entity, with an external `href`, with `foreignObject`,
with a million nodes; a PNG that inflates to gigapixels; a truncated JPEG; a GIF with ten
thousand frames; a zero-byte file; a PNG named `.svg`. On the way out, the test parses an
exported SVG and asserts that it contains no script and no external reference (F4).

**Cost accepted.** A legitimate SVG using something the normaliser does not carry — an exotic
filter, an embedded font, a gradient mesh — is degraded or refused, and says which. And because
the original bytes are not kept, the only route back to the original is the original file; the
data model states this where it is decided, so that nobody discovers it during a restore.

## ADR-017 — Error correction is automatic with a logo, overridable upward only {#adr-017}

**Decision.** With no logo, the person chooses the error-correction level freely; the default is
M. **With a logo**, the engine chooses the lowest level that carries that logo at that size
within the budget and its safety factor (ADR-013), and the person may raise it — to Q, to H —
but never lower it below what the engine chose. The screen says which level is in force and why
it is not lower.

**Why.** Lowering the level under a logo is the precise move that produces a code which scans on
a screen and fails on paper: the budget the logo is spending is the budget a damaged print
needed. Allowing only the safe direction keeps the person in control without handing them the
one control that quietly breaks the product's central promise.

**Cost accepted.** Somebody who knows exactly what they are doing cannot ship a denser code with
a logo at a low level. Raising the level can grow the version and shrink the modules, which is
visible because ADR-015 puts the module size on the screen.

## ADR-018 — Wi-Fi passwords are stored in the clear unless the person opts out {#adr-018}

**Context.** A Wi-Fi code contains the network's password as plain text — that is what the
`WIFI:` format is, and anybody who scans the printed code has the password. The only open
question is what the **library file** keeps after the code has been made.

**Decision.** The password is stored in the code's payload like any other field, in the clear,
**unless** the person clears "save the password with this code" — in which case the code is
saved without it and asks for it again when it is reopened to export. The screen says which of
the two is happening, in a sentence, where the password is typed: not in a tooltip, not on a
help page.

**Alternative considered, and deferred: DPAPI.** `CryptProtectData` against the user's profile
would protect the password from another account on the same machine and from a database file
copied elsewhere. That is a real gain, and a narrow one, and it costs the property this
product's storage is built on (ADR-002): a DPAPI blob does not survive being copied to another
machine or a reinstall, so the single file would stop being portable — and a code whose password
cannot be read back is a code that cannot be re-exported, discovered by the person at the moment
they needed it. Deferred, not rejected: if it arrives it will be a per-field choice with a
stated export path, and it will be its own record.

**Cost accepted, and it is in `SECURITY.md` in the same words.** An attacker with write access
to the Windows user account can read the Wi-Fi passwords in the library, along with everything
else in it; the database is not encrypted at rest. The opt-out is the mitigation the product
offers today, and saying so plainly, where the password is typed, is the rest of it.

## ADR-019 — The library picks, confirmed {#adr-019}

**Status: Accepted.** Supersedes [ADR-012](#adr-012).

**Context.** ADR-012 named candidates and said plainly that they were candidates. F0 had to build
with something: encode a code, rasterise it, decode it with a different lineage, and prove the
whole path from a test process. What follows is what was taken, at the versions in `Cargo.lock`
and `package-lock.json` on the day F0 landed. Versions are named because "we use resvg" is not a
fact anybody can check a year later.

**Decision.**

| Role                     | Taken                                                                                                           | Version                 | Licence                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
| Encoder                  | Project Nayuki's QR Code generator, **vendored**                                                                | upstream `8329a7108fc2` | MIT                                       |
| Decoder, in the host     | `rqrr`                                                                                                          | 0.10.1                  | (MIT OR Apache-2.0) AND ISC               |
| Decoder, third, in tests | `jsQR` (with `pngjs` to read the file)                                                                          | 1.4.0, 7.0.0            | Apache-2.0; MIT (`pngjs`)                 |
| SVG rasteriser           | `resvg`, default features **off**                                                                               | 0.45.1                  | Apache-2.0 OR MIT                         |
| └ SVG parser             | `usvg`, re-exported by `resvg`                                                                                  | 0.45.1                  | Apache-2.0 OR MIT                         |
| └ Rasteriser backend     | `tiny-skia`, re-exported by `resvg`                                                                             | 0.11.4                  | BSD-3-Clause                              |
| PNG in and out           | `image`, `png` feature only                                                                                     | 0.25.10                 | MIT OR Apache-2.0                         |
| Hashing                  | `sha2`, `hex`                                                                                                   | 0.10.9, 0.4.3           | MIT OR Apache-2.0                         |
| Host, storage, platform  | `tauri` (+ `dialog`, `log` plugins), `rusqlite` (bundled SQLite), `windows` (`UI_ViewManagement`, `Foundation`) | 2.11.5, 0.32.1, 0.58    | Apache-2.0 OR MIT; MIT; MIT OR Apache-2.0 |

Every licence is permissive and compatible with this product's Apache-2.0; none is copyleft. The
list a person sees is `NOTICE`, and the About screen reads it from that file rather than from a
second list somebody would have to remember to update.

**The encoder is vendored, and pinned.** `src/domain/qr/vendor/qrcodegen.ts` is upstream
byte-for-byte apart from two lines — a `@ts-nocheck` and lint pragma, and an `export` to give a
script a module boundary — both recorded in `VENDORED.md` beside it, both re-checked by a test
that fails on any third difference, against the upstream file's SHA-256. It is vendored rather
than depended upon for the reason ADR-012 gave: from F5 the placement engine has to reach inside
the matrix, which no packaged encoder exposes. The cost is unchanged and now real — an upstream
fix is a manual merge, not a version bump.

**`resvg` is compiled with its default features off**, which is a security decision before it is a
size one. The defaults are text layout, system fonts, memory-mapped fonts and GIF/JPEG/WebP
decoding: every one of them a parser that would be reachable from a file this product was handed,
and not one of them needed to draw a background rectangle and a path. `usvg` and `tiny-skia` are
not declared as dependencies at all — `resvg` re-exports the exact versions it was built against,
and a second copy of `tiny-skia` at another version would be two incompatible `Pixmap` types.

**`jsQR` is the third decoder**, in the end-to-end suite only, never in the product. It runs in
the Node process that drives the binary, reads the PNG from disk after the product wrote it, and
shares its lineage with neither the encoder (Nayuki) nor the host's decoder (`rqrr`, a port of
quirc). Three readings of one code by three unrelated implementations is the strongest statement
this product can make without a camera. `zxing-cpp`, ADR-012's fallback verifier, was **not**
taken: it would put a C++ toolchain on every machine that builds this, and two decoders in the
host would raise a question — which one wins — that the product has no good answer to.

**PDF is not decided here.** `pdf-writer` and `svg2pdf` remain candidates; F7 is where export
formats are built, and the choice belongs to the record that follows it.

**Cost accepted: the MSRV holds the versions down.** `rust-version = "1.80"` is kept, the same
value the sibling products use, so one toolchain builds the whole family and a contributor is
never asked which Rust today's repository wants. Newer `resvg` and `rqrr` releases require a
newer compiler, so 0.45 and 0.10 are what F0 takes rather than the latest published. That is a
real cost, and it comes due the day one of these crates fixes something that matters upstream:
the answer then is to raise the MSRV across the family deliberately, in its own record, not to
raise it quietly here for one crate.

## ADR-020 — The matrix is proven against the standard, and the corpus is a proof, not a gate {#adr-020}

**Status: Accepted.**

**Context.** F0 proved the path: a link becomes a code, the code becomes a file, and a decoder of a
different lineage reads the file back ([ADR-010](#adr-010), [ADR-011](#adr-011)). What F0 did not
prove is the _matrix_. One link, at one version, at one level, with whatever mask the encoder chose,
says nothing about version 37 at H under mask 5. The encoder is vendored and mature
([ADR-019](#adr-019)), but "the encoder we vendored agrees with itself" is not a proof, and the logo
engine that will reach inside the matrix from F5 onwards needs a matrix somebody has checked against
the published tables first.

**Decision, in two halves.**

**The domain carries the reading half of ISO/IEC 18004.** `src/domain/qr/structure.ts` computes,
from the standard and nothing else, the 15-bit format information (BCH(15, 5) over the generator
10100110111, XORed with 101010000010010 — Annex C), the 18-bit version information for versions 7
and above (BCH(18, 6), Annex D), the alignment-pattern centres of every version (Annex E), and the
position of every function pattern: three finders, their separators, both timing patterns, the dark
module. It also reads those fields back out of a matrix, from both of the copies the standard
requires, so a caller can insist the two agree. Nothing in it writes a module. A matrix is therefore
judged against the standard's tables — with known answers for format, version and alignment copied
into the test straight from those tables — rather than against the encoder's idea of itself.

**The sweep is in the gate.** Every combination the standard allows is built and read back by
`vitest`: forty versions × four levels × numeric, alphanumeric and byte modes × eight masks =
3,840 matrices, each one required to have the size its version fixes, to draw every function
pattern, and to carry the version, level and mask it claims in both copies of its format and
version information.
Beside it, a decoder of a different lineage decodes a symbol at every version and every level, and
byte-mode input that is not valid text comes back as the same bytes. That runs on every push.

**The corpus is a proof, and deliberately not a gate.** `npm run corpus` builds the domain's encoder
as a plain module, generates ten thousand randomised payloads from a fixed seed — every version
reached, lengths skewed the way real codes are but touching version 40, several scripts, and one
payload that is not UTF-8 at all — and hands each matrix to the host's decoder in a release build
(`src-tauri/tests/corpus.rs`, `#[ignore]`d so that it is never run by accident). Each symbol must
come back as the same _bytes_, with the version, level and mask the encoder claimed: a code that
decodes to the right payload from the wrong matrix is a coincidence, not a correct encoder. The host
rasterises the modules directly, without going through the SVG renderer, so the proof of the matrix
does not depend on how the product happens to draw. The corpus is generated, never committed, and
reproducible from its seed, so a failure is named by the id of its line. It runs from the command
line and from a workflow of its own — on dispatch and weekly — and it is **not** part of
`npm run gates`.

**Cost accepted: a regression that only the corpus would catch can reach `develop` between two
runs.** Ten thousand symbols take minutes, the release build takes longer, and a battery a
contributor is tempted to skip protects nothing. So the corpus buys its runtime with a real gap, and
the gap is narrowed rather than denied: the 3,840-cell sweep and the per-version decode by a foreign
decoder _are_ in the `vitest` gate, and the corpus is asked for by hand whenever the encoder, the
decoder or the code between them is touched, with the weekly run as the backstop. That convention is
written into `CONTRIBUTING.md`, which is the only thing that makes "run it when you touch the
encoder" more than a hope.

**Two smaller consequences, recorded so that they are not rediscovered.** The third decoder now runs
in the unit suite as well as the end-to-end one; [ADR-019](#adr-019)'s binding part is unchanged —
it is a development dependency and is never linked into the product. And the corpus carries its
payloads and module bits as base64, which nothing the product ships reads, so the crate that decodes
it is a `dev-dependency`, absent from a release build.

## ADR-021 — One builder per payload kind, and the summary comes from the builder {#adr-021}

**Status: Accepted.**

**Context.** A code carries bytes, and a person reads a sentence. F0 had one kind, a link, and the
two lived in one file without effort. F2 brings seven, and each of them is a different answer to the
same two questions: what exactly does the code carry, and what does a phone do when it reads it?
The failure this product exists to prevent is the gap between those two answers — a preview that
says _"Joins Office-5G"_ over a payload that joins a network called `Office-5G;P:`. That gap is not
found by testing harder; it is opened by writing the payload in one place and the sentence in
another.

**Decision.** A payload kind is **one pure builder**, in its own file under `src/domain/payload/`,
which takes that kind's form and returns either the exact bytes **and** the sentence together, or
one reason and the name of the field that earned it. Never two functions that could disagree:
`buildEmail` is the only thing that knows both what a `mailto:` looks like and that it _"writes to
ana@example.com"_. The screen dispatches, shows and refuses; it knows the format of nothing. The
preview's accessible name, the helper line under the form and the end-to-end suite all read that
same sentence, so there is nothing left for two readings to disagree about.

Every builder is **total**: it throws nothing, because a half-typed form is the normal state of a
form and not an error, and the empty form of every kind is refused — which is what keeps an export
from being offered before anything has been typed.

**The formats, and why these.** The test a format has to pass here is not elegance, it is what the
two mobile platforms' built-in cameras actually act on:

| Kind     | Format                         | Why                                                                                 |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Link     | WHATWG URL, `http`/`https`     | what a browser would resolve, punycode included (`SECURITY.md`)                     |
| Text     | the text, byte for byte        | the one kind with no format: a trailing space in a serial number is part of it      |
| E-mail   | `mailto:` (RFC 6068)           | the only mail URI phones open; subject and body are its query, so both are encoded  |
| Phone    | `tel:` (RFC 3966)              | digits and at most a leading `+` — what a dialler acts on, not what a person writes |
| SMS      | `SMSTO:<number>:<message>`     | read by both platforms for a decade; see the cost below                             |
| Wi-Fi    | ZXing `WIFI:T:…;S:…;P:…;H:…;;` | the de-facto network-join format both platforms implement; there is no standard one |
| Location | `geo:` (RFC 5870)              | opens the map application rather than a maps vendor's website                       |

Escaping is part of the format, not a tidy-up after it: the reserved characters of `WIFI:` are
escaped in the name and the password with the backslash handled first, and in `mailto:` the local
part is percent-encoded exactly as the subject and the body are — a `?` inside an address is a
character, never a second field.

**Cost accepted: two of the seven are not standards, and one of them is chosen _over_ a standard.**
`SMSTO:` has no RFC. `sms:` does ([RFC 5724](https://www.rfc-editor.org/rfc/rfc5724)), and the two
mobile platforms disagree about where the message body goes in it, so a `sms:` code that pre-fills
the message on one platform opens an empty message on the other. The product ships the form that
works on the phone rather than the one that reads best in a specification, and the same reasoning
gives `WIFI:`, which is ZXing's convention and nobody's standard. The cost is real: these two
formats are defined by what implementations do, so they can drift, and no specification will settle
an argument about them. It is paid deliberately, because the alternative is a code that scans
correctly and does nothing useful. Both are pinned by tests that assert the exact bytes, so a drift
is a failed test rather than a surprise on a printed sheet.

**Second cost: seven builders is seven files.** A kind cannot be added by editing one switch; it
needs its file, its tests and its form. That is the point — the dispatch and the form switch are
exhaustive over the union the domain declares, so a kind added without a form is a type error rather
than an empty panel — but it does mean the cheapest-looking change, adding a field to an existing
kind, is the one to watch: a field that the builder ignores is a field the person will believe in.

## ADR-022 — Three card formats, and a density warning at a nominal size {#adr-022}

**Status: Accepted.**

**Context.** A contact card is the payload people print on paper and hand to strangers, and it is
the payload with the most ways to go quietly wrong. It is long — a filled-in vCard is several
hundred bytes where a link is forty — and bytes are modules, so the same card that scans from an A4
poster can be unreadable on a business card. It is also structured: `;` separates the components of
a value and `,` separates the values of a multi-valued one, so a family name written `O'Brien; Jr`
is not punctuation, it is a name and a suffix, and the address book files a different person. And
unlike a link, nothing on the screen shows whether it worked; the person who finds out is the one
who scanned it.

**Decision.** One kind, three formats, chosen on the form and decided before any byte is written.

| Format        | What it is                                          | Why it is offered                                                              |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| **vCard 3.0** | [RFC 2426](https://www.rfc-editor.org/rfc/rfc2426)  | the default: the form the widest range of phones and mail clients import today |
| vCard 4.0     | [RFC 6350](https://www.rfc-editor.org/rfc/rfc6350)  | the current standard — `KIND:individual` and `tel:` URIs, for what reads it    |
| MECARD        | the convention phone cameras have read for a decade | density: roughly half the bytes, for a code that has to be printed small       |

3.0 is the default because the test a format has to pass here is the one [ADR-021](#adr-021) set —
what the two mobile platforms and the desktop address books actually act on — and not which
document is newest. 4.0 exists because it is where the standard is, and the difference is written
where the standard writes it: the `KIND` property it added, the `TYPE=INTERNET` parameter it
dropped, and telephone numbers as `tel:` URIs rather than bare text. MECARD exists because a code
that does not scan at the size it is printed carries nothing at all.

**Escaping, and the two places it deliberately stops.** Every text value is escaped by RFC 6350
§3.4 — the backslash first, then `;` and `,`, and a line break as the two characters `\n` — with
the components of `N` and `ADR` escaped one by one and only then joined, because in a structured
value position is meaning. Two exceptions are decisions rather than omissions:

- **A web address is written raw in a vCard.** `URL` is a URI value, not a text value (RFC 6350
  §6.7.8), and a URI is not backslash-escaped; escaping it would put a backslash into an address
  that some clients then open literally. It is safe to write raw only because the link parser has
  already refused anything with whitespace or a line break in it — the same parser the Link kind
  uses.
- **A line break inside MECARD is passed through.** MECARD has no escape for one. Writing `\n` as
  two characters would not encode the break, it would put a backslash and an `n` into the note, and
  a reader that does unescape would produce a value nobody typed. Passing it through is the only
  choice that cannot corrupt the value, and in a single-line format it is visible rather than
  silent.

Long lines are folded at 75 octets with CRLF and a space (RFC 6350 §3.2), counted in UTF-8 octets
and never inside a multi-byte sequence: a card folded through the middle of an `ü` imports as
mojibake. UTF-8 is the charset in both versions, so no `CHARSET` parameter is written.

**A number on a card carries its country code.** The Phone kind accepts a national number, because
a code taped to a shop counter is scanned in that country. A card is not taped to anything — it
travels, and it is stored — so a number without its country code becomes a local number on whatever
phone reads it later. The card refuses it with a sentence instead, and every other field is read by
the parser its own kind already owns, so what is refused on the Phone or Link tab is refused here in
the same words.

**A density warning, not a refusal, at a nominal size.** How small a module comes out is a function
of the payload's length, and the person who could act on it is the one typing. So the number is
computed from the code on screen and shown beside the preview: at 25 mm, this code's modules are
0.24 mm, and below half a millimetre most cameras fail at arm's length. It is **a warning and never
a refusal** — the printed size is the person's to choose, and what decides whether a code leaves is
the scan gate ([ADR-010](#adr-010)), which reads the bytes that will actually be exported. The
warning is decided on the two-decimal number the sentence shows, not the exact one, so the screen
never claims that 0.50 mm is below half a millimetre; a person reading a warning that contradicts
itself stops believing the next one. Until the export screen makes the physical size an input
([ADR-015](#adr-015), F7), 25 mm is assumed, and the sentence says so — so it is read as the
assumption it is.

**Cost accepted: a card written for one address book's parser may read differently in another.**
Three formats, two of them with implementations older than their specification, and no test in this
repository can settle what a phone will do with a `;` after it has been unescaped. The bytes are
pinned — every format's exact output is asserted, the escaping negative cases included — and the
decoder proves those bytes come back off the printed drawing; neither proves the import. That proof
is the phone matrix and the host proof in `docs/SPEC.md` §7: the card imports into Outlook and
Google Contacts intact, checked on a real machine by a person, per release. A defect that only the
address book can see is found there or not at all.

**Second cost: the warning is generic where the builder is specific.** The density sentence ends
with the same advice for every code, including one already written as a MECARD, while the
over-length refusal in the builder is careful not to suggest MECARD to somebody who is writing one.
Recorded as the smaller of two evils — a warning shown late is worse than a warning worded loosely
— and to be narrowed when the export screen takes over the size.

## ADR-023 — The logo is composed by the host into the bytes the gate decodes {#adr-023}

**Status: Accepted.**

**Context.** The scene the domain draws is an SVG, and the obvious place to put the logo is inside
it: one document, one renderer, nothing to keep in step. But the logo is a file somebody was sent.
Putting it in the scene means either embedding a foreign SVG inside our own or carrying a raster as
a data URI, and both put bytes this product did not write into the document it hands a renderer and
injects into the window — the exact thing [ADR-016](#adr-016) exists to prevent.

**Decision.** The scene carries the **plate** and nothing else of the logo. The plate is a plain
`<rect>` or `<circle>` the domain emits, so it is rasterised with the modules, by the same renderer,
in the same pass. The **logo image** is drawn by the Rust host into the pixmap, **before** the PNG
is encoded — so the bytes the independent decoder reads, and the bytes that are written to disk, are
the artefact with the logo on it ([ADR-010](#adr-010)). On screen the same normalised image is laid
over the figure as an `<img>`, positioned at the same box.

**Why.** A logo drawn after the verification is a logo nobody checked, and a verdict about a code
without its logo is a verdict about a picture nobody will print. Composing before the encode makes
the gate's claim cover the whole artefact, and it keeps a foreign document out of the SVG: the only
markup this product injects remains the scene its own domain serialised.

**Cost accepted: two renderers have to agree about one box.** The browser draws the overlay and the
host draws the export, and neither can see the other's result. The box is therefore stated once, by
the domain, in the scene's own units — modules with the quiet zone included — and both sides use it
as a fraction of one `viewBox`: the screen turns it into percentages of the figure's square, the
host turns it into pixels against the scale the renderer used. Nothing else converts. Held by the
end-to-end test, which reads the box back off the screen's own geometry, exports with it, and then
checks the **centre pixel of the exported file** is the logo's colour and that a third decoder still
reads the link off it. If the two ever drift, that test fails on the artefact rather than on paper.

## ADR-024 — The middle alignment pattern may sit under the plate {#adr-024}

**Status: Proposed.** Every other record here was settled by a table or by a test. This one
cannot be: no decoder in this repository can say what a phone will do with a symbol whose middle
alignment pattern is gone. So it is written as the proposal it is, the code carries it behind a
constant that is on by default, and it is accepted or rejected by the host proof — Alex, with two
phones, at the printed size (SPEC §6). **Accepting it** makes this the behaviour of every logo on
those twenty versions and turns the strict mode into an option nobody has to find.
**Rejecting it** means flipping the constant to `false`, which is one line and no interface at
all: the engine already knows how to walk past those versions, and a superseding record says why.

**Context.** Versions 7–13, 21–27 and 35–40 have an odd number of alignment centres, which puts
one of them in the middle of the symbol — at the exact centre on most of them, up to four modules
beside it on 22–27 and 36–40, where the standard's rounding shifts the row. A centred logo on
those versions cannot avoid it. Every other function pattern is avoidable by making the logo
smaller; this one is not, because the logo and the pattern want the same modules.
[ADR-013](#adr-013) says none of them is ever covered, so the engine's only other move is to
refuse the version and grow: from version 7 the next symbol with a free centre is version 14 — 45
modules a side become 73, a symbol 62 % wider and more than two and a half times the area, or, at
a fixed printed size, modules under two thirds of the size they were. That is a heavy price for
the smallest pattern on the symbol, and it is paid by every code on twenty of the forty
versions.

**Decision, proposed.** The plate may cover the middle alignment pattern, and only that one. It
is left out of the function-pattern map, so the modules under the plate are knocked out with the
rest and nothing of it shows at the plate's edge; the finders, the separators, both timing
patterns, every other alignment pattern, the format and version information and the dark module
stay untouchable in both modes. The behaviour is one constant, `ALLOW_CENTRE_ALIGNMENT` in
`src/domain/placement.ts`, on by default and threaded through `coverage`, `checkBox`,
`largestBox`, `knockOut` and `planCode` rather than read again inside each of them. With it off
the engine skips every version that has a middle alignment pattern, and that strict mode is not
theoretical — it is built and tested: content that lands naturally on version 7 at H is planned
onto version 14 instead. The scan gate ([ADR-010](#adr-010)) remains the judge of any individual
code: this record decides what the engine may offer, never what may leave.

**Why.** A decoder finds the symbol by its three finders, takes the grid from them and the timing
patterns, and reads the format information beside them — none of which the plate touches.
Alignment patterns refine the sampling grid where the symbol is large enough, or the surface
uneven enough, that the grid drifts from one corner to another, and the ones doing that work are
the outer ones, at the edges where the drift has accumulated. The middle one refines the middle,
which is where the plate is and where there is now nothing to sample. The budget this engine
spends is conservative on top of that: `SAFETY = 0.6` leaves 40 % of every block's correctable
capacity to print and camera, so a code that has given up its middle alignment pattern is not a
code sitting at the edge of what it can lose. The proof that it still reads is on the matrix, at
the first version where the case exists — version 7 at H, with the largest plate the budget
allows drawn over the pattern, decoded back to the same content by a decoder of a different
lineage — and the same content planned at version 14 with the exception off, so both halves of
the decision are held by the suite.

**Cost accepted.** This leans on what decoders tolerate rather than on the letter of ISO/IEC
18004, which draws that pattern and says nothing about a symbol that has covered it. No test here
can settle that: every decoder in the suite is software, reading a clean raster, held still, at a
scale of its own choosing — precisely the conditions under which a doubtful code passes. The
proof is the phone matrix, per release, and until it has been held against a code on one of these
versions the default is a bet, written down as one. If a camera fails on such a code the constant
flips, every code on those twenty versions jumps to the next free version and its modules get
smaller at the same printed size — which the module-size warning ([ADR-015](#adr-015)) then has
to say out loud, because somebody who printed at 25 mm yesterday is printing denser modules
today.

## ADR-025 — A look is gated before the scan gate, and function patterns are never reshaped {#adr-025}

**Status: Accepted.**

**Context.** A look is where somebody's taste meets a camera's tolerance, and both colours and
shapes can produce a code that is perfectly legible to a rasteriser and not to a phone. Grey on a
lighter grey separates at full precision in a clean raster and disappears under a restaurant's
lighting. A light code on a dark plate is something the encoder is entirely happy to draw and most
cameras will not look for. A grid of dots is still a grid of modules to a decoder given the grid —
but finding the grid is the part that comes first. [ADR-010](#adr-010) already says nothing leaves
that a decoder did not read back; the difficulty is that the gate answers about one artefact under
laboratory conditions (SPEC §9, R2), and it answers late — by then the person has chosen a look and
has no way of knowing which part of it was the mistake.

**Decision.** Three rules, all of them in the domain — `src/domain/style.ts` and
`src/domain/scene.ts` — and all of them decided before the host is asked for anything.

1. **Colours pass a contrast gate before the code is built.** The two print colours must be at
   least `MIN_CONTRAST = 4.5` apart on the WCAG 2 contrast ratio, computed from sRGB relative
   luminance, and the code must be the darker of the two. A look that fails is refused, in the
   domain, with a sentence that names which of the two rules it broke and, for contrast, the ratio
   it reached against the one it needed. Nothing is rasterised, nothing is decoded, nothing is
   offered for export.
2. **Shapes apply to data modules, and never to the patterns a decoder navigates by.** A module
   shape (square, rounded, dot) is drawn for data modules only; the three finder patterns take
   their own shape (square, or rounded with a corner radius of 0.75 module on the ring) and are
   drawn as three opaque shapes each — the ring in the code colour, the gap in the plate colour,
   the heart in the code colour — so that a rounded finder is a finder and not a decorated
   square. A circular finder is not offered, and the rounding is modest, on measurement: the
   host's decoder derives the grid's perspective from the finder's corners, and against it a ring
   rounded past a radius of one module reads at no size, a circle at none — every module shape
   read at every size. A shape the gate would never let out is not a choice. The timing patterns, the
   alignment patterns, the format information and the version information stay square whatever the
   data modules are, taken from the same function-pattern map the placement engine uses
   ([ADR-013](#adr-013)) — asked for without the exception [ADR-024](#adr-024) grants that engine,
   because where a plate is allowed over the middle alignment pattern those modules are gone
   already, and where there is no plate the pattern is drawn square like every other.
3. **A quiet zone under four modules is a warning, not a refusal.** Four is the number the
   standard asks for and the number the product defaults to; under it the domain returns a sentence
   — a different one when there is no quiet zone at all — and the code is still built.

**Why 4.5.** It is the threshold WCAG sets for text a person has to read, and it is used here as a
floor rather than as a target: a camera has to separate the two colours _and_ find the grid in
them, at an angle, at a distance, in whatever light the code was printed into. A threshold known to
be barely enough for a reader who can lean closer is a reasonable minimum for a reader who cannot.
Choosing a number of our own would have meant defending it with a proof this repository cannot
produce; choosing the one the accessibility world already defends means the number can be looked up.

**Why inverted is refused rather than warned.** Most phone cameras binarise the image expecting a
dark code on a light plate, and several will not attempt a symbol in the other polarity at all —
including, on some releases, the default camera applications the phone matrix is run against. The
ratio can be 21:1 and the code still unscannable, which is precisely the case a contrast number
cannot express, so it is a separate rule with its own sentence.

**Why the function patterns stay square.** A decoder locates the symbol by the three finders, takes
the grid's origin and pitch from the alternating runs of the timing patterns, refines it on the
alignment patterns, and reads the format information beside the finders before it reads any data. A
run of alternating dark and light modules is what those patterns _are_: a row of dots is a row of
separated discs, with light between every one of them, and a sampler measuring a period on it
measures the wrong thing. Reshaping them is the one part of a stylised code that attacks the step
before error correction exists — nothing can be corrected if the grid was never found. Data
modules, by contrast, are sampled at their centres, which is where a rounded corner or a dot puts
the ink. The default look is unchanged by all of this: with square modules and square finders the
scene is byte-identical to the one the product has written since its first slice, down to the
`shape-rendering` hint, which only becomes `geometricPrecision` when something was actually shaped.
Every one of the nine combinations of module and finder shape is rasterised and read back by a
decoder of a different lineage in the rule tests, and the export is verified by the host's decoder
like any other code.

**Cost accepted: a look the gate would have passed is refused by policy.** A ratio of 4.0 will
scan, at a sensible size, on a clean print — and this product will not build it. The gate is a
policy applied to the whole population of codes rather than a verdict about one of them, and a
policy is blunt by construction. It is paid deliberately: the alternative is a warning that people
learn to click past, on the one decision whose consequences show up only after printing. The number
sits in one constant, next to the reason it was chosen, so raising or lowering it later is one
change, argued once, and a superseding record.

**Cost accepted: a white logo on a white plate is not detected here.** SPEC §6 lists it among the
mandatory negative cases, and F6 does not answer it. The plate is the background colour by design —
that is what makes a mark sit clear of the modules instead of on top of them — so a white-on-white
logo is not a contrast defect in the code's colours, and the scan gate is unaffected either way:
the modules under the plate were knocked out before anything was drawn ([ADR-013](#adr-013)), and
the code verifies with or without a visible mark. What is invisible is the logo, and the logo's own
colours are the host's knowledge, not the domain's — the domain never sees the image bytes
([ADR-023](#adr-023)). The case therefore belongs where a code is judged as a picture rather than as
a payload: the Read screen in F10, which already has to say what it sees in an image somebody
photographed. Written down here so that the gap is a decision and not an oversight.

## ADR-026 — What is written is what was verified, with one named exception {#adr-026}

**Status: Accepted.**

**Context.** [ADR-010](#adr-010) fixed the order — nothing leaves that a decoder did not read
back, and the export writes _that_ buffer — at a time when there was one way out of the product.
F7 opens four. Each of them asks the same question in a different shape: what exactly are the
bytes the verdict is about? A PNG has pixels a decoder can read. A PDF is a container around
something. The clipboard is not a file at all. And an SVG has no pixels until something draws it —
and the thing that will draw it is somebody else's renderer, in somebody else's layout tool,
months later.

**Decision.** One sentence per way out, and the exception is named rather than smoothed over.

- **PNG — the verified pixmap _is_ the written file.** Unchanged from F0, with one addition: the
  encoder writes a `pHYs` chunk carrying the resolution the code was designed at, both axes, in
  pixels per metre — 300 dpi is 11,811, the number `pixelsPerMetre` in `src/domain/size.ts`
  computes — so the file states its own physical size instead of leaving it to whatever opens it
  next ([ADR-015](#adr-015)).
- **PDF — the page is the printed size, and what is on the page is the verified raster.** The
  `/MediaBox` is the physical size in points (millimetres × 72 ÷ 25.4, so 25 mm is 70.87 pt) and
  the verified PNG is embedded edge to edge. The PDF therefore carries the verified bytes: what a
  printer rips is the image a decoder read, at the size the person asked for. Writing the modules
  as vector paths would have looked better under a loupe and would have broken the rule — it is a
  second rendering of the scene, by a second code path, and [ADR-010](#adr-010) exists to forbid
  exactly that.
- **SVG — the written file is the very SVG string the decoder rasterised.** `sizedSvg` inserts
  `width` and `height` in millimetres immediately after the `viewBox` and touches nothing else, so
  the document inside is byte-identical to the one that was verified; placing it in a layout tool
  gives the size it was designed at. **Plus, when there is a logo:** the logo the host composed
  from the same stored bytes ([ADR-023](#adr-023)), embedded before `</svg>` as a `data:` image or
  as the normalised drawing inlined as a nested `<svg>` at the plate's box. Either way the file
  points at nothing outside itself — a `data:` URI carries its bytes inside the document, and the
  inlined drawing references nothing — which is the rule [ADR-016](#adr-016) set for everything
  this product writes.

  **This is the one place where the bytes written are not the bytes decoded**, and it is a
  decision rather than an oversight. An SVG has no pixels to verify: the host has to rasterise it
  to be able to say anything at all, and the raster it verified is the composed pixmap, logo
  included, exactly as for a PNG. What is written is the same scene that decoder read, plus the
  mark the host drew onto it from the same stored bytes. The alternative — refusing to embed the
  logo — exports a vector file with the brand missing from the middle, which is not the artefact
  anybody asked for. The gap is closed from the other side, in the end-to-end suite: a **third**
  renderer rasterises the **written** SVG and a third decoder reads the payload off it
  ([ADR-008](#adr-008), [ADR-011](#adr-011)).

- **Clipboard — the verified PNG's pixels, as an image, and never the payload text.** A payload on
  the clipboard is a paste into the wrong window: into the message somebody was writing, into a
  terminal, into a document that is about to be sent. The clipboard is an export like any other
  and goes through the same verification before anything is put on it.

**Why.** Four ways out is four chances to verify one artefact and write another, which is the one
bug [ADR-010](#adr-010) was written to make impossible and the one that reaches paper without
anybody noticing. Stating per format what the verified bytes are turns that from a property
somebody has to remember into a sentence a reviewer can hold against the code. And where the
property genuinely cannot hold, one paragraph saying so is worth more than a claim that is true of
three formats out of four.

**Cost accepted: the SVG asymmetry, stated.** A logo embedded after the raster was decoded is a
logo no decoder in this product read _in that document_. What is verified is the same mark in the
same box, rasterised by the same host; what is not verified is a foreign renderer drawing it. A
defect only such a renderer can produce — a `data:` image ignored, a nested `<svg>` positioned
differently — would be invisible to the gate. The end-to-end suite's third renderer is what
narrows that, and it narrows rather than closes it.

**Second cost: the size is bounded by the raster.** The host renders between
`MIN_PIXEL_SIZE` = 64 and `MAX_PIXEL_SIZE` = 4096 pixels square
(`src-tauri/src/imaging/render.rs`), and the export is that same raster, so a printed size and
resolution whose raster falls outside — 5 mm at 150 dpi is 30 pixels, 1000 mm at 1200 dpi is
47 244 — is refused by the domain before anything is rendered, with the sentence naming the
resolution to change (`checkPrintSize` in `src/domain/size.ts`, `MIN_PIXELS` and `MAX_PIXELS`
mirroring the host's constants). A refusal rather than a silent clamp, because a clamp writes a
file at a size nobody asked for; and a floor at all, because below it a code has fewer pixels than
modules and a decode that succeeded there would prove nothing. The two constants live in two
places and must agree; a host test and a domain test each pin their own, and a change to one
without the other is a refusal on one side that the other cannot explain.

## ADR-027 — The scan margin is a report, never a gate {#adr-027}

**Status: Accepted.**

**Context.** The scan gate answers one question about one artefact under laboratory conditions
(SPEC §9, R2): does this file read, clean, held still, at the scale the renderer chose. That is
the right question and it is not the whole of what somebody printing a menu, a bottle or a bus
shelter needs to know. The code that reads perfectly at 2,000 pixels is going onto paper, through
a press, under a phone held at an angle in poor light — and the honest thing to say about that is
not a verdict, it is a distance: how much abuse is left before it stops reading.

**Decision.** After a verdict, and only after one, the host degrades the render it already has
nine ways and hands each variant to the same decoder that produced the verdict:

| Degradation  | Variants                                         | Why that one                                                        |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| Shrunk       | 50 %, 33 %, 25 % of the pixel size               | printed small, or read from far — nearest-neighbour, the cruel one  |
| Blurred      | box blur, radius 1, 2 and 3 px at the pixel size | a camera that did not focus, or ink that spread                     |
| Recompressed | JPEG at quality 80, 50 and 25, decoded back      | the code that went through a chat application before it was printed |

Each variant reports its label and whether it read, and the screen shows them as short lines —
"Shrunk to 25 %: reads", "Blurred 3 px: fails". **It informs, and it never blocks.** It does not
gate an export, it does not change the verdict, and a code the gate passed is exportable whatever
the nine lines say. Nothing in F7 writes the margin down: it is a report about one render at one
moment, not evidence about a file that was written.

**Why.** The two questions are different, and answering the second one with a refusal would be a
category error. The gate answers _does this file read_ — a fact about one artefact, with one
correct answer, and it is requirement one (SPEC §4). The margin answers _how much abuse before it
does not_ — a set of measurements with no threshold anybody in this repository can defend. A clean
raster passing while a blurred one fails is **information**: it says this code is at the edge of
what a downscale can take, so print it larger or shorten the payload. Turned into a gate it would
become a number chosen by us, refusing codes that scan, and the first person to meet it would ask
which of the nine lines they are allowed to fail — a question with no answer. Shown as nine lines
it needs no threshold at all, because the person reading it knows what their code is going onto
and this product does not.

**Cost accepted: it is the host decoder's opinion, not a camera's.** One implementation (`rqrr`,
[ADR-019](#adr-019)) reading synthetic degradations of a clean render. A box blur is not a
defocus, a nearest-neighbour downscale is not a printer's screening, a JPEG quality is not a
phone's imaging pipeline — and the decoder that produced the verdict is the decoder that produces
the margin, so one that is generous in the first is generous in the second. The margin is
therefore written and read as an indication, in the same breath as the thing that actually
decides: the phone matrix, two phones at the printed size, per release (SPEC §6). A smaller second
cost: nine decodes cost what nine decodes cost, so the margin is asked for after the verdict and
is never on the path between a verdict and a file.

## ADR-028 — A saved code is its fields and the name of its scene, never an image {#adr-028}

**Status: Accepted.**

**Context.** Until F8 a code existed only while the window was open: typed, verified, written out,
and gone when the window closed. A library changes what the product is responsible for — a row in
a file somebody will open again in six months, after an update, after an escaping rule has been
corrected. There are three plausible things to keep, and two of them are traps. Keeping the
**rendered image** is the first: it reopens instantly, it can never be proved again, and it carries
whatever defect the encoder had on the day it was drawn — a picture of a code is not a code.
Keeping the **encoded string** is the second, and it is the more tempting one, because those are
the exact bytes a decoder read back — and it freezes every escaping bug in this product's history
into the person's own data, where a fix cannot reach it without a migration nobody could write
honestly.

**Decision.** A saved code is **the fields the person typed, the look, the size, which logo, and
the name of the scene it made** — nothing else. A brand kit is the same minus the payload.

- **The payload is stored as the form, never as the encoded string.** `payload_json` holds the
  `PayloadForm` the domain validated — SSID, given name, subject, latitude — and the `WIFI:`,
  `mailto:` or vCard string is produced by the builder again every time the code is rendered
  ([ADR-021](#adr-021), `DATA_MODEL.md`). So a corrected escaping rule reaches **every code already
  in the library**, with no data migration and nothing to re-derive. It follows that re-encoding can
  change the payload's hash and therefore invalidate a verification row written under the old rule.
  That is not a defect to be worked around: a code built by rules that have since been corrected has
  not been proved under the corrected ones, and the product says so instead of carrying the old
  verdict forward.
- **The scene's name is its SHA-256, computed in the domain.** `sceneHash` in
  `src/domain/library.ts` hashes the scene's SVG with `src/domain/sha256.ts`, a plain FIPS 180-4
  implementation that is part of the pure layer. The name of the scene is decided **where the scene
  is made**: the domain draws it, so the domain can say what it is, without a command round-trip and
  without the asynchronous, browser-only `crypto.subtle`. It is pinned twice — to the standard's own
  vectors and to the platform's digest, on the lengths where padding goes wrong.
- **Opening a code rebuilds it and asks the gate again.** The stored fields go back through the same
  builder, encoder, placement engine and scene renderer, and the hash of the rebuilt scene is
  compared with the stored one. Then the code is verified again, by the host's decoder, exactly as a
  code typed from nothing is ([ADR-010](#adr-010)) — the stored verification is never the export's
  token. **A saved code is not trusted, it is re-proven**, which is the only reading of "reopened
  exactly as it was" (SPEC §2.7) that a product making this product's claim is allowed to use.
- **A brand kit carries a look, a size and a logo, and never a payload.** `applyKit` returns what to
  set — style, error-correction floor, printed size, logo — and the form on screen is untouched. A
  kit that could carry a payload would be a code by another name, and applying it would silently
  replace what somebody had typed.
- **A logo in use is not deleted, and the refusal names what is using it.** `logo_id` is
  `ON DELETE RESTRICT` from both `codes` and `brand_kits`, and the host turns the constraint into a
  sentence that **names the kits and the saved codes** standing in the way. `CASCADE` would take
  them with it; `SET NULL` would leave a kit that quietly looks different the next time it is
  applied, which is the worst of the three because nobody sees it happen.
- **The Wi-Fi opt-out [ADR-018](#adr-018) promised is this slice's.** `redactForSave` blanks the
  password when the person clears "Save the password with this code", and the row is stored without
  it; every other kind is returned untouched. A redacted code still reopens, into the form it was
  saved from, and the screen asks for the password again before the gate can pass — `reopens`
  returns the builder's own refusal, so the sentence is the one the Wi-Fi form would have shown
  anyway. Kept, it is in the clear in the workspace file, and `SECURITY.md` says so in those words.

**Why the hash at all, rather than comparing the fields.** Two forms can be equal and produce
different scenes — a different encoder version, a different mask after a knock-out, a constant
changed in the placement engine. The scene is what the person saw and what the decoder read, so the
scene is the thing worth naming, and a 64-character name is cheap to store and exact to compare.
It is also what F8's proof of done is stated in (SPEC §7): the code reopens after a restart with
the **identical** scene, hashed, not with a scene that looks the same.

**Cost accepted: a code saved under an older build may rebuild to a different scene, and the product
has to say so.** Every one of the rules above points the same way — the library follows the code
rather than freezing it — so an improvement to the encoder, the placement engine or the style layer
can change the drawing a stored row produces. When the rebuilt scene's hash does not match the
stored one, the mismatch is **shown, never hidden and never silently overwritten**: the code is the
one the fields describe, it is verified again like any other, and the person is told that what they
are looking at is not byte-identical to what was saved. The alternative — keeping the image, or
keeping the encoded string — buys a match that means nothing, because it is a match against bytes
this product would no longer produce.

**Second cost: SHA-256 now exists twice in this repository.** The host already hashes with `sha2`
([ADR-019](#adr-019)), and the domain may not reach for it ([ADR-003](#adr-003)), so the pure layer
carries its own implementation of a standard that is not ours to get wrong. The two never hash the
same bytes — the host names payloads and artefacts, the domain names scenes — so the risk is not
that they disagree but that one of them is quietly incorrect, which a hash cannot show by looking
wrong. It is held down the only way it can be: pinned to the vectors in FIPS 180-4 and to the
platform's own digest, on the lengths where padding goes wrong. The alternative was a command
round-trip in the middle of the render loop, which is a worse trade: the scene would be named by a
process that did not draw it.

**Third cost: applying a kit copies, it does not subscribe.** The planned `codes.brand_kit_id` is
not in the migration. A kit is a starting point, so what it sets is copied into the code's own look
and size, and editing the kit afterwards changes nothing that was already made. That is the
behaviour the screen promises — one click sets the look — and it means there is no lineage to show
a person who wonders why their older codes did not follow the kit. Recorded here so that the
question has an answer.

---

## ADR-029 — A batch is the Create pipeline in a loop, and the host writes only inside the chosen folder {#adr-029}

**Status: Accepted.**

**Context.** Until F9 every code was made by a person watching it: typed into a form, refused with a
sentence they read, exported to a path they chose in a dialog. A batch takes the person out of the
middle of that — a file somebody else wrote decides what is built, what it is called and how many
times it happens — and it does so with two inputs this product already calls hostile. The **cells**
are strings from a colleague's spreadsheet or an export out of an HR system, and one of them names a
file; the **report** is then opened in the spreadsheet those cells came from. Both halves have a
known way to go wrong: a cell that is a path escapes the folder that was chosen, and a cell that
begins with `=` is a formula in whatever opens the report. There is a quieter way to go wrong as
well, and it is the one that would cost the most — a "batch mode" that goes faster by proving less,
so that two hundred files leave under a claim that was tested on one of them.

**Decision.** A batch is the Create pipeline run in a loop, and nothing in it is a shortcut.

- **Every row is planned by the same three functions one code is.** `planBatch` in
  `src/domain/batch.ts` calls `buildPayload` → `planCode` → `renderScene` per row, with the look,
  the size, the error-correction floor and the logo the Create screen is carrying at that moment. So
  a batch **cannot make a code the screen could not**: the same builders and the same escaping
  ([ADR-021](#adr-021)), the same placement engine and its refusals ([ADR-013](#adr-013)), the same
  automatic error correction with a logo ([ADR-017](#adr-017)), the same contrast gate
  ([ADR-025](#adr-025)). A second rendering path for volume would be a second product, and the first
  defect it shipped would ship two hundred times.
- **A row that fails is a problem by line, and the loop goes on.** A refusal becomes
  `RowProblem { line, reason }`, carrying the domain's own sentence and the line **as the person
  sees it in the file** — counted through quoted fields, so a note with a line break in it does not
  shift every number after it. A row with the wrong number of fields, a link that is not a link, a
  card with no name, a logo that will not fit at that size: each is one line of the report, and none
  of them is a stop. The caps are the other half of that promise — 10 000 rows, 64 KiB per row,
  2 MiB per file — each refused with a sentence rather than by slowing to a halt.
- **The header decides what the batch is.** A `url` column makes a batch of links; `given_name` or
  `family_name` makes a batch of contact cards; anything else is refused before a row is read, with
  the sentence that names the columns it would have accepted. Guessing the kind from the cells would
  let the same file mean different things on different days.
- **A file name comes from a `name` column, or from the name the payload gives itself.** It then
  goes through `sanitiseFileStem`:
  normalised to NFC, stripped of control characters, every `\ / : * ? " < > |` replaced by `-`,
  runs of dots and of hyphens collapsed, spaces collapsed, leading and trailing dots and spaces
  trimmed, `.` and `..` and the empty string
  turned into `code`, a name Windows reserves (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9`, `CONIN$`, `CONOUT$`, with or without an extension) prefixed with `code-`, and cut
  to 80 characters. `fileNameFor` then prefixes the row number — `007-Ana Souza` — so the folder
  sorts in the order of the file it came from and two people with one name do not overwrite each
  other; a name already taken takes a `-2`. `../../evil` becomes plain `evil`: the separators were
  the danger and they are gone, and two dots in a row are collapsed even inside a name, so the
  domain never hands the host a leaf the host would refuse.
- **The host verifies each row exactly like an export, and writes it the same way.** Every file is
  rasterised, decoded by the independent decoder and compared byte for byte before it is written
  ([ADR-010](#adr-010)), and what is written is what was decoded ([ADR-026](#adr-026)), through a
  temporary name renamed into place. Two hundred files are two hundred verifications; a row that
  does not read back is `refused` in the report and there is no file for it. A file already in the
  folder under a row's name is **never replaced**: that row fails with a sentence and the file
  stays, so a list run twice into one folder is a report of failed rows, not a folder of replaced
  files. One run at a time: a second `run_batch` while one is going is refused, so Cancel always
  means the run on screen.
- **The folder chosen is the only place written.** The host canonicalises that folder once, and
  checks each leaf again on its own side of the boundary — one segment, no separator, no `..` — so a
  leaf that is not one segment is a **failed row, never a path**. The domain's sanitising and the
  host's check are deliberately the same rule written twice: the domain's is what makes a usable
  name, the host's is what makes the containment claim, and a claim that depends on the webview
  having been correct is not a claim.
- **The report is built by the domain and only written by the host.** `reportCsv` produces the whole
  file — `line,name,file,status,reason`, CRLF, in line order, one line per planned row and one per
  problem — with every cell escaped for CSV **and** neutralised by `csvCell`: a cell beginning `=`,
  `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe, so a spreadsheet reads
  it as text (the OWASP rule). The host writes that string beside the codes, through the same staged
  rename, and **never over a report that is already there** — a second run lands beside the first,
  not on top of it. CSV is written in exactly one place in this repository, which is what makes it
  possible to say it is safe.
- **The rows of a batch are append-only.** `batch_rows` refuses `UPDATE` outright and refuses
  `DELETE` while the batch is still there; deleting the whole run takes its rows with it, which is
  the one deletion that is not a rewrite of a report ([`DATA_MODEL.md`](../DATA_MODEL.md)). This is
  the reasoning behind the verification rows, applied to a run instead of a code: the report is
  evidence, and evidence that can be edited is not evidence.
- **Reading the CSV is the host's job, under a cap.** `read_text_file` is the second door in this
  product that reads a file a person chose in a dialog, after `import_logo`: at most 2 MiB, UTF-8 or
  a refusal, a local path only, and used by this screen alone. The interface still never reads a
  file itself — it hands over the path the dialog produced and receives text
  ([`SECURITY.md`](../../SECURITY.md)).

**Why the plan is shown before anything is written.** The person sees what the file would produce —
how many rows can be made, what each one will be called, and every problem by line — before they
choose a folder. A batch that asked for the folder first would put its refusals after the writing,
which is the order in which nobody reads them.

**Cost accepted: a negative number in a name cell is written as `'-1` in the report.** The rule that
neutralises `=HYPERLINK(...)` cannot tell a formula from a minus sign, because the spreadsheet
cannot either until it has evaluated it. So a row named `-1` is reported as `'-1`, and somebody
reading the report sees an apostrophe that was not in their data. It is the right side to be wrong
on: the apostrophe is visible and harmless, and the alternative is a report about hostile input that
is itself the attack. It is tested with `=HYPERLINK`, `+cmd`, `@SUM` and a plain `-1`, so the cost
is asserted rather than remembered.

**Second cost: 10 000 rows, and the whole plan is in memory.** The plan is materialised before a
single file is written — every row's scene, drawn and held — because the screen shows the plan first
and the host is handed rows that were already proved plannable. That is what makes the cap a number
rather than an intention: a longer list is split into two runs. Streaming the plan would buy an
unbounded batch at the price of the thing that makes this one honest, which is that every refusal is
known before the folder is chosen.

**Third cost: the paste door exists because a test cannot open a dialog, and it is a product feature
anyway.** The end-to-end suite drives the real binary ([ADR-008](#adr-008)), and a native file
dialog is outside what WebDriver can operate, so rows have to be able to arrive without one. Rather
than a hidden hatch the suite uses and nobody else has — a second way in, exercised only by tests,
is a second product — the screen takes pasted rows in a plain `TextArea`, for everybody, and says
so. It reads nothing: the text was already in the person's clipboard, and it goes through the same
parser the file does. The cost is one more place a batch can start from; the gain is that the path
the tests prove is the path people use.
