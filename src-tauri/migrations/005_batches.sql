-- Signatum — migration 005: one run over one CSV, and what happened to each line.
--
-- A batch is the Create pipeline in a loop (ADR-029): every row is rendered,
-- decoded and compared exactly as a single export is, and writes its own
-- `verifications` row. What these two tables add is the *run* — which folder
-- was chosen, what was asked for, and the report a person reads afterwards to
-- find the three lines out of two hundred that could not be made.
--
-- `batch_rows` is append-only, and the triggers below are the reason it can be
-- trusted: a report that can be edited after the fact is a report of what
-- somebody wanted to have happened. Rows are inserted as the run goes, one per
-- line of the CSV, and are never rewritten — a run that went wrong is a second
-- run, with a second batch. The counts on `batches` *are* updated once, when the
-- run ends, because they are a summary of rows that already exist and not a
-- second opinion about them.
--
-- The delete trigger has a `WHEN` clause rather than an unconditional ABORT so
-- that deleting a batch can still take its rows with it: during the cascade the
-- parent row is already gone, so the count is 0 and the delete is allowed.
-- Deleting a row on its own — while its batch is still there — is refused.
--
-- `verification_id` is ON DELETE SET NULL for the same reason `codes.code_id`
-- is: the report row is the fact that a line was written or refused, and it
-- outlives the evidence row it points at rather than vanishing with it. Nothing
-- in this product deletes a verification — the record of what a decoder read is
-- never removed — which is just as well, because the SET NULL would be an UPDATE
-- on a report row, and the trigger below would refuse it. If a reason to delete
-- a verification ever appears, that is the migration where this is settled.

CREATE TABLE batches (
    id          TEXT    NOT NULL PRIMARY KEY,
    created_at  TEXT    NOT NULL,
    folder      TEXT    NOT NULL,
    format      TEXT    NOT NULL CHECK (format IN ('png', 'svg')),
    dpi         INTEGER,
    rows_total  INTEGER NOT NULL DEFAULT 0,
    written     INTEGER NOT NULL DEFAULT 0,
    refused     INTEGER NOT NULL DEFAULT 0,
    failed      INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    finished_at TEXT
);

CREATE INDEX idx_batches_created ON batches (created_at DESC);

CREATE TABLE batch_rows (
    id              TEXT    NOT NULL PRIMARY KEY,
    batch_id        TEXT    NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    line            INTEGER NOT NULL,
    file            TEXT    NOT NULL,
    status          TEXT    NOT NULL CHECK (status IN ('written', 'refused', 'failed', 'skipped')),
    reason          TEXT,
    verification_id TEXT REFERENCES verifications (id) ON DELETE SET NULL
);

CREATE INDEX idx_batch_rows_batch ON batch_rows (batch_id, line);

CREATE TRIGGER batch_rows_refuse_update
BEFORE UPDATE ON batch_rows
BEGIN
    SELECT RAISE(ABORT, 'the batch report is append-only');
END;

CREATE TRIGGER batch_rows_refuse_delete
BEFORE DELETE ON batch_rows
WHEN (SELECT COUNT(*) FROM batches WHERE id = OLD.batch_id) > 0
BEGIN
    SELECT RAISE(ABORT, 'the batch report is append-only');
END;
