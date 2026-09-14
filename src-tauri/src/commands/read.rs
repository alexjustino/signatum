//! The two doors into Read: a picture somebody chose, and a picture somebody
//! copied.
//!
//! This is the third and last place in the product that reads a file a person
//! picked out of a dialog (`import_logo` is the first, `read_text_file` the
//! second), and the first that takes anything off the clipboard. The rules are
//! the ones the other doors keep, because the danger is the same one: an image
//! from outside is a decoder's input before it is a picture. An absolute local
//! path, capped by the directory entry before a byte is read, the format decided
//! by the magic bytes and never by the name, the dimensions read from the header
//! and refused before a pixel is decoded, and the path never echoed — not in the
//! answer, not in an error.
//!
//! What is different here, and it is the whole point of the screen: **nothing is
//! stored**. No row, no file, no thumbnail on disk. A code somebody reads is not
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
//! # Changelog of this boundary
//!
//! - F10: `read_image` and `read_clipboard`.

use std::io::{Cursor, Read as _};
use std::path::Path;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{DynamicImage, ImageFormat, ImageReader, Limits, RgbaImage};
use serde::Serialize;

use crate::commands::logos::RESERVED;
use crate::error::{Error, Result};
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
pub fn read_image(path: String) -> Result<Reading> {
    read_image_at(&path)
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
fn read_image_at(path: &str) -> Result<Reading> {
    let source = check_source(path)?;

    // The size comes from the directory entry, so a file far too large to be a
    // picture of a code is refused without being read at all.
    let facts = std::fs::metadata(source).map_err(|error| {
        log::error!("a picture could not be opened: {error}");
        Error::File("that file could not be opened")
    })?;
    if !facts.is_file() {
        return Err(Error::InvalidInput(
            "That is a folder, not a file.".to_string(),
        ));
    }
    if facts.len() > MAX_IMAGE_BYTES {
        return Err(Error::InvalidInput(format!(
            "This file is {}; Read opens a picture of at most {}.",
            megabytes(facts.len()),
            megabytes(MAX_IMAGE_BYTES)
        )));
    }

    // Read through a ceiling rather than trusting the entry: a file that grew between the
    // two calls, or a special file whose size reads as zero, is stopped at the cap.
    let mut bytes = Vec::with_capacity(facts.len() as usize);
    let file = std::fs::File::open(source).map_err(|error| {
        log::error!("a picture could not be opened for reading: {error}");
        Error::File("that file could not be read")
    })?;
    std::io::Read::take(file, MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            log::error!("a picture could not be read: {error}");
            Error::File("that file could not be read")
        })?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(Error::InvalidInput(format!(
            "This file is larger than {}, which is the most Read opens.",
            megabytes(MAX_IMAGE_BYTES)
        )));
    }

    let decoded = decode_picture(&bytes)?;
    log::info!(
        "reading a {}×{} picture from a file",
        decoded.width(),
        decoded.height()
    );
    reading_of(&decoded)
}

/// The path a person chose in the open dialog, checked before it is read.
///
/// Absolute, on this machine, and not a device Windows keeps a name for. The
/// extension decides nothing — the magic bytes do that — so it is not looked at
/// here.
fn check_source(path: &str) -> Result<&Path> {
    let source = Path::new(path);
    if !source.is_absolute() {
        return Err(Error::InvalidInput(
            "A picture is read from the full path of a file.".to_string(),
        ));
    }
    // A UNC path (`\\host\share\code.png`) or a verbatim one (`\\?\...`) is
    // absolute too, and reading there would make this host open a network
    // connection on the interface's word, in a product that promises nothing
    // leaves the machine.
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(Error::InvalidInput(
            "A picture is read from a local drive, not from a network path.".to_string(),
        ));
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

        let reading = read_image_at(&path).expect("read");

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

        let reading = read_image_at(&path).expect("read");

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

        let reading = read_image_at(&path).expect("read");

        assert!(reading.codes.is_empty());
        assert_eq!(reading.note.as_deref(), Some(NO_CODE));
    }

    #[test]
    fn an_svg_is_sent_to_the_door_that_takes_one() {
        let scratch = Scratch::new();
        // Named `.png`, because the name decides nothing: the bytes do.
        let path = scratch.holding("drawing.png", hello_world_svg().as_bytes());

        let refused = read_image_at(&path).expect_err("an SVG is not read");

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

            let refused = read_image_at(&path).expect_err("this is not a picture");

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

        let refused = read_image_at(&path).expect_err("too large");

        assert_eq!(
            refused.to_string(),
            "This file is 20.0 MB; Read opens a picture of at most 20.0 MB."
        );
    }

    #[test]
    fn a_picture_that_claims_gigapixels_is_refused_from_its_header() {
        let scratch = Scratch::new();
        let path = scratch.holding("bomb.png", &png_claiming(40_000, 40_000));

        let refused = read_image_at(&path).expect_err("a bomb is refused");

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
            let refused = read_image_at(&path).expect_err("refused");
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
            let refused = check_source(path).expect_err("this source must be refused");
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

        let reading = read_image_at(&path).expect("read");
        let json = serde_json::to_value(&reading).expect("serialise");

        for key in ["width", "height", "preview", "codes", "note", "decode_ms"] {
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
}
