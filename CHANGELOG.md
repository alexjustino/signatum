# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Create screen.** Type a web link and it becomes a QR code on screen, redrawn as you
  type. Beside the code, one line says what scanning it will do — "Opens example.com" — with
  the host shown as it will actually resolve, so a look-alike domain is visible before it is
  printed. Only `http` and `https` are accepted as links.
- **The scan gate, which is the product's whole claim.** Before a code can leave, the Rust host
  rasterises the exact drawing that is on screen, hands the pixels to a decoder that shares no
  code with the encoder that drew them, and compares what came back with what was asked for,
  byte for byte. The screen shows one of three states and no fourth: verified, not verified
  yet, or refused with the reason in a sentence.
- **Export to PNG, or no file at all.** The export writes the very bytes the decoder read —
  nothing is rendered a second time between the verdict and the file — through a temporary name
  renamed into place, so a half-written image never exists at the path somebody chose. A code
  that did not read back is refused, and the refusal leaves no file behind.
- **A record of every attempt, successful or not.** Each verification and each export writes a
  row to the workspace file: which decoder, at which version, read what, from which bytes, at
  what moment. Only hashes are kept — what a code carries is the person's business; whether a
  decoder read it back is the product's. A refusal is recorded as plainly as a success.
- **The application shell.** Four destinations — Create, Diagnostics, Settings and About — in
  the Windows 11 visual language, following the accent colour chosen for the desktop, in light
  or dark by choice or by the system. The theme is remembered between sessions.
- **The workspace file.** One SQLite database created on first launch and migrated forward,
  never rewritten backwards; Diagnostics says where it is, how large it is and which schema
  version it holds.
- **The QR encoder, vendored rather than depended upon.** Project Nayuki's reference TypeScript
  generator lives in the repository, pinned by hash, with each local change recorded beside it —
  because later slices have to reach inside the matrix to place a logo without breaking it.
- **The matrix itself, proven against the standard rather than against the encoder.** The domain
  now carries the reading half of the QR standard as well as the writing half: the format and
  version information a symbol is required to carry, the table of alignment-pattern positions, and
  the finders, separators, timing patterns and dark module every code must draw. A code is checked
  against the published tables — the ones anybody can look up — instead of against whatever the
  encoder believed it had drawn.
- **Every version, every level, every mode, every mask.** All 3,840 combinations the standard
  allows — forty sizes, four levels of error correction, numeric, alphanumeric and byte content,
  eight mask patterns — are built and read back on every run of the test suite, beside known
  answers copied from the standard's own tables and a decode by a foreign decoder at every size
  and every level.
- **Ten thousand codes, read back by the decoder the product ships with.** A generated corpus of
  ten thousand randomised payloads — reaching every one of the forty sizes, from a single
  character to the largest a code can hold, text in several scripts, and one payload that is not
  text at all — is handed to the Rust decoder as pixels. Each has to come back as the same bytes
  and to report the same version, level and mask the encoder claimed. Bytes, because a payload
  that is not valid text would hide a defect if it were compared as text. The corpus is generated
  from a fixed seed, so a failure can be reproduced by its number, and it is never committed.
- **The corpus runs on demand and once a week, not on every change.** Ten thousand codes take
  minutes and need the host built in release, so they are asked for by name — `npm run corpus` —
  and by a workflow of their own, while the sweep of every version, level, mode and mask stays in
  the battery that runs on every push.
- **A test suite that drives the real product.** The end-to-end suite starts the built binary,
  types a link, exports a file, and decodes that file from disk with a _third_ decoder — one
  that shares its lineage with neither the encoder nor the host's. Three independent readings of
  one code.
- **The validation battery.** Version agreement, `cargo fmt`, Clippy, Rust tests, TypeScript,
  ESLint, Prettier and the unit suite, run by one command and by CI on every push — plus a
  dependency audit, an end-to-end workflow and a release workflow that refuses an oversized
  installer or one carrying source.
- Full specification: the thesis, the closed list for 1.0.0, the release train, the
  non-functional targets, the vertical slices with a proof of done each, and the risks — with
  the name decided and the collision evidence it was decided on.
- Binding architecture decisions: the layers, the boundary rule for `src/domain/`, the scan gate
  and the logo placement engine.
- The data model: the schema and its forward-only migration policy.
- The threat model: no network, hostile SVG and raster, escaping per payload format, links shown
  as they resolve, batch files confined to the chosen folder, and the hostile corpus the tests
  must refuse.
- The design system contract: Fluent on Windows 11, one token source, canonical primitives and
  the official icon set.
- Contributor documentation: branch model, Conventional Commits with this product's scopes, the
  architectural boundary, the security rule, the gates and the pull-request template.
- Apache-2.0 licence and a NOTICE carrying both trademark statements — the project's own, and
  DENSO WAVE's for "QR Code".

[Unreleased]: https://github.com/alexjustino/signatum/compare/main...HEAD
