//! The SVG this product drew, turned into the pixels a camera would see.
//!
//! Nothing here knows about windows, commands or the database: it takes bytes
//! and returns bytes, which is what makes the scan gate testable without an
//! application running (ADR-010).
//!
//! What is deliberately *not* rendered: text, system fonts and raster images
//! are compiled out of `resvg` (see `Cargo.toml`), and an SVG that reaches for
//! anything outside itself is refused before the parser sees it. A code is one
//! background rectangle and one path of dark modules (spec §3); anything else
//! arriving here is either a defect of ours or an input that should not be
//! trusted (ADR-016).

use resvg::tiny_skia;
use resvg::usvg;

use crate::error::{Error, Result};

/// The largest SVG this host will parse. A code's scene is a few kilobytes;
/// a megabyte is already a hundred times more than the product can produce.
pub const MAX_SVG_BYTES: usize = 1024 * 1024;

/// The smallest useful square, in pixels. Below this a code stops being a code.
pub const MIN_PIXEL_SIZE: u32 = 64;

/// The largest square this host will rasterise: 4096² pixels is 64 MiB in
/// memory, which is the point past which "bigger" stops being a size and starts
/// being a way to exhaust the machine.
pub const MAX_PIXEL_SIZE: u32 = 4096;

/// A rendered code: the PNG bytes, and the size they came out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    /// The encoded PNG. These are the bytes that get decoded, and the same
    /// bytes that get written — the artefact is never re-rendered.
    pub png: Vec<u8>,
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
}

/// Markers an SVG this product drew never contains, and which would make the
/// renderer reach outside the document: another image, a script, foreign
/// content, or an entity declaration (the classic way to make a parser read a
/// file for you).
const FORBIDDEN: [&str; 6] = [
    "<image",
    "<script",
    "<foreignobject",
    "<!entity",
    "<!doctype",
    "xlink:href",
];

/// Refuse anything that points outside the document before it is parsed.
fn refuse_external_references(svg: &[u8]) -> Result<()> {
    let text = String::from_utf8_lossy(svg).to_lowercase();

    if !text.contains("<svg") {
        return Err(Error::Render("that is not an SVG document".to_string()));
    }
    for marker in FORBIDDEN {
        if text.contains(marker) {
            return Err(Error::Render(format!(
                "the drawing contains `{}`, which points outside itself",
                marker.trim_start_matches('<')
            )));
        }
    }
    // A local reference (`href="#id"`) is fine; anything else is a fetch.
    for (index, _) in text.match_indices("href") {
        let rest = &text[index + "href".len()..];
        let value = rest.trim_start().strip_prefix('=').map(str::trim_start);
        let points_at_itself = value
            .and_then(|v| v.strip_prefix('"').or_else(|| v.strip_prefix('\'')))
            .is_some_and(|v| v.starts_with('#'));
        if !points_at_itself {
            return Err(Error::Render(
                "the drawing refers to something outside itself".to_string(),
            ));
        }
    }
    Ok(())
}

/// Render an SVG into a square PNG of `pixel_size` on each side.
///
/// The drawing is scaled from its own `viewBox` to fill the square, so the
/// caller asks for a size in pixels and never has to know the code's module
/// count.
///
/// # Errors
///
/// [`Error::Render`] when the document is not an SVG, points outside itself, is
/// larger than [`MAX_SVG_BYTES`], asks for a size outside
/// [`MIN_PIXEL_SIZE`]..=[`MAX_PIXEL_SIZE`], or cannot be parsed or encoded.
pub fn render_png(svg: &[u8], pixel_size: u32) -> Result<Rendered> {
    if svg.len() > MAX_SVG_BYTES {
        return Err(Error::Render(
            "the drawing is too large to render".to_string(),
        ));
    }
    if !(MIN_PIXEL_SIZE..=MAX_PIXEL_SIZE).contains(&pixel_size) {
        return Err(Error::Render(format!(
            "a code is rendered between {MIN_PIXEL_SIZE} and {MAX_PIXEL_SIZE} pixels square"
        )));
    }
    refuse_external_references(svg)?;

    // The defaults are governed by feature flags; the one that matters most is stated here so
    // that a flag switched on by mistake cannot silently give the parser the disk back.
    let options = usvg::Options {
        resources_dir: None,
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(svg, &options)
        .map_err(|error| Error::Render(format!("the drawing could not be read: {error}")))?;

    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return Err(Error::Render("the drawing has no size".to_string()));
    }

    let mut pixmap = tiny_skia::Pixmap::new(pixel_size, pixel_size)
        .ok_or_else(|| Error::Render("that size could not be allocated".to_string()))?;

    let transform = tiny_skia::Transform::from_scale(
        pixel_size as f32 / size.width(),
        pixel_size as f32 / size.height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let png = pixmap
        .encode_png()
        .map_err(|error| Error::Render(format!("the image could not be encoded: {error}")))?;

    Ok(Rendered {
        png,
        width: pixel_size,
        height: pixel_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLANK: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29">
         <rect width="29" height="29" fill="#ffffff"/></svg>"##;

    #[test]
    fn a_drawing_becomes_a_square_png_of_the_size_asked_for() {
        let rendered = render_png(BLANK.as_bytes(), 128).expect("render");

        assert_eq!((rendered.width, rendered.height), (128, 128));
        assert_eq!(
            &rendered.png[..8],
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            "the artefact is a PNG"
        );
    }

    #[test]
    fn a_size_outside_the_range_is_refused() {
        for size in [0, MIN_PIXEL_SIZE - 1, MAX_PIXEL_SIZE + 1] {
            assert!(render_png(BLANK.as_bytes(), size).is_err(), "{size} passed");
        }
    }

    #[test]
    fn a_drawing_that_reaches_outside_itself_is_refused_before_it_is_parsed() {
        let hostile = [
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="file:///c:/windows/win.ini" width="8" height="8"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <script>fetch('http://elsewhere')</script></svg>"##,
            r##"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text>&x;</text></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <use href="https://elsewhere/thing.svg#a"/></svg>"##,
        ];
        for document in hostile {
            let refused = render_png(document.as_bytes(), 64);
            assert!(refused.is_err(), "this was rendered: {document}");
        }
    }

    #[test]
    fn a_local_reference_is_still_allowed() {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
             <defs><rect id="m" width="1" height="1" fill="#000"/></defs>
             <rect width="8" height="8" fill="#fff"/><use href="#m" x="2" y="2"/></svg>"##;
        assert!(render_png(document.as_bytes(), 64).is_ok());
    }

    #[test]
    fn something_that_is_not_a_drawing_is_refused() {
        assert!(render_png(b"not an svg at all", 64).is_err());
        assert!(render_png(&vec![b'x'; MAX_SVG_BYTES + 1], 64).is_err());
    }
}
