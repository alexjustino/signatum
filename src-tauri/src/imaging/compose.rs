//! Putting the logo on the pixels the code was drawn on.
//!
//! This is the one place a logo and a code meet, and it sits **before** the PNG
//! is encoded on purpose: what the decoder reads back has to be the artefact
//! with the logo on it, or the scan gate would be proving a picture nobody will
//! ever print (ADR-010). A logo drawn after the verification is a logo nobody
//! checked.
//!
//! The plate under the logo is not drawn here. It is a plain `<rect>` the
//! domain puts in the scene, so it is rasterised with the modules, by the same
//! renderer, in the same pass — one geometry, not two that have to agree. The
//! logo is then **centred inside the box**, scaled uniformly to fit: the screen
//! overlays the same picture with `object-fit: contain`, and a host that
//! stretched where the screen contains would verify an artefact nobody was
//! shown. Anything the logo does not fill is plate, which is what the plate is
//! for.
//!
//! Pure: a pixmap in, a pixmap changed, nothing else touched.

use resvg::tiny_skia;
use resvg::usvg;

use crate::error::{Error, Result};
use crate::imaging::logo::{LogoKind, NormalisedLogo};
use crate::imaging::render::scan_external_references;

/// How far outside the pixmap a box may land before it is refused, in pixels.
///
/// A box arrives in the scene's units and is multiplied by a scale, so a box
/// that covers the whole code lands on the last pixel plus or minus a rounding
/// error. Half a pixel is that error; anything past it was asked for.
const EDGE_TOLERANCE: f32 = 0.5;

/// Where a logo goes, in the scene's own coordinate system — modules, with the
/// quiet zone included, exactly as the domain computed it.
///
/// It is deliberately not in pixels: the domain decides the box from the matrix
/// and the error-correction budget, and knows nothing about the size a person
/// happens to be exporting at. The conversion happens once, against the scale
/// the renderer used for the `viewBox`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogoBox {
    /// Left edge, in scene units.
    pub x: f32,
    /// Top edge, in scene units.
    pub y: f32,
    /// Width, in scene units.
    pub width: f32,
    /// Height, in scene units.
    pub height: f32,
}

impl LogoBox {
    /// True when the box is a box: finite, and with something inside it.
    pub fn is_usable(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
}

/// Draw a normalised logo into `box_px`, in pixels, on top of what is there.
///
/// The logo is **fitted** to the box, never stretched: one scale for both axes,
/// the largest that still fits, and what is left over is split evenly so the
/// logo sits in the middle. That is `object-fit: contain`, which is exactly
/// what the preview does — and the two have to agree, because the preview is
/// what a person approved and this is what the decoder reads.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the box is not a usable rectangle, when it does
/// not lie inside the code, or when the stored bytes will not open — which,
/// since this product wrote them, is worth a sentence rather than a silently
/// empty middle.
pub fn draw_logo(
    pixmap: &mut tiny_skia::Pixmap,
    logo: &NormalisedLogo,
    box_px: (f32, f32, f32, f32),
) -> Result<()> {
    let (x, y, width, height) = box_px;
    let area = LogoBox {
        x,
        y,
        width,
        height,
    };
    if !area.is_usable() {
        return Err(Error::InvalidInput(
            "A logo needs a box with a positive width and height.".to_string(),
        ));
    }

    // A box that hangs off the edge would be drawn clipped, and a clipped logo
    // is a logo the decoder met and the person did not. Worse, the part that
    // fell off might be the part covering a finder pattern — so the code could
    // read back and be verified as a picture nobody will print. The gate only
    // means something if what it measures is what leaves.
    let (canvas_width, canvas_height) = (pixmap.width() as f32, pixmap.height() as f32);
    if x < -EDGE_TOLERANCE
        || y < -EDGE_TOLERANCE
        || x + width > canvas_width + EDGE_TOLERANCE
        || y + height > canvas_height + EDGE_TOLERANCE
    {
        return Err(Error::InvalidInput(
            "The logo box has to lie inside the code.".to_string(),
        ));
    }

    match logo.kind {
        LogoKind::Raster => draw_raster(pixmap, &logo.bytes, box_px),
        LogoKind::Vector => draw_vector(pixmap, &logo.bytes, box_px),
    }
}

/// The uniform scale and the top-left corner that put a logo of `source` size
/// inside `box_px`: aspect kept, centred, nothing cropped.
///
/// A wide logo in a square box therefore paints a band across the middle and
/// leaves the plate showing above and below it. That is the right answer twice
/// over: it is what the screen drew, and a squashed brand mark is the kind of
/// defect that is only ever noticed on paper.
fn contain(source: (f32, f32), (x, y, width, height): (f32, f32, f32, f32)) -> (f32, f32, f32) {
    let scale = (width / source.0).min(height / source.1);
    let drawn = (source.0 * scale, source.1 * scale);

    (
        scale,
        x + (width - drawn.0) / 2.0,
        y + (height - drawn.1) / 2.0,
    )
}

/// Draw the stored PNG, fitted into the box.
fn draw_raster(
    pixmap: &mut tiny_skia::Pixmap,
    png: &[u8],
    (x, y, width, height): (f32, f32, f32, f32),
) -> Result<()> {
    let source = tiny_skia::Pixmap::decode_png(png).map_err(|error| {
        log::error!("a stored logo did not decode: {error}");
        Error::InvalidInput("This logo could not be drawn.".to_string())
    })?;
    if source.width() == 0 || source.height() == 0 {
        return Err(Error::InvalidInput(
            "This logo could not be drawn.".to_string(),
        ));
    }

    let paint = tiny_skia::PixmapPaint {
        opacity: 1.0,
        blend_mode: tiny_skia::BlendMode::SourceOver,
        // Bilinear rather than nearest: a logo scaled down to a fifth of a code
        // with nearest sampling is a logo with sparkle on its edges, and the
        // decoder is the one that has to live with the noise.
        quality: tiny_skia::FilterQuality::Bilinear,
    };
    let (scale, left, top) = contain(
        (source.width() as f32, source.height() as f32),
        (x, y, width, height),
    );
    let transform = tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, left, top);

