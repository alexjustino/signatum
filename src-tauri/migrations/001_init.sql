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
