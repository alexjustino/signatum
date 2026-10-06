//! The stamp every exported file carries: what was verified, and never when.
//!
//! One line of ASCII JSON, keys in this order and no whitespace:
//!
//! `{"signatum":1,"ref":"<uuid v4>","decoder":"<name> <x.y.z>","digest":"<sha256>"}`
//!
//! - `ref` is a UUID **v4** made for the stamp and kept on the row that proved the file
//!   (migration 007) — never the row's own identifier, which is a v7 and starts with the
//!   moment it was made.
//! - `decoder` is the name and version that read the artefact back, in exactly one form:
//!   a name of `a-z 0-9 _ -` (at most 32), one space, and a three-part version.
//!
//! There is deliberately no digest of the payload. The reference and the digest already
//! find the row and prove the file; a payload hash added nothing to that, and for a code
//! with little in it — a Wi-Fi password — whose picture was removed but whose metadata
//! survived, it was something a guesser could test candidates against offline.
//! - `digest` is what makes "unchanged" checkable, and each format defines it so that a
//!   reader can recompute it from the file alone:
//!   - **PNG** — the stamp is one `tEXt` chunk, keyword `signatum`, text the JSON, placed
//!     immediately before `IEND`. `digest` is the SHA-256 of the file with that chunk
//!     removed — which is, byte for byte, the PNG the decoder read. On reading, the chunk
//!     is accepted only where it is written: a well-formed chunk with a correct CRC whose
//!     next chunk is `IEND`. Anywhere else — before `IHDR`, between `IDAT`s — it is not a
//!     stamp this product wrote.
//!   - **SVG** — the stamp is the comment `<!-- signatum:{json} -->` right after the root
//!     element's opening tag. `digest` is the SHA-256 of the whole file with the 64 hex
//!     characters of the `digest` value replaced by 64 `0`s: the placeholder the file was
//!     hashed with before the digest was written in.
//!   - **PDF** — the stamp is `/Signatum (signatum:{json})` in the document-information
//!     dictionary, beside `/Producer`. The same placeholder rule as the SVG, so writing the
//!     digest in moves no byte and every cross-reference offset stays true.
//!
//! What the stamp is not: a signature. Anyone can write one. "Intact" proves the file
//! matches its own stamp; only a row in **this** workspace holding the same reference and
//! the same digest says this workspace verified it. Reading a stamp is bounded on every
//! side: a chunk walk that never reads past the file, a marker that has to occur exactly
//! once, and a JSON of at most [`MAX_JSON_BYTES`] parsed into a closed struct and written
//! back out to the very same bytes, or refused.
//!
//! Pure: bytes in, bytes out. Nothing here opens a file or a database.

use std::ops::Range;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::imaging::verify::sha256_hex;

/// The version of the stamp this build writes and reads.
pub const VERSION: u32 = 1;

/// The longest stamp JSON this build reads. One it writes is 159 bytes with this
/// product's decoder (`rqrr 0.10.1`).
pub const MAX_JSON_BYTES: usize = 512;

/// The keyword of the PNG `tEXt` chunk that carries the stamp.
pub const PNG_KEYWORD: &[u8] = b"signatum";

/// What an SVG stamp begins with.
pub const SVG_MARKER: &[u8] = b"<!-- signatum:";

/// What an SVG stamp ends with.
const SVG_END: &[u8] = b" -->";

/// What a PDF stamp begins with: the key in the information dictionary, and the opening of
/// its string.
pub const PDF_MARKER: &[u8] = b"/Signatum (signatum:";

/// The key itself, as the PDF writer is handed it.
pub const PDF_KEY: &[u8] = b"Signatum";

/// What a PDF stamp ends with: the close of its string. The JSON holds no parenthesis, so
/// the first one after the marker is this one.
const PDF_END: &[u8] = b")";

/// What the text of an SVG or PDF stamp starts with, after its marker's own syntax.
const TEXT_PREFIX: &str = "signatum:";

/// How many hex characters a SHA-256 is.
const DIGEST_HEX: usize = 64;

/// The 64 characters the digest is computed over, in an SVG or a PDF.
const PLACEHOLDER: [u8; DIGEST_HEX] = [b'0'; DIGEST_HEX];

/// The eight bytes every PNG begins with.
pub const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// What is said about a file with two stamps in it.
pub const MORE_THAN_ONE: &str =
    "This file carries more than one Signatum stamp, so none of them can be trusted.";

/// What is said about a stamp that is not one this build can read.
pub const UNREADABLE: &str = "This file's Signatum stamp could not be read.";

/// What is said about a `.png` whose bytes are not a PNG.
pub const NOT_A_PNG: &str = "That file is not a PNG.";

/// The three kinds of file a stamp is written into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A PNG: the stamp is a chunk.
    Png,
    /// An SVG: the stamp is a comment.
    Svg,
    /// A PDF: the stamp is an entry in the information dictionary.
    Pdf,
}

impl Kind {
    /// The word the interface and the record use for it, which is also its extension.
    pub fn token(self) -> &'static str {
        match self {
            Kind::Png => "png",
            Kind::Svg => "svg",
            Kind::Pdf => "pdf",
        }
    }
}

/// What is known about a stamp before the file exists: everything but the digest.
#[derive(Debug, Clone, Copy)]
pub struct Mark<'a> {
    /// The stamp's reference, a UUID v4 (`db::new_stamp_ref`).
    pub reference: &'a str,
    /// The decoder that read the artefact back, name and version.
    pub decoder: &'a str,
}

