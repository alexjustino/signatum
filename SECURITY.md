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
- **SVG is hostile.** Scripts, event handlers, entities, `foreignObject` and any reference to
  something outside the document are found by a text scan **before a parser is given the file**,
  and each is a refusal. Then the caps: at most 20,000 elements, at most 1 MiB. Only after all of
  that is the document parsed, with no resources directory, so the parser cannot reach the disk.
  What is stored and what is exported are **re-serialised from the parsed drawing**, never the
  bytes that came in — so nothing that arrived in a file can leave in one.
- **Raster is hostile.** The file is refused above 20 MiB before it is read. Dimensions come from
  the header and are capped **before a pixel is decoded** — at most 8192 pixels a side and at most
  25 million in total — which is what stops a decompression bomb at kilobytes. A decoder may
  allocate at most 256 MiB. A GIF is read to its first frame and stops, so ten thousand frames
  cost what one costs. A JPEG whose scan never ends is refused as truncated, because half a logo
  is a logo somebody prints. A fully transparent image is refused. What is stored is the decoded,
  capped image re-encoded as our own PNG, at most 1024 pixels on its longest side.
- **The format is the bytes, never the extension.** A PNG named `.svg` is imported as a PNG, and
  the screen says so; the name decides nothing and is used for that sentence alone. A file's name
  is also never a path: it is reduced to a label before it is stored, and a name Windows reserves
  is refused.
- **The scene is serialised, never assembled from strings the person typed.** The SVG the window
  shows and the host rasterises is built by the domain from booleans and numbers; a colour has to
  be a six-digit hex value before it reaches the markup, and the one text inside it — the title
  that names what the code does — is escaped for XML. The scene carries no script, no reference
  and no image; the logo is composed by the host from its own stored bytes.
- **Payloads are escaped to their format.** vCard, MECARD and Wi-Fi each have reserved
  characters, and a name with a semicolon must not become a second field. In a `mailto:` the name
  before the @ is percent-encoded exactly as the subject and the body are, so a `?` inside an
  address cannot open a field nobody typed; in a Wi-Fi payload the backslash is escaped before
  anything else, so a network name ending in one escapes itself rather than the separator that
  follows it. In a vCard the same rule governs the shape of the line as well as its content: a
  logical line is folded at 75 octets with a CRLF and a space, counted in UTF-8 octets and never
  inside a multi-byte sequence, so a fold cannot split a character into a byte an importer will
  read as something else. Escaping is a rule of the pure domain, with the negative case tested for
  every kind.
- **Links are shown as they will resolve.** Only `http` and `https`, plus the payload kinds' own
  schemes (`mailto`, `tel`, `SMSTO`, `geo`, `WIFI`); anything else is refused. An
  internationalised domain is shown as it will resolve — in punycode today, with the Unicode form
  beside it when the Read screen arrives (F10) — so a look-alike domain is
  visible before it is printed rather than after.
- **Batch files stay in the folder chosen, and this is now what the code does (F9, ADR-029).** A
  file name built from a CSV cell is reduced to one file name before anything is written:
  normalised, stripped of control characters, every `\ / : * ? " < > |` replaced, leading and
  trailing dots and spaces removed, `.` and `..` and an empty cell turned into `code`, a name
  Windows reserves (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, `CONIN$`, `CONOUT$`,
  with or without an extension) prefixed, and the whole thing cut to eighty characters and given
  the row's number in front. The host then makes the containment claim on its own side: the chosen
  folder is resolved once, and a leaf that is not a single path segment is a **failed row, never a
  path** — so the rule is written twice, and the claim does not rest on the webview having been
  correct. Each file is verified by the decoder and written through a staged rename, exactly as a
  single export is, and a file already in the folder under a row's name is never replaced — the
  row fails and says so.
