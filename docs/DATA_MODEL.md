# Data model

> **Status: `001_init` landed with F0; the SQL wins over this text.** What F0 ships —
> `workspace` and `verifications` — is reproduced below from the migration itself, and the
> migration is the authority. Everything else named here belongs to a later slice: it is a
> plan, not a promise, and each table and column is confirmed, or changed, by the migration
> that introduces it.

The authoritative schema is `src-tauri/migrations/`. This document explains _why_ it is shaped
the way it is; the SQL explains what it is.

## The nouns

> A **code** is a payload, a look and a size.
>
> A **verification** is the scan gate's record: an independent decoder, named and versioned,
> read these exact bytes back and got this exact payload (ADR-010). A code with no verification
> row for its current scene is not exportable — not by the export command, not by the clipboard,
> not by a batch. In F0 there is no library yet, so the check and the export are one call on one
> artefact: what was decoded is what is written, and nothing exists in between for a stale
> verdict to attach itself to.
>
> A **logo** is what was let in, normalised — never the file that arrived (ADR-016).
>
> A **brand kit** is a logo, colours and a style, applied to a new code in one click.
>
> A **batch** is one CSV turned into files, with a report of every row that says what happened
> to it.

## Tables

| Table           | Holds                                                             | Arrives      |
| --------------- | ----------------------------------------------------------------- | ------------ |
| `workspace`     | one row: which migration this file is at, and when it was made    | F0, shipped  |
| `verifications` | what a decoder read back from which bytes, and whether it matched | F0, shipped  |
| `logos`         | the normalised logo, its hash and what normalisation changed      | F4, proposal |
| `codes`         | a payload, a style and a size — one row per saved code            | F8, proposal |
| `brand_kits`    | a logo, colours and a style, named                                | F8, proposal |
| `batches`       | one run over one CSV                                              | F9, proposal |
| `batch_rows`    | the report: one append-only row per line of that CSV              | F9, proposal |

`codes` is the library's table, and the library is F8. F0 makes codes and proves them; it does
not keep them, and a table that exists with nothing writing to it is a promise the product has
not made yet.

A `settings` table (key and value, an absent key meaning the default) arrives with the settings
screen. F0's one setting — the theme — lives in the window's own storage until then.

## `workspace`, and where the schema version lives

There is **no `schema_migrations` table**. The version of the file is a column: `workspace` holds
exactly one row — `CHECK (id = 1)` — and `schema_version` on it is the number of the highest
migration that has been applied. This is the convention the sibling products use, and the runner
in `src-tauri/src/db/migrations.rs` expects it: the migrations are a list in the binary, in order,
where the index plus one _is_ the version that entry produces. Opening a workspace reads that one
number (a database that has never been migrated has no `workspace` table, and reports 0), then
applies every migration above it, each inside a transaction that bumps the column in the same
step. So the version and the schema can never disagree — either both moved or neither did.

The cost accepted: the file does not remember the _name_ or the date of each migration, only how
far it got. The names live beside the SQL, in the binary that ran them. In exchange there is one
number to read, nothing to join, and nothing that can claim a migration ran twice — which is what
Diagnostics shows beside the version the running build expects.

## `001_init`, as shipped

This is the migration, copied from `src-tauri/migrations/001_init.sql`. Where the two disagree,
the file is right.

```sql
-- Signatum — migration 001: the workspace, and the evidence that a code was read.
--
-- Migrations are forward-only and numbered. `workspace.schema_version` records
-- the highest migration applied. A release that adds a migration must be
-- covered by a round-trip test that opens a database at version N-1 and
-- migrates it without loss.
--
-- Every timestamp column is UTC, ISO 8601 with milliseconds and a trailing Z.

PRAGMA foreign_keys = ON;

-- ── Workspace ──────────────────────────────────────────────────────────────
CREATE TABLE workspace (
    id             INTEGER PRIMARY KEY CHECK (id = 1),   -- single row, by design
    schema_version INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO workspace (id) VALUES (1);

-- ── Verifications ──────────────────────────────────────────────────────────
-- The scan gate's record (ADR-010): every time this product rendered a code and
-- handed the pixels to an independent decoder, what the decoder read is written
-- down here — for an export and for a preview alike.
--
-- Only hashes are stored. The payload is the person's business; whether the
-- decoder read it back byte for byte is the product's. The last CHECK is the
-- promise in the schema itself: a row cannot claim a code was verified while
-- recording that the decoder read something else — or nothing at all. It is
-- written with `IS` rather than `=` on purpose: `NULL = 'abc'` is NULL, and a
-- CHECK that evaluates to NULL passes, so `=` would let a row claim a verified
-- code with nothing decoded. `IS` is the null-safe comparison and refuses it.
--
-- `codes` (the library) arrives with F8. Nothing else is kept in F0.
CREATE TABLE verifications (
    id             TEXT    PRIMARY KEY,
    created_at     TEXT    NOT NULL,
    kind           TEXT    NOT NULL CHECK (kind IN ('verify', 'export')),
    decoder        TEXT    NOT NULL,          -- name and version, e.g. "rqrr 0.10.1"
    verified       INTEGER NOT NULL CHECK (verified IN (0, 1)),
    payload_sha256 TEXT    NOT NULL,
    decoded_sha256 TEXT,                      -- NULL when no code was found
    artefact_sha256 TEXT   NOT NULL,          -- the PNG bytes that were decoded
    width          INTEGER NOT NULL,
    height         INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL,
    path           TEXT,                      -- only an export has one
    reason         TEXT,                      -- the sentence shown when not verified
    CHECK (verified = 0 OR decoded_sha256 IS payload_sha256)
);

CREATE INDEX idx_verifications_created ON verifications (created_at DESC);
```

