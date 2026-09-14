//! A logo somebody was sent, turned into something this product will draw.
//!
//! Nothing that arrives here is passed through (ADR-016). A raster is decoded
//! under limits, capped, and re-encoded as **our** PNG; an SVG is parsed into a
//! normalised tree and re-serialised from it. The bytes that came in are never
//! stored, never exported and never drawn — so a file with a script in it has
//! nowhere to go after the first second of its life in this process.
//!
//! The order of the checks is the whole design, and it is header-first on
//! purpose:
//!
//! 1. the file's size, before it is read;
//! 2. the format from the **magic bytes**, never from the extension;
//! 3. for an SVG, the pre-parse refusals and the node count — a text scan that
//!    runs before a parser is handed anything;
//! 4. for a raster, the dimensions out of the header and the caps on them
//!    **before a pixel is decoded**, which is what makes a decompression bomb a
//!    sentence at kilobytes rather than an out-of-memory kill at gigapixels.
//!
//! Every refusal is one sentence written for a person, and every refusal is
//! `Error::InvalidInput`: a file somebody was sent is not a defect of ours.
//!
//! Pure by construction — no Tauri types, no database, no filesystem. What
//! reads the file and what stores the result live in `commands::logos` and
//! `db::logos`.

use std::io::Cursor;

use image::{DynamicImage, ImageFormat, ImageReader, Limits, RgbaImage};
use resvg::usvg;

use crate::error::{Error, Result};
use crate::imaging::render::{scan_external_references, Reaching, MAX_SVG_BYTES};

/// The largest file this product will read as a logo. A brand mark that does
/// not fit in twenty megabytes is not a brand mark; it is a photograph.
pub const MAX_LOGO_BYTES: usize = 20 * 1024 * 1024;

/// The largest side, in pixels, a logo's header may claim. Checked before a
/// pixel is decoded.
pub const MAX_LOGO_SIDE: u32 = 8192;

/// The most pixels a logo may hold. A file can stay under the side cap on both
/// axes and still ask for a quarter of a gigabyte of memory.
pub const MAX_LOGO_PIXELS: u64 = 25_000_000;

/// The longest side a stored raster logo keeps. A code is printed at a few
/// centimetres; a thousand pixels across the middle of it is already more
/// resolution than any press will use.
pub const LOGO_STORE_SIDE: u32 = 1024;

/// The most elements a logo's SVG may contain, counted before it is parsed.
pub const MAX_SVG_NODES: usize = 20_000;

/// The most memory a decoder may allocate for one picture — a logo here, and
/// a photograph in `commands::read`. One ceiling, one place.
pub(crate) const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;

/// How a logo is stored, and therefore how it is drawn: as pixels, or as a
/// tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogoKind {
    /// Decoded, capped and re-encoded as a PNG.
    Raster,
    /// Parsed into a normalised tree and re-serialised from it.
    Vector,
}

impl LogoKind {
    /// The token the database stores, and the one the interface reads.
    pub fn as_str(self) -> &'static str {
        match self {
            LogoKind::Raster => "raster",
            LogoKind::Vector => "vector",
        }
    }

    /// The kind a stored token names.
    pub fn from_token(token: &str) -> Option<Self> {
        match token {
            "raster" => Some(LogoKind::Raster),
            "vector" => Some(LogoKind::Vector),
            _ => None,
        }
    }
}

/// What normalisation produced: the bytes that will be stored, drawn and
/// exported, and the facts a person is shown about them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalisedLogo {
    /// Pixels or a tree.
    pub kind: LogoKind,
    /// What the **bytes** were: `png`, `jpeg`, `gif`, `webp` or `svg`. Not what
    /// the extension said.
    pub format: &'static str,
    /// The normalised bytes. Our PNG, or usvg's SVG — never the input.
    pub bytes: Vec<u8>,
    /// Pixels for a raster; the `viewBox`'s width, rounded up, for an SVG.
    pub width: u32,
    /// The same, vertically.
    pub height: u32,
    /// What normalisation changed, in one sentence; `None` when nothing was.
    pub note: Option<String>,
}