- **The batch report is a CSV, and a report about a hostile list must not be a hostile report.**
  Every cell is escaped for CSV and neutralised: a cell beginning `=`, `+`, `-`, `@`, a tab or a
  carriage return is written with a leading apostrophe, so whatever opens the report reads it as
  text and never as a formula. The report is written beside the codes and never over a report that
  is already there. The cost is deliberate and visible: a name that is a negative number is written
  as `'-1`. Rows can also be **pasted** into the screen instead of opened from a file; that door
  reads nothing from disk — it is text the person already had, parsed by the same parser.
- **Wi-Fi passwords are stored locally, in the clear, unless the person chooses not to save
  them.** This is a deliberate trade and not an oversight: the screen says so, in plain words,
  where the password is typed. **The choice exists as of the library (ADR-018, ADR-028):** saving a
  Wi-Fi code offers "Save the password with this code", and it is what the tick means. Kept, the
  password is written into the workspace database as plain text, beside everything else in it —
  anybody who can read that file can read it, and the file is not encrypted at rest. Cleared, the
  code is saved without the password and asks for it again when it is reopened, so nothing about
  that network is in the file. Either way the printed code itself carries the password in plain
  text, because that is what a Wi-Fi code is; what this choice governs is only what the workspace
  keeps afterwards.
- **Minimum capabilities, and two doors that read a file.** Tauri 2 capabilities are declared
  explicitly, one by one. Files are read and written **only** through paths the person chose in a
  system dialog; nothing in the product enumerates a directory or follows a path it was not handed.
  Shell execution is not granted. Exactly two host commands read a file, each under its own caps:
  `import_logo`, which refuses above 20 MiB and hands back a normalised image or a sentence, and —
  since the batch (F9) — `read_text_file`, which reads the chosen CSV at no more than 2 MiB, as
  UTF-8 or a refusal, from a local path only, refusing a name Windows reserves for a device before
  it is opened, and is used by that one screen. A batch's folder is
  the third thing a dialog hands over, and it is the only place a batch writes.
- **What leaves is an image, and it lands only where a dialog said.** Copying a code puts the
  **verified image** on the clipboard and never the payload text: a payload on the clipboard is a
  paste into the wrong window — into the message somebody was writing, or into a terminal — and
  nothing about a code needs the clipboard to carry it as text. An export writes only through the
  path a save dialog produced, and the SVG and the PDF (F7) join the PNG under the same three
  checks the host already applies: the path came from the dialog, its extension is the kind being
  written, and it is on a local drive — a network path is refused. The bytes written are always a
  code that read back (ADR-010, ADR-026).

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
- a fully transparent image

### Out of the threat model, stated plainly

An attacker with write access to your Windows user account, or with physical access to an
unlocked machine, can edit the database and the logos in it — because they can edit any file you
can. The database is not encrypted at rest. Full-disk encryption (BitLocker) protects the file at
rest; nothing protects it from a process running as you.

A compromised interface — a poisoned front-end dependency, say — could ask the host to write a
verified code over any file on a local drive whose extension is one this product writes (`.png`,
and `.svg` and `.pdf` from F7), because the host trusts the path the interface hands it after the
save dialog. It cannot make the host write anywhere else: the path has to be local and to carry
the extension of the kind being written, never a network path, and the bytes are always a code
that read back. A batch widens that by a folder rather than by a kind: the host writes as many files
as the run has rows, but only inside the one folder the dialog returned, and only names that are a
single path segment. The same
interface could ask the host to read any one file on a local drive — as a logo, or as the text of a
CSV — because the open dialog hands it a path and the host reads the path it is given: it is read
once, under the cap for that door, and what comes back is a normalised image, at most 2 MiB of
UTF-8 text, or a sentence. A network path is refused on every door. The dialog plugin may only open
and save; the interface itself never reads a file, and nothing in the product walks a directory.

## Distribution integrity

Every release, from the first one, is built by the release workflow on GitHub-hosted runners,
from a tagged commit, and attached to the GitHub Release. The SHA-256 of each installer is published in the release notes.
Verify what you install came from this repository's Releases page, and that its hash matches.

Installers are **not** code-signed in 1.0.0: Windows SmartScreen will warn on first run. That is
expected, and is a cost decision rather than a security posture — it is recorded in the project's
architecture decisions.
