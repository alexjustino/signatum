//! The commands the Create screen calls: prove a code, and get one out.
//!
//! Every one of them does the same thing first — render the drawing, decode the
//! pixels, compare byte for byte — and records what happened. The difference is
//! what follows: `verify_code` returns the verdict, the exports write a file or
//! reach the clipboard, and only ever on the strength of a verification of the
//! artefact that leaves (ADR-010). `scan_margin` asks a different question
//! altogether and answers it without writing anything down.
//!
//! # Changelog of this boundary
//!
//! - F0: `verify_code` and `export_png`, the `verifications` record, and the
//!   refusal that keeps an unreadable code off the disk.
//! - F4: both commands take an optional `logo` — an identifier and a box in the
//!   scene's own units. The host draws it onto the pixels before they are
//!   encoded, so the artefact that was decoded is the artefact that carries it.
//! - F7: the printed size is an input. `export_png` takes a `dpi` and writes it
//!   into the file; `export_svg`, `export_pdf` and `copy_png` join it, each
//!   verifying exactly as the PNG does and each recording what it was
//!   (`format`, `dpi` — migration 003). `scan_margin` reports how much the
//!   artefact survives, and never blocks anything.

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::logos;
use crate::db::verifications::{self, VerificationRow};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::export::{pdf, svg as svg_file};
use crate::imaging::compose::LogoBox;
use crate::imaging::logo::NormalisedLogo;
use crate::imaging::margin::{self, ScanMargin};
use crate::imaging::render::{MAX_PIXEL_SIZE, MAX_SVG_BYTES, MIN_PIXEL_SIZE};
use crate::imaging::verify::{decoder, verify, VerificationReport};
use crate::os::clipboard;

/// The most a QR code can carry in this product. The standard's own ceiling is
/// near this; anything approaching it stops being a code a phone reads across a
/// room, which is the only kind worth making.
pub const MAX_PAYLOAD_BYTES: usize = 4096;

/// The resolutions this host will write into a file, in dots per inch.
///
/// Deliberately wider than the list a person is offered: which resolutions make
/// sense is the domain's judgement (`DPI_CHOICES` in `size.ts`), and duplicating
/// that list here would make it two lists. What the host refuses is the absurd —
/// a resolution of zero is not a resolution, and one of a million is a number
/// somebody typed into a request by hand.
pub const MIN_DPI: u32 = 1;

/// The other end of the same bound: more dots per inch than any press, and far
/// fewer than a number that overflows a `pHYs` chunk.
pub const MAX_DPI: u32 = 10_000;

/// Which logo to draw, and where — the box in the scene's own units, exactly
/// as the domain computed it from the matrix and the error-correction budget.
///
/// The host is told where to draw, never how large a logo may be: that decision
/// belongs to the placement engine, which knows the function patterns and the
/// budget (ADR-013). What the host does is refuse to pretend it worked — a logo
/// that swallows the code is a report with `verified: false`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LogoRef {
    /// The identifier `import_logo` returned.
    pub id: String,
    /// Left edge, in scene units.
    pub x: f32,
    /// Top edge, in scene units.
    pub y: f32,
    /// Width, in scene units.
    pub width: f32,
    /// Height, in scene units.
    pub height: f32,
}

/// What an export answers with: the verdict, plus where the bytes went.
#[derive(Debug, Clone, Serialize)]
pub struct ExportReport {
    /// The verification the file was written on the strength of.
    #[serde(flatten)]
    pub report: VerificationReport,
    /// The file that now exists.
    pub path: String,
    /// How many bytes it holds.
    pub bytes_written: u64,
}

/// Everything a command is told about the code itself, gathered so that one
/// function can do the part that must never differ between exports.
///
/// It is not the wire shape: each command takes flat, snake-case arguments, the
/// way the interface calls them. This is what they all become one line later, so
/// that "render, compose, decode, compare, record" exists once.
struct Asked<'a> {
    svg: &'a str,
    payload: &'a str,
    pixel_size: u32,
    logo: Option<&'a LogoRef>,
    /// The resolution the artefact is made for. `None` for a preview and for the
    /// scan margin, neither of which is going to be printed.
    dpi: Option<u32>,
}

/// What an export produces, and therefore what its bytes are made of.
enum Written {
    /// The artefact itself, `pHYs` chunk and all.
    Png,
    /// The scene as the domain sized it, with the logo carried inside it.
    Svg,
    /// One page of exactly this many millimetres, with the artefact on it.
    Pdf { width_mm: f64 },
}

impl Written {
    /// The token the record keeps and the extension the file must have. They are
    /// the same word on purpose: the kind of an export is one idea.
    fn token(&self) -> &'static str {
        match self {
            Written::Png => "png",
            Written::Svg => "svg",
            Written::Pdf { .. } => "pdf",
        }
    }
}

/// Render and decode, and say whether a phone would read it back.
///
/// Writes no file. The record of the attempt is written either way, because a
/// refusal is as much a fact as a success.
#[tauri::command(rename_all = "snake_case")]
pub fn verify_code(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    logo: Option<LogoRef>,
) -> Result<VerificationReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    verify_code_with(&conn, &svg, &payload, pixel_size, logo.as_ref())
}