/// Normalise a logo from its bytes alone.
///
/// The file's name is not needed to read it — the format comes from the magic
/// bytes — so this is the signature the pure path keeps. Use
/// [`normalise_named`] when the name is known: it is worth a note when the two
/// disagree.
///
/// # Errors
///
/// [`Error::InvalidInput`], with one sentence, for every file this product will
/// not take.
pub fn normalise(bytes: &[u8]) -> Result<NormalisedLogo> {
    normalise_named(bytes, "")
}

/// Normalise a logo, and say so when its name does not match its bytes.
///
/// `file_name` is used for nothing but that note: the format is always read
/// from the bytes (ADR-016), so a PNG named `.svg` is a PNG, imported, and said
/// to be one.
///
/// # Errors
///
/// [`Error::InvalidInput`], with one sentence, for every file this product will
/// not take.
pub fn normalise_named(bytes: &[u8], file_name: &str) -> Result<NormalisedLogo> {
    if bytes.is_empty() {
        return Err(Error::InvalidInput("This file is empty.".to_string()));
    }
    if bytes.len() > MAX_LOGO_BYTES {
        return Err(Error::InvalidInput(format!(
            "This file is {}; a logo can be at most {}.",
            megabytes(bytes.len()),
            megabytes(MAX_LOGO_BYTES)
        )));
    }

    if looks_like_svg(bytes) {
        normalise_svg(bytes, file_name)
    } else {
        normalise_raster(bytes, file_name)
    }
}

/// The bytes without a byte-order mark, which is not part of the document.
fn without_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)
}

/// True when the bytes open as an SVG document: an optional byte-order mark,
/// optional whitespace, then a declaration, a doctype or the root element.
///
/// `image` does not read SVG, so this is the fork in the road. It is a shape
/// test, not an extension test — a `.svg` holding a PNG takes the other branch.
/// A doctype counts as an opening because that is how the entity attack is
/// written, and a document that opens with one has to reach the refusals rather
/// than fall through to a decoder that will only say it is not an image.
pub(crate) fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = without_bom(bytes);
    let head: &[u8] = &head[..head.len().min(4096)];
    let start = head
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(head.len());
    let head = &head[start..];

    head.starts_with(b"<?xml")
        || head.starts_with(b"<svg")
        || head[..head.len().min(9)].eq_ignore_ascii_case(b"<!doctype")
}

/// Parse an SVG into a normalised tree and serialise that tree back out.
fn normalise_svg(bytes: &[u8], file_name: &str) -> Result<NormalisedLogo> {
    // Before the parser. Both of these are linear text scans, and both run on
    // the bytes as they arrived — a hostile document is refused without any
    // parser having been given it.
    scan_external_references(bytes).map_err(|finding| {
        Error::InvalidInput(
            match finding {
                Reaching::NotAnSvg => {
                    "This file is not an image Signatum can read (PNG, JPEG, GIF, WebP or SVG)."
                }
                Reaching::Script => "This SVG contains a script, which a logo must not.",
                Reaching::Outside => {
                    "This SVG refers to something outside itself, which a logo must not."
                }
            }
            .to_string(),
        )
    })?;

    // The node count is checked before the size cap on purpose: a document that
    // is too large *because* it has a million elements should be told what is
    // actually wrong with it, and both checks are a single pass over text.
    if count_nodes(bytes) > MAX_SVG_NODES {
        return Err(Error::InvalidInput(
            "This SVG has too many elements.".to_string(),
        ));
    }
    if bytes.len() > MAX_SVG_BYTES {
        return Err(Error::InvalidInput(format!(
            "This SVG is {}; a logo's SVG can be at most {}.",
            megabytes(bytes.len()),
            megabytes(MAX_SVG_BYTES)
        )));
    }

    // `resources_dir: None` is the line that keeps the parser off the disk. It
    // is written out rather than left to the defaults because a default is a
    // thing that changes between versions.
    let options = usvg::Options {
        resources_dir: None,
        ..usvg::Options::default()
    };
    // The mark is not part of the document: an XML parser handed one reports a
    // damaged file, which is a sentence about the wrong thing.
    let tree = usvg::Tree::from_data(without_bom(bytes), &options).map_err(|error| {
        log::debug!("a logo's SVG did not parse: {error}");
        Error::InvalidInput("This file could not be read as an SVG; it may be damaged.".to_string())
    })?;

    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return Err(Error::InvalidInput("This SVG has no size.".to_string()));
    }

    // Re-serialised from the tree, never the bytes that came in (ADR-016).
    let serialised = tree.to_string(&usvg::WriteOptions::default());

    // The caps above bound what came *in*. They do not bound what comes out: a
    // kilobyte of nested `<use>` is a few dozen elements on the way in and tens
    // of megabytes once every reference has been resolved into real nodes. The
    // stored bytes are the ones that get drawn on every render and written into
    // every export, so they are the ones that have to be small enough to mean
    // it — the file that produced them is already gone by now.
    if serialised.len() > MAX_SVG_BYTES {
        log::warn!(
            "a logo's SVG serialised to {} bytes from {} on the way in",
            serialised.len(),
            bytes.len()
        );
        return Err(Error::InvalidInput(
            "This SVG is too complex to store.".to_string(),
        ));
    }

    Ok(NormalisedLogo {
        kind: LogoKind::Vector,
        format: "svg",
        bytes: serialised.into_bytes(),
        width: size.width().ceil() as u32,
        height: size.height().ceil() as u32,
        note: mislabel_note(file_name, "svg"),
    })
}

