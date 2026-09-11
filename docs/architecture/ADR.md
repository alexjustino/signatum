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
white logo on a white plate) belongs to the same suite.

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
