//! The scan margin: how much abuse the artefact survives before it stops being
//! a code.
//!
//! A verified code is a code that read back **once**, from clean pixels, at the
//! size it was rendered. That is the gate, and it is not the same question as
//! "will this survive being printed small, photocopied, or pasted into a slide
//! deck and saved as a JPEG". This module asks that second question thirteen
//! times and reports thirteen answers.
//!
//! Nine of them are what a screen or a chat application does to an image:
//! shrink it, blur it, recompress it. Four are what print does, which is
//! different (ADR-035): ink spreads into the paper, so dark modules grow and the
//! light gaps between them close — more on uncoated stock than on coated; a
//! phone is held at an angle, not square; and the light in a shop window is not
//! the light of a monitor. Ink spread is measured as a share of a **module**, not
//! as pixels, which is why the caller says how many modules the raster is wide:
//! the domain knows that and the raster does not.
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

/// The whole margin: the thirteen variants, in the order they are shown.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScanMargin {
    /// On screen and in chat — shrunk, then blurred, then recompressed, mild to
    /// cruel within each — and then in print: ink spread on coated and on
    /// uncoated paper, a 30° tilt, and dim light.
    pub variants: Vec<MarginVariant>,
}

/// How much of the original each shrunk variant keeps, in per cent.
const SHRUNK_PER_CENT: [u32; 3] = [50, 33, 25];

/// The blur radii, in pixels of the artefact as it was rendered.
const BLUR_RADII: [u32; 3] = [1, 2, 3];

/// The JPEG qualities, on the encoder's own scale.
const JPEG_QUALITIES: [u8; 3] = [80, 50, 25];

/// The fewest modules a code's side can have, quiet zone included: a
/// version-1 symbol with no quiet zone at all.
pub const MIN_MODULES: u32 = 21;

/// The most: a version-40 symbol (177 modules) with a quiet zone of eight on
/// each side.
pub const MAX_MODULES: u32 = 193;

/// How far ink spreads into the paper, as a share of a module, on each edge of
/// every dark area — the label it is reported under, and the share. The figures
/// are conventional approximations for coated and uncoated stock, not a press
/// profile.
const INK_SPREAD: [(&str, f64); 2] = [
    ("Ink spread, coated paper", 0.08),
    ("Ink spread, uncoated paper", 0.18),
];

/// How far off square the tilted variant is held, about the vertical axis.
const TILT_DEGREES: u32 = 30;

/// How far away the tilted artefact is seen from, in widths of itself.
const TILT_DISTANCE_IN_WIDTHS: f64 = 3.0;

/// The share of the contrast dim light leaves, around the mid-grey.
const DIM_CONTRAST: f64 = 0.35;

/// The noise dim light adds, in grey levels either side of the pixel.
const DIM_NOISE: u32 = 12;

/// The seed of dim light's noise. Fixed, so the same artefact always gets the
/// same verdict: a margin that changed its answer between two asks would be
/// measuring the dice, not the code.
const DIM_SEED: u64 = 0x5167_6E61_7475_6D21;

/// Refuse a module count no code has.
///
/// # Errors
///
/// [`Error::InvalidInput`] when `modules` is outside
/// [`MIN_MODULES`]..=[`MAX_MODULES`].
pub fn check_modules(modules: u32) -> Result<()> {
    if (MIN_MODULES..=MAX_MODULES).contains(&modules) {
        Ok(())
    } else {
        Err(Error::InvalidInput(format!(
            "a code is between {MIN_MODULES} and {MAX_MODULES} modules wide, quiet zone included"
        )))
    }
}

/// Measure the margin of an artefact that has already been verified.
///
/// `png` is the artefact itself — the bytes the gate answered for — so every
/// variant is a degradation of the thing that will be printed, and not of a
/// second render that happens to look like it. `modules` is its side in
/// modules, quiet zone included, which turns ink spread into a share of a
/// module rather than a number of pixels that means something different at
/// every size.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a module count outside
/// [`MIN_MODULES`]..=[`MAX_MODULES`]. [`Error::Render`] when the artefact cannot
/// be read back or a variant cannot be encoded. Both are this host's own bytes,
/// so either is a defect rather than a person's mistake. A variant that does not
/// decode is not an error: it is `verified: false`, which is the whole point of
/// asking.
pub fn scan_margin(png: &[u8], payload: &[u8], modules: u32) -> Result<ScanMargin> {
    check_modules(modules)?;
    let original = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| Error::Render(format!("the artefact could not be read back: {error}")))?
        .to_luma8();

    let mut variants = Vec::with_capacity(13);

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

    let module_px = f64::from(original.width()) / f64::from(modules);
    for (label, share) in INK_SPREAD {
        let spread = erode(&original, spread_radius(module_px, share));
        variants.push(MarginVariant {
            label: label.to_string(),
            verified: reads_back(spread, payload),
        });
    }
    variants.push(MarginVariant {
        label: format!("Tilted {TILT_DEGREES}°"),
        verified: reads_back(tilt(&original, f64::from(TILT_DEGREES)), payload),
    });
    variants.push(MarginVariant {
        label: "Dim light".to_string(),
        verified: reads_back(dim(&original), payload),
    });

    Ok(ScanMargin { variants })
}

