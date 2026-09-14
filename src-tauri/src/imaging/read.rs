//! The same decoder as the scan gate, pointed at somebody else's pixels.
//!
//! The gate asks one question of an artefact this product drew: does it read
//! back as what was asked for (`decode`, ADR-010)? Reading asks a different one
//! of a picture nobody here made: what is in it, and how was it built? So this
//! module reports every grid the detector finds rather than the first, and
//! reports the facts of each — version, error correction, mask, how many modules
//! a side, where it sits on the picture — whether or not the payload came out.
//!
//! Two things are done here that the gate never does, both because the pixels
//! arrived from a camera rather than from `render`:
//!
//! 1. **A cap on what is decoded.** A phone photograph is twelve megapixels and
//!    a QR code needs nothing like that; the long side is brought down to
//!    [`MAX_DECODE_SIDE`] before the search, and the corners are scaled back so
//!    that what the screen draws lands on the picture the person is looking at.
//! 2. **A second pass.** When the first pass finds no grid at all, the picture
//!    is thresholded against a local window (Bradley: an integral image, a window
//!    of an eighth of the short side, dark when a pixel sits more than
//!    [`DARKER_BY_PER_CENT`] under its own neighbourhood) and searched once more.
//!    `rqrr` already thresholds row by row, so this rescues the pictures its own
//!    pass cannot: uneven light across the sheet, a shadow over one half. Once,
//!    and never again — a retry loop on somebody's photograph is a spinner.
//!
//! Pure by construction, like the rest of `imaging`: pixels in, facts out. What
//! reads the file and what draws the outline live elsewhere, and nothing that
//! passes through here is stored.

use std::borrow::Cow;

use image::{GrayImage, Luma};
use rqrr::BitGrid;

/// The longest side, in pixels, the search is given. Above this the picture is
/// scaled down first: a code that needs more than two thousand pixels across
/// the frame is a code no camera is reading either.
pub const MAX_DECODE_SIDE: u32 = 2048;

/// The second pass's window, as a fraction of the picture's short side.
const WINDOW_DIVISOR: u32 = 8;

/// How far under its neighbourhood a pixel has to sit, in per cent, for the
/// second pass to call it dark.
const DARKER_BY_PER_CENT: u64 = 15;

/// What is said about a grid that was found and would not decode.
///
/// It names the pattern rather than the picture, and never says where in a way
/// that would echo the file: the outline on the screen is where.
pub const UNREADABLE: &str = "A code-like pattern was found but could not be decoded.";

/// One code found in a picture.
///
/// `side_modules` and `corners` are facts of the *detection* and are always
/// known. `version`, `ecl` and `mask` come from reading the symbol's format
/// information, so they are absent — not zero, not `'?'` — for a pattern whose
/// format could not be read. A number that was never read must not arrive
/// looking like one that was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundCode {
    /// Exactly the bytes the code carries. Empty when it did not decode.
    pub bytes: Vec<u8>,
    /// The symbol's version, 1 to 40.
    pub version: Option<u32>,
    /// The error-correction level as a letter: `L`, `M`, `Q` or `H`.
    pub ecl: Option<char>,
    /// Which of the eight data masks was used.
    pub mask: Option<u8>,
    /// The symbol's side in modules, quiet zone excluded: 17 + 4 × version.
    pub side_modules: u32,
    /// Where the symbol sits in the picture, in its own pixels, clockwise from
    /// the top left: `[[x, y]; 4]`.
    pub corners: [[i32; 2]; 4],
    /// One sentence when the pattern did not decode, and nothing when it did.
    pub error: Option<String>,
}

/// What a search of one picture found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    /// Every code, in the order the detector reported them.
    pub codes: Vec<FoundCode>,
    /// True when nothing was found until the exposure was evened out — which is
    /// worth telling the person, because it is also a picture that some phones
    /// will not read.
    pub adjusted: bool,
}

/// Find every QR code in a picture, and say what each one is.
///
/// The picture is grey by the time it arrives: colour is the caller's to drop,
/// because the caller is the one that decoded the file and holds the only copy
/// of the pixels. Nothing here allocates a second copy of the image unless the
/// picture is larger than [`MAX_DECODE_SIDE`] or the second pass is needed.
pub fn read_codes(grey: &GrayImage) -> Found {
    let (working, scale_x, scale_y) = fit_for_decoding(grey);

    let codes = search(&working, scale_x, scale_y);
    if !codes.is_empty() {
        return Found {
            codes,
            adjusted: false,
        };
    }

    // Nothing at all on the raw pixels. One more look, at a picture whose light
    // has been evened out.
    let evened = evened_out(&working);
    let codes = search(&evened, scale_x, scale_y);
    let adjusted = !codes.is_empty();
    Found { codes, adjusted }
}