/// Count the elements in an SVG without parsing it.
///
/// Comments are stripped first, because a comment may hold anything at all and
/// counting what is inside one would refuse a document for text nobody reads.
/// Everything else is counted the crude way — one `<` is one node — which
/// over-counts closing tags and therefore errs towards refusing.
fn count_nodes(bytes: &[u8]) -> usize {
    let text = String::from_utf8_lossy(bytes);
    let mut count = 0usize;
    let mut rest: &str = &text;

    while let Some(open) = rest.find('<') {
        rest = &rest[open..];
        if let Some(after) = rest.strip_prefix("<!--") {
            rest = after.find("-->").map_or("", |end| &after[end + 3..]);
            continue;
        }
        count += 1;
        if count > MAX_SVG_NODES {
            // No reason to walk the rest of a document that is already refused.
            return count;
        }
        rest = &rest[1..];
    }
    count
}

/// Decode a raster under limits, cap it, and re-encode it as our own PNG.
fn normalise_raster(bytes: &[u8], file_name: &str) -> Result<NormalisedLogo> {
    let format = guessed_format(bytes)?;
    let token = format_token(format);

    // The header, and nothing else. No pixel has been touched yet. The caps on
    // the size are deliberately *not* given to this reader: a decoder that
    // refuses the file for us would refuse it with its own words, and the point
    // of reading the header first is to be able to say what the file claimed.
    // The allocation ceiling still applies, because reading a header is not a
    // reason to let a decoder ask for a gigabyte.
    let mut header = reader(bytes, format);
    let mut header_limits = Limits::default();
    header_limits.max_alloc = Some(MAX_DECODE_ALLOC);
    header.limits(header_limits);

    let (width, height) = header
        .into_dimensions()
        .map_err(|error| unreadable(format, &error))?;

    if width == 0
        || height == 0
        || width > MAX_LOGO_SIDE
        || height > MAX_LOGO_SIDE
        || u64::from(width) * u64::from(height) > MAX_LOGO_PIXELS
    {
        return Err(Error::InvalidInput(format!(
            "This image is {width}×{height} pixels; \
             a logo can be at most {MAX_LOGO_SIDE} pixels a side."
        )));
    }

    // `zune-jpeg` will decode what it was given and call a half-file a picture,
    // which is the one case where a decoder's silence is worse than its error:
    // half a logo is a logo somebody prints. A JPEG's scan ends with its
    // end-of-image marker, and inside the scan every `FF` is stuffed or is a
    // marker — so a missing `FF D9` after the start of the scan is not a
    // judgement call, it is a file that stops in the middle.
    if format == ImageFormat::Jpeg && !ends_properly(bytes) {
        return Err(Error::InvalidInput(format!(
            "This file could not be read as a {}; it may be truncated.",
            spelled("jpeg")
        )));
    }

    // A header can lie. The limits are what stops a lie from being expensive:
    // the decoder is refused the allocation rather than trusted with it.
    let mut reader = reader(bytes, format);
    // `Limits` is non-exhaustive on purpose: a future version of `image` may add
    // a limit, and the default for a new one should arrive with it rather than
    // be silently omitted by a struct literal written today.
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_LOGO_SIDE);
    limits.max_image_height = Some(MAX_LOGO_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    // For a GIF this reads the first frame and stops. The frames are never
    // iterated, so ten thousand of them cost what one does.
    let decoded = reader
        .decode()
        .map_err(|error| unreadable(format, &error))?;

    let mut notes = Vec::new();
    if format == ImageFormat::Gif {
        notes.push("Animated GIF: the first frame is used.".to_string());
    }
    if let Some(note) = mislabel_note(file_name, token) {
        notes.push(note);
    }

    let mut image = decoded.into_rgba8();
    if image.pixels().all(|pixel| pixel.0[3] == 0) {
        return Err(Error::InvalidInput(
            "This image is fully transparent.".to_string(),
        ));
    }

    if image.width() > LOGO_STORE_SIDE || image.height() > LOGO_STORE_SIDE {
        let (was_width, was_height) = (image.width(), image.height());
        image = DynamicImage::ImageRgba8(image)
            .resize(
                LOGO_STORE_SIDE,
                LOGO_STORE_SIDE,
                image::imageops::FilterType::Lanczos3,
            )
            .into_rgba8();
        notes.push(format!(
            "The image was {was_width}×{was_height}; it is stored at {}×{}.",
            image.width(),
            image.height()
        ));
    }

    let (width, height) = (image.width(), image.height());
    let png = encode_png(image)?;

    Ok(NormalisedLogo {
        kind: LogoKind::Raster,
        format: token,
        bytes: png,
        width,
        height,
        note: (!notes.is_empty()).then(|| notes.join(" ")),
    })
}

