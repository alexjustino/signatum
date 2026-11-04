//! Damage on purpose: paint cells over the print and ask the decoder again.
//!
//! The scan margin asks how the whole artefact degrades — shrunk, blurred,
//! inked. This asks a narrower question, and one the margin cannot: what
//! happens when **one place** is damaged. Reed–Solomon corrects each block on
//! its own, and a logo has already spent part of every block it sits on, so a
//! code has a weakest place; the domain finds it by arithmetic (`resilience.ts`)
//! and this module is how a decoder gets a say past what the arithmetic
//! guarantees (ADR-037).
//!
//! A cell is one module of the symbol, in **symbol** coordinates — the quiet
//! zone excluded, as the domain counts them — painted ink or bare paper. It is
//! painted on top of everything, the logo included: a smudge does not know
//! where the logo is.
//!
//! Pure, as the rest of `imaging` is: a pixmap in, a report out. Nothing is
//! recorded — this is a question about a picture somebody has put their thumb
//! on, not evidence about an artefact that leaves.
//!
//! # Changelog
//!
//! - P9: `DamageCell`, `DamageReport`, the bounds a request is held to (the
//!   quiet zone, the cells, and a module count that is the drawing's own), the
//!   painting itself, and the read-back through the gate's own decoder.

use resvg::tiny_skia;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::imaging::decode::decode_png;
use crate::imaging::render::{encode, Raster};
use crate::imaging::verify::{decoder, REASON_DIFFERENT, REASON_NO_CODE};

/// One damaged module, in symbol coordinates: `(0, 0)` is the top-left module
/// of the symbol itself, and the quiet zone is negative or past the last
/// module. `dark` is ink; otherwise it is bare paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct DamageCell {
    /// Column, in modules from the symbol's left edge.
    pub x: i32,
    /// Row, in modules from the symbol's top edge.
    pub y: i32,
    /// Ink when true, bare paper when false.
    pub dark: bool,
}

/// What the gate's decoder made of the damaged picture.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DamageReport {
    /// True only when the decoded bytes were the payload bytes.
    pub reads: bool,
    /// One sentence when it did not read — the gate's own — and `None` when it
    /// did.
    pub reason: Option<String>,
    /// The decoder that was asked, name and version.
    pub decoder: String,
}

/// Refuse a quiet zone or a set of cells that cannot be painted on a code
/// `modules` wide, quiet zone included.
///
/// `modules` itself is the scan margin's to check (`margin::check_modules`);
/// this is everything the damage adds to it. The quiet zone has to leave a
/// symbol between its two sides; every cell has to lie on the scene, quiet zone
/// included — damage there is real damage, the kind that hides a finder's
/// edge — and there can be no more cells than the scene has modules, which is
/// generous (duplicates are harmless) and keeps a request from being a way to
/// make the host paint forever.
///
/// # Errors
///
/// [`Error::InvalidInput`], naming which of the three was wrong.
pub fn check_cells(modules: u32, quiet_zone: u32, cells: &[DamageCell]) -> Result<()> {
    if quiet_zone >= modules / 2 {
        return Err(Error::InvalidInput(format!(
            "a quiet zone of {quiet_zone} leaves no symbol in a code {modules} modules wide"
        )));
    }
    let most = u64::from(modules) * u64::from(modules);
    if cells.len() as u64 > most {
        return Err(Error::InvalidInput(format!(
            "a code {modules} modules wide has {most} modules to damage, and no more"
        )));
    }
    // Both are below 210 by now, so the arithmetic fits an `i32` with room to spare.
    let low = -(quiet_zone as i32);
    let high = (modules - quiet_zone) as i32;
    if let Some(cell) = cells
        .iter()
        .find(|cell| !(low..high).contains(&cell.x) || !(low..high).contains(&cell.y))
    {
        return Err(Error::InvalidInput(format!(
            "the damaged module at ({}, {}) is off the code, which runs from {low} to {} \
             each way, quiet zone included",
            cell.x,
            cell.y,
            high - 1
        )));
    }
    Ok(())
}