## `verifications`

One row per attempt, kept — a verification and a refused export alike. The scan gate's record
(ADR-010): a decoder, named and versioned, read these exact bytes and got this exact payload.

**As shipped in F0:**

| Column            | Type    | Meaning                                                                                              |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `id`              | TEXT    | UUID v7                                                                                              |
| `created_at`      | TEXT    | when the attempt was made                                                                            |
| `kind`            | TEXT    | `verify` or `export` — whether a file was being asked for                                            |
| `decoder`         | TEXT    | the independent decoder, name and version in one string: `rqrr 0.10.1` (ADR-011, ADR-019)            |
| `verified`        | INTEGER | 0 or 1                                                                                               |
| `payload_sha256`  | TEXT    | the encoded payload the code was built from                                                          |
| `decoded_sha256`  | TEXT    | what the decoder read back; `NULL` when it read nothing                                              |
| `artefact_sha256` | TEXT    | the exact bytes that were decoded — and, when the export succeeds, the exact bytes that were written |
| `width`, `height` | INTEGER | the artefact's pixels                                                                                |
| `duration_ms`     | INTEGER | how long the render and the decode took together                                                     |
| `path`            | TEXT    | where the file went; `NULL` for a verification, and `NULL` for a refused export — no file went there |
| `reason`          | TEXT    | the sentence shown when the code was not verified; `NULL` when it was                                |

Only hashes. The payload is never stored by this table, which is why a refusal can be kept
forever without keeping what somebody typed.

```sql
CHECK (verified = 0 OR decoded_sha256 IS payload_sha256)
```

The gate's central claim is one the schema can state, so the schema states it: a row cannot _say_
it was verified while recording that the decoder read something else — or nothing at all.

It is written with `IS` rather than `=` on purpose. In SQL, `NULL = 'abc'` is not false, it is
`NULL`; and a CHECK that evaluates to `NULL` **passes**. With `=`, a row claiming `verified = 1`
with `decoded_sha256` null — precisely the case where the decoder found no code — would be
accepted by the database. `IS` is the null-safe comparison, and it refuses that row.

**Planned for later slices**, when the library gives a verification something to belong to:
`code_id` (`ON DELETE CASCADE` — a verification has no meaning without its code) and
`scene_sha256` (the scene that was verified, not the code it belonged to) arrive with `codes` in
F8, and `scan_margin_json` — how the artefact held up shrunk, blurred and recompressed — with F7.
From F8 the code's verification is the **latest row whose `scene_sha256` equals the code's current
scene**, and its `id` is the token the export command must be given; in F0 there is nothing to go
stale between the check and the export, because the two happen in one call on one artefact.

## `codes` — F8, proposal

The library's table. Not in `001_init`; the columns below are a plan.

| Column         | Type | Meaning                                                                                                                                                                                 |
| -------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | TEXT | UUID v7                                                                                                                                                                                 |
| `payload_kind` | TEXT | `link`, plus `text`, `email`, `phone`, `sms`, `wifi`, `geo` from F2 and `vcard`, `mecard` from F3, each widening the `CHECK` in its own migration                                       |
| `payload_json` | TEXT | the payload's **fields**, as the domain validated them — never the encoded string (see below)                                                                                           |
| `style_json`   | TEXT | foreground and background, module shape, finder shape, quiet zone, the error-correction level **and whether the engine chose it** (ADR-017), plate shape, padding and colour, logo size |
| `size_json`    | TEXT | the physical size (`{ value, unit }`), the resolution, and the module size those two imply (ADR-015)                                                                                    |
| `logo_id`      | TEXT | F4; `NULL` for a code with no logo. `ON DELETE RESTRICT`                                                                                                                                |
| `brand_kit_id` | TEXT | F8; the kit this code was started from, `NULL` if none. `ON DELETE SET NULL` — a kit is a starting point, not an owner                                                                  |
| `name`         | TEXT | F8; what the library calls it. Empty until the person names it, never `NULL`                                                                                                            |
| `scene_sha256` | TEXT | F8; the hash of the scene as last rendered. What F8's proof compares after a restart, and what a verification row is matched against                                                    |
| `created_at`   | TEXT |                                                                                                                                                                                         |
| `updated_at`   | TEXT | any edit to the payload, the style, the logo or the size touches it — and invalidates the verification                                                                                  |