/// True when a JPEG's scan is finished: an end-of-image marker after the
/// start-of-scan marker.
fn ends_properly(jpeg: &[u8]) -> bool {
    let start_of_scan = jpeg.windows(2).position(|pair| pair == [0xFF, 0xDA]);
    let Some(start_of_scan) = start_of_scan else {
        // No scan at all: there is nothing to have been cut short, and the
        // decoder will say what is wrong with it.
        return true;
    };
    jpeg[start_of_scan..]
        .windows(2)
        .any(|pair| pair == [0xFF, 0xD9])
}

/// A reader over the bytes, told which format they are.
///
/// Built twice per import — once for the header, once for the pixels — because
/// reading the dimensions consumes the reader. Both readers are a cursor over
/// the same slice, so the second one costs nothing.
fn reader(bytes: &[u8], format: ImageFormat) -> ImageReader<Cursor<&[u8]>> {
    ImageReader::with_format(Cursor::new(bytes), format)
}

/// The format the magic bytes say, refused unless it is one of the four a logo
/// may arrive as.
fn guessed_format(bytes: &[u8]) -> Result<ImageFormat> {
    let unknown = || {
        Error::InvalidInput(
            "This file is not an image Signatum can read (PNG, JPEG, GIF, WebP or SVG)."
                .to_string(),
        )
    };

    let format = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| unknown())?
        .format()
        .ok_or_else(unknown)?;

    // `with_guessed_format` knows more formats than this product compiles in.
    // Naming the four here means an unsupported format is a sentence about what
    // a logo may be, rather than a decoder error about a feature flag.
    match format {
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP => Ok(format),
        _ => Err(unknown()),
    }
}

/// The token stored for a format: what the bytes were.
fn format_token(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        // Only the four of `guessed_format` reach here; PNG is the safe last
        // arm because it is what this product stores anyway.
        _ => "png",
    }
}

/// How a format is written in a sentence.
fn spelled(token: &str) -> &'static str {
    match token {
        "jpeg" => "JPEG",
        "gif" => "GIF",
        "webp" => "WebP",
        "svg" => "SVG",
        _ => "PNG",
    }
}

