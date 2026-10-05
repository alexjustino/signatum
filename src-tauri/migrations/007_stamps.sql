-- Signatum — migration 007: the stamp an exported file carries, recorded on the row
-- that proved it.
--
-- From P2 every file this product writes — a PNG, an SVG, a PDF, every file of a
-- batch and the proof sheet — carries a stamp: a reference, the payload's digest,
-- the decoder, and a digest of what was verified. The row that proved the file keeps
-- the two halves the file cannot vouch for on its own: which reference it was given,
-- and which digest was written into it. Read finds the row by the reference and says
-- "verified by this workspace" only when the digest in the file is the digest here.
--
-- `stamp_ref` is a UUID **v4** and never the row's own identifier. Row identifiers are
-- v7, whose leading 48 bits are the moment they were made; a stamp that carried one
-- would put the time of the export inside the file, which no export of this product
-- does. The CHECK holds the shape to a v4: the version digit is `4`, the variant digit
-- is one of `8 9 a b`, lowercase, hyphens where a UUID has them.
--
-- Both columns are nullable, and deliberately so. A preview, a refusal, a copy to the
-- clipboard and every row written before this migration carry no stamp, and a row
-- written while stamping is switched off (`stamp_exports`) carries none either: NULL
-- here means "this file was not stamped", which is the truth. The two are set
-- together or not at all, and only on a row that proved a file that was written —
-- a stamp on a refusal would be a stamp on nothing.
--
-- The unique index is partial: any number of rows have no stamp, and no two rows
-- share one.

ALTER TABLE verifications ADD COLUMN stamp_ref TEXT
    CHECK (stamp_ref IS NULL OR stamp_ref GLOB
        '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');

ALTER TABLE verifications ADD COLUMN stamp_digest TEXT
    CHECK (stamp_digest IS NULL OR (
        length(stamp_digest) = 64 AND stamp_digest NOT GLOB '*[^0-9a-f]*'
    ))
    CHECK ((stamp_digest IS NULL) = (stamp_ref IS NULL))
    CHECK (stamp_digest IS NULL OR (verified = 1 AND path IS NOT NULL));

CREATE UNIQUE INDEX idx_verifications_stamp_ref ON verifications (stamp_ref)
    WHERE stamp_ref IS NOT NULL;
