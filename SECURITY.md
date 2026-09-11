# Security Policy

## Supported versions

The latest release is supported. Fixes land on `main` and reach you as the next
release; there are no long-term support branches.

| Version         | Supported |
| --------------- | --------- |
| `main`          | yes       |
| earlier commits | no        |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That channel is private to the maintainer.

Please include what you can: affected version or commit, environment, reproduction steps,
observed impact, and any proof of concept. You will get an acknowledgement within a few days
and an assessment of severity and remediation once the report is reproduced.

Please do not disclose publicly until a fix is released, or until we agree a date together.

## Threat model

Signatum is a **single-user, local-first desktop application**. It has no server, no account and
no network surface. What makes its threat model worth writing before the first line of the
product is what it sits between: it **opens files people receive from other people** — a logo
from a marketing folder, an SVG from a website, a CSV from a colleague — and it **writes codes
that other people's phones will act on**. Everything below follows from taking both halves
seriously.

- **No network.** The application makes no outbound requests. There is no account, no telemetry,
  no crash reporting, no update check, no link preview, no favicon fetched for a URL and no
  shortener. **The product never contacts the address a code opens** — not to validate it, not to
  resolve it, not to render a thumbnail of it. The Tauri content security policy blocks external
  origins.
- **SVG is hostile.** An imported SVG is parsed into a normalised tree that has no scripts, no
  event handlers, no external references, no `foreignObject` and no entities, with limits on size
  and node count. What is exported is **re-serialised from that tree**, never the bytes that came
  in — so nothing that arrived in a file can leave in one.
- **Raster is hostile.** Dimensions are read from the header and capped **before a pixel is
  decoded**, which is what stops a decompression bomb; the frame count is capped for GIF; and a
  truncated or mislabelled file is a sentence on screen, not a panic and not a hang.
- **Payloads are escaped to their format.** vCard, MECARD and Wi-Fi each have reserved
  characters, and a name with a semicolon must not become a second field. Escaping is a rule of
  the pure domain, with the negative case tested for every kind.
- **Links are shown as they will resolve.** Only `http` and `https`, plus the payload kinds' own
  schemes (`mailto`, `tel`, `sms`, `geo`, `WIFI`); anything else is refused. An
  internationalised domain is shown in Unicode **and** in punycode, so a look-alike domain is
  visible before it is printed rather than after.
- **Batch files stay in the folder chosen.** File names built from CSV cells are sanitised: no
  path separator, no `..` and no reserved Windows name reaches the filesystem. The batch
  **report** is itself a CSV, and it is written with formula injection neutralised — a cell
  beginning `=`, `+`, `-` or `@` cannot become a formula in whatever opens it.
- **Wi-Fi passwords are stored locally, in the clear, unless the person chooses not to save
  them.** This is a deliberate trade and not an oversight: the screen says so, in plain words,
  where the password is typed.
- **Minimum capabilities.** Tauri 2 capabilities are declared explicitly, one by one. Files are
  read and written **only** through paths the person chose in a system dialog; nothing in the
  product enumerates a directory or follows a path it was not handed. Shell execution is not
  granted.

### What the tests must refuse

The hostile corpus is mandatory and lives in `cargo test`; each of these is refused or
neutralised with a sentence, in under a second, never as a crash and never as a hang:

- an SVG with `<script>`
- an SVG with an `onload` handler
- an SVG with an XML entity
- an SVG with an external `href`
- an SVG with a `foreignObject`
- an SVG with a million nodes
- a PNG that inflates to gigapixels
- a truncated JPEG
- a GIF with ten thousand frames
- a zero-byte file
- a PNG named `.svg`

### Out of the threat model, stated plainly

An attacker with write access to your Windows user account, or with physical access to an
unlocked machine, can edit the database and the logos in it — because they can edit any file you
can. The database is not encrypted at rest. Full-disk encryption (BitLocker) protects the file at
rest; nothing protects it from a process running as you.

A compromised interface — a poisoned front-end dependency, say — could ask the host to write a
verified code over any `.png` on a local drive, because the host trusts the path the interface
hands it after the save dialog. It cannot make the host write anywhere else: the path has to be
a local `.png`, never a network path, and the bytes are always a code that read back. The
dialog plugin may only save; nothing in the interface can read a file or walk a directory.

## Distribution integrity

Every release, from the first one, is built by the release workflow on GitHub-hosted runners,
from a tagged commit, and attached to the GitHub Release. The SHA-256 of each installer is published in the release notes.
Verify what you install came from this repository's Releases page, and that its hash matches.

Installers are **not** code-signed in 1.0.0: Windows SmartScreen will warn on first run. That is
expected, and is a cost decision rather than a security posture — it is recorded in the project's
architecture decisions.