/// Render, decode, compare — and write the PNG only if the decoder agreed.
///
/// The bytes written are the bytes that were decoded: nothing is rendered a
/// second time between the verdict and the file, and `dpi` is written into the
/// PNG's `pHYs` chunk *before* the decode, so the resolution is part of what was
/// verified. The write goes to a temporary name in the same directory and is
/// renamed into place, so a half-written PNG never exists at the path a person
/// chose.
///
/// # Errors
///
/// [`Error::Refused`] when the code did not read back — the message is the
/// reason, and nothing was written. [`Error::InvalidInput`] for a size, a
/// resolution, a drawing, a payload or a path the host will not accept.
/// [`Error::File`] when the write itself failed.
#[tauri::command(rename_all = "snake_case")]
pub fn export_png(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    path: String,
    logo: Option<LogoRef>,
    dpi: u32,
) -> Result<ExportReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    export_with(
        &conn,
        &Asked {
            svg: &svg,
            payload: &payload,
            pixel_size,
            logo: logo.as_ref(),
            dpi: Some(dpi),
        },
        &path,
        Written::Png,
    )
}

/// Verify exactly as a PNG export does, then write the SVG.
///
/// `svg` is the scene the domain has already sized (`width="25mm"`): the host
/// verifies *that* string, so the drawing that was rasterised and read back is
/// the drawing that is written. When there is a logo, the written file carries it
/// as markup — a `data:` PNG or a nested `<svg>` — which is the one place in this
/// product where the bytes written are not the bytes decoded. They are the same
/// scene and the same stored logo, composed twice; ADR-026 says so in as many
/// words, and what is written is scanned for external references before it
/// reaches the disk.
///
/// # Errors
///
/// As [`export_png`], plus [`Error::Render`] when the file could not be composed
/// from the scene and the stored logo.
#[tauri::command(rename_all = "snake_case")]
pub fn export_svg(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    path: String,
    logo: Option<LogoRef>,
    dpi: u32,
) -> Result<ExportReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    export_with(
        &conn,
        &Asked {
            svg: &svg,
            payload: &payload,
            pixel_size,
            logo: logo.as_ref(),
            dpi: Some(dpi),
        },
        &path,
        Written::Svg,
    )
}

/// Verify exactly as a PNG export does, then write a one-page PDF of exactly
/// `width_mm` millimetres square with the verified artefact on it.
///
/// The page size comes from `width_mm` and from nothing else — never from the
/// drawing, which carries a `viewBox` and no physical width. Embedding the
/// verified raster rather than redrawing the code keeps the product's promise
/// true for the PDF as well: what was read back is what is in the file.
///
/// # Errors
///
/// As [`export_png`], and [`Error::InvalidInput`] when the width is not a
/// printable number of millimetres.
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
// Flat, snake-case arguments are the contract with the interface: one value per
// thing a person chose. Gathering them into a struct would nest the wire shape.
pub fn export_pdf(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    path: String,
    logo: Option<LogoRef>,
    dpi: u32,
    width_mm: f64,
) -> Result<ExportReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    export_with(
        &conn,
        &Asked {
            svg: &svg,
            payload: &payload,
            pixel_size,
            logo: logo.as_ref(),
            dpi: Some(dpi),
        },
        &path,
        Written::Pdf { width_mm },
    )
}

/// Verify, then put the image on the clipboard.
///
/// The image and nothing else: never the payload as text (`SECURITY.md`). No
/// file is written, so the record carries no path — it carries `clipboard` as the
/// format, which is the honest way to say an export happened nowhere on disk.
///
/// # Errors
///
/// [`Error::Refused`] when the code did not read back, and [`Error::File`] when
/// the clipboard could not be written — which is not a failure of the code, and
/// is recorded as the verification it was.
#[tauri::command(rename_all = "snake_case")]
pub fn copy_png(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    logo: Option<LogoRef>,
    dpi: u32,
) -> Result<VerificationReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    copy_png_with(
        &conn,
        &Asked {
            svg: &svg,
            payload: &payload,
            pixel_size,
            logo: logo.as_ref(),
            dpi: Some(dpi),
        },
        clipboard::place,
    )
}

/// How much abuse the artefact survives: nine variants, nine verdicts.
///
/// A report and never a gate (ADR-027) — it writes no row and refuses no export.
/// The artefact it measures is composed exactly as the one the gate answers for,
/// so the margin is a fact about the code somebody is about to print.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a size, a drawing, a payload or a logo the host
/// will not accept, and [`Error::Render`] when the artefact could not be made.
#[tauri::command(async, rename_all = "snake_case")]
pub fn scan_margin(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    logo: Option<LogoRef>,
) -> Result<ScanMargin> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    scan_margin_with(
        &conn,
        &Asked {
            svg: &svg,
            payload: &payload,
            // The margin measures how a code degrades, not the export: a render past this side
            // costs seconds of blur and nine decodes for no better answer, so it is measured at
            // the export's size or this one, whichever is smaller — and off the main thread.
            pixel_size: pixel_size.min(MARGIN_MAX_PIXELS),
            logo: logo.as_ref(),
            dpi: None,
        },
    )
}

/// The largest raster the scan margin is measured on; the test that bounds its time uses it.
pub const MARGIN_MAX_PIXELS: u32 = 1024;