/// One pass of the detector over one set of pixels.
///
/// `scale_x` and `scale_y` take a corner from these pixels back to the picture
/// the caller handed in, which is the only coordinate system the interface knows
/// about.
fn search(grey: &GrayImage, scale_x: f64, scale_y: f64) -> Vec<FoundCode> {
    let (width, height) = grey.dimensions();
    if width == 0 || height == 0 {
        return Vec::new();
    }

    // `prepare_from_greyscale` rather than `prepare`: the latter takes the image
    // and binarises it in place, and this one is borrowed — the second pass
    // needs the grey pixels the first pass was given.
    let mut prepared =
        rqrr::PreparedImage::prepare_from_greyscale(width as usize, height as usize, |x, y| {
            grey.get_pixel(x as u32, y as u32).0[0]
        });

    prepared
        .detect_grids()
        .iter()
        .map(|grid| {
            let side_modules = grid.grid.size() as u32;
            let corners = scaled_corners(&grid.bounds, scale_x, scale_y, grey.dimensions());

            let mut bytes = Vec::new();
            match grid.decode_to(&mut bytes) {
                Ok(meta) => FoundCode {
                    bytes,
                    version: Some(meta.version.0 as u32),
                    ecl: Some(ecl_letter(meta.ecc_level)),
                    mask: Some(meta.mask as u8),
                    side_modules,
                    corners,
                    error: None,
                },
                Err(error) => {
                    // `decode_to` may have written part of a payload before it
                    // gave up, and half a payload is worse than none: it is
                    // dropped. The format information is asked for separately,
                    // because how the symbol was built is often readable when
                    // its data is not — and that is exactly what a person
                    // looking at a damaged code wants to be told.
                    log::debug!("a grid was found in a picture and did not decode: {error}");
                    let meta = grid.get_raw_data().ok().map(|(meta, _)| meta);
                    FoundCode {
                        bytes: Vec::new(),
                        version: meta
                            .map(|meta| meta.version.0 as u32)
                            .or_else(|| version_of(side_modules)),
                        ecl: meta.map(|meta| ecl_letter(meta.ecc_level)),
                        mask: meta.map(|meta| meta.mask as u8),
                        side_modules,
                        corners,
                        error: Some(UNREADABLE.to_string()),
                    }
                }
            }
        })
        .collect()
}

/// The error-correction level as its letter.
///
/// The numbering is the format information's own, not the letters' order
/// (ISO/IEC 18004, Table 12): the two bits are `01` for L, `00` for M, `11` for
/// Q and `10` for H, and `rqrr` reports those two bits unchanged. So 0 is M and
/// 1 is L, which looks like a transposition and is not one.
fn ecl_letter(bits: u16) -> char {
    match bits & 0b11 {
        0 => 'M',
        1 => 'L',
        2 => 'H',
        _ => 'Q',
    }
}

/// The version a symbol of this many modules a side is, when that is a size a
/// QR code comes in.
fn version_of(side_modules: u32) -> Option<u32> {
    let version = side_modules.checked_sub(17)? / 4;
    (side_modules % 4 == 1 && (1..=40).contains(&version)).then_some(version)
}

/// The picture the search runs on, and what takes its coordinates back to the
/// picture that was handed in.
///
/// Borrowed and unscaled for anything already small enough — the common case is
/// a screenshot, and a screenshot should not be resampled to be read.
fn fit_for_decoding(grey: &GrayImage) -> (Cow<'_, GrayImage>, f64, f64) {
    let (width, height) = grey.dimensions();
    let longest = width.max(height);
    if longest <= MAX_DECODE_SIDE || width == 0 || height == 0 {
        return (Cow::Borrowed(grey), 1.0, 1.0);
    }

    let ratio = f64::from(MAX_DECODE_SIDE) / f64::from(longest);
    let fitted = |side: u32| ((f64::from(side) * ratio).round() as u32).max(1);
    let (fitted_width, fitted_height) = (fitted(width), fitted(height));

    // Triangle, not Lanczos: a code is hard edges, and a filter that overshoots
    // them rings a bright halo along every module. Averaging is what a camera
    // does when it looks at the same code from further away.
    let smaller = image::imageops::resize(
        grey,
        fitted_width,
        fitted_height,
        image::imageops::FilterType::Triangle,
    );

    (
        Cow::Owned(smaller),
        f64::from(width) / f64::from(fitted_width),
        f64::from(height) / f64::from(fitted_height),
    )
}

