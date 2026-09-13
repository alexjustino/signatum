# Data model

> **Status: `001_init` landed with F0, `002_logos` with F4 and `003_export_formats` with F7 — schema
> version 3; `004_library` arrives with F8 and takes it to 4. The SQL wins over this text.** What
> has shipped — `workspace`, `verifications` and `logos` — is reproduced below from the migrations
> themselves, and the migrations are the authority. Everything else named here belongs to a later
> slice: it is a plan, not a promise, and each table and column is confirmed, or changed, by the
> migration that introduces it.

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
> A **batch** is one list — a CSV, or rows pasted in — turned into files, with a report of every
> row that says what happened to it.

## Tables

| Table           | Holds                                                             | Arrives      |
| --------------- | ----------------------------------------------------------------- | ------------ |
| `workspace`     | one row: which migration this file is at, and when it was made    | F0, shipped  |
| `verifications` | what a decoder read back from which bytes, and whether it matched | F0, shipped  |
| `logos`         | the normalised logo, its hash and what normalisation changed      | F4, shipped  |
| `codes`         | a payload, a style and a size — one row per saved code            | F8, arriving |
| `brand_kits`    | a logo, a look and a size, named                                  | F8, arriving |
| `batches`       | one run over one list of rows                                     | F9, arriving |
| `batch_rows`    | the report: one append-only row per row that run tried            | F9, arriving |

`codes` is the library's table, and the library is F8 — where it arrives, in `004_library.sql`,
together with `brand_kits`. Until then F0 to F7 make codes and prove them without keeping them, on
the principle that a table nothing writes to is a promise the product has not made yet.

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

**Arriving with F7, in `003_export_formats`** — two nullable columns, because a row written before
this migration ran cannot honestly claim either of them, and a verification that was not an export
has no format to record:

| Column   | Type    | Meaning                                                                                       |
| -------- | ------- | --------------------------------------------------------------------------------------------- |
| `format` | TEXT    | which way out was asked for: `png`, `svg`, `pdf` or `clipboard`. `NULL` for a row from before |
| `dpi`    | INTEGER | the resolution the size was designed at — 150, 300, 600 or 1200 (ADR-015)                     |

`width` and `height` already say how many pixels the artefact was; `dpi` is what turns that back
into a size on paper, and `format` is what makes a row about a PDF distinguishable from a row about
a PNG of the same code. Both landed with F7, in the SQL above.

**`scan_margin_json` is not among them.** It was planned here for F7, and F7 does not write it: the
margin is a report about one render at one moment, shown after a verdict and never stored
(ADR-027). The batch was the reason it might have been kept, and F9 did not keep it either: the
report says whether each row was written and why not, which is what a person acts on. If a reason
to keep it appears, it arrives in a migration of its own.

**Arriving with F8, in `004_library.sql`** — one nullable column, so that an attempt can say which
saved code it was about:

| Column    | Type | Meaning                                                                                    |
| --------- | ---- | ------------------------------------------------------------------------------------------ |
| `code_id` | TEXT | the saved code this attempt was about (`codes.id`); `NULL` for a code that was never saved |

`ON DELETE SET NULL`, and **not** `ON DELETE CASCADE` as this document planned. A verification row
is the record of what a decoder read, successes and refusals alike, and a refused export is evidence
a person shows a printer who insists the file was fine — deleting the code from the library should
not delete the fact that the product refused to let something out that day. The row keeps only
hashes, so one that outlives its code discloses nothing about what was typed. What is lost is the
ability to say _which_ code a stranded row belonged to, which is the smaller loss of the two.