/// What [`verify_code`] does once the database is in hand.
fn verify_code_with(
    conn: &Connection,
    svg: &str,
    payload: &str,
    pixel_size: u32,
    logo: Option<&LogoRef>,
) -> Result<VerificationReport> {
    let asked = Asked {
        svg,
        payload,
        pixel_size,
        logo,
        dpi: None,
    };
    check_inputs(&asked)?;
    let logo = load_logo(conn, asked.logo)?;

    let verification = verify(
        asked.svg.as_bytes(),
        asked.payload.as_bytes(),
        asked.pixel_size,
        &decoder(),
        logo.as_ref().map(|(logo, area)| (logo, *area)),
        asked.dpi,
    )?;
    let report = verification.report;
    record(conn, "verify", &report, None, None, None)?;

    Ok(report)
}

/// The part of an export that must never differ between the kinds of file: the
/// gate, the refusal, the record, and the one write.
///
/// Only `bytes` differs, and it is computed after the verdict — from the
/// artefact that was decoded, or from the very string that was rasterised. There
/// is no path through this function that writes something the decoder did not
/// answer for.
fn export_with(
    conn: &Connection,
    asked: &Asked,
    path: &str,
    written: Written,
) -> Result<ExportReport> {
    check_inputs(asked)?;
    check_destination(path, written.token())?;
    if let Written::Pdf { width_mm } = written {
        pdf::check_width(width_mm)?;
    }
    let logo = load_logo(conn, asked.logo)?;
    let placed = logo.as_ref().map(|(logo, area)| (logo, *area));

    let verification = verify(
        asked.svg.as_bytes(),
        asked.payload.as_bytes(),
        asked.pixel_size,
        &decoder(),
        placed,
        asked.dpi,
    )?;
    let report = verification.report;
    let format = Some(written.token());

    if !report.verified {
        let reason = report
            .reason
            .clone()
            .unwrap_or_else(|| "The code did not read back.".to_string());
        // The destination is not recorded: no file went there, and a row that
        // names a path is a row that says one exists.
        record(conn, "export", &report, None, asked.dpi, format)?;
        log::warn!("an export was refused: {reason}");
        return Err(Error::Refused(reason));
    }

    let bytes = match written {
        Written::Png => verification.png,
        Written::Svg => svg_file::to_write(asked.svg, placed)?.into_bytes(),
        Written::Pdf { width_mm } => pdf::one_page(&verification.png, width_mm)?,
    };

    let bytes_written = write_atomically(Path::new(path), &bytes)?;
    record(conn, "export", &report, Some(path), asked.dpi, format)?;
    log::info!(
        "exported {bytes_written} bytes as {} verified by {}",
        written.token(),
        report.decoder
    );

    Ok(ExportReport {
        report,
        path: path.to_string(),
        bytes_written,
    })
}

/// What [`copy_png`] does once the database is in hand, with the placement as an
/// argument so the decision can be tested where there is no desktop.
fn copy_png_with(
    conn: &Connection,
    asked: &Asked,
    place: clipboard::Placement,
) -> Result<VerificationReport> {
    check_inputs(asked)?;
    let logo = load_logo(conn, asked.logo)?;

    let verification = verify(
        asked.svg.as_bytes(),
        asked.payload.as_bytes(),
        asked.pixel_size,
        &decoder(),
        logo.as_ref().map(|(logo, area)| (logo, *area)),
        asked.dpi,
    )?;
    let report = verification.report;

    // Recorded before the clipboard is touched: the verification is a fact
    // already, and whether the system let go of its clipboard is not evidence
    // about the code.
    record(conn, "export", &report, None, asked.dpi, Some("clipboard"))?;

    if !report.verified {
        let reason = report
            .reason
            .clone()
            .unwrap_or_else(|| "The code did not read back.".to_string());
        log::warn!("a copy was refused: {reason}");
        return Err(Error::Refused(reason));
    }

    place(&clipboard::image_from_png(&verification.png)?)?;
    log::info!("copied a code verified by {}", report.decoder);

    Ok(report)
}

/// What [`scan_margin`] does once the database is in hand.
fn scan_margin_with(conn: &Connection, asked: &Asked) -> Result<ScanMargin> {
    check_inputs(asked)?;
    let logo = load_logo(conn, asked.logo)?;

    let artefact = crate::imaging::verify::artefact(
        asked.svg.as_bytes(),
        asked.pixel_size,
        logo.as_ref().map(|(logo, area)| (logo, *area)),
        asked.dpi,
    )?;

    margin::scan_margin(&artefact.png, asked.payload.as_bytes())
}

/// Fetch the logo a request named, and the box it asked for.
///
/// A logo that is not in the workspace is a refusal rather than a silently
/// logo-less code: the person asked for one, and a code that quietly comes back
/// without it is a code they will print.
fn load_logo(
    conn: &Connection,
    logo: Option<&LogoRef>,
) -> Result<Option<(NormalisedLogo, LogoBox)>> {
    let Some(asked) = logo else {
        return Ok(None);
    };

    let area = LogoBox {
        x: asked.x,
        y: asked.y,
        width: asked.width,
        height: asked.height,
    };
    if !area.is_usable() {
        return Err(Error::InvalidInput(
            "A logo needs a box with a positive width and height.".to_string(),
        ));
    }

    let (_, stored) = logos::get(conn, &asked.id)?.ok_or_else(|| {
        Error::InvalidInput("That logo is no longer in this workspace.".to_string())
    })?;
    Ok(Some((stored, area)))
}