/// How many pixels ink spreads by, on each edge, when it spreads by `share` of
/// a module `module_px` pixels wide.
///
/// Never less than one pixel: a spread that rounded to nothing would report a
/// small code as surviving print because the arithmetic could not see it — and
/// a small code is exactly where a pixel of spread is a large share of a module.
fn spread_radius(module_px: f64, share: f64) -> u32 {
    let radius = (share * module_px).round();
    if radius < 1.0 {
        1
    } else {
        radius as u32
    }
}

/// Grey-scale erosion — a minimum filter over a square of `radius` pixels each
/// way — which is what ink spread does: every dark area grows by `radius` on
/// each edge, and a light gap narrower than twice that closes.
///
/// Square rather than round, because a square is separable (two passes of a
/// line, not one pass of an area) and because a QR module is a square: its
/// edges are horizontal and vertical, which is where a square and a disc grow a
/// module by the same amount. The edge of the raster is extended outwards, as
/// paper continues past what was printed on it.
fn erode(source: &GrayImage, radius: u32) -> GrayImage {
    let (width, height) = source.dimensions();
    if radius == 0 || width == 0 || height == 0 {
        return source.clone();
    }
    let (w, h, reach) = (width as usize, height as usize, radius as usize);

    // Along each row, then down each column. The second pass goes row by row
    // too — a running minimum of whole rows — so both passes read memory in the
    // order it is laid out.
    let mut horizontal = vec![0u8; w * h];
    for (row, out) in source
        .as_raw()
        .chunks_exact(w)
        .zip(horizontal.chunks_exact_mut(w))
    {
        min_along(row, reach, out);
    }

    let mut eroded = vec![u8::MAX; w * h];
    for y in 0..h {
        let out = &mut eroded[y * w..(y + 1) * w];
        for at in y.saturating_sub(reach)..=(y + reach).min(h - 1) {
            let row = &horizontal[at * w..(at + 1) * w];
            for x in 0..w {
                if row[x] < out[x] {
                    out[x] = row[x];
                }
            }
        }
    }

    GrayImage::from_raw(width, height, eroded).expect("the buffer is exactly width × height")
}

/// The minimum of `line` over a window of `reach` either side of each position,
/// the line's ends extended outwards — van Herk and Gil-Werman's method, three
/// comparisons a pixel whatever the reach, so a wide spread on a large raster
/// costs what a narrow one does.
fn min_along(line: &[u8], reach: usize, out: &mut [u8]) {
    let window = reach * 2 + 1;
    let first = line[0];
    let last = line[line.len() - 1];
    // The line, padded by `reach` at each end and to a whole number of windows.
    let padded_len = (line.len() + reach * 2).div_ceil(window) * window;
    let mut padded = vec![last; padded_len];
    padded[..reach].fill(first);
    padded[reach..reach + line.len()].copy_from_slice(line);

    // Within each block of one window: the running minimum from its start, and
    // the running minimum from its end.
    let mut forward = vec![0u8; padded_len];
    let mut backward = vec![0u8; padded_len];
    for start in (0..padded_len).step_by(window) {
        forward[start] = padded[start];
        for at in start + 1..start + window {
            forward[at] = forward[at - 1].min(padded[at]);
        }
        let end = start + window - 1;
        backward[end] = padded[end];
        for at in (start..end).rev() {
            backward[at] = backward[at + 1].min(padded[at]);
        }
    }

    // The window centred on `x` spans `x..x + window` of the padded line, which
    // is the tail of one block and the head of the next.
    for (x, value) in out.iter_mut().enumerate() {
        *value = backward[x].min(forward[x + window - 1]);
    }
}

