# Contributing to Signatum

Thank you for considering a contribution. This document is short on ceremony and precise
about the few rules that are not negotiable.

## Ground rules

1. **Green gates before anything.** `npm run gates` must pass locally, and CI must be green
   before a pull request is merged. There is no "I'll fix it after".
2. **One commit, one concern.** Stage per file. Never `git add .` blindly, never squash
   unrelated work together.
3. **Verified running, not just compiling.** If a change touches a screen, open the screen in
   the real application, in both light and dark theme, and drive it with the keyboard. If it
   touches an export, open the file that was written. A green type-check is not evidence that a
   UI works.
4. **Documentation is part of the delivery.** Behaviour, contract or procedure changed?
   The README, ADR, CHANGELOG, SPEC, DATA_MODEL or DESIGN_SYSTEM changes in the same pull
   request.

## The architectural boundary

This is the one rule that a reviewer will always check.

> `src/domain/` must never import from `src/data/`, `src/ui/`, `src/features/`,
> `react`, or `@tauri-apps/*`.

`domain/` is pure: the payload builders and their escaping, the QR matrix across versions 1–40
with its modes, masks and penalty, the function-pattern map, the logo placement engine, contrast,
physical sizing and the CSV batch planner. It performs no I/O and knows nothing about the UI or
the host. That is what makes the hard parts of this product unit-testable without opening a
window or writing a file.

The rule is enforced twice, on purpose: by ESLint `no-restricted-imports`, and by an
architecture test that fails CI. A rule without a gate is not a rule.

Business logic does not live in Rust either. `src-tauri/` is a thin repository plus the
operating-system surface: CRUD, transactions, migrations, image decoding with limits, SVG
normalisation, rasterisation, the independent decoder, and the PNG and PDF writers.

## The security rule

This product opens files people receive from other people, and writes codes that other people's
phones will act on. Two things are never negotiable, whatever the feature:

- **Every file the product opens is hostile.** A logo, an SVG, a CSV, an image to read — each is
  capped from its header before it is decoded, parsed by a reader that never panics, and
  re-serialised from a normalised tree rather than passed through. The original bytes of an
  imported file never reach an exported one.
- **Every exported artefact must have been decoded by a decoder that did not make it.** The scan
  gate is a correctness requirement, not a feature: the host rasterises the exact bytes that will
  be written, decodes them with a decoder of a different lineage from the encoder, compares the
  result with the payload byte for byte, and only then writes — and it writes the bytes it
  verified, never a re-render. A verifier built from the same code as the encoder would share its
  mistakes.

A change that touches **import, export or the scan gate** does not merge without the negative
test: the file that must be refused, the style that must not be exportable, the row that must be
reported rather than written. `SECURITY.md` is the threat model; a change that touches it changes
it.

## Branches

| Branch            | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `main`            | always releasable, tagged; updated only at a release |
| `develop`         | integration branch; pull requests target this        |
| `feat/*`, `fix/*` | one slice or one fix                                 |
| `release/vX.Y`    | release stabilisation                                |

**Both `main` and `develop` are protected on GitHub**, and the protection says
what this document says: a pull request is required, the gates and the dependency
audit must be green before it can be merged, and neither branch can be
force-pushed or deleted. A rule with no gate is a rule that eventually gets
bypassed — including by the person who wrote it.

Tags follow SemVer: `vMAJOR.MINOR.PATCH`. See [`VERSIONING.md`](VERSIONING.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), imperative mood, 72 characters
or fewer in the subject, no trailing period.

```
<type>(<scope>): <description>
```

**Types** — `feat` `fix` `refactor` `docs` `test` `chore` `style` `perf` `build` `ci`

**Scopes** — the module's canonical token:
`payload` `contact` `logo` `placement` `look` `size` `export` `gate` `library` `brands`
`batch` `read` `settings` `diagnostics` `about` `db` `domain` `host` `ui` `a11y` `ci` `docs`
`deps`

```
feat(placement): size the logo from the error-correction budget
fix(contact): escape a semicolon in a vCard name instead of splitting the field
test(gate): refuse an export whose raster decodes to a different payload
```

## Gates

```bash
npm run gates
```

runs, and all of them must pass:

| Gate                       | What it protects                                                               |
| -------------------------- | ------------------------------------------------------------------------------ |
| `check:version`            | the version is one fact in three files                                         |
| `cargo fmt --check`        | Rust formatting                                                                |
| `cargo clippy -D warnings` | Rust correctness and idiom                                                     |
| `cargo test`               | the host: the independent decoder, the hostile corpus, the writers, migrations |
| `tsc --noEmit`             | type correctness                                                               |
| `eslint`                   | **`react-hooks/rules-of-hooks` is an error**, plus the boundary rule           |
| `prettier --check`         | formatting                                                                     |
| `vitest`                   | domain rules, including negative cases                                         |
| `npm run e2e` (separate)   | the real binary through WebDriver — needs a debug build and `msedgedriver`     |

> A hook placed after an early return type-checks cleanly and crashes the screen at runtime.
> That is why the lint gate is mandatory and not advisory.

`npm run corpus` is not in that list and is not meant to be. It generates ten thousand randomised
codes and decodes every one of them with the host's decoder in a release build, which takes minutes
([ADR-020](docs/architecture/ADR.md#adr-020)). Run it yourself whenever you touch the encoder, the
decoder or the code between them, and say in the pull request that you did; otherwise the workflow
of the same name runs it on demand and once a week.

## Tests

The pyramid: rules in Vitest over `domain/` at **90% coverage** — every payload kind and its
escaping, the matrix against known-answer vectors, the function-pattern map for versions 1–40,
the placement engine, contrast, physical sizing and the CSV planner; the host in `cargo test` —
randomised round-trips through the independent decoder, the hostile-file corpus, PNG `pHYs`, PDF
physical size, export refusing unverified bytes, the append-only batch report and the migration
round-trip; a contract suite over `data/` proving the interface's shape matches the Rust serde
shape; an architecture test that fails if `domain/` imports React, Tauri or an outer layer;
axe-core over every screen in both themes inside the end-to-end suite, where serious and critical
findings fail; and **the end-to-end suite decodes exported files on disk with a third decoder** —
one that made neither the encoder nor the verifier — and gets the payload back.

New rules arrive with tests, **including the negative case**. For the placement engine the
following are not optional: a logo exactly at the budget and one module over it; version 1 with a
logo; the first version with a centre alignment pattern; a transparent logo; a white logo on a
white plate; a code with no quiet zone; inverted colours; colours one step under the contrast
threshold; and a payload that fits at L but not at H once the logo needs H.

## Pull requests

Target `develop`. One slice per pull request. The body uses the template: what changed, which
slice, the gates, what was verified running — on which screen, in which theme, and which exported
file was opened and decoded — the documentation that moved with it, the risk, and **what could
not be verified**. That last section is mandatory and is never empty; if everything was verified,
it says "nothing" in as many words.

## Reporting security issues

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Licence of contributions

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), consistent with the rest of the project.