/// Everything the host refuses before it renders anything.
fn check_inputs(asked: &Asked) -> Result<()> {
    if !(MIN_PIXEL_SIZE..=MAX_PIXEL_SIZE).contains(&asked.pixel_size) {
        return Err(Error::InvalidInput(format!(
            "a code is made between {MIN_PIXEL_SIZE} and {MAX_PIXEL_SIZE} pixels square"
        )));
    }
    if asked.svg.len() > MAX_SVG_BYTES {
        return Err(Error::InvalidInput(
            "that drawing is too large for this product to render".to_string(),
        ));
    }
    if asked.payload.is_empty() {
        return Err(Error::InvalidInput(
            "there is nothing to encode".to_string(),
        ));
    }
    if asked.payload.len() > MAX_PAYLOAD_BYTES {
        return Err(Error::InvalidInput(
            "that is more than one code can carry".to_string(),
        ));
    }
    if let Some(dpi) = asked.dpi {
        if !(MIN_DPI..=MAX_DPI).contains(&dpi) {
            return Err(Error::InvalidInput(format!(
                "a code is made for between {MIN_DPI} and {MAX_DPI} dots per inch"
            )));
        }
    }
    Ok(())
}

/// The path a person chose in the system's save dialog, checked before it is
/// used. Absolute, local, and named for the kind of file this export writes.
fn check_destination(path: &str, extension: &str) -> Result<()> {
    let destination = Path::new(path);
    if !destination.is_absolute() {
        return Err(Error::InvalidInput(
            "an export needs the full path of the file to write".to_string(),
        ));
    }
    // `is_absolute` is true of a UNC path (`\\host\share\code.png`) and of a verbatim one
    // (`\\?\...`). Writing there would make the host open a network connection on the
    // interface's word, in a product that promises nothing leaves the machine. The system's
    // save dialog never produces one for a local file, so a request that carries one is refused.
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(Error::InvalidInput(
            "an export is written to a local drive, not to a network path".to_string(),
        ));
    }
    let named_properly = destination
        .extension()
        .is_some_and(|found| found.eq_ignore_ascii_case(extension));
    if !named_properly {
        return Err(Error::InvalidInput(format!(
            "this export is a {} file, so its name has to end in .{extension}",
            extension.to_uppercase()
        )));
    }
    Ok(())
}

/// Write the bytes beside the destination and rename them onto it.
///
/// A rename within one directory is the closest a filesystem comes to a single
/// step: either the old file is there or the new one is, and never half of
/// either. A failed write takes its own leftovers with it.
fn write_atomically(destination: &Path, bytes: &[u8]) -> Result<u64> {
    let directory = destination
        .parent()
        .ok_or(Error::File("that path has no folder to write into"))?;
    let name = destination
        .file_name()
        .ok_or(Error::File("that path does not name a file"))?
        .to_string_lossy()
        .into_owned();

    let staged = directory.join(format!(".{name}.{}.part", crate::db::new_id()));

    if let Err(error) = std::fs::write(&staged, bytes) {
        log::error!("the staged export could not be written: {error}");
        let _ = std::fs::remove_file(&staged);
        return Err(Error::File("that file could not be written"));
    }
    if let Err(error) = std::fs::rename(&staged, destination) {
        log::error!("the staged export could not be moved into place: {error}");
        let _ = std::fs::remove_file(&staged);
        return Err(Error::File("that file could not be written"));
    }

    Ok(bytes.len() as u64)
}