/// The artefact as a phone sees it held `degrees` off square, turned about its
/// vertical centre line, from [`TILT_DISTANCE_IN_WIDTHS`] widths away.
///
/// A projective warp, not a shear: the near half grows and the far half
/// shrinks, as a camera sees a plane at an angle. The focal length is the
/// viewing distance, so the centre line keeps its size; the image keeps its
/// size; whatever the turned artefact no longer covers is white, as the paper
/// around it would be. Sampling is bilinear, because a camera's pixels average
/// what falls on them.
fn tilt(source: &GrayImage, degrees: f64) -> GrayImage {
    let (width, height) = source.dimensions();
    let (w, h) = (f64::from(width), f64::from(height));
    let (sin, cos) = degrees.to_radians().sin_cos();
    let distance = TILT_DISTANCE_IN_WIDTHS * w;

    let mut tilted = GrayImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            // Where this pixel's centre is on the screen, from the image centre…
            let seen_x = f64::from(x) + 0.5 - w / 2.0;
            let seen_y = f64::from(y) + 0.5 - h / 2.0;
            // …and the point of the turned plane that projects onto it. A point
            // `u` across the plane sits at depth `distance + u·sin` and appears at
            // `distance·u·cos / depth`; solving that for `u` is the line below.
            let across = seen_x * distance / (distance * cos - seen_x * sin);
            let depth = distance + across * sin;
            let down = seen_y * depth / distance;

            let value = bilinear(source, across + w / 2.0 - 0.5, down + h / 2.0 - 0.5);
            tilted.put_pixel(x, y, image::Luma([value]));
        }
    }

    tilted
}

/// The grey at a point between pixel centres, white outside the raster.
fn bilinear(source: &GrayImage, x: f64, y: f64) -> u8 {
    let (width, height) = source.dimensions();
    let at = |column: f64, row: f64| -> f64 {
        if column < 0.0 || row < 0.0 || column >= f64::from(width) || row >= f64::from(height) {
            255.0
        } else {
            f64::from(source.get_pixel(column as u32, row as u32).0[0])
        }
    };

    let (left, top) = (x.floor(), y.floor());
    let (along, below) = (x - left, y - top);
    let upper = at(left, top) * (1.0 - along) + at(left + 1.0, top) * along;
    let lower = at(left, top + 1.0) * (1.0 - along) + at(left + 1.0, top + 1.0) * along;

    (upper * (1.0 - below) + lower * below)
        .round()
        .clamp(0.0, 255.0) as u8
}

/// The artefact in poor light: a third of the contrast, a camera's noise, and
/// the slight softness of a sensor working hard.
///
/// The contrast is compressed to [`DIM_CONTRAST`] around the mid-grey, a noise
/// of up to [`DIM_NOISE`] grey levels either way is added from a fixed seed,
/// and a box blur of one pixel follows. The seed is fixed so the same artefact
/// always gets the same verdict.
fn dim(source: &GrayImage) -> GrayImage {
    const MID_GREY: f64 = 127.5;
    let mut noise = SplitMix64(DIM_SEED);
    let span = u64::from(DIM_NOISE) * 2 + 1;

    let mut darkened = source.clone();
    for pixel in darkened.pixels_mut() {
        let compressed = MID_GREY + (f64::from(pixel.0[0]) - MID_GREY) * DIM_CONTRAST;
        let jitter = (noise.draw() % span) as f64 - f64::from(DIM_NOISE);
        pixel.0[0] = (compressed.round() + jitter).clamp(0.0, 255.0) as u8;
    }

    box_blur(&darkened, 1)
}

/// A small, fixed, well-mixed sequence of numbers — SplitMix64 — so dim light's
/// noise needs no dependency and is the same on every machine and every run.
struct SplitMix64(u64);