impl Mark<'_> {
    /// The stamp this mark becomes with `digest` written in.
    ///
    /// # Errors
    ///
    /// [`Error::Render`] when any part of it is not the shape a stamp has. Every part is
    /// this host's own value, so that is a defect — and a stamp that could not be read back
    /// must not be written.
    fn with_digest(&self, digest: &str) -> Result<Stamp> {
        let stamp = Stamp {
            signatum: VERSION,
            reference: self.reference.to_string(),
            decoder: self.decoder.to_string(),
            digest: digest.to_string(),
        };
        // On the way out the decoder also never holds `--`, which an XML comment cannot
        // carry; the form allows it inside a name, and this product's decoder has none.
        if !stamp.is_well_formed() || stamp.decoder.contains("--") {
            log::error!("a stamp was composed from values that are not a stamp's");
            return Err(Error::Render("the export could not be stamped".to_string()));
        }
        Ok(stamp)
    }
}

/// The stamp, exactly as it is written: four keys, in this order, and no other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stamp {
    /// The version of the stamp, [`VERSION`].
    pub signatum: u32,
    /// The stamp's reference, a UUID v4.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The decoder, name and version.
    pub decoder: String,
    /// Hex SHA-256 of what was verified, by the rule of the file's kind.
    pub digest: String,
}

impl Stamp {
    /// The one line of JSON this stamp is.
    ///
    /// # Errors
    ///
    /// [`Error::Render`] if it cannot be serialised, which a struct of strings cannot fail.
    pub fn json(&self) -> Result<String> {
        serde_json::to_string(self)
            .map_err(|_| Error::Render("the export could not be stamped".to_string()))
    }

    /// Whether every field is the shape a stamp's field has.
    ///
    /// Checked on the way in as well as on the way out: the decoder's form is closed, so
    /// the JSON needs no escaping anywhere it is written — not in a PDF string, where a
    /// parenthesis would end it — and says nothing but a name and a version.
    fn is_well_formed(&self) -> bool {
        self.signatum == VERSION
            && is_v4(&self.reference)
            && is_digest(&self.digest)
            && is_decoder(&self.decoder)
    }
}

/// A stamp found in a file, and whether the file still matches it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// The stamp as it was read.
    pub stamp: Stamp,
    /// True when the digest recomputed from the file is the digest the stamp carries.
    pub intact: bool,
}

/// The bytes of a file, and the stamp written into them when there is one.
#[derive(Debug, Clone)]
pub struct Sealed {
    /// The file.
    pub bytes: Vec<u8>,
    /// Its stamp; `None` when stamping is off.
    pub stamp: Option<Stamp>,
}

/// The text a PDF's `/Signatum` entry holds before the file is sealed: the stamp with the
/// placeholder where its digest goes.
///
/// # Errors
///
/// [`Error::Render`] when the mark is not the shape a stamp has.
pub fn pdf_entry(mark: &Mark) -> Result<String> {
    Ok(format!("{TEXT_PREFIX}{}", placeholder_json(mark)?))
}

/// Write the stamp into a PNG, as one `tEXt` chunk immediately before `IEND`.
///
/// The digest is the SHA-256 of `png` as it arrives — which is the file with the chunk
/// removed, and the artefact the decoder read.
///
/// # Errors
///
/// [`Error::Render`] when `png` is not a PNG this host made — no `IEND`, or a stamp already
/// in it — or the mark is not a stamp's.
pub fn stamp_png(png: &[u8], mark: &Mark) -> Result<(Vec<u8>, Stamp)> {
    let defect = |what: &str| {
        log::error!("a PNG could not be stamped: {what}");
        Error::Render("the export could not be stamped".to_string())
    };
    if !png.starts_with(&PNG_SIGNATURE) {
        return Err(defect("it is not a PNG"));
    }
    let mut iend = None;
    for chunk in Chunks::new(png) {
        if chunk.is_stamp(png) {
            return Err(defect("it already carries a stamp"));
        }
        if &png[chunk.kind.clone()] == b"IEND" {
            iend = Some(chunk.whole.start);
            break;
        }
    }
    let iend = iend.ok_or_else(|| defect("it has no IEND"))?;

    let stamp = mark.with_digest(&sha256_hex(png))?;
    let mut data = Vec::from(PNG_KEYWORD);
    data.push(0);
    data.extend_from_slice(stamp.json()?.as_bytes());

    let mut stamped = Vec::with_capacity(png.len() + data.len() + 12);
    stamped.extend_from_slice(&png[..iend]);
    stamped.extend_from_slice(&chunk(b"tEXt", &data));
    stamped.extend_from_slice(&png[iend..]);
    Ok((stamped, stamp))
}

/// Write the stamp into an SVG, as a comment right after the root's opening tag.
///
/// # Errors
///
/// [`Error::Render`] when the text has no `<svg` opening tag to follow, when that tag closes
/// itself, when the text already carries a stamp, or when the mark is not a stamp's.
pub fn stamp_svg(text: &str, mark: &Mark) -> Result<(String, Stamp)> {
    let after = root_opening_end(text)?;
    let comment = format!("<!-- {TEXT_PREFIX}{} -->", placeholder_json(mark)?);

    let mut marked = String::with_capacity(text.len() + comment.len());
    marked.push_str(&text[..after]);
    marked.push_str(&comment);
    marked.push_str(&text[after..]);

    let (bytes, stamp) = seal(marked.into_bytes(), Kind::Svg)?;
    let sealed = String::from_utf8(bytes)
        .map_err(|_| Error::Render("the export could not be stamped".to_string()))?;
    Ok((sealed, stamp))
}

/// Fill the digest into a PDF written with [`pdf_entry`] in its information dictionary, or
/// hand the bytes back as they are when there is no stamp to seal.
///
/// # Errors
///
/// [`Error::Render`] when `stamped` is true and the entry is not there exactly once.
pub fn seal_pdf(pdf: Vec<u8>, stamped: bool) -> Result<Sealed> {
    if !stamped {
        return Ok(Sealed {
            bytes: pdf,
            stamp: None,
        });
    }
    let (bytes, stamp) = seal(pdf, Kind::Pdf)?;
    Ok(Sealed {
        bytes,
        stamp: Some(stamp),
    })
}

