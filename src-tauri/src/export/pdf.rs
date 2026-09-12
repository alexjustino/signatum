//! One page, one code, at the size it will be printed.
//!
//! A PDF is the only export that carries a physical size a print shop will obey
//! without being asked: the page is `width_mm` square in the document's own
//! units, and the image fills it edge to edge. There is no margin, no title and
//! no metadata beyond the producer — a page with a border is a page somebody has
//! to trim.
//!
//! What is embedded is the **verified raster**, not a second drawing of the code.
//! That keeps the promise the whole product rests on: the bytes that were read
//! back are the bytes that leave (ADR-010, ADR-026). The cost is that a PDF of a
//! code is a picture of a code rather than curves, which is the right trade at
//! the sizes a code is printed — 25 mm at 300 dpi is 295 pixels, and no press
//! resolves more of a square than that.
//!
//! Pure: bytes in, bytes out. Nothing here opens a file.

use std::io::Write;

use image::ImageFormat;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, TextStr};

use crate::error::{Error, Result};

/// Points per millimetre: a PDF point is a seventy-second of an inch.
pub const POINTS_PER_MM: f64 = 72.0 / 25.4;

/// The smallest page this host will write, in millimetres. The domain has its
/// own bounds on the printed size (`size.ts`); this is the one that makes a page
/// a page.
pub const MIN_WIDTH_MM: f64 = 1.0;

/// The largest page this host will write, in millimetres: two metres, which is
/// past any press and short of a number that stops being a page.
pub const MAX_WIDTH_MM: f64 = 2000.0;

/// The name the page's resource dictionary gives the one image on it.
const IMAGE_NAME: Name<'static> = Name(b"Code");

/// The page side in points for a page `width_mm` millimetres wide, rounded to
/// the hundredth of a point.
///
/// Rounded on purpose: two decimals is a fortieth of a millimetre, far below
/// what any press holds, and it makes the number in the file the number a person
/// can read back — 25 mm is `70.87`, not `70.86614`.
pub fn points(width_mm: f64) -> f64 {
    (width_mm * POINTS_PER_MM * 100.0).round() / 100.0
}

/// Refuse a width that is not a printable number of millimetres.
///
/// Public because an export checks it **before** it renders anything: a page
/// nobody can write is not worth a verification, and a row that records one is a
/// row about something that did not happen.
///
/// # Errors
///
/// [`Error::InvalidInput`], in one sentence.
pub fn check_width(width_mm: f64) -> Result<()> {
    if !width_mm.is_finite() || !(MIN_WIDTH_MM..=MAX_WIDTH_MM).contains(&width_mm) {
        return Err(Error::InvalidInput(format!(
            "a page is written between {MIN_WIDTH_MM} and {MAX_WIDTH_MM} millimetres wide"
        )));
    }
    Ok(())
}

/// Write a one-page PDF holding `png` at `width_mm` millimetres square.
///
/// The page size comes from `width_mm` and from nothing else. In particular it
/// is never read out of the drawing: the SVG this host verifies carries a
/// `viewBox` and no physical width, and a page that guessed its size from a
/// drawing would be a page that changed when the drawing did.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the width is not a printable number of
/// millimetres. [`Error::Render`] when the verified artefact cannot be read back
/// or its samples cannot be compressed — both are this host's own bytes.
pub fn one_page(png: &[u8], width_mm: f64) -> Result<Vec<u8>> {
    check_width(width_mm)?;

    let image = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| Error::Render(format!("the artefact could not be read back: {error}")))?
        .to_rgb8();
    let (width, height) = (image.width(), image.height());
    let samples = deflate(image.as_raw())?;

    let side = points(width_mm) as f32;
    let catalogue = Ref::new(1);
    let tree = Ref::new(2);
    let page = Ref::new(3);
    let drawing = Ref::new(4);
    let picture = Ref::new(5);
    let about = Ref::new(6);

    let mut pdf = Pdf::new();
    pdf.catalog(catalogue).pages(tree);
    pdf.pages(tree).kids([page]).count(1);

    {
        let mut written = pdf.page(page);
        written.parent(tree);
        written.media_box(Rect::new(0.0, 0.0, side, side));
        written.contents(drawing);
        written.resources().x_objects().pair(IMAGE_NAME, picture);
        written.finish();
    }

    {
        let mut embedded = pdf.image_xobject(picture, &samples);
        embedded.filter(Filter::FlateDecode);
        embedded.width(width as i32);
        embedded.height(height as i32);
        embedded.color_space().device_rgb();
        embedded.bits_per_component(8);
        embedded.finish();
    }

    // The image's own coordinate system is the unit square, so the matrix that
    // places it is the page size itself: no offset, no scale to work out, and
    // nothing to get wrong at a different page size.
    let mut content = Content::new();
    content.save_state();
    content.transform([side, 0.0, 0.0, side, 0.0, 0.0]);
    content.x_object(IMAGE_NAME);
    content.restore_state();
    pdf.stream(drawing, &content.finish());

    // The only thing said about where this came from. No author, no title, no
    // dates: a file that records when a code was made records something about
    // the person who made it.
    pdf.document_info(about).producer(TextStr("Signatum"));

    Ok(pdf.finish())
}