/// Refuse a module count that is not the drawing's own side.
///
/// The cells are painted at `pixmap width / modules` pixels a module, which is
/// where the scene's modules are only when its `viewBox` is `modules` units
/// wide — the domain draws it as `0 0 side side`. A count that disagrees would
/// paint every cell between modules, and the decoder would be asked about
/// damage nobody drew; that is refused rather than measured.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the drawing's own width, in its units, is not
/// `modules` on both axes.
pub fn check_grid(raster: &Raster, modules: u32) -> Result<()> {
    let units = |pixels: u32, scale: f32| pixels as f32 / scale;
    let agrees = |found: f32| (found - modules as f32).abs() < 0.01;
    if agrees(units(raster.pixmap.width(), raster.scale_x))
        && agrees(units(raster.pixmap.height(), raster.scale_y))
    {
        Ok(())
    } else {
        Err(Error::InvalidInput(format!(
            "the drawing is not {modules} modules wide, so the damage cannot be placed on it"
        )))
    }
}

/// The pixels one module covers along one axis: those whose centre lies inside
/// it, `module_px` being the float width of a module.
///
/// The centre rule is what a renderer does with a shape it does not smooth —
/// the scene draws square modules with `crispEdges` — so a painted cell lands
/// on the pixels the module itself landed on, at any size, whole or not.
fn pixels_of(module: u32, module_px: f32, side: u32) -> std::ops::Range<u32> {
    let edge = |at: u32| {
        let pixel = (at as f32 * module_px - 0.5).ceil();
        (pixel.max(0.0) as u32).min(side)
    };
    edge(module)..edge(module + 1)
}

/// Paint every cell as an opaque square on the pixmap, at the scene's own
/// module grid: scene module `(x + quiet_zone, y + quiet_zone)`, a module being
/// `pixmap width / modules` pixels as a float — the mapping the `viewBox`
/// `0 0 modules modules` gives the scene's own modules.
///
/// Black for ink, white for paper, written straight over whatever is there.
/// The cells are expected to have passed [`check_cells`]; one that lies off the
/// scene anyway is skipped rather than wrapped onto a module nobody named.
pub fn paint_cells(
    pixmap: &mut tiny_skia::Pixmap,
    modules: u32,
    quiet_zone: u32,
    cells: &[DamageCell],
) {
    if modules == 0 {
        return;
    }
    let (width, height) = (pixmap.width(), pixmap.height());
    let module_x = width as f32 / modules as f32;
    let module_y = height as f32 / modules as f32;
    let ink = tiny_skia::ColorU8::from_rgba(0, 0, 0, 255).premultiply();
    let paper = tiny_skia::ColorU8::from_rgba(255, 255, 255, 255).premultiply();

    let scene = |at: i32| -> Option<u32> {
        let module = i64::from(at) + i64::from(quiet_zone);
        u32::try_from(module)
            .ok()
            .filter(|module| *module < modules)
    };

    let pixels = pixmap.pixels_mut();
    for cell in cells {
        let (Some(column), Some(row)) = (scene(cell.x), scene(cell.y)) else {
            continue;
        };
        let colour = if cell.dark { ink } else { paper };
        let across = pixels_of(column, module_x, width);
        for y in pixels_of(row, module_y, height) {
            let line = (y * width) as usize;
            pixels[line + across.start as usize..line + across.end as usize].fill(colour);
        }
    }
}