**`verifications.scene_sha256` is not among them.** It was planned here for F8, and F8 does not add
it: the name of the scene lives on the code (`codes.scene_sha256`), and freshness is not a lookup. A
verification is the export's token in the process that produced it
([ADR-010](architecture/ADR.md#adr-010)), and a saved code reopened is rebuilt and **verified
again** rather than matched against an older row ([ADR-028](architecture/ADR.md#adr-028)) — so a
stored scene-to-verification join would be a second answer to a question the product deliberately
answers only one way. If listing a saved code's proof history ever needs it, it arrives in a
migration of its own.

## `002_logos`, as shipped

This is the migration, copied from `src-tauri/migrations/002_logos.sql`. Where the two disagree,
the file is right.

```sql
-- Signatum — migration 002: the logos that were let in, as they were normalised.
--
-- What is stored is never what arrived (ADR-016). For a raster, `bytes` is the
-- decoded, capped image re-encoded as our own PNG; for an SVG it is the
-- serialisation of the normalised tree. The file that came in is not kept — not
-- "just in case", not anywhere — because the moment two byte strings exist for
-- one logo, something eventually writes the wrong one, and the wrong one is the
-- one with the script in it. The cost is stated in ADR-016 and in DATA_MODEL.md:
-- the only way back to the original is the original file.
--
-- `sha256` is the hash of `bytes` — of what will be drawn and exported, never of
-- what was opened.
--
-- `kind` is how the bytes are drawn: a pixmap, or a tree. `format` is what the
-- bytes *were* when they arrived, which is a fact about the file and not about
-- its name: a PNG called `logo.svg` is stored here as `png`.

CREATE TABLE logos (
    id         TEXT    PRIMARY KEY,
    created_at TEXT    NOT NULL,
    name       TEXT    NOT NULL,                                   -- sanitised file name
    kind       TEXT    NOT NULL CHECK (kind IN ('raster', 'vector')),
    format     TEXT    NOT NULL,                                   -- png|jpeg|gif|webp|svg
    bytes      BLOB    NOT NULL,                                   -- normalised, never the input
    sha256     TEXT    NOT NULL,                                   -- of `bytes`
    width      INTEGER NOT NULL,                                   -- pixels, or the SVG viewBox
    height     INTEGER NOT NULL,
    note       TEXT                                                -- what normalisation changed
);

CREATE INDEX idx_logos_created ON logos (created_at DESC);
```

## `logos`

One row per logo that was let in, holding what normalisation produced and never what arrived
(ADR-016, ADR-023). For an SVG that is the serialisation of the parsed drawing; for a raster it is
the decoded image, capped at 1024 pixels on its longest side and re-encoded as PNG. The rules the
row is the result of live in `src-tauri/src/imaging/logo.rs`.

**As shipped in F4:**

| Column            | Type    | Meaning                                                                                        |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `id`              | TEXT    | UUID v7                                                                                        |
| `created_at`      | TEXT    | when the file was imported                                                                     |
| `name`            | TEXT    | the file's name reduced to a label — no separator, no `..`, no reserved Windows name, 80 chars |
| `kind`            | TEXT    | how the bytes are drawn: `raster` (a pixmap) or `vector` (a tree)                              |
| `format`          | TEXT    | what the **bytes** were: `png`, `jpeg`, `gif`, `webp` or `svg`. Not what the extension said    |
| `bytes`           | BLOB    | the stored form. The bytes that arrived are not here, and are nowhere else either              |
| `sha256`          | TEXT    | of `bytes` — of what will be drawn and exported, never of what was opened                      |
| `width`, `height` | INTEGER | pixels for a raster; the `viewBox`, rounded up, for an SVG                                     |
| `note`            | TEXT    | what normalisation changed, in one sentence — "Animated GIF: the first frame is used."         |

The plan this replaces asked for `storage_kind`, `byte_size`, `view_box` and `imported_at`. Three
of them were dropped rather than deferred: `kind` says how the bytes are drawn and `format` says
what they were, which is the pair the screen and the composer actually read; `byte_size` is
`length(bytes)`, and a stored copy of it is a second fact that can disagree with the first; and the
normalised `viewBox` is always the origin plus `width` and `height`, so a column for it would
restate them. `imported_at` is here under the name every other table uses, `created_at`.

## `codes` — arrives with F8

The library's table, in `004_library.sql`. A saved code is **its fields, its look, its size, which
logo, and the name of the scene it made** — never a stored image and never the encoded string
([ADR-028](architecture/ADR.md#adr-028)). Where this text and the migration disagree, the SQL is
right.

| Column         | Type | Meaning                                                                                                          |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `id`           | TEXT | UUID v7                                                                                                          |
| `created_at`   | TEXT | when it was first saved                                                                                          |
| `updated_at`   | TEXT | any edit to the name, the payload, the look, the logo or the size touches it                                     |
| `name`         | TEXT | what the library calls it: trimmed, one line, at most 80 characters, and never empty                             |
| `kind`         | TEXT | the payload kind as the domain names it — `link`, `text`, `email`, `phone`, `sms`, `wifi`, `geo`, `contact`      |
| `payload_json` | TEXT | the payload's **fields**, as the domain validated them — never the encoded string (see below)                    |
| `style_json`   | TEXT | the look: both colours, module and finder shape, quiet zone, and the error-correction floor if one was asked for |
| `size_json`    | TEXT | the printed size (`{ value, unit }`) and the resolution (ADR-015)                                                |
| `logo_id`      | TEXT | `NULL` for a code with no logo. `ON DELETE RESTRICT`                                                             |
| `logo_json`    | TEXT | what was chosen _about_ that logo — the plate and the size. `NULL` when there is no logo                         |
| `scene_sha256` | TEXT | the name of the scene at the moment it was saved: what reopening compares against                                |

`payload_json`, `style_json`, `size_json` and `logo_json` are shapes the domain validates
(ADR-003); SQLite is not asked to understand them, and neither is the host — it stores them as JSON
it has checked is JSON and small enough to be a form, and parses nothing else out of them. The
shapes are `PayloadForm`, `Style`, `PrintSize` and the chosen logo in `src/domain/`, which is where
a field added to one of them is added.

**Four things changed between the plan above and the migration.** `payload_kind` is here as `kind`,
the word the domain and the interface both already use for it
([one word, one meaning](../DESIGN_SYSTEM.md#one-word-one-meaning)). What was chosen about the logo
— the plate and the size — is its own `logo_json` rather than fields inside `style_json`, because it
is meaningless
without `logo_id` and it is `NULL` in exactly the same rows. `brand_kit_id` is gone: applying a kit
copies its look into the code, so there is no owner to point at and no lineage to keep — recorded as
a cost in ADR-028 rather than modelled as a relation nobody would maintain. And `name` is `NOT NULL`
and never empty, where the plan had it empty until the person typed one: a code is named when it is
saved, the interface offers a name derived from what the code carries, and an empty one is refused
with a sentence rather than stored as a row nobody can find again.

## `brand_kits` — arrives with F8

A look, a size and a logo, under a name, applied to a new code in one click. **A kit never carries a
payload** (ADR-028): what it sets is everything except what the code says.

| Column       | Type | Meaning                                                                              |
| ------------ | ---- | ------------------------------------------------------------------------------------ |
| `id`         | TEXT | UUID v7                                                                              |
| `created_at` | TEXT |                                                                                      |
| `updated_at` | TEXT |                                                                                      |
| `name`       | TEXT | as typed, trimmed, never empty — and `UNIQUE`, so two kits cannot share one name     |
| `logo_id`    | TEXT | `NULL` for a kit that is only a look. `ON DELETE RESTRICT` — see below               |
| `logo_json`  | TEXT | the plate and the logo size the kit carries. `NULL` when it has no logo              |
| `style_json` | TEXT | the same shape `codes.style_json` holds, already through the contrast gate (ADR-025) |
| `size_json`  | TEXT | the printed size and resolution the kit sets                                         |

The plan split the look into `colours_json` and `style_json` and gave a kit no size at all. Both
changed for the same reason: a kit is applied by one function in the domain (`applyKit`), and what
it returns is what a code stores — so a kit holds the code's own shapes, column for column, instead
of a second arrangement of the same facts that something would have to translate. The printed size
is in because a brand that prints at 40 mm prints at 40 mm; a kit that set the colours and left the
size behind would be applied and then corrected by hand every time.

`name` is `UNIQUE` because a kit is chosen from a list by its name. Two kits called _Brand_ is a
list where one of the two is a mistake nobody can see.

## `batches` — arrives with F9

One run, in `005_batches.sql`. A batch is the Create pipeline in a loop
([ADR-029](architecture/ADR.md#adr-029)): every row is rendered, decoded and compared exactly as a
single export is, and writes its own `verifications` row. What this table adds is the **run** — what
was asked for, where it was written, and how it ended. Where this text and the migration disagree,
the SQL is right.

| Column        | Type    | Meaning                                                              |
| ------------- | ------- | -------------------------------------------------------------------- |
| `id`          | TEXT    | UUID v7                                                              |
| `created_at`  | TEXT    | when the run started                                                 |
| `folder`      | TEXT    | the folder the person chose in the dialog. Every file is inside it   |
| `format`      | TEXT    | `png` or `svg` — one format for the whole run, chosen once           |
| `dpi`         | INTEGER | the resolution the size was designed at; `NULL` for a run of vectors |
| `rows_total`  | INTEGER | rows the run was handed — the ones the plan could make               |
| `written`     | INTEGER | files written and verified                                           |
| `refused`     | INTEGER | rows the gate would not let out                                      |
| `failed`      | INTEGER | rows the host could not write                                        |
| `skipped`     | INTEGER | rows the run never reached, because it was cancelled                 |
| `finished_at` | TEXT    | `NULL` while it runs                                                 |

The counts are written once, when the run ends, from rows that already exist — a summary of the
report and not a second opinion about it.

**Four things changed between the plan above and the migration.** `source_name` and `source_sha256`
are gone: rows can be **pasted** as well as opened from a file (ADR-029), so there is not always a
file to name, and a copy of somebody's file name and hash would be a record about a document this
product does not keep. `payload_kind` is gone because by the time the host is running a batch there
is no kind left to record — the domain planned every row and what crosses the boundary is a drawing
and a payload, which is the whole point of planning in the domain. `template_code_id` and
`brand_kit_id` are gone: a batch takes the look, the size and the logo the Create screen is carrying
at that moment, and applying a kit copies it rather than pointing at it (ADR-028), so there was no
row to point at. And `outcome` is gone as a word, because the five numbers beside it already say it:
a run with `refused > 0` completed with refusals, a run with `skipped > 0` was stopped, and a stored
adjective is the field that eventually disagrees with the counts it summarises. `started_at` is here
as `created_at`, the name every other table uses, and `output_dir` as `folder`, the word the command
and the screen both use.

## `batch_rows` — the report, arrives with F9

**Append-only.** One trigger refuses `UPDATE` outright. A second refuses `DELETE` **while the batch
is still there**, which is what makes deleting a whole run possible without making a report
editable: during the cascade the parent is already gone, so the rows follow it; a row deleted on its
own, out of a report that still exists, is refused.

| Column            | Type    | Meaning                                                                              |
| ----------------- | ------- | ------------------------------------------------------------------------------------ |
| `id`              | TEXT    | UUID v7                                                                              |
| `batch_id`        | TEXT    | the run this line belongs to (`ON DELETE CASCADE`)                                   |
| `line`            | INTEGER | the line number **as the person sees it in the file**, header counted                |
| `file`            | TEXT    | the sanitised file name, with no path: the folder is the run's (`folder`)            |
| `status`          | TEXT    | `written`, `refused`, `failed` or `skipped`                                          |
| `reason`          | TEXT    | one sentence for anything that is not `written`; `NULL` when there is nothing to say |
| `verification_id` | TEXT    | the row that proved the file (`verifications.id`); `NULL` when no file was written   |

**The four statuses are the four things that can happen to a row, and the domain names them**
(`RowStatus` in `src/domain/batch.ts`): `written` is a file a decoder read back; `refused` is a code
the gate would not let out; `failed` is a row the host could not write — a name that was not a
single path segment, a disk that said no; `skipped` is a row the run never reached, because it was
cancelled. The plan for this table listed three; `failed` is the distinction worth having, because a
code that did not read back and a file the filesystem refused are two different sentences to the
person holding the report.

`line` is the order, so the row's own key does not have to be: `id` is a UUID v7 like every other
table's, and the index is `(batch_id, line)`. `written_at` is not here — the run has its own two
timestamps, and a clock per row would be a third reading of the same minute. `verification_id` is
`ON DELETE SET NULL` for the reason `verifications.code_id` is: the report row is the fact that a
line was written or refused, and it outlives the evidence row it points at rather than vanishing
with it. Nothing in this product deletes a verification, which is just as well, because `SET NULL`
would be an `UPDATE` on a report row and the trigger above would refuse it.

**The report file carries one word more than the table does.** Rows that never reached the host — a
malformed line, a link that is not a link, a header the parser refused — are the domain's own
problems, and `reportCsv` writes them as `not made`, with the line number and the reason. So the CSV
beside the codes accounts for **every line of the file**, while the table accounts for every row the
run actually tried. It is written with formula injection neutralised (`=`, `+`, `-`, `@`, a tab, a
carriage return): a report about hostile input must not be hostile output (SPEC §5,
[ADR-029](architecture/ADR.md#adr-029)).

**`verifications.batch_id` is not among the columns this slice adds.** The relation is held once,
here, on `batch_rows.verification_id`: a report row points at the proof that made its file, and the
run a verification belonged to is read back through the report it is in. Both directions together
would be one relation stored twice, which is the failure mode this document refuses elsewhere,
because the second copy is the one that eventually disagrees. If listing a run's verifications
without joining `batch_rows` ever earns a column, it arrives in a migration of its own.

## Conventions

**Identifiers** are UUID v7, which sort by creation time — `batch_rows` included, where the plan
asked for an autoincrement integer: the report's order is the line number it already carries, so
the key does not have to carry it a second time. **Timestamps** are UTC, ISO 8601 with milliseconds
and a trailing `Z`;
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
carries `code_id`, and so says which saved code it was about. What it does not do is decide whether
a verdict is still current: that is the token the export command is given, in the process that
produced it, and a scene that changed — a colour, a field, a logo — has no token (ADR-010). A saved
code reopened is rebuilt and proved again rather than matched against a row from months ago
(ADR-028), so a stale verification is not merely unlikely; there is nowhere for one to be read from.
Keeping the failures matters as much as keeping the successes — the rows with `verified = 0` are the
record of what this product refused to let out, each with the sentence it refused them in, and they
are what a person shows a printer who insists the file was fine. A decoder upgrade is also a fact
worth having: the rows say which version proved what.

**The SVG that arrived is never stored.** `logos.bytes` holds the serialisation of the normalised
tree, and `logos.sha256` is the hash of that — the hash of what will be exported, not of what was
opened. Keeping the original "just in case" would mean a file with scripts and external
references sitting in the database, one careless read away from being written into an export; and
the moment two byte strings exist for one logo, something eventually writes the wrong one. The
cost is stated in ADR-016 and here: the only way back to the original is the original file.

Since F4 this is code rather than intention. `src-tauri/src/imaging/logo.rs` refuses a hostile
document before a parser is handed it, then re-serialises whatever parsed, and
`src-tauri/src/commands/logos.rs` writes only what came back from it — the buffer the file was read
into is dropped with the function. A test asserts that what is stored would itself pass the refusals
on the way back in, which is the property that matters: there is no stored logo this product would
refuse to import.

**Logos are deleted with `RESTRICT`, never `CASCADE`.** In F4 nothing pointed at a logo, so removing
one from the code removed the row and the only copy of that image was the file it came from. From F8
the relation exists, and both sides of it are `RESTRICT`: deleting a logo a brand kit or a saved
code points at is refused, and the refusal **names the kits and the codes** that are using it — the
names the person will recognise, from the rows themselves, rather than a count they then have to go
and find. `CASCADE` would take the kits and the codes with it; `SET NULL` would leave a kit that
quietly looks different the next time it is applied, which is the worst of the three because nobody
sees it happen. A refusal that names what is in the way is a sentence a person can act on — take it
out of those kits and codes, then delete it.

**The batch report is append-only.** A report that can be edited is not a report. Rows go in as
each line is decided and nothing rewrites them afterwards, so a batch that failed halfway has a
truthful record of where it got to, and a row that says `refused` still says so tomorrow. This is
the same reasoning as the verification rows, applied to a run instead of a code: the log is the
evidence, and evidence that can be updated is not evidence. Enforced by triggers rather than by
convention, because the path that forgets is always the one written next week.

**The payload is stored as fields, not as the string that gets encoded.** This is the library's
central decision and it has its own record, [ADR-028](architecture/ADR.md#adr-028). `payload_json`
holds
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
`verifications`, and nothing else. `002_logos` is F4's, and takes the schema to version 2.
`003_export_formats` is F7's, and takes it to 3: `format` and `dpi` on `verifications`, both
nullable, added with `ALTER TABLE` so the rows already in a person's workspace keep their meaning —
they recorded a PNG at a fixed pixel size, and a column they were written without says `NULL`
rather than guessing. `004_library` is F8's, and takes it to 4: `codes`, `brand_kits`, and `code_id`
on `verifications`, nullable for the same reason — a row written before the library existed was
about a code that was never saved. `005_batches` is F9's, and takes it to 5: `batches`, `batch_rows`
and the two triggers that make the report append-only — a migration that only adds tables, so a
workspace from before the batch existed simply gains them. Version 5 is then the number Diagnostics
shows and the number the running build states.

There is no down-migration. A mistake is corrected by a new migration, never by rewriting an
applied one: an applied migration is history, and that history has already run on somebody's
machine.

Every release that adds a migration is covered by a round-trip test that opens a database at
version N-1 and migrates it without loss — including the blobs, which are the part a careless
table rebuild loses quietly.
