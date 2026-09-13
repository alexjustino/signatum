-- Signatum — migration 004: the library, and the look saved as a brand kit.
--
-- A saved code is its fields and the hash of the scene they made — never a
-- stored image (ADR-028). Opening one rebuilds the scene through the same
-- domain pipeline and hands it to the same gate, which is why `scene_sha256` is
-- here and a PNG is not: an image in the file would be a second answer to "what
-- does this code look like", and the day the two disagree the stored one is the
-- one somebody prints.
--
-- The three JSON columns are the domain's shapes (ADR-003), and SQLite is not
-- asked to understand them: `json_valid` says they are JSON, and nothing here
-- says what kind. The host stores them verbatim. That is also what makes
-- ADR-018's opt-out possible without the host knowing what Wi-Fi is — the
-- interface blanks the password before saving, and `payload_json` is written
-- exactly as it arrives.
--
-- `kind` is bounded by length and not by a list of values. Each payload kind
-- arrives in its own slice, and a CHECK enumerating them would need a migration
-- per kind to record a fact the domain already refuses to get wrong.
--
-- `logo_id` is ON DELETE RESTRICT in both tables: a logo that a saved code or a
-- brand kit is drawn with cannot be removed from under it. The SQL is the
-- backstop; the sentence naming which ones is the host's (`commands/logos.rs`),
-- because "it is in use" without saying where is a dead end for the person
-- holding the mouse.

CREATE TABLE codes (
    id           TEXT NOT NULL PRIMARY KEY,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    kind         TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 32),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    style_json   TEXT NOT NULL CHECK (json_valid(style_json)),
    size_json    TEXT NOT NULL CHECK (json_valid(size_json)),
    logo_id      TEXT REFERENCES logos (id) ON DELETE RESTRICT,
    logo_json    TEXT CHECK (logo_json IS NULL OR json_valid(logo_json)),
    scene_sha256 TEXT NOT NULL CHECK (
        length(scene_sha256) = 64 AND scene_sha256 NOT GLOB '*[^0-9a-f]*'
    )
);

CREATE INDEX idx_codes_created ON codes (created_at DESC);

-- A kit's name is what the person picks it by in a list, so two kits cannot
-- share one: UNIQUE here, and the sentence naming the kit that already has it
-- in `commands/library.rs`.
CREATE TABLE brand_kits (
    id         TEXT NOT NULL PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    name       TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
    logo_id    TEXT REFERENCES logos (id) ON DELETE RESTRICT,
    logo_json  TEXT CHECK (logo_json IS NULL OR json_valid(logo_json)),
    style_json TEXT NOT NULL CHECK (json_valid(style_json)),
    size_json  TEXT NOT NULL CHECK (json_valid(size_json))
);

CREATE INDEX idx_brand_kits_created ON brand_kits (created_at DESC);

-- The verification of a saved code can now say which code it was of.
--
-- Nullable, and ON DELETE SET NULL rather than CASCADE: every row written
-- before this migration belongs to no saved code, and a refusal recorded
-- against a code somebody later deleted is still evidence that a code was
-- rendered and did not read back. Deleting the library entry must not delete
-- the record of what happened — the row keeps its hashes and loses its link.
ALTER TABLE verifications ADD COLUMN code_id TEXT REFERENCES codes (id) ON DELETE SET NULL;