/// The one sentence a decoder's failure becomes.
fn unreadable(format: ImageFormat, error: &image::ImageError) -> Error {
    log::debug!("a logo did not decode: {error}");
    Error::InvalidInput(format!(
        "This file could not be read as a {}; it may be truncated.",
        spelled(format_token(format))
    ))
}

/// A note when the name and the bytes disagree, and nothing when they do not.
///
/// The extension is never used to decide anything — it is used to say what was
/// decided, because a person who opened `logo.svg` and got a PNG should be told
/// why the file behaves like one.
fn mislabel_note(file_name: &str, token: &str) -> Option<String> {
    let extension = file_name.rsplit_once('.')?.1.to_ascii_lowercase();
    if extension.is_empty() {
        return None;
    }

    let matches = match token {
        "jpeg" => extension == "jpeg" || extension == "jpg",
        other => extension == other,
    };
    if matches {
        return None;
    }

    let spelling = spelled(token);
    Some(format!(
        "The file is named .{extension} but it is a {spelling}; it was read as a {spelling}."
    ))
}

/// Encode the capped image as the PNG that will be stored.
fn encode_png(image: RgbaImage) -> Result<Vec<u8>> {
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| {
            log::error!("a normalised logo could not be encoded: {error}");
            Error::InvalidInput("This image could not be stored.".to_string())
        })?;
    Ok(png)
}