    // The destination offset is left at the origin because the translation is
    // in the transform: two places to put it is one place too many.
    pixmap.draw_pixmap(0, 0, source.as_ref(), &paint, transform, None);
    Ok(())
}

/// Render the stored SVG, fitted into the box.
fn draw_vector(
    pixmap: &mut tiny_skia::Pixmap,
    svg: &[u8],
    (x, y, width, height): (f32, f32, f32, f32),
) -> Result<()> {
    // These bytes are usvg's own output, stored by the importer — but they came
    // back out of a database file, which is a file on a disk somebody else can
    // also write to (SECURITY.md says so in as many words). The scan that
    // refused the original runs again here, on the way to the parser, because
    // "it was safe when we wrote it" is an assumption and this is a check.
    if let Err(finding) = scan_external_references(svg) {
        log::error!("a stored logo would reach outside itself: {finding:?}");
        return Err(Error::InvalidInput(
            "This logo could not be drawn.".to_string(),
        ));
    }

    let options = usvg::Options {
        resources_dir: None,
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(svg, &options).map_err(|error| {
        log::error!("a stored logo did not parse: {error}");
        Error::InvalidInput("This logo could not be drawn.".to_string())
    })?;

    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return Err(Error::InvalidInput(
            "This logo could not be drawn.".to_string(),
        ));
    }

    let (scale, left, top) = contain((size.width(), size.height()), (x, y, width, height));
    let transform = tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, left, top);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::logo::normalise;

    const RED: [u8; 3] = [220, 40, 40];

    /// A white square to draw on, the way a rendered code arrives here.
    fn canvas(side: u32) -> tiny_skia::Pixmap {
        let mut pixmap = tiny_skia::Pixmap::new(side, side).expect("allocate");
        pixmap.fill(tiny_skia::Color::WHITE);
        pixmap
    }

    fn raster_logo() -> NormalisedLogo {
        raster_logo_of(32, 32)
    }

    /// A solid logo of a given shape, normalised the way an imported one is.
    fn raster_logo_of(width: u32, height: u32) -> NormalisedLogo {
        let image =
            image::RgbaImage::from_pixel(width, height, image::Rgba([RED[0], RED[1], RED[2], 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode");
        normalise(&png).expect("normalise")
    }

    fn vector_logo() -> NormalisedLogo {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
             <rect width="32" height="32" fill="#dc2828"/></svg>"##;
        normalise(document.as_bytes()).expect("normalise")
    }

    fn pixel(pixmap: &tiny_skia::Pixmap, x: u32, y: u32) -> [u8; 3] {
        let found = pixmap.pixel(x, y).expect("inside the pixmap").demultiply();
        [found.red(), found.green(), found.blue()]
    }

    fn close(found: [u8; 3], wanted: [u8; 3]) -> bool {
        found
            .iter()
            .zip(wanted.iter())
            .all(|(a, b)| a.abs_diff(*b) <= 4)
    }

    #[test]
    fn a_raster_logo_lands_inside_its_box_and_nowhere_else() {
        let mut pixmap = canvas(200);

        draw_logo(&mut pixmap, &raster_logo(), (50.0, 50.0, 100.0, 100.0)).expect("draw");

        assert!(
            close(pixel(&pixmap, 100, 100), RED),
            "the middle is the logo"
        );
        assert!(
            close(pixel(&pixmap, 10, 10), [255, 255, 255]),
            "the corner is untouched"
        );
        assert!(close(pixel(&pixmap, 190, 190), [255, 255, 255]));
    }

    #[test]
    fn a_vector_logo_lands_inside_its_box_and_nowhere_else() {
        let mut pixmap = canvas(200);

        draw_logo(&mut pixmap, &vector_logo(), (50.0, 50.0, 100.0, 100.0)).expect("draw");

        assert!(close(pixel(&pixmap, 100, 100), RED));
        assert!(close(pixel(&pixmap, 10, 10), [255, 255, 255]));
    }

    /// A wide logo in a square box keeps its shape: a band across the middle,
    /// with the plate still showing above and below it. Stretching here would
    /// verify a picture the screen never drew — the preview fits the same box
    /// with `object-fit: contain`.
    #[test]
    fn a_wide_logo_in_a_square_box_keeps_its_shape() {
        let mut pixmap = canvas(200);

        // 64×32 fitted into 100×100: 100 wide, 50 tall, so rows 75 to 125.
        draw_logo(
            &mut pixmap,
            &raster_logo_of(64, 32),
            (50.0, 50.0, 100.0, 100.0),
        )
        .expect("draw");

        for y in [80, 100, 120] {
            assert!(close(pixel(&pixmap, 100, y), RED), "row {y} should be logo");
        }
        for y in [55, 70, 130, 145] {
            assert!(
                close(pixel(&pixmap, 100, y), [255, 255, 255]),
                "row {y} is above or below the band and must stay the plate"
            );
        }
        // And it fills the box from side to side, because the width is what ran
        // out first.
        for x in [55, 100, 145] {
            assert!(
                close(pixel(&pixmap, x, 100), RED),
                "column {x} should be logo"
            );
        }
    }

    /// The same for a tall logo, and the same for the vector path: one rule,
    /// both kinds.
    #[test]
    fn a_tall_vector_logo_keeps_its_shape_too() {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 32">
             <rect width="16" height="32" fill="#dc2828"/></svg>"##;
        let logo = normalise(document.as_bytes()).expect("normalise");
        let mut pixmap = canvas(200);

        // 16×32 fitted into 100×100: 50 wide, 100 tall, so columns 75 to 125.
        draw_logo(&mut pixmap, &logo, (50.0, 50.0, 100.0, 100.0)).expect("draw");

        for x in [80, 100, 120] {
            assert!(
                close(pixel(&pixmap, x, 100), RED),
                "column {x} should be logo"
            );
        }
        for x in [55, 70, 130, 145] {
            assert!(
                close(pixel(&pixmap, x, 100), [255, 255, 255]),
                "column {x} is beside the band and must stay the plate"
            );
        }
    }

    /// A box that hangs off the edge is refused rather than clipped: a clipped
    /// logo is a different picture from the one that was approved, and the
    /// difference is exactly the part that fell off the code.
    #[test]
    fn a_box_that_does_not_lie_inside_the_code_is_refused() {
        let logo = raster_logo();
        for area in [
            (-10.0, 20.0, 40.0, 40.0),
            (20.0, -10.0, 40.0, 40.0),
            (180.0, 20.0, 40.0, 40.0),
            (20.0, 180.0, 40.0, 40.0),
            (0.0, 0.0, 400.0, 400.0),
        ] {
            let mut pixmap = canvas(200);

            let refused = draw_logo(&mut pixmap, &logo, area).expect_err("that box was drawn");

            assert_eq!(
                refused.to_string(),
                "The logo box has to lie inside the code."
            );
            assert!(
                close(pixel(&pixmap, 100, 100), [255, 255, 255]),
                "a refused box must not have drawn anything"
            );
        }
    }

    /// A box that reaches the very edge of the code is not "outside" it: the
    /// scale that took it there is floating point, and half a pixel of rounding
    /// is not something a person asked for.
    #[test]
    fn a_box_that_fills_the_whole_code_is_allowed() {
        let mut pixmap = canvas(200);

        draw_logo(&mut pixmap, &raster_logo(), (0.0, 0.0, 200.2, 200.2)).expect("draw");

        assert!(close(pixel(&pixmap, 100, 100), RED));
    }

    /// Defence in depth: the stored bytes are ours, and they are still scanned.
    /// A database is a file, and a file is something else can write to.
    #[test]
    fn a_stored_vector_logo_that_reaches_outside_itself_is_not_drawn() {
        let tampered = NormalisedLogo {
            kind: LogoKind::Vector,
            format: "svg",
            bytes: br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                 <script>fetch('http://elsewhere')</script>
                 <image href="file:///c:/windows/win.ini" width="32" height="32"/></svg>"##
                .to_vec(),
            width: 32,
            height: 32,
            note: None,
        };
        let mut pixmap = canvas(200);

        let refused =
            draw_logo(&mut pixmap, &tampered, (50.0, 50.0, 100.0, 100.0)).expect_err("drawn");

        assert_eq!(refused.to_string(), "This logo could not be drawn.");
        assert!(close(pixel(&pixmap, 100, 100), [255, 255, 255]));
    }

    #[test]
    fn a_box_that_is_not_a_rectangle_is_refused() {
        let logo = raster_logo();
        for area in [
            (0.0, 0.0, 0.0, 10.0),
            (0.0, 0.0, 10.0, -1.0),
            (f32::NAN, 0.0, 10.0, 10.0),
            (0.0, 0.0, f32::INFINITY, 10.0),
        ] {
            let mut pixmap = canvas(64);
            let refused = draw_logo(&mut pixmap, &logo, area).expect_err("that box was drawn");
            assert!(matches!(refused, Error::InvalidInput(_)), "{refused:?}");
        }
    }
}
