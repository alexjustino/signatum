//! The scan margin: how much abuse the artefact survives before it stops being
//! a code.
//!
//! A verified code is a code that read back **once**, from clean pixels, at the
//! size it was rendered. That is the gate, and it is not the same question as
//! "will this survive being printed small, photocopied, or pasted into a slide
//! deck and saved as a JPEG". This module asks that second question nine times
//! and reports nine answers.
//!
//! It is a **report, never a gate** (ADR-027). A variant that fails does not
//! stop an export: a code that reads at full size and fails at a quarter of it
//! is still a true code at full size. What would be wrong is not saying so.
//!
//! Pure: bytes in, verdicts out. No database row is written — this is not
//! evidence about an artefact, it is a measurement of one, and the artefact's
//! evidence was written when it was verified.

use image::{ExtendedColorType, GrayImage, ImageFormat};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::imaging::decode::decode_luma;

/// One variant, and whether the decoder still read the payload out of it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MarginVariant {
    /// What was done to the artefact, as the screen says it: `Shrunk to 25 %`.
    pub label: String,
    /// True only when the decoder read back the payload, byte for byte.
    pub verified: bool,
}

/// The whole margin: the nine variants, in the order they are shown.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScanMargin {
    /// Shrunk, then blurred, then recompressed — mild to cruel within each.
    pub variants: Vec<MarginVariant>,
}

/// How much of the original each shrunk variant keeps, in per cent.
const SHRUNK_PER_CENT: [u32; 3] = [50, 33, 25];

/// The blur radii, in pixels of the artefact as it was rendered.
const BLUR_RADII: [u32; 3] = [1, 2, 3];

/// The JPEG qualities, on the encoder's own scale.
const JPEG_QUALITIES: [u8; 3] = [80, 50, 25];

/// Measure the margin of an artefact that has already been verified.
///
/// `png` is the artefact itself — the bytes the gate answered for — so every
/// variant is a degradation of the thing that will be printed, and not of a
/// second render that happens to look like it.
///
/// # Errors
///
/// [`Error::Render`] when the artefact cannot be read back or a variant cannot
/// be encoded. Both are this host's own bytes, so either is a defect rather than
/// a person's mistake. A variant that does not decode is not an error: it is
/// `verified: false`, which is the whole point of asking.
pub fn scan_margin(png: &[u8], payload: &[u8]) -> Result<ScanMargin> {
    let original = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| Error::Render(format!("the artefact could not be read back: {error}")))?
        .to_luma8();

    let mut variants = Vec::with_capacity(9);

    for per_cent in SHRUNK_PER_CENT {
        let shrunk = shrink(&original, per_cent);
        variants.push(MarginVariant {
            label: format!("Shrunk to {per_cent} %"),
            verified: reads_back(shrunk, payload),
        });
    }
    for radius in BLUR_RADII {
        let blurred = box_blur(&original, radius);
        variants.push(MarginVariant {
            label: format!("Blurred {radius} px"),
            verified: reads_back(blurred, payload),
        });
    }
    for quality in JPEG_QUALITIES {
        let recompressed = recompress(&original, quality)?;
        variants.push(MarginVariant {
            label: format!("JPEG quality {quality}"),
            verified: reads_back(recompressed, payload),
        });
    }

    Ok(ScanMargin { variants })
}

/// True when the independent decoder read exactly the payload out of `grey`.
fn reads_back(grey: GrayImage, payload: &[u8]) -> bool {
    decode_luma(grey).as_deref() == Some(payload)
}

/// Scale down to `per_cent` of each side, by nearest neighbour.
///
/// Nearest neighbour is the cruel choice and the honest one: it is what a screen
/// does when a slide is scaled, and it does not average a module's edge into its
/// neighbour the way a smooth filter would. A smooth filter would flatter the
/// code.
fn shrink(source: &GrayImage, per_cent: u32) -> GrayImage {
    let side = |value: u32| ((u64::from(value) * u64::from(per_cent) + 50) / 100).max(1) as u32;

    image::imageops::resize(
        source,
        side(source.width()),
        side(source.height()),
        image::imageops::FilterType::Nearest,
    )
}

/// Blur with a box of `radius` pixels, in two passes.
///
/// A box blur rather than a Gaussian: it is close to what a printer's dot spread
/// and a camera slightly out of focus both do, it is separable, and it is the
/// same arithmetic in both directions — a blur whose cost grew with the square
/// of the radius would be a variant nobody waits for.
fn box_blur(source: &GrayImage, radius: u32) -> GrayImage {
    let (width, height) = source.dimensions();
    if radius == 0 || width == 0 || height == 0 {
        return source.clone();
    }

    let reach = i64::from(radius);
    let window = reach * 2 + 1;
    let mut horizontal = GrayImage::new(width, height);
    let mut blurred = GrayImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let mut total = 0i64;
            for step in -reach..=reach {
                let at = (i64::from(x) + step).clamp(0, i64::from(width) - 1) as u32;
                total += i64::from(source.get_pixel(at, y).0[0]);
            }
            horizontal.put_pixel(x, y, image::Luma([(total / window) as u8]));
        }
    }
    for y in 0..height {
        for x in 0..width {
            let mut total = 0i64;
            for step in -reach..=reach {
                let at = (i64::from(y) + step).clamp(0, i64::from(height) - 1) as u32;
                total += i64::from(horizontal.get_pixel(x, at).0[0]);
            }
            blurred.put_pixel(x, y, image::Luma([(total / window) as u8]));
        }
    }

    blurred
}