/// A byte count as a person reads it, to one decimal.
fn megabytes(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use image::{codecs::gif::GifEncoder, ExtendedColorType, ImageEncoder, Rgba};

    use super::*;

    /// A tiny opaque square, the thing a real logo is a prettier version of.
    fn square(side: u32) -> RgbaImage {
        RgbaImage::from_fn(side, side, |x, y| {
            if (x + y) % 2 == 0 {
                Rgba([220, 40, 40, 255])
            } else {
                Rgba([255, 255, 255, 255])
            }
        })
    }

    fn png_bytes(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                ExtendedColorType::Rgba8,
            )
            .expect("encode a PNG");
        bytes
    }

    fn jpeg_bytes(image: &RgbaImage) -> Vec<u8> {
        let rgb = DynamicImage::ImageRgba8(image.clone()).into_rgb8();
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut bytes)
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
            .expect("encode a JPEG");
        bytes
    }

    fn gif_bytes(frames: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut bytes);
            for _ in 0..frames {
                let frame = RgbaImage::from_pixel(1, 1, Rgba([220, 40, 40, 255]));
                encoder
                    .encode_frame(image::Frame::new(frame))
                    .expect("encode a GIF frame");
            }
        }
        bytes
    }

    fn webp_bytes(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
            .encode(
                image.as_raw(),
                image.width(),
                image.height(),
                ExtendedColorType::Rgba8,
            )
            .expect("encode a WebP");
        bytes
    }

    /// A PNG whose header claims a size no machine will allocate. Written by
    /// hand, because no encoder will produce a lie: a real IHDR with an absurd
    /// size, then just enough of an image for a decoder to reach the header
    /// honestly and hand back what it says.
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
        // A pixel's worth of deflate stream. Nothing decompresses it: the size
        // is refused from the header, which is the whole point.
        png.extend_from_slice(&chunk(b"IDAT", &[0x78, 0x01, 0x01, 0x00, 0x00, 0xFF, 0xFF]));
        png.extend_from_slice(&chunk(b"IEND", &[]));
        png
    }

    fn refusal(bytes: &[u8], name: &str) -> String {
        match normalise_named(bytes, name) {
            Err(Error::InvalidInput(sentence)) => sentence,
            Err(other) => panic!("the refusal must be invalid_input, not {other:?}"),
            Ok(logo) => panic!("this was accepted as a {} logo", logo.format),
        }
    }

    // ── The hostile corpus (SPEC §6). Each one a sentence, none a panic. ──

    #[test]
    fn an_svg_with_a_script_is_refused() {
        let hostile = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
             <script>fetch('http://elsewhere')</script><rect width="8" height="8"/></svg>"##;

        assert_eq!(
            refusal(hostile, "logo.svg"),
            "This SVG contains a script, which a logo must not."
        );
    }

    #[test]
    fn an_svg_with_an_event_handler_is_refused() {
        let hostile = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"
             onload="fetch('http://elsewhere')"><rect width="8" height="8"/></svg>"##;

        assert_eq!(
            refusal(hostile, "logo.svg"),
            "This SVG contains a script, which a logo must not."
        );
    }

    #[test]
    fn an_svg_with_an_entity_is_refused() {
        let hostile = br##"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]>
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">&x;</svg>"##;

        assert_eq!(
            refusal(hostile, "logo.svg"),
            "This SVG refers to something outside itself, which a logo must not."
        );
    }

    #[test]
    fn an_svg_with_an_external_reference_is_refused() {
        for hostile in [
            br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <use href="https://elsewhere/thing.svg#a"/></svg>"##
                .as_slice(),
            br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="file:///c:/windows/win.ini" width="8" height="8"/></svg>"##
                .as_slice(),
            br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <style>@import url("https://elsewhere/x.css");</style></svg>"##
                .as_slice(),
        ] {
            assert_eq!(
                refusal(hostile, "logo.svg"),
                "This SVG refers to something outside itself, which a logo must not."
            );
        }
    }

    #[test]
    fn an_svg_with_foreign_content_is_refused() {
        let hostile = br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
             <foreignObject width="8" height="8"><body/></foreignObject></svg>"##;

        assert_eq!(
            refusal(hostile, "logo.svg"),
            "This SVG refers to something outside itself, which a logo must not."
        );
    }

    /// A million elements is refused by counting, before a parser is handed the
    /// document — which is why it is refused in milliseconds rather than in
    /// however long usvg would have taken to build a million nodes.
    #[test]
    fn an_svg_with_a_million_nodes_is_refused_before_it_is_parsed() {
        let mut hostile =
            String::from(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">"##);
        hostile.push_str(&"<g/>".repeat(1_000_000));
        hostile.push_str("</svg>");

        let started = Instant::now();
        let sentence = refusal(hostile.as_bytes(), "logo.svg");
        let took = started.elapsed();

        assert_eq!(sentence, "This SVG has too many elements.");
        assert!(took < Duration::from_secs(1), "it took {took:?}");
    }

    /// A kilobyte in, tens of megabytes out. Every reference points at this
    /// document, every cap on the way in is respected, and the bomb is entirely
    /// in what the parser *produces*: each group uses the one below it twice, so
    /// sixteen levels are sixty-five thousand rectangles once resolved.
    #[test]
    fn an_svg_that_expands_when_it_is_resolved_is_refused_by_what_it_becomes() {
        const LEVELS: usize = 16;

        let mut document = String::from(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>
             <g id="g0"><rect width="4" height="4" fill="#d02828"/></g>"##,
        );
        for level in 1..=LEVELS {
            document.push_str(&format!(
                r##"<g id="g{level}"><use href="#g{}"/><use href="#g{}" x="4"/></g>"##,
                level - 1,
                level - 1
            ));
        }
        document.push_str(&format!(r##"</defs><use href="#g{LEVELS}"/></svg>"##));

        // It passes every cap this host puts on the way in …
        assert!(document.len() < MAX_SVG_BYTES, "{} bytes", document.len());
        assert!(count_nodes(document.as_bytes()) < MAX_SVG_NODES);

        // … and is still refused, for what it turns into.
        assert_eq!(
            refusal(document.as_bytes(), "bomb.svg"),
            "This SVG is too complex to store."
        );
    }

    #[test]
    fn a_png_that_claims_gigapixels_is_refused_from_its_header() {
        let sentence = refusal(&png_claiming(100_000, 100_000), "bomb.png");

        assert_eq!(
            sentence,
            "This image is 100000×100000 pixels; a logo can be at most 8192 pixels a side."
        );
    }

    #[test]
    fn a_truncated_jpeg_is_a_sentence_not_a_panic() {
        let whole = jpeg_bytes(&square(64));
        let half = &whole[..whole.len() / 2];

        assert_eq!(
            refusal(half, "logo.jpg"),
            "This file could not be read as a JPEG; it may be truncated."
        );
    }

    /// Ten thousand frames cost what one frame costs, because the frames are
    /// never iterated: the decoder reads the first and stops.
    #[test]
    fn a_gif_of_ten_thousand_frames_reads_only_the_first() {
        let hostile = gif_bytes(10_000);

        let started = Instant::now();
        let logo = normalise_named(&hostile, "many.gif").expect("the first frame is readable");
        let took = started.elapsed();

        assert_eq!((logo.width, logo.height), (1, 1));
        assert_eq!(logo.format, "gif");
        assert_eq!(
            logo.note.as_deref(),
            Some("Animated GIF: the first frame is used.")
        );
        assert!(took < Duration::from_secs(1), "it took {took:?}");
    }

    #[test]
    fn an_empty_file_is_refused() {
        assert_eq!(refusal(b"", "logo.png"), "This file is empty.");
    }

    #[test]
    fn a_png_named_svg_is_a_png_and_says_so() {
        let logo = normalise_named(&png_bytes(&square(32)), "brand.svg").expect("a PNG is a PNG");

        assert_eq!(logo.format, "png");
        assert_eq!(logo.kind, LogoKind::Raster);
        assert_eq!(
            logo.note.as_deref(),
            Some("The file is named .svg but it is a PNG; it was read as a PNG.")
        );
    }

    #[test]
    fn a_fully_transparent_image_is_refused() {
        let invisible = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 0]));

        assert_eq!(
            refusal(&png_bytes(&invisible), "ghost.png"),
            "This image is fully transparent."
        );
    }

    #[test]
    fn something_that_is_not_an_image_at_all_is_refused() {
        assert_eq!(
            refusal(b"this is a spreadsheet, honestly", "logo.png"),
            "This file is not an image Signatum can read (PNG, JPEG, GIF, WebP or SVG)."
        );
    }

    #[test]
    fn a_file_larger_than_the_cap_is_refused_before_it_is_decoded() {
        let sentence = refusal(&vec![b'x'; MAX_LOGO_BYTES + 1], "huge.png");

        assert!(sentence.starts_with("This file is "), "{sentence}");
        assert!(
            sentence.ends_with("a logo can be at most 20.0 MB."),
            "{sentence}"
        );
    }

    // ── The positive path, once per format ────────────────────────────────

    #[test]
    fn a_png_is_stored_as_our_own_png() {
        let logo = normalise_named(&png_bytes(&square(48)), "brand.png").expect("import");

        assert_eq!(logo.kind, LogoKind::Raster);
        assert_eq!(logo.format, "png");
        assert_eq!((logo.width, logo.height), (48, 48));
        assert_eq!(logo.note, None);
        assert_eq!(
            &logo.bytes[..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
            "what is stored is a PNG"
        );
    }

    #[test]
    fn a_jpeg_is_stored_as_a_png() {
        let logo = normalise_named(&jpeg_bytes(&square(48)), "brand.jpg").expect("import");

        assert_eq!(logo.format, "jpeg");
        assert_eq!((logo.width, logo.height), (48, 48));
        assert_eq!(
            &logo.bytes[1..4],
            b"PNG",
            "the stored bytes are never the input"
        );
    }

    #[test]
    fn a_gif_is_stored_as_a_png() {
        let logo = normalise_named(&gif_bytes(1), "brand.gif").expect("import");

        assert_eq!(logo.format, "gif");
        assert_eq!(&logo.bytes[1..4], b"PNG");
    }

    #[test]
    fn a_webp_is_stored_as_a_png() {
        let logo = normalise_named(&webp_bytes(&square(48)), "brand.webp").expect("import");

        assert_eq!(logo.format, "webp");
        assert_eq!((logo.width, logo.height), (48, 48));
        assert_eq!(&logo.bytes[1..4], b"PNG");
    }

    #[test]
    fn an_oversized_raster_is_stored_at_the_cap() {
        let logo = normalise_named(&png_bytes(&square(2048)), "big.png").expect("import");

        assert_eq!(
            (logo.width, logo.height),
            (LOGO_STORE_SIDE, LOGO_STORE_SIDE)
        );
        assert_eq!(
            logo.note.as_deref(),
            Some("The image was 2048×2048; it is stored at 1024×1024.")
        );
    }

    #[test]
    fn an_svg_is_stored_as_the_tree_it_parsed_into() {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
             <defs><rect id="m" width="8" height="8" fill="#d02828"/></defs>
             <use href="#m" x="4" y="4"/>
             <circle cx="32" cy="32" r="16" fill="#102030"/></svg>"##;

        let logo = normalise_named(document.as_bytes(), "brand.svg").expect("import");
        let stored = String::from_utf8(logo.bytes.clone()).expect("usvg writes UTF-8");

        assert_eq!(logo.kind, LogoKind::Vector);
        assert_eq!(logo.format, "svg");
        assert_eq!((logo.width, logo.height), (64, 64));
        assert_ne!(
            logo.bytes,
            document.as_bytes(),
            "the input is not passed through"
        );

        let lowered = stored.to_lowercase();
        assert!(!lowered.contains("<script"), "{stored}");
        assert!(!lowered.contains("<foreignobject"), "{stored}");
        assert!(!lowered.contains("<!doctype"), "{stored}");
        for (index, _) in lowered.match_indices("href") {
            let value = lowered[index..]
                .split_once('=')
                .map(|(_, rest)| rest.trim_start().trim_start_matches(['"', '\'']))
                .unwrap_or_default();
            assert!(
                value.starts_with('#'),
                "an href leaves the document: {stored}"
            );
        }
        for (index, _) in lowered.match_indices(" on") {
            let after = &lowered[index + 3..];
            let name = after
                .find(|c: char| !c.is_ascii_alphabetic())
                .unwrap_or(after.len());
            assert!(
                name == 0 || !after[name..].trim_start().starts_with('='),
                "an event handler survived: {stored}"
            );
        }
        assert!(
            crate::imaging::render::scan_external_references(&logo.bytes).is_ok(),
            "what is stored would be refused on the way back in: {stored}"
        );
    }

    #[test]
    fn an_svg_with_no_size_is_refused() {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>"##;

        let sentence = refusal(document.as_bytes(), "flat.svg");

        // usvg refuses a sizeless document itself, and this host keeps its own
        // guard behind that one; either way it is a sentence, not a logo of no
        // size that F5 would later divide by.
        assert!(
            sentence == "This SVG has no size."
                || sentence == "This file could not be read as an SVG; it may be damaged.",
            "{sentence}"
        );
    }

    #[test]
    fn an_svg_behind_a_byte_order_mark_is_still_an_svg() {
        let mut document = vec![0xEF, 0xBB, 0xBF];
        document.extend_from_slice(
            br##"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"
                 viewBox="0 0 16 16"><rect width="16" height="16" fill="#123456"/></svg>"##,
        );

        let logo = normalise(&document).expect("import");

        assert_eq!(logo.kind, LogoKind::Vector);
        assert_eq!((logo.width, logo.height), (16, 16));
    }

    #[test]
    fn an_svg_behind_whitespace_is_still_an_svg() {
        let document = br##"

             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
             <rect width="16" height="16" fill="#123456"/></svg>"##;

        assert_eq!(normalise(document).expect("import").kind, LogoKind::Vector);
    }

    #[test]
    fn the_name_is_used_for_the_note_and_for_nothing_else() {
        let bytes = png_bytes(&square(8));

        assert_eq!(normalise(&bytes).expect("import").note, None);
        assert_eq!(
            normalise_named(&bytes, "no-extension")
                .expect("import")
                .note,
            None
        );
        assert_eq!(
            normalise_named(&bytes, "brand.PNG").expect("import").note,
            None
        );
        assert_eq!(
            normalise_named(&bytes, "brand.gif")
                .expect("import")
                .note
                .as_deref(),
            Some("The file is named .gif but it is a PNG; it was read as a PNG.")
        );
    }
}
