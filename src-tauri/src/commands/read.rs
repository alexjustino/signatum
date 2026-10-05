//! The doors into Read: a picture somebody chose, a picture somebody copied, and
//! — from P2 — an exported file whose stamp somebody wants checked.
//!
//! `read_image` is the third place in the product that reads a file a person
//! picked out of a dialog (`import_logo` is the first, `read_text_file` the
//! second; `check_file`, below, is the fourth), and `read_clipboard` the first
//! that takes anything off the clipboard. The rules are
//! the ones the other doors keep, because the danger is the same one: an image
//! from outside is a decoder's input before it is a picture. An absolute local
//! path, capped by the directory entry before a byte is read, the format decided
//! by the magic bytes and never by the name, the dimensions read from the header
//! and refused before a pixel is decoded, and the path never echoed — not in the
//! answer, not in an error.
//!
//! What is different here, and it is the whole point of the screen: **nothing is
//! stored**. No row, no file, no thumbnail on disk — a stamp is checked against
//! the rows that are there, and nothing is written about the check. A code somebody reads is not
//! a code this product made, and the workspace is a record of what it made. The
//! picture the screen shows is not the file either — it is this host's own PNG,
//! re-encoded from the decoded pixels at [`PREVIEW_SIDE`], so the bytes that
//! arrived never reach the window.
//!
//! What the content *means* is not decided here. The host reports the bytes, the
//! text they make and the facts of the symbol; whether that is a link, a Wi-Fi
//! network or a contact card — and whether it would scan at 20 mm — is the
//! domain's, in TypeScript, where it can be tested without a window (ADR-011).
//!
//! The stamp door, `check_file`, is narrower than the first on purpose. It opens
//! a `.png`, `.svg` or `.pdf` under the same path rules and the same cap, and
//! looks for the stamp this product writes (`export::stamp`) — and that is all it
//! does. It **never renders and never decodes an SVG or a PDF**: those are
//! searched for one marker as bytes, because a door that drew somebody's SVG to
//! check a comment in it would be a renderer reachable from any file on the disk.
//! What it reports about *when* and *as what* a file was verified comes from this
//! workspace's own rows and never from the file, which carries no date.
//!
//! # Changelog of this boundary
//!
//! - F10: `read_image` and `read_clipboard`.
//! - P2: `check_file`, and `read_image` reports the stamp of a PNG it opened.

use std::io::{Cursor, Read as _};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{DynamicImage, ImageFormat, ImageReader, Limits, RgbaImage};
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::commands::logos::RESERVED;
use crate::db::{verifications, Db};
use crate::error::{Error, Result};
use crate::export::stamp::{self, Found as StampFound, Kind};
use crate::imaging::logo::{looks_like_svg, MAX_DECODE_ALLOC, MAX_LOGO_PIXELS, MAX_LOGO_SIDE};
use crate::imaging::read::{read_codes, Found, FoundCode};
use crate::os::clipboard;

/// The largest file Read will open. The same twenty megabytes a logo may be:
/// it is the cap on what this product will let a decoder be handed, and a
/// second number would be a second answer to the same question.
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// The most codes one reading reports. A photograph has a handful; an image built to hold
/// thousands is reported by count, and the first of them are shown.
pub const MAX_CODES: usize = 32;

/// The longest side a picture may claim, in pixels — checked from the header,
/// before a pixel is decoded.
pub const MAX_IMAGE_SIDE: u32 = MAX_LOGO_SIDE;

/// The most pixels a picture may hold, whatever shape it is. This and
/// [`MAX_IMAGE_SIDE`] are what make a decompression bomb a sentence at
/// kilobytes rather than an out-of-memory kill at gigapixels (`SECURITY.md`).
pub const MAX_IMAGE_PIXELS: u64 = MAX_LOGO_PIXELS;

/// The longest side of the picture the screen is shown. Large enough that the
/// outline lands where the eye expects it, small enough that a `data:` URL is
/// not a photograph.
pub const PREVIEW_SIDE: u32 = 1024;

/// What is said when the picture held no code at all.
pub const NO_CODE: &str = "No QR code was found in this image.";

/// What is said when the first pass found nothing and the second one did.
///
/// It is not an apology: a picture that needed the exposure evened out is a
/// picture some phones will not read either, and that is worth knowing before
/// the code is printed.
pub const ADJUSTED: &str = "Found after adjusting the exposure.";

/// What an SVG is told. It is not a refusal of the file — it is a signpost to
/// the door that does take one.
pub const AN_SVG: &str =
    "Read works on photographs and screenshots; open an SVG as a logo instead.";

/// What anything else is told.
pub const NOT_A_PICTURE: &str = "That file is not an image Read can open.";

/// The largest file whose stamp is checked: the same cap as a picture, for the
/// same reason.
pub const MAX_CHECKED_BYTES: u64 = MAX_IMAGE_BYTES;

/// What a file of any other kind is told by `check_file`.
pub const NOT_CHECKABLE: &str = "A stamp is checked on a PNG, SVG or PDF file.";

/// What a stamp says, checked against this workspace.
///
/// `decoder` is the only thing taken from the file, and only when it carries a
/// stamp. Everything else that describes the verification — when, as what, of
/// which saved code — is read from this workspace's row, and only when that row
/// holds the same reference, the same payload digest and the same stamp digest:
/// a file that matches no row here gets nothing but what its own stamp says.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct StampCheck {
    /// The file carries a stamp this build reads.
    pub stamped: bool,
    /// The file still matches its stamp's digest. False when there is no stamp.
    pub intact: bool,
    /// `png`, `svg` or `pdf`.
    pub kind: &'static str,
    /// The decoder the stamp names; `None` when there is no stamp.
    pub decoder: Option<String>,
    /// This workspace holds a row with the stamp's reference.
    pub in_workspace: bool,
    /// That row's payload digest and stamp digest are the stamp's.
    pub matches_record: bool,
    /// When the row was recorded — from the workspace, never from the file.
    pub verified_at: Option<String>,
    /// What the export was, from the row.
    pub format: Option<String>,
    /// The resolution it was made for, from the row.
    pub dpi: Option<u32>,
    /// The saved code it was of, while that code is in the library.
    pub code_id: Option<String>,
    /// That saved code's name.
    pub code_name: Option<String>,
}