/// Deflate the samples, as `/FlateDecode` means them.
fn deflate(samples: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(samples)
        .and_then(|()| encoder.finish())
        .map_err(|error| {
            Error::Render(format!("the page's image could not be compressed: {error}"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::hello_world_svg;
    use crate::imaging::render::render_png;

    /// 25 mm at 300 dpi: the slice's own proof of done. The page measures 25 mm
    /// in the document's units, and the picture on it is 295 pixels square —
    /// read out of the bytes, because a PDF nobody parsed is a PDF nobody knows
    /// the size of.
    #[test]
    fn a_page_measures_the_millimetres_it_was_asked_for() {
        let artefact = render_png(hello_world_svg().as_bytes(), 295).expect("render");

        let written = one_page(&artefact.png, 25.0).expect("write the page");
        let text = String::from_utf8_lossy(&written);

        assert!(
            text.contains("/MediaBox [0 0 70.87 70.87]"),
            "the page is not 25 mm: {}",
            &text[..text.len().min(400)]
        );
        assert!(text.contains("/Subtype /Image"));
        assert!(text.contains("/Width 295"));
        assert!(text.contains("/Height 295"));
        assert!(text.contains("/Producer (Signatum)"));
        assert_eq!(&written[..8], b"%PDF-1.7");
    }

    /// The page size is the number the command was given, and never a number
    /// read out of the drawing: this artefact was rendered from a `viewBox` with
    /// no physical width at all, and the page is still exactly 50 mm.
    #[test]
    fn the_page_size_comes_from_the_millimetres_and_not_from_the_drawing() {
        let artefact = render_png(hello_world_svg().as_bytes(), 128).expect("render");

        let written = one_page(&artefact.png, 50.0).expect("write the page");

        let expected = format!("/MediaBox [0 0 {0} {0}]", points(50.0) as f32);
        assert!(
            String::from_utf8_lossy(&written).contains(&expected),
            "expected {expected}"
        );
        assert_eq!(points(50.0), 141.73);
    }

    /// The image in the page is the artefact, pixel for pixel: inflated, it is
    /// three bytes per pixel of a 295-square picture, dark in the middle of a
    /// finder pattern and light in the quiet zone.
    #[test]
    fn the_picture_in_the_page_is_the_artefact_that_was_verified() {
        let artefact = render_png(hello_world_svg().as_bytes(), 295).expect("render");

        let written = one_page(&artefact.png, 25.0).expect("write the page");
        let samples = inflate_first_stream(&written);

        assert_eq!(samples.len(), 295 * 295 * 3, "295 × 295 pixels of RGB");

        let pixel = |x: usize, y: usize| {
            let at = (y * 295 + x) * 3;
            samples[at]
        };
        // The quiet zone is four modules of white at the very edge.
        assert!(pixel(2, 2) > 200, "the quiet zone is light");
        // The top-left finder pattern's centre sits at about module 7 of 29.
        assert!(pixel(70, 70) < 80, "the finder pattern is dark");
    }

    #[test]
    fn a_width_that_is_not_a_page_is_refused() {
        let artefact = render_png(hello_world_svg().as_bytes(), 64).expect("render");

        for width in [0.0, -25.0, f64::NAN, f64::INFINITY, 5000.0] {
            let refused = one_page(&artefact.png, width).expect_err("that page was written");
            assert!(matches!(refused, Error::InvalidInput(_)), "{width}");
        }
    }

    /// The `/FlateDecode` stream of the first object that has one, inflated.
    fn inflate_first_stream(pdf: &[u8]) -> Vec<u8> {
        let start = find(pdf, b"stream").expect("a stream") + b"stream".len();
        // The keyword is followed by an end-of-line, which is not part of the data.
        let start = start + if pdf[start] == b'\r' { 2 } else { 1 };
        let end = find(&pdf[start..], b"endstream").expect("an endstream") + start;

        let mut inflated = Vec::new();
        let mut decoder = flate2::read::ZlibDecoder::new(&pdf[start..end]);
        std::io::Read::read_to_end(&mut decoder, &mut inflated).expect("inflate");
        inflated
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }
}