impl SplitMix64 {
    fn draw(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut mixed = self.0;
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        mixed ^ (mixed >> 31)
    }
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
    use crate::imaging::fixtures::{blank_svg, hello_world_modules, hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;

    /// The modules of the fixture's side, quiet zone included: 21 + 2 × 4.
    const FIXTURE_MODULES: u32 = 29;

    /// The thirteen lines, in the order the screen shows them, worded exactly as
    /// it words them. The labels are a contract with the interface: it prints
    /// them and does not build them.
    #[test]
    fn the_margin_is_thirteen_variants_with_the_labels_the_screen_shows() {
        let artefact = render_png(hello_world_svg().as_bytes(), 512).expect("render");

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");

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
                "Ink spread, coated paper",
                "Ink spread, uncoated paper",
                "Tilted 30°",
                "Dim light",
            ]
        );
    }

    /// A code rendered at 512 px has a module of 17 pixels; none of the thirteen
    /// insults is enough to stop it reading. That is the answer a person should
    /// get for a code at a sensible size — and it is what proves the variants
    /// are the artefact and not noise.
    #[test]
    fn a_code_with_room_to_spare_survives_every_variant() {
        let artefact = render_png(hello_world_svg().as_bytes(), 512).expect("render");

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");

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

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");

        assert!(margin.variants.iter().all(|variant| !variant.verified));
    }

    /// Thirteen decodes, three of them of a re-encoded image, have to stay inside
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
        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");
        let elapsed = started.elapsed();

        assert_eq!(margin.variants.len(), 13);
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

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");

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

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");
        let json = serde_json::to_value(&margin).expect("serialise");

        let variants = json
            .get("variants")
            .and_then(|variants| variants.as_array())
            .expect("the margin is an array of variants");
        assert_eq!(variants.len(), 13);
        assert!(variants[0].get("label").is_some());
        assert!(variants[0].get("verified").is_some());
    }

    /// The four print lines, at the size the fixture is measured at, all read:
    /// a code with a 17-pixel module has room for ink, an angle and poor light.
    #[test]
    fn the_fixture_reads_under_every_print_condition_at_its_size() {
        let artefact = render_png(hello_world_svg().as_bytes(), 512).expect("render");

        let margin =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");

        let print = &margin.variants[9..];
        assert_eq!(print.len(), 4);
        for variant in print {
            assert!(variant.verified, "{} should still read", variant.label);
        }
    }

    /// Ink spread is a share of a module, rounded, and never less than a pixel.
    #[test]
    fn ink_spreads_by_a_share_of_a_module() {
        // 1024 pixels over 29 modules is a module of 35.3 pixels: 8 % of it is
        // 2.8, which is 3; 18 % is 6.4, which is 6.
        let module_px = 1024.0 / 29.0;
        assert_eq!(spread_radius(module_px, 0.08), 3);
        assert_eq!(spread_radius(module_px, 0.18), 6);
        // A module of 25 pixels is exactly 2 at 8 %.
        assert_eq!(spread_radius(25.0, 0.08), 2);
        // A module of 3 pixels rounds 8 % to nothing, and a pixel is the least.
        assert_eq!(spread_radius(3.0, 0.08), 1);
        assert_eq!(spread_radius(3.0, 0.18), 1);
    }

    /// Erosion grows a dark area by its radius on every edge.
    #[test]
    fn ink_spread_grows_a_dark_area_by_its_radius_on_each_edge() {
        let mut paper = GrayImage::from_pixel(11, 11, image::Luma([255]));
        paper.put_pixel(5, 5, image::Luma([0]));

        let spread = erode(&paper, 2);

        for y in 0..11 {
            for x in 0..11 {
                let inked = (3..=7).contains(&x) && (3..=7).contains(&y);
                assert_eq!(
                    spread.get_pixel(x, y).0[0],
                    if inked { 0 } else { 255 },
                    "({x}, {y})"
                );
            }
        }
    }

    /// The fast minimum agrees with the obvious one — every pixel, several
    /// reaches, edges included, on a raster of noise that is the same every run.
    #[test]
    fn ink_spread_agrees_with_a_brute_force_minimum() {
        let mut noise = SplitMix64(7);
        let (width, height) = (37u32, 23u32);
        let source = GrayImage::from_fn(width, height, |_, _| {
            image::Luma([(noise.draw() % 256) as u8])
        });

        for radius in [1u32, 2, 3, 6, 20, 40] {
            let fast = erode(&source, radius);
            for y in 0..height {
                for x in 0..width {
                    let reach = i64::from(radius);
                    let mut least = u8::MAX;
                    for dy in -reach..=reach {
                        for dx in -reach..=reach {
                            let at_x = (i64::from(x) + dx).clamp(0, i64::from(width) - 1) as u32;
                            let at_y = (i64::from(y) + dy).clamp(0, i64::from(height) - 1) as u32;
                            least = least.min(source.get_pixel(at_x, at_y).0[0]);
                        }
                    }
                    assert_eq!(fast.get_pixel(x, y).0[0], least, "r {radius} at ({x}, {y})");
                }
            }
        }
    }

    /// The proof that print is a question of its own. The fixture is drawn by
    /// hand at 12 pixels a module with every dark module grown 3 pixels on each
    /// edge — a heavy look, in which a lone light module is half a module wide.
    /// It reads clean, and it survives coated paper: 8 % of 12 pixels is one
    /// pixel of spread, and the six-pixel gap keeps four. On uncoated paper 18 %
    /// is two pixels, the gap keeps two, and the decoder no longer reads it. The
    /// margin says so on the line named for it.
    #[test]
    fn a_code_that_reads_clean_and_fails_under_uncoated_ink_spread_says_so_by_name() {
        let png = heavy_hello_world(12, 3);
        let clean = image::load_from_memory_with_format(&png, ImageFormat::Png)
            .expect("read back")
            .to_luma8();
        assert!(reads_back(clean, HELLO_WORLD.as_bytes()), "it reads clean");

        let margin = scan_margin(&png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");
        let line = |label: &str| {
            margin
                .variants
                .iter()
                .find(|variant| variant.label == label)
                .unwrap_or_else(|| panic!("{label} is always reported"))
                .verified
        };

        assert!(
            line("Ink spread, coated paper"),
            "coated paper spreads one pixel"
        );
        assert!(
            !line("Ink spread, uncoated paper"),
            "uncoated paper spreads two pixels and closes the gaps"
        );
    }

    /// The tilted view is the size of the original, and where the turned
    /// artefact no longer reaches is white. A solid black square makes that
    /// visible: its corners turn white and its centre stays black.
    #[test]
    fn the_tilt_keeps_the_size_and_whitens_the_corners() {
        let ink = GrayImage::from_pixel(200, 160, image::Luma([0]));

        let tilted = tilt(&ink, f64::from(TILT_DEGREES));

        assert_eq!(tilted.dimensions(), (200, 160));
        for (x, y) in [(0, 0), (199, 0), (0, 159), (199, 159)] {
            assert_eq!(tilted.get_pixel(x, y).0[0], 255, "corner ({x}, {y})");
        }
        assert_eq!(
            tilted.get_pixel(100, 80).0[0],
            0,
            "the centre is the artefact"
        );
    }

    /// Dim light is the same every time it is asked: two runs, identical pixels.
    /// It is also what it says — a third of the contrast, with noise in it.
    #[test]
    fn dim_light_is_deterministic() {
        let artefact = render_png(hello_world_svg().as_bytes(), 256).expect("render");
        let original = image::load_from_memory_with_format(&artefact.png, ImageFormat::Png)
            .expect("read back")
            .to_luma8();

        let first = dim(&original);
        let second = dim(&original);

        assert_eq!(first.as_raw(), second.as_raw());
        let darkest = first
            .pixels()
            .map(|pixel| pixel.0[0])
            .min()
            .expect("pixels");
        let lightest = first
            .pixels()
            .map(|pixel| pixel.0[0])
            .max()
            .expect("pixels");
        assert!(
            darkest >= 83 - 12 && lightest <= 172 + 12,
            "{darkest}..{lightest}"
        );
        let white = GrayImage::from_pixel(64, 64, image::Luma([255]));
        let lit = dim(&white);
        assert!(
            lit.pixels()
                .any(|pixel| pixel.0[0] != lit.get_pixel(0, 0).0[0]),
            "dim light carries noise"
        );

        let again =
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin");
        assert_eq!(
            again,
            scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), FIXTURE_MODULES).expect("margin"),
            "the same artefact gets the same margin"
        );
    }

    /// A module count no code has is refused, at both ends.
    #[test]
    fn a_module_count_outside_the_range_is_refused() {
        let artefact = render_png(hello_world_svg().as_bytes(), 128).expect("render");

        for modules in [0, MIN_MODULES - 1, MAX_MODULES + 1] {
            let refused =
                scan_margin(&artefact.png, HELLO_WORLD.as_bytes(), modules).expect_err("refused");
            assert!(
                matches!(refused, Error::InvalidInput(_)),
                "{modules} modules"
            );
        }
        assert!(check_modules(MIN_MODULES).is_ok());
        assert!(check_modules(MAX_MODULES).is_ok());
    }

    /// The fixture drawn by hand at `module_px` pixels a module, every dark
    /// module grown by `bleed` pixels on each edge, as a PNG.
    fn heavy_hello_world(module_px: u32, bleed: u32) -> Vec<u8> {
        let quiet = crate::imaging::fixtures::QUIET_ZONE as u32;
        let pixels = FIXTURE_MODULES * module_px;
        let mut grey = GrayImage::from_pixel(pixels, pixels, image::Luma([255]));

        for (row, line) in hello_world_modules().iter().enumerate() {
            for (column, module) in line.chars().enumerate() {
                if module != '#' {
                    continue;
                }
                let (left, top) = (
                    (column as u32 + quiet) * module_px,
                    (row as u32 + quiet) * module_px,
                );
                for y in top - bleed..top + module_px + bleed {
                    for x in left - bleed..left + module_px + bleed {
                        grey.put_pixel(x, y, image::Luma([0]));
                    }
                }
            }
        }

        let mut png = Vec::new();
        grey.write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .expect("encode");
        png
    }
}
