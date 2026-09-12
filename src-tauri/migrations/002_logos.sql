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