impl StampCheck {
    /// The answer for a file with no stamp.
    fn unstamped(kind: Kind) -> Self {
        Self {
            stamped: false,
            intact: false,
            kind: kind.token(),
            decoder: None,
            in_workspace: false,
            matches_record: false,
            verified_at: None,
            format: None,
            dpi: None,
            code_id: None,
            code_name: None,
        }
    }
}

/// One code found in a picture, as the interface reads it.
///
/// `bytes` is base64 and `text` is the same bytes read as UTF-8 with the
/// unreadable parts replaced: a payload is compared and described from the
/// bytes, and shown from the text. The two are both here because a code may
/// carry bytes that are not text at all, and a screen that showed only the
/// lossy form would be saying the code contains question marks.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct CodeRead {
    /// Exactly what the code carries, base64-encoded. Empty when it did not
    /// decode.
    pub bytes: String,
    /// The same bytes as text, lossily.
    pub text: String,
    /// The symbol's version, 1 to 40; absent when the format could not be read.
    pub version: Option<u32>,
    /// `L`, `M`, `Q` or `H`; absent when the format could not be read.
    pub ecl: Option<char>,
    /// Which of the eight data masks; absent when the format could not be read.
    pub mask: Option<u8>,
    /// The symbol's side in modules, quiet zone excluded.
    pub side_modules: u32,
    /// Where it sits in the picture, in the picture's own pixels, clockwise
    /// from the top left.
    pub corners: [[i32; 2]; 4],
    /// One sentence when a pattern was found and would not decode.
    pub error: Option<String>,
}

/// What one picture turned out to hold.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct Reading {
    /// The picture's own width, in pixels — not the preview's.
    pub width: u32,
    /// The picture's own height, in pixels.
    pub height: u32,
    /// The picture as the screen shows it: this host's PNG, as a `data:` URL.
    pub preview: String,
    /// Every code found, in the order the detector reported them.
    pub codes: Vec<CodeRead>,
    /// One sentence about the search itself, when there is one to say.
    pub note: Option<String>,
    /// How long the search took, in milliseconds.
    pub decode_ms: u64,
    /// The stamp of a PNG opened from a file, checked against this workspace;
    /// `None` for a picture with no stamp, for any other format, and for the
    /// clipboard, which carries pixels and never a file's stamp.
    pub stamp: Option<StampCheck>,
}

/// Read the picture a person chose in the open dialog.
///
/// Off the main thread: a twelve-megapixel photograph is a second of work, and
/// a window that stops painting for a second looks broken.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path this host will not read, a file that is
/// too large, an SVG, and anything that is not one of the four picture formats;
/// [`Error::File`] when the read itself failed; [`Error::Render`] when the
/// picture could not be prepared for the screen.
#[tauri::command(async, rename_all = "snake_case")]
pub fn read_image(db: State<'_, Db>, path: String) -> Result<Reading> {
    read_image_at(&db.0, &path)
}

/// Check the stamp of a file this product exported — or of any `.png`, `.svg`
/// or `.pdf` somebody hands it.
///
/// Off the main thread: a twenty-megabyte file is read and hashed. Nothing is
/// rendered and nothing is decoded; an SVG or a PDF is never parsed. The path is
/// never echoed.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path this host will not read, a file that is
/// not a `.png`, `.svg` or `.pdf`, one that is too large, a `.png` that is not a
/// PNG, a file with two stamps, and a stamp this build cannot read;
/// [`Error::File`] when the read itself failed; [`Error::Database`] when the
/// workspace could not be asked.
#[tauri::command(async, rename_all = "snake_case")]
pub fn check_file(db: State<'_, Db>, path: String) -> Result<StampCheck> {
    check_file_at(&db.0, &path)
}

/// Read the picture somebody copied — a screenshot of a code, most often.
///
/// The clipboard is this host's own, reached through `arboard` rather than
/// through a plugin, so the interface can ask for what is on it and cannot read
/// it itself. Nothing else on the clipboard is looked at: an image, or the
/// sentence that there is none.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the clipboard holds no image, and when the
/// image is past the pixel caps; [`Error::File`] when the clipboard could not be
/// opened; [`Error::Render`] when the picture could not be prepared for the
/// screen.
#[tauri::command(async)]
pub fn read_clipboard() -> Result<Reading> {
    let copied = clipboard::read_image()?;
    let (width, height) = (
        u32::try_from(copied.width).unwrap_or(u32::MAX),
        u32::try_from(copied.height).unwrap_or(u32::MAX),
    );
    within_caps(width, height)?;

    let pixels = RgbaImage::from_raw(width, height, copied.rgba).ok_or_else(|| {
        log::error!("the clipboard gave {width}×{height} and the wrong number of bytes for it");
        Error::InvalidInput("That image could not be read.".to_string())
    })?;

    log::info!("reading a {width}×{height} picture from the clipboard");
    reading_of(&DynamicImage::ImageRgba8(pixels))
}

/// What [`read_image`] does once the path is a string this host will consider.
fn read_image_at(db: &Mutex<Connection>, path: &str) -> Result<Reading> {
    let source = check_source(path, &PICTURE)?;
    let bytes = read_capped(
        source,
        MAX_IMAGE_BYTES,
        |found| {
            format!(
                "This file is {}; Read opens a picture of at most {}.",
                megabytes(found),
                megabytes(MAX_IMAGE_BYTES)
            )
        },
        || {
            format!(
                "This file is larger than {}, which is the most Read opens.",
                megabytes(MAX_IMAGE_BYTES)
            )
        },
    )?;

    let decoded = decode_picture(&bytes)?;
    log::info!(
        "reading a {}×{} picture from a file",
        decoded.width(),
        decoded.height()
    );
    let mut reading = reading_of(&decoded)?;

    // A PNG may be one this product exported. Its stamp is looked for in the
    // bytes that arrived — the chunk walk reads, it does not decode — and a stamp
    // that cannot be trusted is not reported rather than allowed to fail a
    // reading of the codes, which is what this door is for. `check_file` says why.
    if bytes.starts_with(&stamp::PNG_SIGNATURE) {
        match stamp::read_stamp(&bytes, Kind::Png) {
            Ok(Some(found)) => {
                let conn = db.lock().expect("the database lock was poisoned");
                reading.stamp = Some(check_of(&conn, Kind::Png, Some(found))?);
            }
            Ok(None) => {}
            Err(error) => log::warn!("a picture's stamp was not reported: {error}"),
        }
    }
    Ok(reading)
}