/// Write the evidence of one attempt.
fn record(
    conn: &Connection,
    kind: &str,
    report: &VerificationReport,
    path: Option<&str>,
    dpi: Option<u32>,
    format: Option<&str>,
) -> Result<()> {
    verifications::record(
        conn,
        &VerificationRow {
            kind,
            decoder: &report.decoder,
            verified: report.verified,
            payload_sha256: &report.payload_sha256,
            decoded_sha256: report.decoded_sha256.as_deref(),
            artefact_sha256: &report.artefact_sha256,
            width: report.width,
            height: report.height,
            duration_ms: report.duration_ms,
            path,
            reason: report.reason.as_deref(),
            dpi,
            format,
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};
    use crate::imaging::verify::sha256_hex;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    /// A directory of its own for each test that writes, removed when it ends.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("signatum-{}", crate::db::new_id()));
            std::fs::create_dir_all(&path).expect("scratch directory");
            Self(path)
        }

        fn file(&self, name: &str) -> String {
            self.0.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The scene the fixture draws: 21 modules plus a quiet zone of 4 a side.
    const SCENE: f32 = 29.0;

    /// The resolution the tests export at, and the pixels-per-metre it becomes.
    const DPI: u32 = 300;
    const PER_METRE: u32 = 11_811;

    /// What the domain hands `export_svg`: the same scene, with the printed size
    /// written in after the `viewBox` (`sizedSvg` in `size.ts`).
    fn sized(svg: &str, millimetres: &str) -> String {
        let marker = format!("viewBox=\"0 0 {SCENE} {SCENE}\"");
        let marker = marker.replace(".0", "");
        svg.replace(
            &marker,
            &format!("{marker} width=\"{millimetres}mm\" height=\"{millimetres}mm\""),
        )
    }

    /// An export of one kind, built the way the command builds it.
    fn export(
        conn: &Connection,
        svg: &str,
        payload: &str,
        pixel_size: u32,
        path: &str,
        logo: Option<&LogoRef>,
        written: Written,
    ) -> Result<ExportReport> {
        export_with(
            conn,
            &Asked {
                svg,
                payload,
                pixel_size,
                logo,
                dpi: Some(DPI),
            },
            path,
            written,
        )
    }

    /// The PNG export, which is what most of these tests are about.
    fn export_png_with(
        conn: &Connection,
        svg: &str,
        payload: &str,
        pixel_size: u32,
        path: &str,
        logo: Option<&LogoRef>,
    ) -> Result<ExportReport> {
        export(conn, svg, payload, pixel_size, path, logo, Written::Png)
    }

    /// A logo in the workspace, the way an import leaves one there.
    fn a_stored_logo(conn: &Connection) -> String {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
             <rect width="32" height="32" fill="#1a1a1a"/></svg>"##;
        let logo = crate::imaging::logo::normalise(document.as_bytes()).expect("normalise");
        logos::insert(conn, "brand", &logo).expect("insert").id
    }

    /// A stored raster logo, which is the kind an SVG export has to carry as
    /// bytes rather than as markup.
    fn a_stored_raster_logo(conn: &Connection) -> String {
        let image = image::RgbaImage::from_pixel(32, 32, image::Rgba([26, 26, 26, 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode");
        let logo = crate::imaging::logo::normalise(&png).expect("normalise");
        logos::insert(conn, "brand", &logo).expect("insert").id
    }

    /// A square of `fraction` of the symbol, centred — what the domain hands
    /// the host.
    fn centred_logo(id: &str, fraction: f32) -> LogoRef {
        let side = (SCENE - 8.0) * fraction;
        LogoRef {
            id: id.to_string(),
            x: (SCENE - side) / 2.0,
            y: (SCENE - side) / 2.0,
            width: side,
            height: side,
        }
    }

    fn kind_of(error: &Error) -> String {
        serde_json::to_value(error)
            .expect("serialise")
            .get("kind")
            .and_then(|kind| kind.as_str())
            .map(str::to_string)
            .expect("every error has a kind")
    }

    fn rows(conn: &Connection) -> Vec<(String, i64, Option<String>)> {
        let mut statement = conn
            .prepare("SELECT kind, verified, path FROM verifications ORDER BY id")
            .expect("prepare");
        let found = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .expect("query")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("rows");
        found
    }

    /// What each row says about the export it records: its resolution and its
    /// kind.
    fn exported(conn: &Connection) -> Vec<(Option<i64>, Option<String>)> {
        let mut statement = conn
            .prepare("SELECT dpi, format FROM verifications ORDER BY id")
            .expect("prepare");
        let found = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .expect("query")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("rows");
        found
    }

    /// The `pHYs` chunk of a PNG, if it has one.
    fn pixels_per_metre_of(png: &[u8]) -> Option<u32> {
        let mut at = 8;
        while at + 8 <= png.len() {
            let length = u32::from_be_bytes(png[at..at + 4].try_into().ok()?) as usize;
            if &png[at + 4..at + 8] == b"pHYs" {
                return u32::from_be_bytes(png[at + 8..at + 12].try_into().ok()?).into();
            }
            at += 12 + length;
        }
        None
    }

    #[test]
    fn a_code_that_reads_back_is_verified_and_recorded() {
        let conn = workspace();
        let report =
            verify_code_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, None).expect("verify");

        assert!(report.verified, "reason: {:?}", report.reason);
        assert_eq!(rows(&conn), vec![("verify".to_string(), 1, None)]);
        assert_eq!(
            exported(&conn),
            vec![(None, None)],
            "a preview is not an export, and records neither a resolution nor a kind"
        );
    }

    #[test]
    fn an_export_of_a_code_that_does_not_read_writes_nothing() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let refused = export_png_with(&conn, &blank_svg(), HELLO_WORLD, 512, &path, None)
            .expect_err("an unreadable code must be refused");

        assert_eq!(kind_of(&refused), "refused");
        assert_eq!(
            refused.to_string(),
            crate::imaging::verify::REASON_NO_CODE,
            "the refusal says why, in one sentence"
        );
        assert!(
            !Path::new(&path).exists(),
            "a refused export must leave no file behind"
        );
        assert_eq!(
            std::fs::read_dir(&scratch.0).expect("read").count(),
            0,
            "not even a partial one"
        );
        assert_eq!(rows(&conn), vec![("export".to_string(), 0, None)]);
        assert_eq!(
            exported(&conn),
            vec![(Some(300), Some("png".to_string()))],
            "a refusal still records what was being attempted"
        );
    }

    #[test]
    fn an_export_writes_exactly_the_bytes_that_were_decoded() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let export = export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path, None)
            .expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        assert_eq!(export.bytes_written, written.len() as u64);
        assert_eq!(
            sha256_hex(&written),
            export.report.artefact_sha256,
            "the file on disk is the artefact that was verified"
        );
        assert!(export.report.verified);
        assert_eq!(export.path, path);
        assert_eq!(
            std::fs::read_dir(&scratch.0).expect("read").count(),
            1,
            "the staged file was renamed, not left"
        );
        assert_eq!(rows(&conn), vec![("export".to_string(), 1, Some(path))]);
    }

    /// The slice's own proof of done, on this side of it: 25 mm at 300 dpi is
    /// 295 pixels, and the file says 11 811 pixels per metre — in the bytes that
    /// were decoded, so the resolution is part of what was verified rather than
    /// something added afterwards.
    #[test]
    fn a_png_export_writes_the_printed_size_into_the_file() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let export = export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 295, &path, None)
            .expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        assert_eq!((export.report.width, export.report.height), (295, 295));
        assert_eq!(
            pixels_per_metre_of(&written),
            Some(PER_METRE),
            "300 dpi is 11 811 pixels per metre"
        );
        assert_eq!(
            sha256_hex(&written),
            export.report.artefact_sha256,
            "the bytes that carry the resolution are the bytes that were decoded"
        );
        assert_eq!(exported(&conn), vec![(Some(300), Some("png".to_string()))]);
    }

    /// The SVG export verifies the string it is given — the sized one — and
    /// writes it back byte for byte when there is no logo to carry.
    #[test]
    fn an_svg_export_writes_the_scene_it_verified() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.svg");
        let scene = sized(&hello_world_svg(), "25");

        let export =
            export(&conn, &scene, HELLO_WORLD, 295, &path, None, Written::Svg).expect("export");

        let written = std::fs::read_to_string(&path).expect("the file exists");
        assert_eq!(written, scene, "the domain's scene is written as it stands");
        assert!(
            written.contains("width=\"25mm\""),
            "the printed size is in the file"
        );
        assert!(
            export.report.verified,
            "the sized scene is what was decoded"
        );
        assert_eq!((export.report.width, export.report.height), (295, 295));
        assert_eq!(exported(&conn), vec![(Some(300), Some("svg".to_string()))]);
    }

    /// With a logo, the written SVG carries it — and still refers to nothing
    /// outside itself. This is the asymmetry ADR-026 records: the bytes written
    /// are not the bytes decoded, but they are the same scene and the same
    /// stored logo.
    #[test]
    fn an_svg_export_carries_its_logo_and_refers_to_nothing_outside() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.svg");
        let logo = a_stored_raster_logo(&conn);
        let scene = sized(&hello_world_svg(), "25");

        let export = export(
            &conn,
            &scene,
            HELLO_WORLD,
            512,
            &path,
            Some(&centred_logo(&logo, 0.2)),
            Written::Svg,
        )
        .expect("export");

        let written = std::fs::read_to_string(&path).expect("the file exists");
        assert!(export.report.verified);
        assert!(
            written.contains("<image ") && written.contains("href=\"data:image/png;base64,"),
            "the logo has to be inside the file"
        );
        assert!(!written.contains("<script"));
        assert!(!written.contains("<foreignObject"));
        assert!(!written.contains("xlink:href"));
        for (index, _) in written.match_indices("href") {
            let value = &written[index + "href".len()..];
            assert!(
                value.starts_with("=\"data:image/png;base64,") || value.starts_with("=\"#"),
                "an external reference reached the file"
            );
        }
        assert_ne!(
            export.report.artefact_sha256,
            sha256_hex(written.as_bytes()),
            "for an SVG the artefact is the raster, and the file is the markup (ADR-026)"
        );
    }

    /// The PDF's page is the millimetres it was asked for, and nothing about the
    /// drawing changes that: this scene carries a `viewBox` and no physical
    /// width at all.
    #[test]
    fn a_pdf_export_measures_the_millimetres_it_was_asked_for() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.pdf");

        let export = export(
            &conn,
            &hello_world_svg(),
            HELLO_WORLD,
            295,
            &path,
            None,
            Written::Pdf { width_mm: 25.0 },
        )
        .expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        let text = String::from_utf8_lossy(&written);
        assert_eq!(&written[..8], b"%PDF-1.7");
        assert!(
            text.contains("/MediaBox [0 0 70.87 70.87]"),
            "25 mm is 70.87 points"
        );
        assert!(text.contains("/Width 295"), "the artefact is 295 pixels");
        assert!(export.report.verified);
        assert_eq!(exported(&conn), vec![(Some(300), Some("pdf".to_string()))]);
    }

    /// A page size the host will not write is refused before anything is
    /// rendered — so there is no row, because nothing happened.
    #[test]
    fn a_pdf_export_refuses_a_page_that_is_not_a_page() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.pdf");

        for width_mm in [0.0, -25.0, f64::NAN, 9000.0] {
            let refused = export(
                &conn,
                &hello_world_svg(),
                HELLO_WORLD,
                128,
                &path,
                None,
                Written::Pdf { width_mm },
            )
            .expect_err("that page was written");

            assert_eq!(kind_of(&refused), "invalid_input", "{width_mm}");
        }
        assert!(!Path::new(&path).exists());
        assert!(
            rows(&conn).is_empty(),
            "nothing was rendered, so there is nothing to record"
        );
    }

    #[test]
    fn an_export_replaces_a_file_that_is_already_there() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");
        std::fs::write(&path, b"an older export").expect("seed");

        let export = export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path, None)
            .expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        assert_eq!(sha256_hex(&written), export.report.artefact_sha256);
    }

    #[test]
    fn the_host_refuses_what_it_will_not_render() {
        let conn = workspace();
        let svg = hello_world_svg();

        let too_small =
            verify_code_with(&conn, &svg, HELLO_WORLD, 32, None).expect_err("too small");
        let too_large =
            verify_code_with(&conn, &svg, HELLO_WORLD, 8192, None).expect_err("too large");
        let nothing = verify_code_with(&conn, &svg, "", 512, None).expect_err("nothing to encode");
        let too_much = verify_code_with(&conn, &svg, &"x".repeat(MAX_PAYLOAD_BYTES + 1), 512, None)
            .expect_err("too much");
        let huge_drawing = verify_code_with(
            &conn,
            &"x".repeat(MAX_SVG_BYTES + 1),
            HELLO_WORLD,
            512,
            None,
        )
        .expect_err("drawing too large");

        for error in [too_small, too_large, nothing, too_much, huge_drawing] {
            assert_eq!(kind_of(&error), "invalid_input");
        }
        assert!(
            rows(&conn).is_empty(),
            "nothing was rendered, so there is nothing to record"
        );
    }

    /// The resolution is checked before anything is rendered. The list a person
    /// chooses from is the domain's; what the host refuses is a number that
    /// cannot be written into a file.
    #[test]
    fn the_host_refuses_a_resolution_it_cannot_write() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        for dpi in [0, MAX_DPI + 1] {
            let refused = export_with(
                &conn,
                &Asked {
                    svg: &hello_world_svg(),
                    payload: HELLO_WORLD,
                    pixel_size: 128,
                    logo: None,
                    dpi: Some(dpi),
                },
                &path,
                Written::Png,
            )
            .expect_err("that resolution was accepted");

            assert_eq!(kind_of(&refused), "invalid_input", "{dpi} dpi");
        }
        assert!(rows(&conn).is_empty());
    }

    #[test]
    fn the_host_refuses_a_destination_it_was_not_given_properly() {
        let conn = workspace();
        let svg = hello_world_svg();

        for path in ["signatum.png", "code.jpg", "C:/somewhere/code.jpeg", ""] {
            let error = export_png_with(&conn, &svg, HELLO_WORLD, 512, path, None)
                .expect_err("this destination must be refused");
            assert_eq!(kind_of(&error), "invalid_input", "path: {path}");
        }
    }

    /// Each kind of export is named for what it is. A PDF written to a `.png` is
    /// a file somebody will double-click and not understand.
    #[test]
    fn every_kind_of_export_insists_on_its_own_extension() {
        assert!(check_destination("C:/somewhere/code.png", "png").is_ok());
        assert!(check_destination("C:/somewhere/code.SVG", "svg").is_ok());
        assert!(check_destination("C:/somewhere/code.pdf", "pdf").is_ok());

        for (path, extension) in [
            ("C:/somewhere/code.png", "svg"),
            ("C:/somewhere/code.svg", "pdf"),
            ("C:/somewhere/code.pdf", "png"),
            ("C:/somewhere/code", "png"),
        ] {
            let refused = check_destination(path, extension).expect_err(path);
            assert!(
                refused.to_string().contains(&format!(".{extension}")),
                "the refusal has to name the extension it wanted: {refused}"
            );
        }
    }

    #[test]
    fn the_host_refuses_a_network_path_even_though_it_is_absolute() {
        for path in [
            "\\\\server\\share\\code.png",
            "\\\\?\\C:\\code.png",
            "//server/share/code.png",
        ] {
            let error = check_destination(path, "png").expect_err(path);
            assert!(matches!(error, Error::InvalidInput(_)), "{path}: {error:?}");
            assert!(error.to_string().contains("network"), "{path}: {error}");
        }
    }

    /// A logo the placement engine would allow goes onto the artefact, and the
    /// code still reads back — which is the only sense in which a logo is ever
    /// "allowed" here.
    #[test]
    fn a_code_with_a_logo_is_verified_on_the_artefact_that_carries_it() {
        let conn = workspace();
        let logo = a_stored_logo(&conn);

        let plain = verify_code_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, None)
            .expect("verify without a logo");
        let with_logo = verify_code_with(
            &conn,
            &hello_world_svg(),
            HELLO_WORLD,
            512,
            Some(&centred_logo(&logo, 0.2)),
        )
        .expect("verify with a logo");

        assert!(with_logo.verified, "reason: {:?}", with_logo.reason);
        assert_ne!(
            with_logo.artefact_sha256, plain.artefact_sha256,
            "the logo has to be in the bytes that were decoded"
        );
    }

    #[test]
    fn an_export_with_a_logo_writes_the_bytes_that_carry_it() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");
        let logo = a_stored_logo(&conn);

        let export = export_png_with(
            &conn,
            &hello_world_svg(),
            HELLO_WORLD,
            512,
            &path,
            Some(&centred_logo(&logo, 0.2)),
        )
        .expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        assert_eq!(sha256_hex(&written), export.report.artefact_sha256);
    }

    #[test]
    fn a_logo_that_swallows_the_code_refuses_the_export() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");
        let logo = a_stored_logo(&conn);

        let refused = export_png_with(
            &conn,
            &hello_world_svg(),
            HELLO_WORLD,
            512,
            &path,
            Some(&centred_logo(&logo, 0.6)),
        )
        .expect_err("a code nobody can read must not be written");

        assert_eq!(kind_of(&refused), "refused");
        assert!(!Path::new(&path).exists(), "nothing was written");
    }

    #[test]
    fn a_logo_the_workspace_does_not_have_is_refused() {
        let conn = workspace();

        let refused = verify_code_with(
            &conn,
            &hello_world_svg(),
            HELLO_WORLD,
            512,
            Some(&LogoRef {
                id: "not-a-logo".to_string(),
                x: 1.0,
                y: 1.0,
                width: 4.0,
                height: 4.0,
            }),
        )
        .expect_err("a logo nobody imported must be refused");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "That logo is no longer in this workspace."
        );
        assert!(
            rows(&conn).is_empty(),
            "nothing was rendered, so there is nothing to record"
        );
    }

    /// A clipboard that works: the image placed is the verified artefact, four
    /// bytes a pixel, and the row says an export happened with no file at the
    /// end of it.
    #[test]
    fn a_copy_places_the_verified_image_and_records_it() {
        static PLACED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

        fn places(image: &clipboard::Image) -> Result<()> {
            assert_eq!(image.rgba.len(), image.width * image.height * 4);
            assert_eq!((image.width, image.height), (295, 295));
            PLACED.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }

        let conn = workspace();
        let report = copy_png_with(
            &conn,
            &Asked {
                svg: &hello_world_svg(),
                payload: HELLO_WORLD,
                pixel_size: 295,
                logo: None,
                dpi: Some(DPI),
            },
            places,
        )
        .expect("copy");

        assert!(report.verified);
        assert_eq!(PLACED.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(rows(&conn), vec![("export".to_string(), 1, None)]);
        assert_eq!(
            exported(&conn),
            vec![(Some(300), Some("clipboard".to_string()))],
            "a copy is an export that went nowhere on disk"
        );
    }

    /// A clipboard another application is holding open is one sentence, and the
    /// verification is recorded anyway: the code read back, whatever the system
    /// did next.
    #[test]
    fn a_clipboard_that_will_not_open_is_one_sentence_and_the_row_is_still_written() {
        fn will_not_open(_: &clipboard::Image) -> Result<()> {
            Err(Error::File("The clipboard could not be written."))
        }

        let conn = workspace();
        let refused = copy_png_with(
            &conn,
            &Asked {
                svg: &hello_world_svg(),
                payload: HELLO_WORLD,
                pixel_size: 128,
                logo: None,
                dpi: Some(DPI),
            },
            will_not_open,
        )
        .expect_err("the clipboard failed");

        assert_eq!(kind_of(&refused), "file");
        assert_eq!(refused.to_string(), "The clipboard could not be written.");
        assert_eq!(rows(&conn), vec![("export".to_string(), 1, None)]);
    }

    #[test]
    fn a_copy_of_a_code_that_does_not_read_never_reaches_the_clipboard() {
        fn must_not_be_called(_: &clipboard::Image) -> Result<()> {
            panic!("a code that did not read back reached the clipboard");
        }

        let conn = workspace();
        let refused = copy_png_with(
            &conn,
            &Asked {
                svg: &blank_svg(),
                payload: HELLO_WORLD,
                pixel_size: 128,
                logo: None,
                dpi: Some(DPI),
            },
            must_not_be_called,
        )
        .expect_err("an unreadable code must be refused");

        assert_eq!(kind_of(&refused), "refused");
        assert_eq!(rows(&conn), vec![("export".to_string(), 0, None)]);
    }

    /// The margin is a report: nine lines, and not one row in the workspace.
    #[test]
    fn the_scan_margin_reports_nine_variants_and_records_nothing() {
        let conn = workspace();

        let margin = scan_margin_with(
            &conn,
            &Asked {
                svg: &hello_world_svg(),
                payload: HELLO_WORLD,
                pixel_size: 512,
                logo: None,
                dpi: None,
            },
        )
        .expect("margin");

        assert_eq!(margin.variants.len(), 9);
        assert!(margin.variants.iter().all(|variant| variant.verified));
        assert!(
            rows(&conn).is_empty(),
            "a measurement is not evidence about an artefact"
        );
    }

    /// And it measures the artefact with the logo on it, because that is the one
    /// somebody is about to print.
    #[test]
    fn the_scan_margin_measures_the_code_with_its_logo() {
        let conn = workspace();
        let logo = a_stored_logo(&conn);

        let margin = scan_margin_with(
            &conn,
            &Asked {
                svg: &hello_world_svg(),
                payload: HELLO_WORLD,
                pixel_size: 512,
                logo: Some(&centred_logo(&logo, 0.6)),
                dpi: None,
            },
        )
        .expect("margin");

        assert!(
            margin.variants.iter().all(|variant| !variant.verified),
            "a logo over the budget cannot read at any size"
        );
    }

    #[test]
    fn an_export_report_reaches_the_interface_flat_and_in_snake_case() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let export = export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path, None)
            .expect("export");
        let json = serde_json::to_value(&export).expect("serialise");

        for key in [
            "verified",
            "decoder",
            "payload_sha256",
            "artefact_sha256",
            "duration_ms",
            "path",
            "bytes_written",
        ] {
            assert!(
                json.get(key).is_some(),
                "`{key}` is missing from the report"
            );
        }
    }
}
