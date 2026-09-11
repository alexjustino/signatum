# Data model

> **Status: proposal until F0 lands `001_init`; the SQL wins over this text.** Columns named
> here for later slices are a plan, not a promise — each is confirmed, or changed, by the
> migration that introduces it.

The authoritative schema is `src-tauri/migrations/`. This document explains _why_ it is shaped
the way it is; the SQL explains what it is.

## The nouns

> A **code** is a payload, a look and a size.
>
> A **verification** is the scan gate's record: an independent decoder, named and versioned,
> read these exact bytes back and got this exact payload (ADR-010). A code with no verification
> row for its current scene is not exportable — not by the export command, not by the clipboard,
> not by a batch.
>
> A **logo** is what was let in, normalised — never the file that arrived (ADR-016).
>
> A **brand kit** is a logo, colours and a style, applied to a new code in one click.
>
> A **batch** is one CSV turned into files, with a report of every row that says what happened
> to it.

## Tables

| Table               | Holds                                                             | Arrives |
| ------------------- | ----------------------------------------------------------------- | ------- |
| `schema_migrations` | which migrations have been applied, and when                      | F0      |
| `codes`             | a payload, a style and a size — one row per saved code            | F0      |
| `verifications`     | what a decoder read back from which bytes, and whether it matched | F0      |
| `logos`             | the normalised logo, its hash and what normalisation changed      | F4      |
| `brand_kits`        | a logo, colours and a style, named                                | F8      |
| `batches`           | one run over one CSV                                              | F9      |
| `batch_rows`        | the report: one append-only row per line of that CSV              | F9      |

A `settings` table (key and value, an absent key meaning the default) arrives with the settings
screen and is not part of `001_init`.

## `schema_migrations`

| Column       | Type    | Meaning                                                   |
| ------------ | ------- | --------------------------------------------------------- |
| `version`    | INTEGER | primary key; forward-only, dense, never reused            |
| `name`       | TEXT    | the migration's file name, so a database can say what ran |
| `applied_at` | TEXT    | when it ran                                               |

## `codes`

F0 creates it with the payload, the style, the size and the timestamps; later slices add the
columns marked.

| Column         | Type | Meaning                                                                                                                                                                                 |
| -------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | TEXT | UUID v7                                                                                                                                                                                 |
| `payload_kind` | TEXT | `link` in F0; `text`, `email`, `phone`, `sms`, `wifi`, `geo` in F2 and `vcard`, `mecard` in F3, each widening the `CHECK` in its own migration                                          |
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

## `verifications`

One row per attempt, kept. The **latest row whose `scene_sha256` equals the code's current scene**
is the code's verification; its `id` is the token the export command must be given (ADR-010).

| Column             | Type | Meaning                                                                                              |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------- |
| `id`               | TEXT | UUID v7 — the verification token                                                                     |
| `code_id`          | TEXT | `ON DELETE CASCADE`: a verification has no meaning without its code                                  |
| `scene_sha256`     | TEXT | the scene that was verified, not the code it belonged to                                             |
| `artefact_kind`    | TEXT | `png`, `svg`, `pdf` or `clipboard`                                                                   |
| `artefact_sha256`  | TEXT | the exact bytes that were decoded — and, when the export succeeds, the exact bytes that were written |
| `payload_sha256`   | TEXT | the encoded payload the code was built from                                                          |
| `decoded_sha256`   | TEXT | what the decoder read back; `NULL` when it read nothing                                              |
| `decoder_name`     | TEXT | the independent decoder (ADR-011)                                                                    |
| `decoder_version`  | TEXT | its version, as reported by the library, not as written in a manifest                                |
| `outcome`          | TEXT | `verified`, `mismatch` or `not_decoded`                                                              |
| `reason`           | TEXT | one sentence when the outcome is not `verified`; empty otherwise                                     |
| `scan_margin_json` | TEXT | F7; how the artefact held up shrunk, blurred and recompressed. `{}` until then                       |
| `verified_at`      | TEXT |                                                                                                      |

```sql
CHECK (outcome <> 'verified' OR decoded_sha256 = payload_sha256)
```

The gate's central claim is one the schema can state, so the schema states it: a row cannot
_say_ `verified` while holding two different hashes, whatever wrote it.

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
scanned, which bytes, read by which decoder at which version, at what moment — and, because it
carries `scene_sha256`, _which version of the code_. That last part is what makes a stale
verification impossible rather than merely unlikely: change a colour and the current scene no
longer matches any row, so the export command has no token to be given (ADR-010). Keeping the
failures matters as much as keeping the successes — `mismatch` and `not_decoded` rows are the
record of what this product refused to let out, and they are what a person shows a printer who
insists the file was fine. A decoder upgrade is also a fact worth having: the rows say which
version proved what.

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

Numbered, forward-only, each applied inside a transaction, each recorded in `schema_migrations`.
`001_init` is F0's: `schema_migrations`, `codes` and `verifications`, and nothing else.

There is no down-migration. A mistake is corrected by a new migration, never by rewriting an
applied one: an applied migration is history, and that history has already run on somebody's
machine.

Every release that adds a migration is covered by a round-trip test that opens a database at
version N-1 and migrates it without loss — including the blobs, which are the part a careless
table rebuild loses quietly.