/// What [`check_file`] does once the database is in hand.
fn check_file_at(db: &Mutex<Connection>, path: &str) -> Result<StampCheck> {
    let source = check_source(path, &CHECKED)?;
    let kind = kind_of(source)?;
    let bytes = read_capped(
        source,
        MAX_CHECKED_BYTES,
        |found| {
            format!(
                "This file is {}; a stamp is checked on a file of at most {}.",
                megabytes(found),
                megabytes(MAX_CHECKED_BYTES)
            )
        },
        || {
            format!(
                "This file is larger than {}, which is the most a stamp is checked on.",
                megabytes(MAX_CHECKED_BYTES)
            )
        },
    )?;

    let found = stamp::read_stamp(&bytes, kind)?;
    let conn = db.lock().expect("the database lock was poisoned");
    let check = check_of(&conn, kind, found)?;
    log::info!(
        "checked a {} file: stamped {}, intact {}, in this workspace {}, matching {}",
        check.kind,
        check.stamped,
        check.intact,
        check.in_workspace,
        check.matches_record
    );
    Ok(check)
}

/// The kind of file `check_file` was handed, by its extension — which here is
/// the only thing that decides it, because nothing is decoded.
fn kind_of(source: &Path) -> Result<Kind> {
    let extension = source
        .extension()
        .and_then(|found| found.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("png") => Ok(Kind::Png),
        Some("svg") => Ok(Kind::Svg),
        Some("pdf") => Ok(Kind::Pdf),
        _ => Err(Error::InvalidInput(NOT_CHECKABLE.to_string())),
    }
}

/// A stamp found — or not — checked against this workspace.
///
/// The row is found by the stamp's reference. It *matches* when its payload
/// digest and its stamp digest are the stamp's; only then does the answer carry
/// what the row knows. A reference this workspace holds under a different digest
/// is a stamp copied onto another file, or a file from another export under a
/// forged reference — and in both cases the date of the row would be a date
/// about some other file.
fn check_of(conn: &Connection, kind: Kind, found: Option<StampFound>) -> Result<StampCheck> {
    let Some(found) = found else {
        return Ok(StampCheck::unstamped(kind));
    };
    let record = verifications::find_by_stamp(conn, &found.stamp.reference)?;
    let in_workspace = record.is_some();
    let known = record.filter(|row| {
        row.payload_sha256 == found.stamp.payload && row.stamp_digest == found.stamp.digest
    });

    Ok(StampCheck {
        stamped: true,
        intact: found.intact,
        kind: kind.token(),
        decoder: Some(found.stamp.decoder),
        in_workspace,
        matches_record: known.is_some(),
        verified_at: known.as_ref().map(|row| row.created_at.clone()),
        format: known.as_ref().and_then(|row| row.format.clone()),
        dpi: known.as_ref().and_then(|row| row.dpi),
        code_id: known.as_ref().and_then(|row| row.code_id.clone()),
        code_name: known.and_then(|row| row.code_name),
    })
}

/// A file's bytes, under a cap checked twice: by the directory entry before a
/// byte is read, and by a ceiling on the read itself — a file that grew between
/// the two calls, or a special file whose size reads as zero, is stopped at the
/// cap.
fn read_capped(
    source: &Path,
    cap: u64,
    too_large: impl Fn(u64) -> String,
    past_the_cap: impl Fn() -> String,
) -> Result<Vec<u8>> {
    let facts = std::fs::metadata(source).map_err(|error| {
        log::error!("a file could not be opened: {error}");
        Error::File("that file could not be opened")
    })?;
    if !facts.is_file() {
        return Err(Error::InvalidInput(
            "That is a folder, not a file.".to_string(),
        ));
    }
    if facts.len() > cap {
        return Err(Error::InvalidInput(too_large(facts.len())));
    }

    let mut bytes = Vec::with_capacity(facts.len() as usize);
    let file = std::fs::File::open(source).map_err(|error| {
        log::error!("a file could not be opened for reading: {error}");
        Error::File("that file could not be read")
    })?;
    std::io::Read::take(file, cap + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            log::error!("a file could not be read: {error}");
            Error::File("that file could not be read")
        })?;
    if bytes.len() as u64 > cap {
        return Err(Error::InvalidInput(past_the_cap()));
    }
    Ok(bytes)
}

/// What a door says about a path it will not read.
struct Door {
    /// For a path that is not absolute.
    relative: &'static str,
    /// For a path on another machine.
    network: &'static str,
}

/// Read's picture door.
const PICTURE: Door = Door {
    relative: "A picture is read from the full path of a file.",
    network: "A picture is read from a local drive, not from a network path.",
};

/// The stamp-checking door.
const CHECKED: Door = Door {
    relative: "A file is checked from its full path.",
    network: "A file is checked on a local drive, not on a network path.",
};