/// Paint the cells, encode the pixels as the gate encodes them, and ask the
/// gate's decoder whether the payload still comes back, byte for byte.
///
/// The pixmap is the composed artefact — rendered and with the logo on it —
/// and is changed in place: the caller made it for this question and has no
/// other use for it.
///
/// # Errors
///
/// [`Error::Render`] when the painted pixels cannot be encoded or read back,
/// which would be a defect: they are this host's own. A code that no longer
/// reads is not an error — it is `reads: false` with the gate's sentence.
pub fn read_damaged(
    pixmap: &mut tiny_skia::Pixmap,
    payload: &[u8],
    modules: u32,
    quiet_zone: u32,
    cells: &[DamageCell],
) -> Result<DamageReport> {
    paint_cells(pixmap, modules, quiet_zone, cells);
    let painted = encode(pixmap, None)?;
    let decoded = decode_png(&painted.png)?;

    let reads = decoded.as_deref() == Some(payload);
    let reason = match (&decoded, reads) {
        (_, true) => None,
        (None, _) => Some(REASON_NO_CODE.to_string()),
        (Some(_), _) => Some(REASON_DIFFERENT.to_string()),
    };

    Ok(DamageReport {
        reads,
        reason,
        decoder: decoder(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A white square of `side` pixels.
    fn paper(side: u32) -> tiny_skia::Pixmap {
        let mut pixmap = tiny_skia::Pixmap::new(side, side).expect("allocate");
        pixmap.fill(tiny_skia::Color::WHITE);
        pixmap
    }

    /// The grey of one pixel, read back from the premultiplied buffer.
    fn grey_at(pixmap: &tiny_skia::Pixmap, x: u32, y: u32) -> u8 {
        pixmap.pixel(x, y).expect("inside").demultiply().red()
    }

    /// 290 pixels over 29 modules is ten a module. Symbol cell `(2, 3)` with a
    /// quiet zone of 4 is scene module `(6, 7)`: columns 60..70, rows 70..80,
    /// and not one pixel either side of it.
    #[test]
    fn a_dark_cell_lands_on_its_module_and_nowhere_else() {
        let mut pixmap = paper(290);

        paint_cells(
            &mut pixmap,
            29,
            4,
            &[DamageCell {
                x: 2,
                y: 3,
                dark: true,
            }],
        );

        for y in 0..290 {
            for x in 0..290 {
                let inked = (60..70).contains(&x) && (70..80).contains(&y);
                assert_eq!(
                    grey_at(&pixmap, x, y),
                    if inked { 0 } else { 255 },
                    "({x}, {y})"
                );
            }
        }
    }

    /// Paper is painted as surely as ink, and a cell in the quiet zone is a
    /// cell like any other: `(-4, -4)` is the scene's first module.
    #[test]
    fn a_paper_cell_in_the_quiet_zone_whitens_the_corner_module() {
        let mut pixmap = tiny_skia::Pixmap::new(290, 290).expect("allocate");
        pixmap.fill(tiny_skia::Color::BLACK);

        paint_cells(
            &mut pixmap,
            29,
            4,
            &[DamageCell {
                x: -4,
                y: -4,
                dark: false,
            }],
        );

        assert_eq!(grey_at(&pixmap, 0, 0), 255);
        assert_eq!(grey_at(&pixmap, 9, 9), 255);
        assert_eq!(grey_at(&pixmap, 10, 9), 0);
        assert_eq!(grey_at(&pixmap, 9, 10), 0);
        assert_eq!(pixmap.pixel(5, 5).expect("inside").alpha(), 255, "opaque");
    }

    /// At a size that is not a whole number of pixels a module, neighbouring
    /// cells still tile the row exactly: no pixel is skipped and none is
    /// painted twice, which is what the centre rule buys.
    #[test]
    fn modules_of_a_fractional_width_tile_without_gaps_or_overlaps() {
        let (side, modules) = (100u32, 29u32);
        let module_px = side as f32 / modules as f32;
        let mut next = 0;
        for module in 0..modules {
            let covered = pixels_of(module, module_px, side);
            assert_eq!(covered.start, next, "module {module}");
            next = covered.end;
        }
        assert_eq!(next, side);
    }

    #[test]
    fn a_quiet_zone_that_leaves_no_symbol_is_refused() {
        assert!(check_cells(29, 4, &[]).is_ok());
        for quiet_zone in [14, 15, 29, u32::MAX] {
            let refused = check_cells(29, quiet_zone, &[]).expect_err("refused");
            assert!(matches!(refused, Error::InvalidInput(_)), "{quiet_zone}");
        }
    }

    #[test]
    fn a_cell_off_the_code_is_refused_by_coordinate() {
        let cell = |x, y| DamageCell { x, y, dark: true };
        assert!(check_cells(29, 4, &[cell(-4, -4), cell(24, 24), cell(0, 20)]).is_ok());

        for (x, y) in [(-5, 0), (0, -5), (25, 0), (0, 25), (i32::MIN, i32::MAX)] {
            let refused = check_cells(29, 4, &[cell(x, y)]).expect_err("refused");
            assert!(
                refused.to_string().contains(&format!("({x}, {y})")),
                "the refusal names the cell: {refused}"
            );
        }
    }
}