/// Encode as JPEG at `quality` and decode the result — the round trip a code
/// makes through a document, an e-mail and a chat application.
///
/// The luminance is what is compressed, because the luminance is what the
/// decoder reads: a colour round trip would spend its time on the two channels
/// that make no difference to the answer.
fn recompress(source: &GrayImage, quality: u8) -> Result<GrayImage> {
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode(
            source.as_raw(),
            source.width(),
            source.height(),
            ExtendedColorType::L8,
        )
        .map_err(|error| Error::Render(format!("a variant could not be encoded: {error}")))?;

    Ok(
        image::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
            .map_err(|error| Error::Render(format!("a variant could not be read back: {error}")))?
            .to_luma8(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;

    /// The nine lines, in the order the screen shows them, worded exactly as it
    /// words them. The labels are a contract with the interface: it prints them
    /// and does not build them.
    #[test]
    fn the_margin_is_nine_variants_with_the_labels_the_screen_shows() {
        let artefact = render_png(hello_world_svg().as_bytes(), 512).expect("render");

        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");

        let labels: Vec<&str> = margin
            .variants
            .iter()
            .map(|variant| variant.label.as_str())
            .collect();
        assert_eq!(
            labels,
            vec![
                "Shrunk to 50 %",
                "Shrunk to 33 %",
                "Shrunk to 25 %",
                "Blurred 1 px",
                "Blurred 2 px",
                "Blurred 3 px",
                "JPEG quality 80",
                "JPEG quality 50",
                "JPEG quality 25",
            ]
        );
    }

    /// A code rendered at 512 px has a module of 17 pixels; none of the nine
    /// insults is enough to stop it reading. That is the answer a person should
    /// get for a code at a sensible size — and it is what proves the variants
    /// are the artefact and not noise.
    #[test]
    fn a_code_with_room_to_spare_survives_every_variant() {
        let artefact = render_png(hello_world_svg().as_bytes(), 512).expect("render");

        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");

        for variant in &margin.variants {
            assert!(variant.verified, "{} should still read", variant.label);
        }
    }

    /// And the report is capable of saying no. A blank square has nothing to read
    /// at any size, which is the cheapest way to prove the verdict is measured
    /// rather than assumed.
    #[test]
    fn a_square_with_no_code_in_it_fails_every_variant() {
        let artefact = render_png(blank_svg().as_bytes(), 256).expect("render");

        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");

        assert!(margin.variants.iter().all(|variant| !variant.verified));
    }

    /// Nine decodes, three of them of a re-encoded image, have to stay inside
    /// the time a person will wait: the screen asks for the margin after every
    /// verification.
    #[test]
    fn the_whole_margin_of_a_large_code_is_bounded_in_time() {
        let artefact = render_png(
            hello_world_svg().as_bytes(),
            crate::commands::codes::MARGIN_MAX_PIXELS,
        )
        .expect("render");

        let started = std::time::Instant::now();
        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");
        let elapsed = started.elapsed();

        assert_eq!(margin.variants.len(), 9);
        // Three seconds is the bound the product is held to, on the release build a person
        // runs. The gate runs this test unoptimised on a shared runner, where the same work
        // took six seconds; a fixed bound there would measure the runner, not the code.
        let bound = std::time::Duration::from_secs(if cfg!(debug_assertions) { 12 } else { 3 });
        assert!(
            elapsed < bound,
            "the margin took {elapsed:?} at the largest side it is measured on"
        );
    }

    /// A small code is where the margin earns its place: shrink it far enough
    /// and it stops reading, and the report says which line failed.
    #[test]
    fn a_code_shrunk_far_enough_stops_reading_and_is_reported_as_such() {
        let artefact = render_png(hello_world_svg().as_bytes(), 64).expect("render");

        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");

        let quarter = margin
            .variants
            .iter()
            .find(|variant| variant.label == "Shrunk to 25 %")
            .expect("the quarter-size line is always reported");
        assert!(
            !quarter.verified,
            "a 21-module code in 16 pixels cannot be read"
        );
    }

    #[test]
    fn the_margin_speaks_snake_case_to_the_interface() {
        let artefact = render_png(hello_world_svg().as_bytes(), 256).expect("render");

        let margin = scan_margin(&artefact.png, HELLO_WORLD.as_bytes()).expect("margin");
        let json = serde_json::to_value(&margin).expect("serialise");

        let variants = json
            .get("variants")
            .and_then(|variants| variants.as_array())
            .expect("the margin is an array of variants");
        assert_eq!(variants.len(), 9);
        assert!(variants[0].get("label").is_some());
        assert!(variants[0].get("verified").is_some());
    }
}
