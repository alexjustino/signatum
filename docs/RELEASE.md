# Releasing Signatum

The flow is in [`VERSIONING.md`](../VERSIONING.md); this is the checklist that
runs it. Every step is a command or a thing a person looks at, in order, and
nothing here is optional — a release that skipped a step is a release nobody
can reason about afterwards.

## Before the tag

1. **The slice branches are merged** into `develop` and CI is green on it.
2. **Bump the version** in `src-tauri/tauri.conf.json`. Mirror it into
   `package.json` and `src-tauri/Cargo.toml`, then prove they agree:

   ```bash
   npm run check:version
   ```

3. **Close the changelog.** Move `[Unreleased]` into `[X.Y.Z] — YYYY-MM-DD`.
   Write it for somebody who has never seen the product, not as a diff against
   the last commit. Note any migration the release adds, as
   `VERSIONING.md` requires.
4. **Run the whole battery**, which builds the installers and checks them:

   ```bash
   npm run release:check
   ```

   That is `npm run gates`, then `tauri build`, then `check:bundle` — which
   fails if an installer is over 20 MB, if `dist/` carries source, or if the
   binary was not stripped.

5. **Run the end-to-end suite against the release binary**, not the debug one.
   This is the closest thing to a clean machine that a developer machine can
   offer: a workspace created from empty, migrated from nothing, driven through
   the real product — and every file it exports read back from disk by a third
   decoder.

   ```bash
   $env:SIGNATUM_E2E_APP = "$PWD\src-tauri\target\release\signatum.exe"
   $env:SIGNATUM_E2E_EDGEDRIVER = '<the path to msedgedriver.exe>'
   npm run e2e:only
   ```

6. **The phone matrix.** A person, with two phones, scans printed codes: the
   **iOS default camera and the Android default camera**, at the printed size,
   from 30 cm, over every payload kind with a logo. Not simulated, not a
   screenshot, not a decoder in a test process — a camera in a room. A release
   ships only when the whole matrix reads back what was encoded.
7. **The name sweep, repeated.** Re-run the collision check behind
   [`SPEC.md`](SPEC.md) §0 — GitHub, npm, crates.io, the domains, the Microsoft
   Store, USPTO and INPI — and record what changed since the decision. Risk R8
   is the reason: a name is only clear on the day somebody looked.
8. **Install the MSI and use it.** The suite cannot judge how a print looks,
   cannot hold a card at arm's length, and cannot hear a screen reader. A
   person does:
   - install, launch, and make a code from a typed link;
   - import a logo, push it to the largest the engine allows, and export SVG,
     PNG and PDF;
   - open each exported file and check it is what the screen showed;
   - print the PDF and measure it — a 25 mm code is 25 mm on paper;
   - run a batch over a CSV and read the report;
   - back up, change something, restore, and check the change is gone.

## The tag

9. **Open a pull request from `release/vX.Y` into `main`.** `main` is always
   releasable; it receives releases and nothing else.
10. **Merge it, then tag `main`:**

    ```bash
    git checkout main && git pull
    git tag vX.Y.Z
    git push origin vX.Y.Z
    ```

11. The **Release workflow** runs on the tag: gates, build, bundle check, and a
    **draft** GitHub Release with the MSI and the NSIS installer attached. It is
    a draft on purpose — somebody reads the notes before the world does.
12. **Edit the draft release notes** from the changelog, add the SHA-256 of each
    installer, then publish.
13. **Merge `main` back into `develop`** so the release commits are not stranded.

## After

- The installers are unsigned; SmartScreen warns on first run. The README and
  the release notes both say so, and neither pretends otherwise.
- If a fix is needed before the next minor, branch `release/vX.Y` from the tag,
  fix, and cut `vX.Y.Z+1` the same way.