/// The detector's corners, in the picture the caller handed in.
///
/// Clamped into the picture: `rqrr` measures the symbol's outline including a
/// module of quiet zone, so a code printed against the edge of a photograph can
/// bound at minus two pixels — and a corner outside the picture is a polygon the
/// screen draws outside the image it is over.
fn scaled_corners(
    bounds: &[rqrr::Point; 4],
    scale_x: f64,
    scale_y: f64,
    (width, height): (u32, u32),
) -> [[i32; 2]; 4] {
    // The picture the corners are scaled back *to*, which is the one the caller
    // holds: these dimensions are the working picture's, so they are grown by
    // the same scale rather than used as they are.
    let last = |side: u32, scale: f64| ((f64::from(side) * scale).round() as i32 - 1).max(0);
    let (last_x, last_y) = (last(width, scale_x), last(height, scale_y));

    let mut corners = [[0; 2]; 4];
    for (corner, point) in corners.iter_mut().zip(bounds.iter()) {
        let x = (f64::from(point.x) * scale_x).round() as i32;
        let y = (f64::from(point.y) * scale_y).round() as i32;
        *corner = [x.clamp(0, last_x), y.clamp(0, last_y)];
    }
    corners
}

/// The picture with its light evened out: black where a pixel sits under its own
/// neighbourhood, white where it does not.
///
/// Bradley's method, over an integral image, so the cost is one pass to sum and
/// one to threshold whatever the window is. All of it in integers: a threshold
/// that depends on rounding is a threshold that behaves differently on two
/// machines.
fn evened_out(grey: &GrayImage) -> GrayImage {
    let (width, height) = grey.dimensions();
    let mut evened = GrayImage::new(width, height);
    if width == 0 || height == 0 {
        return evened;
    }

    // One row and one column of zeros on top, so that the four lookups below
    // need no special case at the edges.
    let stride = width as usize + 1;
    let mut sums = vec![0u64; stride * (height as usize + 1)];
    for y in 0..height {
        let mut row = 0u64;
        for x in 0..width {
            row += u64::from(grey.get_pixel(x, y).0[0]);
            sums[(y as usize + 1) * stride + x as usize + 1] =
                sums[y as usize * stride + x as usize + 1] + row;
        }
    }

    let window = (width.min(height) / WINDOW_DIVISOR).max(1);
    let reach = (window / 2).max(1);
    for y in 0..height {
        let (top, bottom) = (y.saturating_sub(reach), (y + reach + 1).min(height));
        for x in 0..width {
            let (left, right) = (x.saturating_sub(reach), (x + reach + 1).min(width));
            let at = |x: u32, y: u32| sums[y as usize * stride + x as usize];
            let total = at(right, bottom) + at(left, top) - at(right, top) - at(left, bottom);
            let count = u64::from(right - left) * u64::from(bottom - top);

            let value = u64::from(grey.get_pixel(x, y).0[0]);
            let dark = value * count * 100 < total * (100 - DARKER_BY_PER_CENT);
            evened.put_pixel(x, y, Luma([if dark { 0 } else { 255 }]));
        }
    }

    evened
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::{hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;

    /// The fixture, rasterised, as grey pixels.
    fn hello_world(pixel_size: u32) -> GrayImage {
        let rendered = render_png(hello_world_svg().as_bytes(), pixel_size).expect("render");
        image::load_from_memory(&rendered.png)
            .expect("read back")
            .to_luma8()
    }

    /// A grey picture of `width` × `height` from a function of its coordinates.
    fn painted(width: u32, height: u32, paint: impl Fn(u32, u32) -> u8) -> GrayImage {
        GrayImage::from_fn(width, height, |x, y| Luma([paint(x, y)]))
    }

    /// The one code in a picture, which the test expects to be there.
    fn only_code(found: &Found) -> &FoundCode {
        assert_eq!(found.codes.len(), 1, "one code: {:?}", found.codes);
        &found.codes[0]
    }

    #[test]
    fn a_rendered_code_reads_back_with_what_it_is() {
        let found = read_codes(&hello_world(256));

        let code = only_code(&found);
        assert!(!found.adjusted, "a clean render needs no second pass");
        assert_eq!(code.bytes, HELLO_WORLD.as_bytes());
        assert_eq!(code.version, Some(1));
        assert_eq!(code.ecl, Some('Q'), "the fixture is a quartile symbol");
        assert_eq!(code.mask, Some(0));
        assert_eq!(code.side_modules, 21, "17 + 4 × 1");
        assert_eq!(code.error, None);
    }

    /// The fixture is version 1 at quartile — 21 modules a side — and the
    /// numbers above are not a restatement of the letters' order: if the level
    /// were read as `0 = L, 1 = M, 2 = Q, 3 = H`, this same symbol would come
    /// back as `H`. The whole table is proved below.
    #[test]
    fn every_corner_is_inside_the_picture() {
        let picture = hello_world(256);
        let found = read_codes(&picture);

        for [x, y] in only_code(&found).corners {
            assert!(
                (0..picture.width() as i32).contains(&x)
                    && (0..picture.height() as i32).contains(&y),
                "a corner at {x},{y} is outside a {}×{} picture",
                picture.width(),
                picture.height()
            );
        }
    }

    /// The four error-correction levels, written into the symbol as the standard
    /// says they are written, and read back as their letters.
    ///
    /// There is no encoder in this host (ADR-011), so the levels cannot be
    /// generated — but they can be *stated*: the format information is fifteen
    /// bits in two known places, five of data (two of level, three of mask) and
    /// ten of BCH, masked with `0x5412`. The fixture's own modules are taken
    /// from the detector, the format is rewritten for each level, and the
    /// symbol is handed back to the detector. The payload no longer decodes —
    /// the blocks belong to the level it really is — so the format is read on
    /// its own, which is the thing under test.
    ///
    /// The authority for the bit patterns is ISO/IEC 18004, Table 12.
    #[test]
    fn the_four_error_correction_levels_are_read_as_their_letters() {
        for (bits, letter) in [(0b01, 'L'), (0b00, 'M'), (0b11, 'Q'), (0b10, 'H')] {
            for mask in 0..8u16 {
                let modules = with_format(&hello_world_modules(), bits, mask);
                let meta = format_of(&modules);

                assert_eq!(
                    ecl_letter(meta.ecc_level),
                    letter,
                    "level bits {bits:02b} with mask {mask} must read as {letter}"
                );
                assert_eq!(meta.mask, mask, "the mask goes back in beside the level");
                assert_eq!(meta.version.0, 1);
            }
        }
    }

    /// The fixture's modules, as the detector sampled them out of the render:
    /// `true` is a dark module. Read back rather than written down, so this test
    /// carries no second copy of the fixture.
    fn hello_world_modules() -> Vec<Vec<bool>> {
        let picture = hello_world(256);
        let mut prepared = rqrr::PreparedImage::prepare(picture);
        let grids = prepared.detect_grids();
        let grid = &grids.first().expect("the fixture is detectable").grid;

        let side = grid.size();
        (0..side)
            .map(|y| (0..side).map(|x| grid.bit(y, x)).collect())
            .collect()
    }

    /// The same modules with the format information rewritten, in both of the
    /// two places a symbol carries it.
    fn with_format(modules: &[Vec<bool>], ecl: u16, mask: u16) -> Vec<Vec<bool>> {
        let mut patched = modules.to_vec();
        let side = patched.len();
        let format = format_information(ecl, mask);
        let bit = |index: usize| format & (1 << index) != 0;

        // The copy around the top-left finder, in the order the standard lays
        // it out: down column 8, then left along row 8, skipping the timing
        // module in each.
        const XS: [usize; 15] = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
        const YS: [usize; 15] = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
        for index in 0..15 {
            patched[YS[index]][XS[index]] = bit(index);
        }

        // The second copy: seven bits up the left edge of the bottom-left
        // finder, eight along the right of the top-right one.
        for index in 0..7 {
            patched[side - 1 - index][8] = bit(14 - index);
        }
        for index in 0..8 {
            patched[8][side - 8 + index] = bit(7 - index);
        }

        patched
    }

    /// The fifteen bits a symbol carries for a level and a mask: five of data,
    /// ten of BCH(15, 5) remainder over the generator `0b10100110111`, the whole
    /// word masked with `0x5412` so that a symbol of all-zero format is not a
    /// blank field (ISO/IEC 18004, §8.9).
    fn format_information(ecl: u16, mask: u16) -> u16 {
        let data = (ecl << 3) | mask;
        let mut remainder = data << 10;
        for shift in (10..15).rev() {
            if remainder & (1 << shift) != 0 {
                remainder ^= 0b101_0011_0111 << (shift - 10);
            }
        }
        ((data << 10) | remainder) ^ 0x5412
    }

    /// Modules drawn into a picture, with a quiet zone and eight pixels a
    /// module: the detector is always asked to find a code in a picture, which
    /// is what it is asked everywhere else in this module.
    fn drawn(modules: &[Vec<bool>]) -> GrayImage {
        const QUIET: u32 = 4;
        const SCALE: u32 = 8;
        let side = modules.len() as u32;
        let pixels = (side + QUIET * 2) * SCALE;

        painted(pixels, pixels, |x, y| {
            let module = |value: u32| (value / SCALE).checked_sub(QUIET);
            let dark = match (module(x), module(y)) {
                (Some(x), Some(y)) => x < side && y < side && modules[y as usize][x as usize],
                _ => false,
            };
            if dark {
                0
            } else {
                255
            }
        })
    }

    /// What the decoder reads as a symbol's format, given its modules.
    fn format_of(modules: &[Vec<bool>]) -> rqrr::MetaData {
        let mut prepared = rqrr::PreparedImage::prepare(drawn(modules));
        let grids = prepared.detect_grids();
        let grid = grids.first().expect("a patched symbol is still a symbol");
        grid.get_raw_data().expect("the format reads").0
    }

    #[test]
    fn a_pattern_that_will_not_decode_is_reported_for_what_can_be_read_of_it() {
        let mut modules = hello_world_modules();
        // Every module of the data region replaced by a chequerboard, which is
        // far beyond what quartile correction recovers. The finders, the timing
        // patterns and both copies of the format information are untouched: this
        // is a code a camera would see and a decoder would give up on.
        for (y, row) in modules.iter_mut().enumerate().skip(9) {
            for (x, module) in row.iter_mut().enumerate().skip(9) {
                *module = (x + y) % 2 == 0;
            }
        }

        let found = read_codes(&drawn(&modules));

        let code = only_code(&found);
        assert_eq!(code.error.as_deref(), Some(UNREADABLE));
        assert!(code.bytes.is_empty(), "half a payload is worse than none");
        assert_eq!(code.side_modules, 21);
        assert_eq!(code.version, Some(1), "the format still reads");
        assert_eq!(code.ecl, Some('Q'));
        assert!(!found.adjusted, "a grid was found, so nothing was adjusted");
    }

    #[test]
    fn a_code_photographed_at_an_angle_still_reads() {
        let turned = rotated(&hello_world(512), 15.0);

        let found = read_codes(&turned);

        assert_eq!(only_code(&found).bytes, HELLO_WORLD.as_bytes());
    }

    /// The picture turned by `degrees` about its centre, on white, by sampling
    /// the source at each destination pixel.
    ///
    /// Written here rather than taken from a crate: `image` turns pictures by
    /// quarters only, and a code photographed by a person is never square to the
    /// frame. Nearest-neighbour on purpose — it is the unkind choice, and a
    /// smoothed rotation would flatter the decoder.
    fn rotated(source: &GrayImage, degrees: f64) -> GrayImage {
        let (width, height) = source.dimensions();
        let (sin, cos) = degrees.to_radians().sin_cos();
        let (centre_x, centre_y) = (f64::from(width) / 2.0, f64::from(height) / 2.0);

        painted(width, height, |x, y| {
            let (dx, dy) = (f64::from(x) - centre_x, f64::from(y) - centre_y);
            let from_x = (dx * cos + dy * sin + centre_x).round();
            let from_y = (-dx * sin + dy * cos + centre_y).round();
            if (0.0..f64::from(width)).contains(&from_x)
                && (0.0..f64::from(height)).contains(&from_y)
            {
                source.get_pixel(from_x as u32, from_y as u32).0[0]
            } else {
                255
            }
        })
    }

    #[test]
    fn a_code_half_in_shadow_reads_only_after_the_exposure_is_adjusted() {
        let shadowed = shadowed(&hello_world(320));

        assert!(
            search(&shadowed, 1.0, 1.0).is_empty(),
            "the detector's own pass cannot cross the shadow's edge"
        );

        let found = read_codes(&shadowed);

        assert!(found.adjusted, "and the second pass is what rescues it");
        assert_eq!(only_code(&found).bytes, HELLO_WORLD.as_bytes());
    }

    /// What being told about the second pass is worth: a picture that is merely
    /// dark and low in contrast — the whole thing squeezed to a third of its
    /// range and lifted towards grey — needs no second pass at all, because the
    /// detector thresholds each row against its own running average rather than
    /// against a fixed level. Brightness is not what defeats it; *uneven*
    /// brightness is, which is what the test above photographs.
    #[test]
    fn a_dark_picture_that_is_dark_all_over_needs_no_second_pass() {
        let dim = dimmed(&hello_world(320));

        let found = read_codes(&dim);

        assert!(!found.adjusted);
        assert_eq!(only_code(&found).bytes, HELLO_WORLD.as_bytes());
    }

    /// A sheet with a hard-edged shadow lying across it: three fifths of the
    /// picture at a fifth of the light, the rest as it was. It is what a hand or
    /// a window frame does to a printed code on a desk, and it is the case a
    /// per-row threshold cannot follow — the average lags the edge by most of
    /// its window.
    fn shadowed(source: &GrayImage) -> GrayImage {
        let (width, height) = source.dimensions();
        painted(width, height, |x, y| {
            let light = if x < width * 6 / 10 { 0.22 } else { 1.0 };
            (f64::from(source.get_pixel(x, y).0[0]) * light).round() as u8
        })
    }

    /// A picture taken in bad light: the contrast squeezed to a third and the
    /// whole thing lifted towards grey.
    fn dimmed(source: &GrayImage) -> GrayImage {
        let (width, height) = source.dimensions();
        painted(width, height, |x, y| {
            (f64::from(source.get_pixel(x, y).0[0]) * 0.3 + 100.0).round() as u8
        })
    }

    #[test]
    fn a_picture_of_nothing_holds_no_code_and_no_second_pass_invents_one() {
        // Deterministic noise: a hash of the coordinates, so the picture is the
        // same picture on every machine and on every run.
        let noise = painted(400, 400, |x, y| {
            let mixed = u64::from(x).wrapping_mul(0x9E37_79B9).wrapping_add(
                u64::from(y).wrapping_mul(0x85EB_CA6B) ^ u64::from(x ^ y).wrapping_mul(0xC2B2_AE35),
            );
            (mixed >> 13) as u8
        });

        let found = read_codes(&noise);

        assert!(found.codes.is_empty(), "{:?}", found.codes);
        assert!(!found.adjusted, "nothing was found, so nothing was rescued");
    }

    #[test]
    fn two_codes_in_one_picture_are_two_readings() {
        let one = hello_world(256);
        let mut both = GrayImage::from_pixel(one.width() * 2 + 40, one.height() + 40, Luma([255]));
        for (at_x, at_y) in [(10, 20), (one.width() + 30, 20)] {
            image::imageops::replace(&mut both, &one, i64::from(at_x), i64::from(at_y));
        }

        let found = read_codes(&both);

        assert_eq!(found.codes.len(), 2, "{:?}", found.codes);
        for code in &found.codes {
            assert_eq!(code.bytes, HELLO_WORLD.as_bytes());
            assert_eq!(code.version, Some(1));
        }
        let [left, right] = [&found.codes[0], &found.codes[1]];
        assert_ne!(
            left.corners, right.corners,
            "two codes are in two places on the picture"
        );
    }

    #[test]
    fn a_picture_larger_than_the_cap_is_read_and_its_corners_are_the_picture_s_own() {
        let big = hello_world(2400);

        let found = read_codes(&big);

        let code = only_code(&found);
        assert_eq!(code.bytes, HELLO_WORLD.as_bytes());
        // The search ran on 2048 pixels; the corners come back in the 2400 the
        // caller holds, so the symbol still fills the frame it was drawn in.
        let width = big.width() as i32;
        let furthest = code.corners.iter().map(|[x, _]| *x).max().expect("corners");
        assert!(
            furthest > width - width / 8,
            "a corner at {furthest} is not near the right edge of {width}"
        );
        for [x, y] in code.corners {
            assert!((0..width).contains(&x) && (0..big.height() as i32).contains(&y));
        }
    }

    #[test]
    fn an_empty_picture_is_an_answer_rather_than_a_panic() {
        let found = read_codes(&GrayImage::new(0, 0));

        assert!(found.codes.is_empty());
        assert!(!found.adjusted);
    }

    #[test]
    fn a_size_that_is_not_a_symbol_s_has_no_version() {
        assert_eq!(version_of(21), Some(1));
        assert_eq!(version_of(177), Some(40));
        assert_eq!(version_of(22), None);
        assert_eq!(version_of(17), None);
        assert_eq!(version_of(181), None);
        assert_eq!(version_of(0), None);
    }
}
