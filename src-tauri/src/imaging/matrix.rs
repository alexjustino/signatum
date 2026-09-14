//! A QR symbol as modules, and the pixels a decoder is given to read them in.
//!
//! The host has no encoder and must not grow one (ADR-011): the modules are
//! drawn in the domain, in TypeScript, and arrive here already decided. What
//! this module does is the opposite of clever — it turns a packed bit string
//! back into one boolean per module, and paints those modules as squares of
//! grey pixels with the quiet zone a QR code needs around it (spec §2.4).
//!
//! It exists so that a corpus of symbols can be handed to the decoder without
//! going through SVG at all: the scan gate proper renders a drawing, but the
//! proof that the *matrix* is correct should not depend on the renderer. Pure,
//! no Tauri types, no filesystem.

use image::{GrayImage, Luma};

use crate::error::{Error, Result};

/// A dark module, as the decoder sees it.
pub const DARK: Luma<u8> = Luma([0]);

/// A light module, and the quiet zone.
pub const LIGHT: Luma<u8> = Luma([255]);

/// How many bytes `size` × `size` modules occupy, packed 8 bits per byte.
fn packed_len(size: usize) -> usize {
    size.saturating_mul(size).div_ceil(8)
}

/// Unpack `size` × `size` module bits into one boolean per module.
///
/// The bits are row-major — row 0 first, within a row column 0 first — packed
/// eight to a byte, most significant bit first, and zero-padded to a whole byte
/// at the end. `true` is a dark module.
///
/// # Errors
///
/// [`Error::InvalidInput`] when `size` is zero, or when `packed` is not exactly
/// as long as `size` × `size` bits require. A matrix of the wrong length is not
/// a matrix that can be partly read: it is a different symbol.
pub fn unpack_modules(size: usize, packed: &[u8]) -> Result<Vec<bool>> {
    if size == 0 {
        return Err(Error::InvalidInput(
            "a symbol of no modules cannot be read".to_string(),
        ));
    }

    let expected = packed_len(size);
    if packed.len() != expected {
        return Err(Error::InvalidInput(format!(
            "a {size}×{size} symbol needs {expected} packed bytes, not {}",
            packed.len()
        )));
    }

    let mut modules = Vec::with_capacity(size * size);
    for index in 0..size * size {
        let byte = packed[index / 8];
        modules.push((byte >> (7 - index % 8)) & 1 == 1);
    }

    Ok(modules)
}

/// Paint `modules` as a grey image: `px_per_module` pixels a side for each
/// module, with `quiet_zone` modules of light margin all around.
///
/// Dark modules are 0, everything else — light modules and the quiet zone —
/// is 255. Nothing is anti-aliased, scaled or softened: every pixel is one of
/// two values, which is the cleanest input a decoder can be given and therefore
/// the fairest place to blame a disagreement on the matrix rather than on the
/// raster.
///
/// # Panics
///
/// When `modules` is not `size` × `size` long, or when the resulting image
/// would not fit in a `u32` a side. Both are programming errors here: the
/// caller pairs this with [`unpack_modules`], which has already checked.
pub fn rasterise_modules(
    size: usize,
    modules: &[bool],
    px_per_module: u32,
    quiet_zone: u32,
) -> GrayImage {
    assert_eq!(
        modules.len(),
        size * size,
        "the modules handed in are not a {size}×{size} symbol"
    );
    assert!(px_per_module > 0, "a module needs at least one pixel");

    let size_u32 = u32::try_from(size).expect("a symbol wider than a u32 is not a QR code");
    let side = (size_u32 + quiet_zone * 2)
        .checked_mul(px_per_module)
        .expect("the image would be wider than a u32");

    let mut image = GrayImage::from_pixel(side, side, LIGHT);

    for y in 0..size {
        for x in 0..size {
            if !modules[y * size + x] {
                continue;
            }

            let left = (x as u32 + quiet_zone) * px_per_module;
            let top = (y as u32 + quiet_zone) * px_per_module;
            for py in top..top + px_per_module {
                for px in left..left + px_per_module {
                    image.put_pixel(px, py, DARK);
                }
            }
        }
    }

    image
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hand-made 21×21 pattern — the size of a version-1 symbol — with no
    /// symmetry a packing bug could hide in.
    fn pattern() -> Vec<bool> {
        (0..21 * 21).map(|i| (i * 7 + i / 21) % 5 == 0).collect()
    }

    fn pack(modules: &[bool]) -> Vec<u8> {
        let mut packed = vec![0u8; modules.len().div_ceil(8)];
        for (index, &dark) in modules.iter().enumerate() {
            if dark {
                packed[index / 8] |= 1 << (7 - index % 8);
            }
        }
        packed
    }

    #[test]
    fn a_hand_made_symbol_survives_packing_and_unpacking() {
        let modules = pattern();
        let packed = pack(&modules);

        // 21 × 21 = 441 bits: 56 bytes, the last one seven eighths used.
        assert_eq!(packed.len(), 56);
        assert_eq!(unpack_modules(21, &packed).expect("unpack"), modules);
    }

    #[test]
    fn the_first_byte_is_read_most_significant_bit_first() {
        // 0b1000_0000 in the first byte is the module at row 0, column 0.
        let mut packed = vec![0u8; 56];
        packed[0] = 0b1000_0001;

        let modules = unpack_modules(21, &packed).expect("unpack");

        assert!(modules[0], "the top bit is row 0, column 0");
        assert!(!modules[1]);
        assert!(modules[7], "the bottom bit of the first byte is column 7");
    }

    #[test]
    fn a_length_that_does_not_match_the_size_is_an_error() {
        assert!(unpack_modules(21, &[0u8; 55]).is_err());
        assert!(unpack_modules(21, &[0u8; 57]).is_err());
        assert!(unpack_modules(0, &[]).is_err());
    }

    #[test]
    fn modules_become_squares_inside_a_quiet_zone() {
        let mut modules = vec![false; 21 * 21];
        modules[0] = true;

        let image = rasterise_modules(21, &modules, 3, 4);

        // (21 + 4 + 4) × 3 pixels a side.
        assert_eq!(image.dimensions(), (87, 87));
        // The quiet zone is light all the way to the first module.
        assert_eq!(*image.get_pixel(11, 11), LIGHT);
        // The module at row 0, column 0 is a 3 × 3 square of dark.
        assert_eq!(*image.get_pixel(12, 12), DARK);
        assert_eq!(*image.get_pixel(14, 14), DARK);
        // And nothing beyond it.
        assert_eq!(*image.get_pixel(15, 14), LIGHT);
        assert_eq!(*image.get_pixel(14, 15), LIGHT);
    }

    #[test]
    fn an_empty_symbol_is_all_light() {
        let image = rasterise_modules(21, &vec![false; 21 * 21], 2, 1);

        assert_eq!(image.dimensions(), (46, 46));
        assert!(image.pixels().all(|pixel| *pixel == LIGHT));
    }
}