/// The path a person chose in the open dialog, checked before it is read.
///
/// Absolute, on this machine, and not a device Windows keeps a name for. The
/// extension is not looked at here: for a picture the magic bytes decide, and
/// for a stamp the door decides after this.
fn check_source<'a>(path: &'a str, door: &Door) -> Result<&'a Path> {
    let source = Path::new(path);
    if !source.is_absolute() {
        return Err(Error::InvalidInput(door.relative.to_string()));
    }
    // A UNC path (`\\host\share\code.png`) or a verbatim one (`\\?\...`) is
    // absolute too, and reading there would make this host open a network
    // connection on the interface's word, in a product that promises nothing
    // leaves the machine.
    if !crate::os::paths::is_local(path) {
        return Err(Error::InvalidInput(door.network.to_string()));
    }
    // `COM3.png` is a device on a Windows that has the port, and opening it can
    // wait forever. Refused by name, before anything is opened.
    let stem = source
        .file_stem()
        .and_then(|found| found.to_str())
        .unwrap_or("");
    // Windows resolves `COM3 .png` and `COM3..png` to the device as well.
    let base = stem
        .split('.')
        .next()
        .unwrap_or(stem)
        .trim_end_matches([' ', '.']);
    if RESERVED.contains(&base.to_ascii_lowercase().as_str()) {
        return Err(Error::InvalidInput(
            "That is a name Windows reserves for a device, not a file.".to_string(),
        ));
    }
    Ok(source)
}

/// The bytes of a file, as pixels — under every cap, and never by their name.
fn decode_picture(bytes: &[u8]) -> Result<DynamicImage> {
    // Before the format is guessed at all: `image` does not read SVG, and an
    // SVG is not a mistake worth a generic sentence — it is the other door.
    if looks_like_svg(bytes) {
        return Err(Error::InvalidInput(AN_SVG.to_string()));
    }

    let format = picture_format(bytes)?;

    // The header, and nothing else: no pixel has been touched yet. The
    // allocation ceiling still applies, because reading a header is not a reason
    // to let a decoder ask for a gigabyte.
    let mut header = ImageReader::with_format(Cursor::new(bytes), format);
    let mut header_limits = Limits::default();
    header_limits.max_alloc = Some(MAX_DECODE_ALLOC);
    header.limits(header_limits);
    let (width, height) = header
        .into_dimensions()
        .map_err(|error| unreadable(&error))?;
    within_caps(width, height)?;

    // A header can lie. The limits are what stops a lie from being expensive:
    // the decoder is refused the allocation rather than trusted with it.
    // `Limits` is non-exhaustive on purpose — a future version of `image` may
    // add one, and its default should arrive with it.
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    // For a GIF this reads the first frame and stops, so ten thousand frames
    // cost what one does.
    reader.decode().map_err(|error| unreadable(&error))
}

/// The format the magic bytes say, refused unless it is one of the four Read
/// opens.
///
/// `with_guessed_format` knows more formats than this product compiles in, so
/// the four are named: an unsupported format is a sentence about what Read
/// opens, rather than a decoder error about a feature flag.
fn picture_format(bytes: &[u8]) -> Result<ImageFormat> {
    let unknown = || Error::InvalidInput(NOT_A_PICTURE.to_string());

    let format = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| unknown())?
        .format()
        .ok_or_else(unknown)?;

    match format {
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP => Ok(format),
        _ => Err(unknown()),
    }
}

/// The pixel caps, as one refusal that says what the picture claimed to be.
fn within_caps(width: u32, height: u32) -> Result<()> {
    if width == 0
        || height == 0
        || width > MAX_IMAGE_SIDE
        || height > MAX_IMAGE_SIDE
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(Error::InvalidInput(format!(
            "This image is {width}×{height} pixels; \
             Read opens a picture of at most {MAX_IMAGE_SIDE} pixels a side."
        )));
    }
    Ok(())
}

/// The search, and everything the screen is told about it.
///
/// One place, because the two doors differ only in where the pixels came from —
/// and a second copy of this is a second answer to "what did it find".
fn reading_of(picture: &DynamicImage) -> Result<Reading> {
    let started = Instant::now();
    let found = read_codes(&picture.to_luma8());
    let decode_ms = started.elapsed().as_millis() as u64;

    log::info!(
        "read {} code(s) in {decode_ms} ms{}",
        found.codes.len(),
        if found.adjusted {
            ", after adjusting the exposure"
        } else {
            ""
        }
    );

    // A mosaic of thousands of codes is a screen with thousands of cards; the first few
    // dozen are reported and the note says how many there were.
    let total = found.codes.len();
    let note = match note_for(&found) {
        Some(note) => Some(note),
        None if total > MAX_CODES => Some(format!(
            "{total} codes were found; the first {MAX_CODES} are shown."
        )),
        None => None,
    };
    Ok(Reading {
        width: picture.width(),
        height: picture.height(),
        preview: preview_of(picture)?,
        note,
        codes: found.codes.into_iter().take(MAX_CODES).map(shown).collect(),
        decode_ms,
        stamp: None,
    })
}

/// The one sentence about the search, when there is one.
fn note_for(found: &Found) -> Option<String> {
    if found.codes.is_empty() {
        Some(NO_CODE.to_string())
    } else if found.adjusted {
        Some(ADJUSTED.to_string())
    } else {
        None
    }
}

/// A found code as the interface reads it.
fn shown(code: FoundCode) -> CodeRead {
    CodeRead {
        text: String::from_utf8_lossy(&code.bytes).into_owned(),
        bytes: STANDARD.encode(&code.bytes),
        version: code.version,
        ecl: code.ecl,
        mask: code.mask,
        side_modules: code.side_modules,
        corners: code.corners,
        error: code.error,
    }
}

/// The picture the screen shows: **this host's** PNG, at most [`PREVIEW_SIDE`]
/// on its long side, as a `data:` URL.
///
/// Re-encoded from the decoded pixels rather than passed through, for the same
/// reason a logo is (ADR-016): the bytes that arrived in somebody's file do not
/// reach the window. It is also the only copy of the picture that leaves this
/// host — nothing is written, and nothing is kept.
fn preview_of(picture: &DynamicImage) -> Result<String> {
    let shown = if picture.width() > PREVIEW_SIDE || picture.height() > PREVIEW_SIDE {
        picture.resize(
            PREVIEW_SIDE,
            PREVIEW_SIDE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        picture.clone()
    };

    let mut png = Vec::new();
    shown
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| {
            log::error!("a picture could not be encoded for the screen: {error}");
            Error::Render("That image could not be shown.".to_string())
        })?;

    Ok(format!("data:image/png;base64,{}", STANDARD.encode(&png)))
}

