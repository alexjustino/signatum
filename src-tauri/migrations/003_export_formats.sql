-- Signatum — migration 003: what an export was, not only that it happened.
--
-- F7 makes the printed size an input, and one code can now leave as four
-- different things: a PNG at a resolution, an SVG, a PDF at an exact physical
-- size, or an image on the clipboard. The row that records the scan gate's
-- verdict has to say which of them was asked for, and at what resolution — a
-- record that says "an export was verified" without saying what was written is
-- evidence of something, but not of the file somebody printed.
--
-- Both columns are nullable, and deliberately so: every row written before this
-- migration is a PNG export or a preview from a release that had no other kind,
-- and back-filling a value nobody recorded would be inventing evidence. NULL
-- here means "not recorded", which is the truth.
--
-- `format` carries the export kind rather than a file extension, so the
-- clipboard — which writes no file and therefore has no path — is still
-- distinguishable from a PNG that was written to disk.

ALTER TABLE verifications ADD COLUMN dpi INTEGER;

ALTER TABLE verifications ADD COLUMN format TEXT
    CHECK (format IS NULL OR format IN ('png', 'svg', 'pdf', 'clipboard'));