`payload_json`, `style_json` and `size_json` are shapes the domain validates (ADR-003); SQLite is
not asked to understand them. The host stores them verbatim and parses only what it must to
render.

## `logos`

What is stored is what normalisation produced (ADR-016). For SVG that is the serialisation of the
normalised tree; for raster it is the decoded, capped image re-encoded as PNG.

| Column         | Type    | Meaning                                                                                                      |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `id`           | TEXT    | UUID v7                                                                                                      |
| `name`         | TEXT    | the original file name, sanitised — no separator, no `..`, no reserved Windows name                          |
| `format`       | TEXT    | what the **bytes** were: `png`, `jpeg`, `gif`, `webp` or `svg`. Not what the extension said                  |
| `storage_kind` | TEXT    | `svg` (the normalised tree, re-serialised) or `png` (decoded and capped)                                     |
| `bytes`        | BLOB    | the stored form. The bytes that arrived are not here and are nowhere else either                             |
| `byte_size`    | INTEGER | of `bytes`, for the library to show and for the caps to be checked against                                   |
| `sha256`       | TEXT    | of `bytes` — of what is stored, never of what arrived                                                        |
| `width`        | REAL    | pixels for a raster, user units for an SVG                                                                   |
| `height`       | REAL    | the same                                                                                                     |
| `view_box`     | TEXT    | the normalised SVG's `viewBox`; `NULL` for a raster                                                          |
| `note`         | TEXT    | what normalisation changed, in words — "first frame of 24", "colour profile dropped". Empty when nothing was |
| `imported_at`  | TEXT    |                                                                                                              |

## `brand_kits`