/// Read the stamp in a file of this kind, and recompute its digest.
///
/// `Ok(None)` for a file with no stamp. A PNG is walked chunk by chunk and never past its
/// own bytes; an SVG or a PDF is searched for its marker and nothing in it is parsed, drawn
/// or decoded.
///
/// # Errors
///
/// [`Error::InvalidInput`] with [`MORE_THAN_ONE`] for a file with two stamps, with
/// [`UNREADABLE`] for one whose stamp is not a stamp this build writes — too long, not the
/// four keys, not in their order, not their shapes, or (in a PNG) a chunk with a wrong CRC
/// or anywhere but immediately before `IEND` — and with [`NOT_A_PNG`] for a PNG whose
/// signature is not a PNG's.
pub fn read_stamp(bytes: &[u8], kind: Kind) -> Result<Option<Found>> {
    match kind {
        Kind::Png => read_png(bytes),
        Kind::Svg => read_marked(bytes, SVG_MARKER, SVG_END),
        Kind::Pdf => read_marked(bytes, PDF_MARKER, PDF_END),
    }
}

/// A PNG with its stamp chunk taken out; the bytes unchanged when there is none.
///
/// # Errors
///
/// As [`read_stamp`] for a PNG.
#[cfg(test)]
pub(crate) fn png_without_stamp(png: &[u8]) -> Result<Vec<u8>> {
    Ok(match png_stamp(png)? {
        Some((range, _)) => [&png[..range.start], &png[range.end..]].concat(),
        None => png.to_vec(),
    })
}

/// The stamp JSON with the placeholder where its digest goes.
fn placeholder_json(mark: &Mark) -> Result<String> {
    mark.with_digest(&"0".repeat(DIGEST_HEX))?.json()
}

/// Write the digest into an SVG or PDF that carries a stamp with the placeholder in it.
fn seal(mut bytes: Vec<u8>, kind: Kind) -> Result<(Vec<u8>, Stamp)> {
    let (marker, end) = match kind {
        Kind::Svg => (SVG_MARKER, SVG_END),
        Kind::Pdf => (PDF_MARKER, PDF_END),
        Kind::Png => {
            log::error!("a PNG was handed to the seal for text files");
            return Err(Error::Render("the export could not be stamped".to_string()));
        }
    };
    let defect = || {
        log::error!("an export could not be sealed: its stamp is not there exactly once");
        Error::Render("the export could not be stamped".to_string())
    };
    let (json, mut stamp) = locate(&bytes, marker, end)
        .map_err(|_| defect())?
        .ok_or_else(defect)?;
    let at = digest_range(&json);
    if bytes[at.clone()] != PLACEHOLDER {
        return Err(defect());
    }

    let digest = sha256_hex(&bytes);
    bytes[at].copy_from_slice(digest.as_bytes());
    stamp.digest = digest;
    Ok((bytes, stamp))
}

/// The stamp in an SVG or PDF, and whether the file matches it.
fn read_marked(bytes: &[u8], marker: &[u8], end: &[u8]) -> Result<Option<Found>> {
    let Some((json, stamp)) = locate(bytes, marker, end)? else {
        return Ok(None);
    };
    let at = digest_range(&json);
    let mut hasher = Sha256::new();
    hasher.update(&bytes[..at.start]);
    hasher.update(PLACEHOLDER);
    hasher.update(&bytes[at.end..]);
    let intact = hex::encode(hasher.finalize()) == stamp.digest;
    Ok(Some(Found { stamp, intact }))
}

/// Where the stamp's JSON is in an SVG or PDF, and what it says.
///
/// The marker has to occur exactly once; the JSON is what follows it up to `end`, at most
/// [`MAX_JSON_BYTES`] of it.
fn locate(bytes: &[u8], marker: &[u8], end: &[u8]) -> Result<Option<(Range<usize>, Stamp)>> {
    let starts = occurrences(bytes, marker, 2);
    let start = match starts.as_slice() {
        [] => return Ok(None),
        [only] => only + marker.len(),
        _ => return Err(Error::InvalidInput(MORE_THAN_ONE.to_string())),
    };
    let window = &bytes[start..bytes.len().min(start + MAX_JSON_BYTES + end.len())];
    let length = find(window, end).ok_or_else(unreadable)?;
    if length > MAX_JSON_BYTES {
        return Err(unreadable());
    }
    let json = start..start + length;
    let stamp = parse(&bytes[json.clone()])?;
    Ok(Some((json, stamp)))
}

/// The 64 hex characters of the `digest` value inside the JSON at `json`.
///
/// The JSON is canonical — [`parse`] refuses anything else — so it ends `"digest":"…"}` and
/// the digest is the 64 characters before the closing quote and brace.
fn digest_range(json: &Range<usize>) -> Range<usize> {
    let end = json.end - 2;
    end - DIGEST_HEX..end
}

/// The stamp in a PNG, and whether the file matches it.
fn read_png(png: &[u8]) -> Result<Option<Found>> {
    let Some((range, text)) = png_stamp(png)? else {
        return Ok(None);
    };
    let stamp = parse(text)?;
    let mut hasher = Sha256::new();
    hasher.update(&png[..range.start]);
    hasher.update(&png[range.end..]);
    let intact = hex::encode(hasher.finalize()) == stamp.digest;
    Ok(Some(Found { stamp, intact }))
}