/// The one sentence a decoder's failure becomes. The detail goes to the log;
/// what the person is told is that the file did not read.
fn unreadable(error: &image::ImageError) -> Error {
    log::debug!("a picture did not decode: {error}");
    Error::InvalidInput("This file could not be read as an image; it may be truncated.".to_string())
}

/// A byte count as a person reads it, to one decimal.
fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;

    /// A directory of its own for each test that writes, removed when it ends.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("signatum-{}", crate::db::new_id()));
            std::fs::create_dir_all(&path).expect("scratch directory");
            Self(path)
        }

        fn holding(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).expect("seed");
            path.to_string_lossy().into_owned()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn workspace() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::db::migrations::apply(&conn).expect("migrate");
        Mutex::new(conn)
    }

    /// The fixture as a PNG file's bytes.
    fn a_code() -> Vec<u8> {
        render_png(hello_world_svg().as_bytes(), 320)
            .expect("render")
            .png
    }

    #[test]
    fn a_picture_of_a_code_is_read_and_nothing_about_it_is_kept() {
        let scratch = Scratch::new();
        let path = scratch.holding("photo.png", &a_code());

        let reading = read_image_at(&workspace(), &path).expect("read");

        assert_eq!((reading.width, reading.height), (320, 320));
        assert!(reading.preview.starts_with("data:image/png;base64,"));
        assert_eq!(reading.note, None);
        assert_eq!(reading.codes.len(), 1);

        let code = &reading.codes[0];
        assert_eq!(code.text, HELLO_WORLD);
        assert_eq!(
            STANDARD.decode(&code.bytes).expect("base64"),
            HELLO_WORLD.as_bytes()
        );
        assert_eq!(code.version, Some(1));
        assert_eq!(code.ecl, Some('Q'));
        assert_eq!(code.mask, Some(0));
        assert_eq!(code.side_modules, 21);
        assert_eq!(code.error, None);
        for [x, y] in code.corners {
            assert!((0..320).contains(&x) && (0..320).contains(&y), "{x},{y}");
        }
    }

    #[test]
    fn the_preview_is_our_own_png_and_never_the_bytes_that_arrived() {
        let scratch = Scratch::new();
        // A picture larger than the preview, so the answer cannot be the file.
        let big = render_png(hello_world_svg().as_bytes(), 1600)
            .expect("render")
            .png;
        let path = scratch.holding("photo.png", &big);

        let reading = read_image_at(&workspace(), &path).expect("read");

        let preview = reading
            .preview
            .strip_prefix("data:image/png;base64,")
            .expect("a data URL");
        let bytes = STANDARD.decode(preview).expect("base64");
        assert_ne!(bytes, big, "the file's own bytes must not reach the screen");

        let shown = image::load_from_memory(&bytes).expect("a PNG");
        assert_eq!(shown.width().max(shown.height()), PREVIEW_SIDE);
        assert_eq!(
            (reading.width, reading.height),
            (1600, 1600),
            "the answer measures the picture, not the preview"
        );
        assert_eq!(reading.codes[0].text, HELLO_WORLD);
    }

    #[test]
    fn a_picture_with_no_code_in_it_says_so() {
        let scratch = Scratch::new();
        let blank = render_png(blank_svg().as_bytes(), 320).expect("render").png;
        let path = scratch.holding("nothing.png", &blank);

        let reading = read_image_at(&workspace(), &path).expect("read");

        assert!(reading.codes.is_empty());
        assert_eq!(reading.note.as_deref(), Some(NO_CODE));
    }

    #[test]
    fn an_svg_is_sent_to_the_door_that_takes_one() {
        let scratch = Scratch::new();
        // Named `.png`, because the name decides nothing: the bytes do.
        let path = scratch.holding("drawing.png", hello_world_svg().as_bytes());

        let refused = read_image_at(&workspace(), &path).expect_err("an SVG is not read");

        assert_eq!(refused.to_string(), AN_SVG);
    }

    #[test]
    fn a_file_that_is_not_a_picture_is_one_sentence() {
        let scratch = Scratch::new();
        for (name, bytes) in [
            ("notes.png", b"certainly not a picture".as_slice()),
            ("empty.png", b"".as_slice()),
        ] {
            let path = scratch.holding(name, bytes);

            let refused = read_image_at(&workspace(), &path).expect_err("this is not a picture");

            assert_eq!(refused.to_string(), NOT_A_PICTURE, "{name}");
        }
    }

    #[test]
    fn a_file_larger_than_the_cap_is_refused_before_it_is_decoded() {
        let scratch = Scratch::new();
        let path = scratch.holding(
            "huge.png",
            &vec![0u8; MAX_IMAGE_BYTES as usize + 1].into_boxed_slice(),
        );

        let refused = read_image_at(&workspace(), &path).expect_err("too large");

        assert_eq!(
            refused.to_string(),
            "This file is 20.0 MB; Read opens a picture of at most 20.0 MB."
        );
    }

    #[test]
    fn a_picture_that_claims_gigapixels_is_refused_from_its_header() {
        let scratch = Scratch::new();
        let path = scratch.holding("bomb.png", &png_claiming(40_000, 40_000));

        let refused = read_image_at(&workspace(), &path).expect_err("a bomb is refused");

        assert_eq!(
            refused.to_string(),
            format!(
                "This image is 40000×40000 pixels; \
                 Read opens a picture of at most {MAX_IMAGE_SIDE} pixels a side."
            )
        );
    }

    /// A PNG header that claims a size, with a pixel's worth of deflate stream
    /// behind it. Nothing decompresses it: the size is refused from the header,
    /// which is the whole point. The same shape the logo's own bomb test uses —
    /// written out here so this door's test stands on its own.
    fn png_claiming(width: u32, height: u32) -> Vec<u8> {
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

        fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
            let mut body = Vec::from(*kind);
            body.extend_from_slice(data);

            let mut bytes = Vec::new();
            bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
            bytes.extend_from_slice(&body);
            bytes.extend_from_slice(&crc32(&body).to_be_bytes());
            bytes
        }

        let mut header = Vec::new();
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]); // eight bits, RGBA, no interlace

        let mut png = Vec::from([0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        png.extend_from_slice(&chunk(b"IHDR", &header));
        png.extend_from_slice(&chunk(b"IDAT", &[0x78, 0x01, 0x01, 0x00, 0x00, 0xFF, 0xFF]));
        png.extend_from_slice(&chunk(b"IEND", &[]));
        png
    }

    #[test]
    fn a_refusal_never_echoes_the_path() {
        let scratch = Scratch::new();
        let secret = "a-folder-nobody-should-read-about";
        let there = scratch.0.join(secret);
        std::fs::create_dir_all(&there).expect("a directory");

        let paths = [
            there.join("gone.png").to_string_lossy().into_owned(),
            {
                let path = there.join("notes.png");
                std::fs::write(&path, b"not a picture").expect("seed");
                path.to_string_lossy().into_owned()
            },
            there.to_string_lossy().into_owned(),
        ];

        for path in paths {
            let refused = read_image_at(&workspace(), &path).expect_err("refused");
            let said = refused.to_string();
            assert!(!said.contains(secret), "{said}");
            assert!(!said.contains(".png"), "{said}");
        }
    }

    #[test]
    fn the_host_refuses_a_source_it_was_not_given_properly() {
        for path in [
            "photo.png",
            "",
            "\\\\server\\share\\photo.png",
            "//server/share/photo.png",
            "C:\\codes\\COM3.png",
            "C:\\codes\\nul.png",
        ] {
            let refused = check_source(path, &PICTURE).expect_err("this source must be refused");
            assert!(
                matches!(refused, Error::InvalidInput(_)),
                "{path}: {refused:?}"
            );
        }
    }

    #[test]
    fn the_facts_reach_the_interface_in_snake_case() {
        let scratch = Scratch::new();
        let path = scratch.holding("photo.png", &a_code());

        let reading = read_image_at(&workspace(), &path).expect("read");
        let json = serde_json::to_value(&reading).expect("serialise");

        for key in [
            "width",
            "height",
            "preview",
            "codes",
            "note",
            "decode_ms",
            "stamp",
        ] {
            assert!(json.get(key).is_some(), "`{key}` is missing");
        }
        for key in [
            "bytes",
            "text",
            "version",
            "ecl",
            "mask",
            "side_modules",
            "corners",
            "error",
        ] {
            assert!(json["codes"][0].get(key).is_some(), "`{key}` is missing");
        }
        assert_eq!(json["codes"][0]["ecl"], "Q", "a level is its letter");
        assert_eq!(
            json["codes"][0]["corners"][0].as_array().map(Vec::len),
            Some(2)
        );
    }

    /// The clipboard round trip, which needs a desktop session: the image this
    /// product puts on the clipboard is an image it can read back off it.
    ///
    /// Ignored by default because the runner has no clipboard — and a test that
    /// fails on CI for having no session is a test nobody reads. Run with
    /// `cargo test -- --ignored` on a machine with a desktop.
    #[test]
    #[ignore]
    fn a_copied_code_reads_back_off_the_clipboard() {
        let artefact = clipboard::image_from_png(&a_code()).expect("the pixels");
        clipboard::place(&artefact).expect("the clipboard");

        let reading = read_clipboard().expect("read the clipboard");

        assert_eq!((reading.width, reading.height), (320, 320));
        assert_eq!(reading.codes.len(), 1, "{:?}", reading.note);
        assert_eq!(reading.codes[0].text, HELLO_WORLD);
        assert_eq!(reading.codes[0].version, Some(1));
    }

    /// An export into the scratch folder, the way the Create screen makes one —
    /// stamped, and recorded in `db`.
    fn exported(
        db: &Mutex<Connection>,
        scratch: &Scratch,
        name: &str,
        written: crate::commands::codes::Written,
        code_id: Option<&str>,
    ) -> String {
        let path = scratch.0.join(name).to_string_lossy().into_owned();
        let conn = db.lock().expect("lock");
        let done = crate::commands::codes::export_once(
            &conn,
            &crate::commands::codes::Asked {
                svg: &hello_world_svg(),
                payload: HELLO_WORLD,
                pixel_size: 295,
                logo: None,
                dpi: Some(300),
                code_id,
            },
            &path,
            written,
        )
        .expect("export");
        assert!(done.bytes_written.is_some(), "the export was written");
        path
    }

    /// A stamp written by hand onto a PNG, under a reference and a payload of
    /// the test's choosing — what somebody forging one would do.
    fn forged(png: &[u8], reference: &str, payload: &str) -> Vec<u8> {
        stamp::stamp_png(
            png,
            &stamp::Mark {
                reference,
                payload,
                decoder: "rqrr 0.10.1",
            },
        )
        .expect("stamp")
        .0
    }

    /// The proof of done, on Read's side: a file this workspace exported is
    /// "verified by this workspace, unchanged", for every kind of file — and
    /// what is said about when comes from the row.
    #[test]
    fn a_file_this_workspace_exported_is_its_own_and_unchanged() {
        let db = workspace();
        let scratch = Scratch::new();
        let saved = {
            let conn = db.lock().expect("lock");
            crate::db::codes::insert(
                &conn,
                &crate::db::codes::NewCode {
                    name: "Menu",
                    kind: "link",
                    payload_json: "{}",
                    style_json: "{}",
                    size_json: "{}",
                    logo_id: None,
                    logo_json: None,
                    scene_sha256: &"a".repeat(64),
                },
            )
            .expect("save")
            .id
        };

        use crate::commands::codes::Written;
        for (name, written, token) in [
            ("menu.png", Written::Png, "png"),
            ("menu.svg", Written::Svg, "svg"),
            ("menu.pdf", Written::Pdf { width_mm: 25.0 }, "pdf"),
        ] {
            let path = exported(&db, &scratch, name, written, Some(&saved));

            let check = check_file_at(&db, &path).expect("check");

            assert!(check.stamped, "{name}");
            assert!(check.intact, "{name}");
            assert!(check.in_workspace, "{name}");
            assert!(check.matches_record, "{name}");
            assert_eq!(check.kind, token);
            assert_eq!(check.decoder.as_deref(), Some("rqrr 0.10.1"));
            assert_eq!(check.format.as_deref(), Some(token));
            assert_eq!(check.dpi, Some(300));
            assert_eq!(check.code_id.as_deref(), Some(saved.as_str()));
            assert_eq!(check.code_name.as_deref(), Some("Menu"));
            let when = check.verified_at.expect("the row says when");
            assert!(when.ends_with('Z') && when.len() == 24, "{when}");
        }
    }

    /// One changed byte after the export: the stamp still names this
    /// workspace's row, and the file no longer matches it.
    #[test]
    fn a_file_changed_after_it_was_exported_says_so() {
        let db = workspace();
        let scratch = Scratch::new();
        use crate::commands::codes::Written;

        for (name, written) in [
            ("menu.png", Written::Png),
            ("menu.svg", Written::Svg),
            ("menu.pdf", Written::Pdf { width_mm: 25.0 }),
        ] {
            let path = exported(&db, &scratch, name, written, None);
            let mut bytes = std::fs::read(&path).expect("written");
            // A byte the format does not care much about, and the stamp does:
            // inside the PNG's IHDR, the SVG's root tag, the PDF's header.
            let at = match name {
                "menu.png" => 19,
                "menu.svg" => 6,
                _ => 5,
            };
            bytes[at] ^= 0x01;
            std::fs::write(&path, &bytes).expect("edit");

            let check = check_file_at(&db, &path).expect("check");
            assert!(check.stamped, "{name}");
            assert!(
                !check.intact,
                "{name}: one byte changed and it said unchanged"
            );
            assert!(check.in_workspace, "{name}");
        }
    }

    /// Anyone can write a stamp. One with a valid digest under a reference this
    /// workspace has never issued is intact — and from somewhere else.
    #[test]
    fn a_forged_stamp_with_a_valid_digest_is_not_this_workspaces() {
        let db = workspace();
        let scratch = Scratch::new();
        let reference = crate::db::new_stamp_ref();
        let payload = crate::imaging::verify::sha256_hex(HELLO_WORLD.as_bytes());
        let path = scratch.holding("forged.png", &forged(&a_code(), &reference, &payload));

        let check = check_file_at(&db, &path).expect("check");

        assert!(check.stamped);
        assert!(check.intact, "the forger computed the digest correctly");
        assert!(!check.in_workspace);
        assert!(!check.matches_record);
        assert_eq!(check.verified_at, None, "nothing about when, from the file");
        assert_eq!((check.format, check.dpi, check.code_id), (None, None, None));
    }

    /// A reference this workspace issued, written onto a file with a different
    /// payload: the row is found, and it is about some other file.
    #[test]
    fn a_stamp_whose_reference_is_known_but_whose_payload_differs_does_not_match() {
        let db = workspace();
        let scratch = Scratch::new();
        let original = exported(
            &db,
            &scratch,
            "menu.png",
            crate::commands::codes::Written::Png,
            None,
        );
        let reference = check_reference(&original);
        let other = crate::imaging::verify::sha256_hex(b"something else entirely");
        let path = scratch.holding("other.png", &forged(&a_code(), &reference, &other));

        let check = check_file_at(&db, &path).expect("check");

        assert!(check.stamped && check.intact);
        assert!(check.in_workspace, "the reference is this workspace's");
        assert!(!check.matches_record, "but not for this payload");
        assert_eq!(
            check.verified_at, None,
            "and its date is about another file"
        );
    }

    /// The same reference copied onto a different picture of the same code —
    /// the payload matches, the digest does not.
    #[test]
    fn a_stamp_copied_onto_another_picture_of_the_same_code_does_not_match() {
        let db = workspace();
        let scratch = Scratch::new();
        let original = exported(
            &db,
            &scratch,
            "menu.png",
            crate::commands::codes::Written::Png,
            None,
        );
        let reference = check_reference(&original);
        let payload = crate::imaging::verify::sha256_hex(HELLO_WORLD.as_bytes());
        let path = scratch.holding("copy.png", &forged(&a_code(), &reference, &payload));

        let check = check_file_at(&db, &path).expect("check");

        assert!(check.in_workspace);
        assert!(!check.matches_record, "a different file under this stamp");
    }

    /// The reference a stamped file carries, as written.
    fn check_reference(path: &str) -> String {
        let bytes = std::fs::read(path).expect("written");
        stamp::read_stamp(&bytes, Kind::Png)
            .expect("read")
            .expect("stamp")
            .stamp
            .reference
    }

    #[test]
    fn a_file_with_no_stamp_says_so() {
        let db = workspace();
        let scratch = Scratch::new();

        for (name, bytes, kind) in [
            ("plain.png", a_code(), "png"),
            ("plain.svg", hello_world_svg().into_bytes(), "svg"),
            ("plain.pdf", b"%PDF-1.7\n%%EOF\n".to_vec(), "pdf"),
        ] {
            let path = scratch.holding(name, &bytes);
            let check = check_file_at(&db, &path).expect("check");
            assert_eq!(
                check,
                StampCheck::unstamped(kind_of(Path::new(&path)).expect("kind"))
            );
            assert_eq!(check.kind, kind);
        }
    }

    /// An SVG or a PDF is never drawn and never parsed: a file that would make
    /// a renderer reach outside itself, or that is not a document at all, is
    /// searched for the marker and nothing else.
    #[test]
    fn an_svg_or_pdf_is_searched_and_never_rendered() {
        let db = workspace();
        let scratch = Scratch::new();
        for (name, bytes) in [
            (
                "hostile.svg",
                br#"<svg xmlns="http://www.w3.org/2000/svg"><image href="http://example.com/x.png"/><script>alert(1)</script></svg>"#.to_vec(),
            ),
            ("not-a-document.svg", vec![0xFF, 0x00, 0xFE, 0x01]),
            ("not-a-document.pdf", b"certainly not a PDF".to_vec()),
            ("empty.pdf", Vec::new()),
        ] {
            let path = scratch.holding(name, &bytes);
            let check = check_file_at(&db, &path).expect(name);
            assert!(!check.stamped, "{name}");
        }
    }

    #[test]
    fn a_file_with_two_stamps_is_refused() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = exported(
            &db,
            &scratch,
            "menu.svg",
            crate::commands::codes::Written::Svg,
            None,
        );
        let text = std::fs::read_to_string(&path).expect("written");
        let start = text.find("<!-- signatum:").expect("a stamp");
        let end = text[start..].find(" -->").expect("its end") + start + 4;
        let twice = text.replacen("</svg>", &format!("{}</svg>", &text[start..end]), 1);
        std::fs::write(&path, twice).expect("edit");

        let refused = check_file_at(&db, &path).expect_err("two stamps");
        assert_eq!(refused.to_string(), stamp::MORE_THAN_ONE);
    }

    #[test]
    fn a_png_by_name_that_is_not_a_png_is_refused() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("drawing.png", hello_world_svg().as_bytes());

        let refused = check_file_at(&db, &path).expect_err("not a PNG");
        assert_eq!(refused.to_string(), stamp::NOT_A_PNG);
    }

    #[test]
    fn a_file_larger_than_the_cap_is_refused_before_it_is_read() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding(
            "huge.pdf",
            &vec![0u8; MAX_CHECKED_BYTES as usize + 1].into_boxed_slice(),
        );

        let refused = check_file_at(&db, &path).expect_err("too large");

        assert_eq!(
            refused.to_string(),
            "This file is 20.0 MB; a stamp is checked on a file of at most 20.0 MB."
        );
    }

    #[test]
    fn the_check_refuses_a_path_or_a_kind_it_will_not_read() {
        let db = workspace();
        let scratch = Scratch::new();
        let picture = scratch.holding("photo.jpg", &a_code());
        let text = scratch.holding("notes.txt", b"signatum");
        let bare = scratch.holding("noextension", &a_code());

        for (path, sentence) in [
            ("menu.png", CHECKED.relative),
            ("", CHECKED.relative),
            ("\\\\server\\share\\menu.png", CHECKED.network),
            ("//server/share/menu.pdf", CHECKED.network),
            ("\\/server/share/menu.svg", CHECKED.network),
            ("\\\\?\\C:\\menu.png", CHECKED.network),
            (
                "C:\\codes\\COM3.png",
                "That is a name Windows reserves for a device, not a file.",
            ),
            (
                "C:\\codes\\nul.pdf",
                "That is a name Windows reserves for a device, not a file.",
            ),
            (
                "C:\\codes\\con .svg",
                "That is a name Windows reserves for a device, not a file.",
            ),
            (
                "C:\\codes\\LPT1..png",
                "That is a name Windows reserves for a device, not a file.",
            ),
            (picture.as_str(), NOT_CHECKABLE),
            (text.as_str(), NOT_CHECKABLE),
            (bare.as_str(), NOT_CHECKABLE),
        ] {
            let refused = check_file_at(&db, path).expect_err(path);
            assert!(
                matches!(refused, Error::InvalidInput(_)),
                "{path}: {refused:?}"
            );
            assert_eq!(refused.to_string(), sentence, "{path}");
        }
    }

    #[test]
    fn a_check_never_echoes_the_path() {
        let db = workspace();
        let scratch = Scratch::new();
        let secret = "a-folder-nobody-should-read-about";
        let there = scratch.0.join(secret);
        std::fs::create_dir_all(&there).expect("a directory");
        let not_a_png = there.join("notes.png");
        std::fs::write(&not_a_png, b"not a picture").expect("seed");

        for path in [
            there.join("gone.png").to_string_lossy().into_owned(),
            not_a_png.to_string_lossy().into_owned(),
            there.join("photo.jpg").to_string_lossy().into_owned(),
        ] {
            let said = check_file_at(&db, &path).expect_err("refused").to_string();
            assert!(!said.contains(secret), "{said}");
            assert!(!said.contains("notes"), "{said}");
        }
    }

    /// What the interface receives: eleven keys, in snake case, and nothing
    /// else.
    #[test]
    fn a_check_reaches_the_interface_as_eleven_keys() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = exported(
            &db,
            &scratch,
            "menu.png",
            crate::commands::codes::Written::Png,
            None,
        );

        let json =
            serde_json::to_value(check_file_at(&db, &path).expect("check")).expect("serialise");

        let keys: Vec<&str> = json
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        let mut expected = vec![
            "stamped",
            "intact",
            "kind",
            "decoder",
            "in_workspace",
            "matches_record",
            "verified_at",
            "format",
            "dpi",
            "code_id",
            "code_name",
        ];
        expected.sort_unstable();
        let mut keys = keys;
        keys.sort_unstable();
        assert_eq!(keys, expected);
        assert_eq!(json["kind"], "png");
        assert_eq!(json["code_name"], serde_json::Value::Null);
    }

    /// Read's own door reports the stamp of a PNG it opened — and nothing for
    /// one that has none.
    #[test]
    fn reading_a_stamped_png_reports_its_stamp() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = exported(
            &db,
            &scratch,
            "menu.png",
            crate::commands::codes::Written::Png,
            None,
        );

        let reading = read_image_at(&db, &path).expect("read");

        assert_eq!(
            reading.codes[0].text, HELLO_WORLD,
            "the codes are read as ever"
        );
        let stamp = reading.stamp.expect("the stamp is reported");
        assert!(stamp.stamped && stamp.intact && stamp.in_workspace && stamp.matches_record);
        assert_eq!(
            stamp,
            check_file_at(&db, &path).expect("check"),
            "the same answer"
        );

        let plain = scratch.holding("plain.png", &a_code());
        assert_eq!(read_image_at(&db, &plain).expect("read").stamp, None);
    }
}