| Column         | Type | Meaning                                                                                                                |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`           | TEXT | UUID v7                                                                                                                |
| `name`         | TEXT | as typed, trimmed; never empty                                                                                         |
| `logo_id`      | TEXT | `NULL` for a kit that is only colours. `ON DELETE RESTRICT` — see below                                                |
| `colours_json` | TEXT | foreground, background, plate — the colours a kit carries, already through the contrast gate                           |
| `style_json`   | TEXT | module and finder shape, quiet zone, plate shape and padding, and the lowest error-correction level the kit insists on |
| `created_at`   | TEXT |                                                                                                                        |
| `updated_at`   | TEXT |                                                                                                                        |

## `batches`

| Column             | Type    | Meaning                                                                             |
| ------------------ | ------- | ----------------------------------------------------------------------------------- |
| `id`               | TEXT    | UUID v7                                                                             |
| `source_name`      | TEXT    | the CSV's file name, sanitised                                                      |
| `source_sha256`    | TEXT    | of the file as read, so a report can be matched to the file it came from            |
| `payload_kind`     | TEXT    | what every row of this batch was read as                                            |
| `output_dir`       | TEXT    | the folder the person chose in the dialog. Every file written is inside it          |
| `template_code_id` | TEXT    | the code whose style was applied, `NULL` once it is deleted (`ON DELETE SET NULL`)  |
| `brand_kit_id`     | TEXT    | the kit applied, if any (`ON DELETE SET NULL`)                                      |
| `row_count`        | INTEGER | data rows read from the CSV                                                         |
| `written_count`    | INTEGER | files written and verified                                                          |
| `refused_count`    | INTEGER | rows that produced no file                                                          |
| `started_at`       | TEXT    |                                                                                     |
| `finished_at`      | TEXT    | `NULL` while it runs                                                                |
| `outcome`          | TEXT    | `completed`, `completed_with_refusals`, `failed` or `stopped`; `NULL` while it runs |

## `batch_rows` — the report

**Append-only.** Two triggers refuse `UPDATE` and `DELETE`; no command edits a row; a batch with
rows cannot be deleted.

| Column            | Type    | Meaning                                                                                                         |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `id`              | INTEGER | autoincrement — the report's own order                                                                          |
| `batch_id`        | TEXT    | `ON DELETE RESTRICT`                                                                                            |
| `row_number`      | INTEGER | the line number **as the person sees it in the file**, header counted                                           |
| `status`          | TEXT    | `written`, `refused` or `skipped`                                                                               |
| `reason`          | TEXT    | one sentence for anything that is not `written` — which cell, and what was wrong with it                        |
| `output_filename` | TEXT    | the sanitised file name, with no path: the folder is the batch's (`output_dir`). Empty when nothing was written |
| `verification_id` | TEXT    | the row that proved the file (`verifications.id`); `NULL` when no file was written                              |
| `written_at`      | TEXT    |                                                                                                                 |

The report itself is exported as a CSV with formula injection neutralised (`=`, `+`, `-`, `@`) —
a report about hostile input must not be hostile output (SPEC §5).

## Conventions

**Identifiers** are UUID v7, which sort by creation time. `batch_rows` is the single exception:
its key is an autoincrement integer, because the report's order _is_ its sequence and nothing
else should decide it. **Timestamps** are UTC, ISO 8601 with milliseconds and a trailing `Z`;
local wall-clock time is never stored. **Hashes** are lowercase hexadecimal SHA-256, of the bytes
as stored or as written, never of an intermediate. **JSON columns** hold shapes the domain
validates (ADR-003); SQLite is not asked to understand them, and the host refuses unknown fields
where it parses one. **Booleans** are integers, 0 or 1. **Absence** is an empty string where a
value is a name or a sentence, and `NULL` only where the absence is structural — no row to point
at, no time to record. **Foreign keys are on**, and the behaviour on delete is chosen per
relation rather than taken from a default.

## Five decisions worth defending

**A verification is a row, not a flag on the code.** A flag says "this scanned"; a row says what
scanned, which bytes, read by which decoder at which version, at what moment. From F8 it also
carries `scene_sha256`, and so says _which version of the code_ — which is what makes a stale
verification impossible rather than merely unlikely: change a colour and the current scene no
longer matches any row, so the export command has no token to be given (ADR-010). Keeping the
failures matters as much as keeping the successes — the rows with `verified = 0` are the record
of what this product refused to let out, each with the sentence it refused them in, and they are
what a person shows a printer who insists the file was fine. A decoder upgrade is also a fact
worth having: the rows say which version proved what.

**The SVG that arrived is never stored.** `logos.bytes` holds the serialisation of the normalised
tree, and `logos.sha256` is the hash of that — the hash of what will be exported, not of what was
opened. Keeping the original "just in case" would mean a file with scripts and external
references sitting in the database, one careless read away from being written into an export; and
the moment two byte strings exist for one logo, something eventually writes the wrong one. The
cost is stated in ADR-016 and here: the only way back to the original is the original file.

**Logos are deleted with `RESTRICT`, never `CASCADE`.** Deleting a logo that a brand kit or a code
points at is refused, and the refusal **names the kits and counts the codes**. `CASCADE` would
take the kits with it; `SET NULL` would leave a kit that quietly looks different the next time it
is applied, which is the worst of the three because nobody sees it happen. A refusal that names
what is in the way is a sentence a person can act on — remove it from those kits, then delete it.

**The batch report is append-only.** A report that can be edited is not a report. Rows go in as
each line is decided and nothing rewrites them afterwards, so a batch that failed halfway has a
truthful record of where it got to, and a row that says `refused` still says so tomorrow. This is
the same reasoning as the verification rows, applied to a run instead of a code: the log is the
evidence, and evidence that can be updated is not evidence. Enforced by triggers rather than by
convention, because the path that forgets is always the one written next week.

**The payload is stored as fields, not as the string that gets encoded.** `payload_json` holds
what the person entered — name, surname, telephone, SSID, password — and the encoded string
(`vCard`, `MECARD`, `WIFI:`) is produced by the domain when the code is rendered. If an escaping
rule is fixed, every saved code gets the fix; if the encoded string were stored, the fix would be
a data migration over rows nobody can re-derive. It follows that re-encoding can change
`payload_sha256`, which invalidates old verification rows — correct, and exactly what should
happen: a code built by rules that have since been corrected has not been proved under the new
ones.

## Migrations

Numbered, forward-only, each applied inside a transaction that also raises
`workspace.schema_version` to the version it produces. `001_init` is F0's: `workspace` and
`verifications`, and nothing else.

There is no down-migration. A mistake is corrected by a new migration, never by rewriting an
applied one: an applied migration is history, and that history has already run on somebody's
machine.

Every release that adds a migration is covered by a round-trip test that opens a database at
version N-1 and migrates it without loss — including the blobs, which are the part a careless
table rebuild loses quietly.