/// The stamp chunk of a PNG — where it is, and its text — when there is exactly one, and
/// it is exactly where this product writes it.
///
/// Accepted only as a well-formed chunk whose CRC is correct and whose next chunk in the
/// walk is `IEND`. A stamp chunk anywhere else — the first chunk, between two `IDAT`s,
/// before another ancillary chunk, at the end of a file with no `IEND` — or with a CRC that
/// does not match is [`UNREADABLE`]: it is not a stamp this product wrote, and reporting
/// what it claims would be repeating a stranger's words.
fn png_stamp(png: &[u8]) -> Result<Option<(Range<usize>, &[u8])>> {
    if !png.starts_with(&PNG_SIGNATURE) {
        return Err(Error::InvalidInput(NOT_A_PNG.to_string()));
    }
    let mut found: Option<(Range<usize>, &[u8], bool)> = None;
    let mut next_is_iend = false;
    let mut previous_was_stamp = false;
    for chunk in Chunks::new(png) {
        let is_iend = &png[chunk.kind.clone()] == b"IEND";
        if previous_was_stamp {
            next_is_iend = is_iend;
        }
        previous_was_stamp = false;
        if chunk.is_stamp(png) {
            if found.is_some() {
                return Err(Error::InvalidInput(MORE_THAN_ONE.to_string()));
            }
            let text = &png[chunk.data.start + PNG_KEYWORD.len() + 1..chunk.data.end];
            let crc_ok = chunk.crc_is_correct(png);
            found = Some((chunk.whole.clone(), text, crc_ok));
            previous_was_stamp = true;
        }
        if is_iend {
            break;
        }
    }
    let Some((range, text, crc_ok)) = found else {
        return Ok(None);
    };
    if !crc_ok || !next_is_iend || text.len() > MAX_JSON_BYTES {
        log::debug!(
            "a PNG stamp chunk was refused: CRC correct {crc_ok}, followed by IEND {next_is_iend}"
        );
        return Err(unreadable());
    }
    Ok(Some((range, text)))
}

/// One chunk of a PNG, as ranges into the file.
struct Chunk {
    /// Length, type, data and CRC.
    whole: Range<usize>,
    /// The four bytes of its type.
    kind: Range<usize>,
    /// Its data.
    data: Range<usize>,
}

impl Chunk {
    /// Whether this is a `tEXt` chunk whose keyword is [`PNG_KEYWORD`].
    fn is_stamp(&self, png: &[u8]) -> bool {
        let data = &png[self.data.clone()];
        &png[self.kind.clone()] == b"tEXt"
            && data.len() > PNG_KEYWORD.len()
            && data.starts_with(PNG_KEYWORD)
            && data[PNG_KEYWORD.len()] == 0
    }

    /// Whether the CRC the chunk carries is the CRC of its type and data.
    fn crc_is_correct(&self, png: &[u8]) -> bool {
        let stored = &png[self.data.end..self.whole.end];
        crc32(&png[self.kind.start..self.data.end]).to_be_bytes() == stored
    }
}

/// The chunks of a PNG in order, stopping at the first one that would run past the end of
/// the file. Each step moves forward by at least the twelve bytes a chunk's frame is, so
/// the walk ends, and it never indexes past the bytes it was given.
struct Chunks<'a> {
    png: &'a [u8],
    at: usize,
}

impl<'a> Chunks<'a> {
    fn new(png: &'a [u8]) -> Self {
        Self {
            png,
            at: PNG_SIGNATURE.len(),
        }
    }
}

impl Iterator for Chunks<'_> {
    type Item = Chunk;

    fn next(&mut self) -> Option<Chunk> {
        let start = self.at;
        let header = self.png.get(start..start.checked_add(8)?)?;
        let length = u32::from_be_bytes(header[..4].try_into().ok()?) as usize;
        let data_start = start + 8;
        let data_end = data_start.checked_add(length)?;
        let end = data_end.checked_add(4)?;
        if end > self.png.len() {
            return None;
        }
        self.at = end;
        Some(Chunk {
            whole: start..end,
            kind: start + 4..start + 8,
            data: data_start..data_end,
        })
    }
}

/// A PNG chunk: length, type, data, and the CRC of type and data.
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(4 + data.len());
    body.extend_from_slice(kind);
    body.extend_from_slice(data);

    let mut bytes = Vec::with_capacity(12 + data.len());
    bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(&crc32(&body).to_be_bytes());
    bytes
}

/// The CRC-32 a PNG chunk carries (ISO 3309, as the PNG specification defines it). Bitwise:
/// the one chunk it is computed for is a few hundred bytes.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// The stamp JSON, parsed into the closed struct — and refused unless writing it back out
/// gives the very same bytes. That one comparison refuses whitespace, reordered keys,
/// escapes and every spelling but the one this product writes.
fn parse(json: &[u8]) -> Result<Stamp> {
    if json.len() > MAX_JSON_BYTES {
        return Err(unreadable());
    }
    let text = std::str::from_utf8(json).map_err(|_| unreadable())?;
    let stamp: Stamp = serde_json::from_str(text).map_err(|error| {
        log::debug!("a stamp did not parse: {error}");
        unreadable()
    })?;
    if !stamp.is_well_formed() || stamp.json()? != text {
        return Err(unreadable());
    }
    Ok(stamp)
}

/// The refusal for a stamp this build cannot read.
fn unreadable() -> Error {
    Error::InvalidInput(UNREADABLE.to_string())
}

/// Where the root `<svg` element's opening tag ends — the index just past its `>`.
fn root_opening_end(text: &str) -> Result<usize> {
    let defect = |what: &str| {
        log::error!("an SVG could not be stamped: {what}");
        Error::Render("the export could not be stamped".to_string())
    };
    let bytes = text.as_bytes();
    let mut from = 0;
    let start = loop {
        let at = find_ignoring_case(&bytes[from..], b"<svg")
            .map(|at| at + from)
            .ok_or_else(|| defect("it has no <svg> element"))?;
        if matches!(
            bytes.get(at + 4),
            Some(b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/')
        ) {
            break at;
        }
        from = at + 4;
    };

    let mut quote = None;
    for (index, &byte) in bytes.iter().enumerate().skip(start) {
        match (quote, byte) {
            (None, b'"' | b'\'') => quote = Some(byte),
            (Some(open), _) if byte == open => quote = None,
            (None, b'>') => {
                if bytes[index - 1] == b'/' {
                    return Err(defect("its root element closes itself"));
                }
                return Ok(index + 1);
            }
            _ => {}
        }
    }
    Err(defect("its root element is never closed"))
}

/// Whether `reference` is a lowercase UUID v4: hyphens at 8, 13, 18 and 23, version digit
/// `4`, variant digit one of `8 9 a b`.
fn is_v4(reference: &str) -> bool {
    let bytes = reference.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => is_lower_hex(*byte),
        })
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

/// Whether `digest` is 64 lowercase hex characters.
fn is_digest(digest: &str) -> bool {
    digest.len() == DIGEST_HEX && digest.bytes().all(is_lower_hex)
}

/// Whether `decoder` has the one form a stamp's decoder has —
/// `^[a-z0-9_-]{1,32} \d+\.\d+\.\d+$`, with ASCII digits: a lower-case name, one space,
/// and a three-part version.
pub(crate) fn is_decoder(decoder: &str) -> bool {
    let Some((name, version)) = decoder.split_once(' ') else {
        return false;
    };
    let name_ok = (1..=32).contains(&name.len())
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        });
    let mut parts = 0;
    let version_ok = version.split('.').all(|part| {
        parts += 1;
        !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
    });
    name_ok && version_ok && parts == 3
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

/// The first position of `needle` in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// The first position of `needle` in `haystack`, ASCII letters compared without case.
fn find_ignoring_case(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
}

/// Where `needle` occurs in `haystack`, up to `most` times.
fn occurrences(haystack: &[u8], needle: &[u8], most: usize) -> Vec<usize> {
    let mut found = Vec::new();
    let mut from = 0;
    while found.len() < most {
        let Some(at) = find(&haystack[from..], needle) else {
            break;
        };
        found.push(from + at);
        from += at + needle.len();
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::pdf;
    use crate::imaging::fixtures::{hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;

    const DECODER: &str = "rqrr 0.10.1";

    fn reference() -> String {
        crate::db::new_stamp_ref()
    }

    fn artefact(side: u32) -> Vec<u8> {
        render_png(hello_world_svg().as_bytes(), side)
            .expect("render")
            .png
    }

    /// Stamp a PNG with a fresh mark.
    fn stamped_png(png: &[u8]) -> (Vec<u8>, Stamp) {
        let reference = reference();
        stamp_png(
            png,
            &Mark {
                reference: &reference,
                decoder: DECODER,
            },
        )
        .expect("stamp")
    }

    fn stamped_svg(text: &str) -> (String, Stamp) {
        let reference = reference();
        stamp_svg(
            text,
            &Mark {
                reference: &reference,
                decoder: DECODER,
            },
        )
        .expect("stamp")
    }

    fn stamped_pdf() -> (Vec<u8>, Stamp) {
        let reference = reference();
        let sealed = pdf::one_page(
            &artefact(295),
            25.0,
            Some(&Mark {
                reference: &reference,
                decoder: DECODER,
            }),
        )
        .expect("write the page");
        let stamp = sealed.stamp.expect("stamped");
        (sealed.bytes, stamp)
    }

    /// The stamp chunk of a stamped PNG, whole — to copy onto another file, the way
    /// somebody forging a stamp would.
    fn stamp_chunk(png: &[u8]) -> Vec<u8> {
        let (range, _) = png_stamp(png).expect("walk").expect("a stamp");
        png[range].to_vec()
    }

    /// Insert raw chunk bytes immediately before `IEND`, recomputing nothing.
    fn with_chunk_before_iend(png: &[u8], raw: &[u8]) -> Vec<u8> {
        let iend = Chunks::new(png)
            .find(|chunk| &png[chunk.kind.clone()] == b"IEND")
            .expect("an IEND")
            .whole
            .start;
        [&png[..iend], raw, &png[iend..]].concat()
    }

    #[test]
    fn a_stamped_png_minus_its_chunk_is_the_artefact_byte_for_byte() {
        let png = artefact(295);

        let (stamped, stamp) = stamped_png(&png);

        assert_ne!(stamped, png, "the stamp is in the file");
        assert_eq!(
            png_without_stamp(&stamped).expect("strip"),
            png,
            "remove the stamp and what is left is exactly what was decoded"
        );
        assert_eq!(stamp.digest, sha256_hex(&png));

        let found = read_stamp(&stamped, Kind::Png)
            .expect("read")
            .expect("a stamp");
        assert!(found.intact);
        assert_eq!(found.stamp, stamp);

        // The chunk is the last one before IEND, and its text is the JSON alone.
        let chunks: Vec<Chunk> = Chunks::new(&stamped).collect();
        let last_two: Vec<&[u8]> = chunks[chunks.len() - 2..]
            .iter()
            .map(|chunk| &stamped[chunk.kind.clone()])
            .collect();
        assert_eq!(last_two, vec![b"tEXt".as_slice(), b"IEND".as_slice()]);
        let (_, text) = png_stamp(&stamped).expect("walk").expect("stamp");
        assert_eq!(text, stamp.json().expect("json").as_bytes());

        // And it is still a PNG any decoder opens.
        image::load_from_memory_with_format(&stamped, image::ImageFormat::Png)
            .expect("a stamped PNG is a PNG");
    }

    #[test]
    fn the_stamp_json_is_four_keys_in_order_and_carries_no_time() {
        let (_, stamp) = stamped_png(&artefact(128));
        let json = stamp.json().expect("json");

        assert_eq!(
            json,
            format!(
                "{{\"signatum\":1,\"ref\":\"{}\",\"decoder\":\"{DECODER}\",\"digest\":\"{}\"}}",
                stamp.reference, stamp.digest
            ),
            "four keys, in order, and no whitespace"
        );
        assert!(
            !json.contains("payload"),
            "no digest of the payload: {json}"
        );
        assert!(
            !json.contains(&sha256_hex(HELLO_WORLD.as_bytes())),
            "the payload's digest is nowhere in it"
        );
        assert_eq!(json.len(), 159, "the size the documentation states");

        // A v4, not a v7: the version digit is the fifteenth character.
        assert_eq!(stamp.reference.as_bytes()[14], b'4', "{}", stamp.reference);
        assert_ne!(stamp.reference.as_bytes()[14], b'7');
        assert_no_date(&json);
    }

    /// No `YYYY-MM-DD`, no `HH:MM`, no year of this century followed by a month.
    fn assert_no_date(text: &str) {
        let bytes = text.as_bytes();
        let digit = |at: usize| bytes.get(at).is_some_and(u8::is_ascii_digit);
        for at in 0..bytes.len() {
            let date = (0..4).all(|i| digit(at + i))
                && bytes.get(at + 4) == Some(&b'-')
                && digit(at + 5)
                && digit(at + 6)
                && bytes.get(at + 7) == Some(&b'-');
            let time = digit(at)
                && digit(at + 1)
                && bytes.get(at + 2) == Some(&b':')
                && digit(at + 3)
                && digit(at + 4);
            assert!(!date && !time, "a date-like string at {at} in {text}");
        }
        let month = chrono::Utc::now().format("%Y-%m").to_string();
        assert!(!text.contains(&month), "this month is in {text}");
    }

    #[test]
    fn one_changed_pixel_is_a_png_that_was_changed() {
        let png = artefact(295);
        let (stamped, _) = stamped_png(&png);

        // The pixels, one flipped, re-encoded — and the original stamp chunk put back.
        let mut picture = image::load_from_memory(&stamped)
            .expect("decode")
            .to_rgba8();
        let pixel = picture.get_pixel_mut(2, 2);
        pixel.0[0] ^= 0xFF;
        let mut edited = Vec::new();
        image::DynamicImage::ImageRgba8(picture)
            .write_to(
                &mut std::io::Cursor::new(&mut edited),
                image::ImageFormat::Png,
            )
            .expect("encode");
        let edited = with_chunk_before_iend(&edited, &stamp_chunk(&stamped));

        let found = read_stamp(&edited, Kind::Png)
            .expect("read")
            .expect("stamp");
        assert!(
            !found.intact,
            "one pixel changed and the stamp still said unchanged"
        );
    }

    #[test]
    fn one_changed_byte_outside_the_stamp_is_a_png_that_was_changed() {
        let (mut stamped, _) = stamped_png(&artefact(128));
        // The last byte of IHDR's width field: still a chunk walk, a different file.
        stamped[19] ^= 0x01;

        let found = read_stamp(&stamped, Kind::Png)
            .expect("read")
            .expect("stamp");
        assert!(!found.intact);
    }

    #[test]
    fn a_stamp_copied_onto_another_image_does_not_match_it() {
        let (stamped, stamp) = stamped_png(&artefact(295));
        let other = artefact(320);

        let forged = with_chunk_before_iend(&other, &stamp_chunk(&stamped));

        let found = read_stamp(&forged, Kind::Png)
            .expect("read")
            .expect("stamp");
        assert_eq!(found.stamp, stamp, "the stamp reads as it was written");
        assert!(!found.intact, "but it is not this file's");
    }

    #[test]
    fn a_png_with_no_stamp_has_none_and_a_png_with_two_is_refused() {
        let png = artefact(128);
        assert_eq!(read_stamp(&png, Kind::Png).expect("read"), None);

        let (stamped, _) = stamped_png(&png);
        let twice = with_chunk_before_iend(&stamped, &stamp_chunk(&stamped));
        let refused = read_stamp(&twice, Kind::Png).expect_err("two stamps");
        assert_eq!(refused.to_string(), MORE_THAN_ONE);

        let not_a_png = read_stamp(b"GIF89a and the rest", Kind::Png).expect_err("not a PNG");
        assert_eq!(not_a_png.to_string(), NOT_A_PNG);
    }

    #[test]
    fn a_png_cannot_be_stamped_twice() {
        let (stamped, _) = stamped_png(&artefact(128));
        let reference = reference();

        let refused = stamp_png(
            &stamped,
            &Mark {
                reference: &reference,
                decoder: DECODER,
            },
        )
        .expect_err("a second stamp");
        assert!(matches!(refused, Error::Render(_)));
    }

    /// A truncated file is walked as far as it goes and no further.
    #[test]
    fn a_truncated_png_is_walked_safely() {
        let (stamped, _) = stamped_png(&artefact(128));
        for cut in [8, 9, 20, 33, stamped.len() - 13, stamped.len() - 1] {
            let _ = read_stamp(&stamped[..cut], Kind::Png);
        }
        // A chunk whose length claims gigabytes ends the walk rather than the process.
        let mut lying = stamped.clone();
        lying[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(read_stamp(&lying, Kind::Png).expect("read"), None);
    }

    const SCENE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="25mm" height="25mm"><rect width="29" height="29" fill="#ffffff"/><path d="M4 4h1v1h-1z" fill="#000000"/></svg>"##;

    #[test]
    fn an_svg_stamp_is_a_comment_right_after_the_root_and_reads_back_intact() {
        let (stamped, stamp) = stamped_svg(SCENE);

        let opening = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="25mm" height="25mm">"#;
        let comment = format!("<!-- signatum:{} -->", stamp.json().expect("json"));
        assert_eq!(
            stamped,
            SCENE.replacen(opening, &format!("{opening}{comment}"), 1),
            "the scene is untouched but for the comment"
        );

        let found = read_stamp(stamped.as_bytes(), Kind::Svg)
            .expect("read")
            .expect("stamp");
        assert!(found.intact);
        assert_eq!(found.stamp, stamp);

        // The digest is the file hashed with the placeholder where it now stands.
        let placeholder = stamped.replace(&stamp.digest, &"0".repeat(64));
        assert_eq!(stamp.digest, sha256_hex(placeholder.as_bytes()));
    }

    #[test]
    fn one_changed_byte_in_a_stamped_svg_is_a_file_that_was_changed() {
        let (stamped, _) = stamped_svg(SCENE);

        let edited = stamped.replacen("#000000", "#000001", 1);
        assert_ne!(edited, stamped);
        let found = read_stamp(edited.as_bytes(), Kind::Svg)
            .expect("read")
            .expect("stamp");
        assert!(!found.intact);

        // A changed digest is a changed file too.
        let mut bytes = stamped.into_bytes();
        let at = find(&bytes, b"\"digest\":\"").expect("digest") + 10;
        bytes[at] = if bytes[at] == b'a' { b'b' } else { b'a' };
        let found = read_stamp(&bytes, Kind::Svg).expect("read").expect("stamp");
        assert!(!found.intact);
    }

    #[test]
    fn an_svg_with_no_stamp_has_none_and_one_with_two_is_refused() {
        assert_eq!(read_stamp(SCENE.as_bytes(), Kind::Svg).expect("read"), None);

        let (stamped, stamp) = stamped_svg(SCENE);
        let comment = format!("<!-- signatum:{} -->", stamp.json().expect("json"));
        let twice = stamped.replacen("</svg>", &format!("{comment}</svg>"), 1);

        let refused = read_stamp(twice.as_bytes(), Kind::Svg).expect_err("two stamps");
        assert_eq!(refused.to_string(), MORE_THAN_ONE);
    }

    #[test]
    fn an_svg_that_already_carries_a_stamp_is_not_stamped_again() {
        let (stamped, _) = stamped_svg(SCENE);
        let reference = reference();

        let refused = stamp_svg(
            &stamped,
            &Mark {
                reference: &reference,
                decoder: DECODER,
            },
        )
        .expect_err("a second stamp");
        assert!(matches!(refused, Error::Render(_)));
    }

    #[test]
    fn a_stamp_that_is_not_the_one_this_product_writes_is_refused() {
        let (_, stamp) = stamped_svg(SCENE);
        let json = stamp.json().expect("json");
        let svg = |inner: &str| format!("<svg viewBox=\"0 0 1 1\"><!-- signatum:{inner} --></svg>");

        for (name, inner) in [
            ("spaces", json.replace(",\"", ", \"")),
            (
                "reordered",
                json.replacen("{\"signatum\":1,", "{", 1)
                    .replacen('}', ",\"signatum\":1}", 1),
            ),
            ("unknown key", json.replacen('}', ",\"when\":\"x\"}", 1)),
            (
                "version two",
                json.replacen("\"signatum\":1", "\"signatum\":2", 1),
            ),
            (
                "a v7 reference",
                json.replacen(&stamp.reference, "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", 1),
            ),
            (
                "upper-case digest",
                json.replacen(&stamp.digest, &stamp.digest.to_uppercase(), 1),
            ),
            ("not JSON", "this is not a stamp".to_string()),
            (
                "a payload digest",
                json.replacen(
                    ",\"decoder\"",
                    &format!(",\"payload\":\"{}\",\"decoder\"", "a".repeat(64)),
                    1,
                ),
            ),
            (
                "a decoder in capitals",
                json.replacen(DECODER, "RQRR 0.10.1", 1),
            ),
            (
                "a decoder with two parts",
                json.replacen(DECODER, "rqrr 0.10", 1),
            ),
            (
                "a decoder with a suffix",
                json.replacen(DECODER, "rqrr 0.10.1-beta", 1),
            ),
            (
                "a decoder with no version",
                json.replacen(DECODER, "rqrr", 1),
            ),
            (
                "a decoder with two spaces",
                json.replacen(DECODER, "rqrr  0.10.1", 1),
            ),
            (
                "a decoder name past 32",
                json.replacen(DECODER, &format!("{} 0.10.1", "r".repeat(33)), 1),
            ),
            (
                "too long",
                json.replacen(DECODER, &"r".repeat(MAX_JSON_BYTES), 1),
            ),
            (
                "a decoder with a path",
                json.replacen(DECODER, "C:\\\\users\\\\x", 1),
            ),
        ] {
            let refused = read_stamp(svg(&inner).as_bytes(), Kind::Svg).expect_err(name);
            assert_eq!(refused.to_string(), UNREADABLE, "{name}");
        }
    }

    #[test]
    fn a_pdf_stamp_sits_beside_the_producer_and_reads_back_intact() {
        let (pdf, stamp) = stamped_pdf();
        let text = String::from_utf8_lossy(&pdf);

        let entry = format!("/Signatum (signatum:{})", stamp.json().expect("json"));
        assert!(text.contains("/Producer (Signatum)"));
        assert!(
            text.contains(&entry),
            "no stamp entry in the information dictionary"
        );
        let info = text
            .split(" 0 obj")
            .find(|object| object.contains("/Producer"))
            .expect("an information dictionary");
        assert!(
            info.contains(&entry),
            "the stamp is not beside the producer"
        );

        let found = read_stamp(&pdf, Kind::Pdf).expect("read").expect("stamp");
        assert!(found.intact);
        assert_eq!(found.stamp, stamp);
    }

    /// Writing the digest in moves nothing: every offset the cross-reference table gives
    /// still lands on its object.
    #[test]
    fn sealing_a_pdf_keeps_every_offset_true() {
        let (pdf, _) = stamped_pdf();
        let text = String::from_utf8_lossy(&pdf);

        let startxref: usize = text
            .rsplit("startxref")
            .next()
            .and_then(|tail| tail.split_whitespace().next())
            .and_then(|number| number.parse().ok())
            .expect("a startxref");
        assert!(
            pdf[startxref..].starts_with(b"xref"),
            "startxref does not point at xref"
        );

        // From the bytes, not the lossy text: an image stream is not UTF-8, and
        // its replacement characters would move every offset after it.
        let table = String::from_utf8_lossy(&pdf[startxref..]);
        let entries: Vec<usize> = table
            .lines()
            .map(str::trim_end)
            .skip(2)
            .take_while(|line| line.ends_with(" n") || line.ends_with(" f"))
            .filter(|line| line.ends_with(" n"))
            .map(|line| line[..10].parse().expect("an offset"))
            .collect();
        assert!(!entries.is_empty());
        for (index, offset) in entries.iter().enumerate() {
            let expected = format!("{} 0 obj", index + 1);
            assert!(
                pdf[*offset..].starts_with(expected.as_bytes()),
                "object {} is not at {offset}",
                index + 1
            );
        }
    }

    #[test]
    fn one_changed_byte_in_a_stamped_pdf_is_a_file_that_was_changed() {
        let (mut pdf, _) = stamped_pdf();
        let at = find(&pdf, b"/MediaBox [0 0 70.87").expect("a media box") + 15;
        pdf[at] = b'9';

        let found = read_stamp(&pdf, Kind::Pdf).expect("read").expect("stamp");
        assert!(!found.intact);
    }

    #[test]
    fn a_pdf_with_no_stamp_has_none_and_one_with_two_is_refused() {
        let plain = pdf::one_page(&artefact(128), 25.0, None).expect("page");
        assert!(plain.stamp.is_none());
        assert_eq!(read_stamp(&plain.bytes, Kind::Pdf).expect("read"), None);

        let (pdf, stamp) = stamped_pdf();
        let entry = format!("/Signatum (signatum:{})", stamp.json().expect("json"));
        let mut twice = pdf.clone();
        twice.extend_from_slice(format!("\n% {entry}\n").as_bytes());
        let refused = read_stamp(&twice, Kind::Pdf).expect_err("two stamps");
        assert_eq!(refused.to_string(), MORE_THAN_ONE);
    }

    #[test]
    fn the_stamp_carries_no_path() {
        let (pdf, stamp) = stamped_pdf();
        let json = stamp.json().expect("json");
        for fragment in ["\\", "/", ":\\", "Users", "tmp", "signatum-"] {
            assert!(!json.contains(fragment), "`{fragment}` is in {json}");
        }
        assert!(String::from_utf8_lossy(&pdf).contains(&json));
    }

    /// The one form a stamp's decoder has, on both sides: this product's own
    /// decoder string has it, and anything else does not.
    #[test]
    fn a_decoder_is_a_lower_case_name_and_a_three_part_version() {
        assert!(is_decoder(&crate::imaging::verify::decoder()));
        for good in [
            "rqrr 0.10.1",
            "a 0.0.0",
            "zx_ing-cpp 2.2.10",
            &format!("{} 1.2.3", "r".repeat(32)),
        ] {
            assert!(is_decoder(good), "{good}");
        }
        for bad in [
            "",
            "rqrr",
            "rqrr 0.10",
            "rqrr 0.10.1.2",
            "rqrr 0.10.1 ",
            " rqrr 0.10.1",
            "Rqrr 0.10.1",
            "rqrr 0..1",
            "rqrr 0.10.x",
            "rqrr 0.10.\u{0661}",
            "r(r) 0.10.1",
            "rqrr\t0.10.1",
        ] {
            assert!(!is_decoder(bad), "{bad:?}");
        }
    }

    /// M1: the chunk is a stamp only where this product writes it — a correct
    /// CRC, immediately before IEND. A flipped CRC byte is not a stamp.
    #[test]
    fn a_stamp_chunk_with_a_wrong_crc_is_refused() {
        let (mut stamped, _) = stamped_png(&artefact(128));
        let crc_at = stamped.len() - 12 - 1;
        stamped[crc_at] ^= 0x01;

        let refused = read_stamp(&stamped, Kind::Png).expect_err("a wrong CRC");
        assert_eq!(refused.to_string(), UNREADABLE);
    }

    #[test]
    fn a_stamp_chunk_moved_to_the_front_is_refused() {
        let (stamped, _) = stamped_png(&artefact(128));
        let chunk = stamp_chunk(&stamped);
        let plain = png_without_stamp(&stamped).expect("strip");
        let moved = [&plain[..8], &chunk[..], &plain[8..]].concat();

        let refused = read_stamp(&moved, Kind::Png).expect_err("before IHDR");
        assert_eq!(refused.to_string(), UNREADABLE);
    }

    #[test]
    fn a_stamp_chunk_between_idats_is_refused() {
        // A PNG with two IDAT chunks: the encoder's one, split in two.
        let plain = artefact(128);
        let idat = Chunks::new(&plain)
            .find(|chunk| &plain[chunk.kind.clone()] == b"IDAT")
            .expect("an IDAT");
        let data = &plain[idat.data.clone()];
        let half = data.len() / 2;
        let split = [
            &plain[..idat.whole.start],
            &chunk(b"IDAT", &data[..half])[..],
            &chunk(b"IDAT", &data[half..])[..],
            &plain[idat.whole.end..],
        ]
        .concat();
        image::load_from_memory_with_format(&split, image::ImageFormat::Png)
            .expect("two IDATs are still a PNG");
        let (stamped, _) = stamped_png(&split);
        let stamp = stamp_chunk(&stamped);

        let second = Chunks::new(&split)
            .filter(|chunk| &split[chunk.kind.clone()] == b"IDAT")
            .nth(1)
            .expect("the second IDAT")
            .whole
            .start;
        let between = [&split[..second], &stamp[..], &split[second..]].concat();

        let refused = read_stamp(&between, Kind::Png).expect_err("between IDATs");
        assert_eq!(refused.to_string(), UNREADABLE);
    }

    /// A stamp chunk followed by anything but IEND — another ancillary chunk —
    /// is refused too.
    #[test]
    fn a_stamp_chunk_not_followed_by_iend_is_refused() {
        let (stamped, _) = stamped_png(&artefact(128));
        let after = with_chunk_before_iend(&stamped, &chunk(b"tIME", &[7, 234, 1, 1, 0, 0, 0]));

        let refused = read_stamp(&after, Kind::Png).expect_err("not before IEND");
        assert_eq!(refused.to_string(), UNREADABLE);
    }
}
