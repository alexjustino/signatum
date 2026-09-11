//! The two commands the Create screen calls: prove a code, and export one.
//!
//! Both do the same thing first — render the drawing, decode the pixels,
//! compare byte for byte — and record what happened. The difference is what
//! follows: `verify_code` returns the verdict, `export_png` writes the file,
//! and only ever the bytes that were decoded (ADR-010).
//!
//! # Changelog of this boundary
//!
//! - F0: `verify_code` and `export_png`, the `verifications` record, and the
//!   refusal that keeps an unreadable code off the disk.

use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db::verifications::{self, VerificationRow};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::imaging::render::{MAX_PIXEL_SIZE, MAX_SVG_BYTES, MIN_PIXEL_SIZE};
use crate::imaging::verify::{decoder, verify, VerificationReport};

/// The most a QR code can carry in this product. The standard's own ceiling is
/// near this; anything approaching it stops being a code a phone reads across a
/// room, which is the only kind worth making.
pub const MAX_PAYLOAD_BYTES: usize = 4096;

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
) -> Result<VerificationReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    verify_code_with(&conn, &svg, &payload, pixel_size)
}

/// Render, decode, compare — and write the file only if the decoder agreed.
///
/// The bytes written are the bytes that were decoded: nothing is rendered a
/// second time between the verdict and the file. The write goes to a temporary
/// name in the same directory and is renamed into place, so a half-written PNG
/// never exists at the path a person chose.
///
/// # Errors
///
/// [`Error::Refused`] when the code did not read back — the message is the
/// reason, and nothing was written. [`Error::InvalidInput`] for a size, a
/// drawing, a payload or a path the host will not accept. [`Error::File`] when
/// the write itself failed.
#[tauri::command(rename_all = "snake_case")]
pub fn export_png(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    pixel_size: u32,
    path: String,
) -> Result<ExportReport> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    export_png_with(&conn, &svg, &payload, pixel_size, &path)
}

/// What [`verify_code`] does once the database is in hand.
fn verify_code_with(
    conn: &Connection,
    svg: &str,
    payload: &str,
    pixel_size: u32,
) -> Result<VerificationReport> {
    check_inputs(svg, payload, pixel_size)?;

    let verification = verify(svg.as_bytes(), payload.as_bytes(), pixel_size, &decoder())?;
    let report = verification.report;
    record(conn, "verify", &report, None)?;

    Ok(report)
}

/// What [`export_png`] does once the database is in hand.
fn export_png_with(
    conn: &Connection,
    svg: &str,
    payload: &str,
    pixel_size: u32,
    path: &str,
) -> Result<ExportReport> {
    check_inputs(svg, payload, pixel_size)?;
    check_destination(path)?;

    let verification = verify(svg.as_bytes(), payload.as_bytes(), pixel_size, &decoder())?;
    let report = verification.report;

    if !report.verified {
        let reason = report
            .reason
            .clone()
            .unwrap_or_else(|| "The code did not read back.".to_string());
        // The destination is not recorded: no file went there, and a row that
        // names a path is a row that says one exists.
        record(conn, "export", &report, None)?;
        log::warn!("an export was refused: {reason}");
        return Err(Error::Refused(reason));
    }

    let bytes_written = write_atomically(Path::new(path), &verification.png)?;
    record(conn, "export", &report, Some(path))?;
    log::info!(
        "exported {bytes_written} bytes verified by {}",
        report.decoder
    );

    Ok(ExportReport {
        report,
        path: path.to_string(),
        bytes_written,
    })
}

/// Everything the host refuses before it renders anything.
fn check_inputs(svg: &str, payload: &str, pixel_size: u32) -> Result<()> {
    if !(MIN_PIXEL_SIZE..=MAX_PIXEL_SIZE).contains(&pixel_size) {
        return Err(Error::InvalidInput(format!(
            "a code is made between {MIN_PIXEL_SIZE} and {MAX_PIXEL_SIZE} pixels square"
        )));
    }
    if svg.len() > MAX_SVG_BYTES {
        return Err(Error::InvalidInput(
            "that drawing is too large for this product to render".to_string(),
        ));
    }
    if payload.is_empty() {
        return Err(Error::InvalidInput(
            "there is nothing to encode".to_string(),
        ));
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(Error::InvalidInput(
            "that is more than one code can carry".to_string(),
        ));
    }
    Ok(())
}

/// The path a person chose in the system's save dialog, checked before it is
/// used. Absolute, and a PNG — the host writes one kind of file.
fn check_destination(path: &str) -> Result<()> {
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
    let is_png = destination
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
    if !is_png {
        return Err(Error::InvalidInput(
            "an export is a PNG file, so its name has to end in .png".to_string(),
        ));
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

    #[test]
    fn a_code_that_reads_back_is_verified_and_recorded() {
        let conn = workspace();
        let report = verify_code_with(&conn, &hello_world_svg(), HELLO_WORLD, 512).expect("verify");

        assert!(report.verified, "reason: {:?}", report.reason);
        assert_eq!(rows(&conn), vec![("verify".to_string(), 1, None)]);
    }

    #[test]
    fn an_export_of_a_code_that_does_not_read_writes_nothing() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let refused = export_png_with(&conn, &blank_svg(), HELLO_WORLD, 512, &path)
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
    }

    #[test]
    fn an_export_writes_exactly_the_bytes_that_were_decoded() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let export =
            export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path).expect("export");

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

    #[test]
    fn an_export_replaces_a_file_that_is_already_there() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");
        std::fs::write(&path, b"an older export").expect("seed");

        let export =
            export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path).expect("export");

        let written = std::fs::read(&path).expect("the file exists");
        assert_eq!(sha256_hex(&written), export.report.artefact_sha256);
    }

    #[test]
    fn the_host_refuses_what_it_will_not_render() {
        let conn = workspace();
        let svg = hello_world_svg();

        let too_small = verify_code_with(&conn, &svg, HELLO_WORLD, 32).expect_err("too small");
        let too_large = verify_code_with(&conn, &svg, HELLO_WORLD, 8192).expect_err("too large");
        let nothing = verify_code_with(&conn, &svg, "", 512).expect_err("nothing to encode");
        let too_much = verify_code_with(&conn, &svg, &"x".repeat(MAX_PAYLOAD_BYTES + 1), 512)
            .expect_err("too much");
        let huge_drawing =
            verify_code_with(&conn, &"x".repeat(MAX_SVG_BYTES + 1), HELLO_WORLD, 512)
                .expect_err("drawing too large");

        for error in [too_small, too_large, nothing, too_much, huge_drawing] {
            assert_eq!(kind_of(&error), "invalid_input");
        }
        assert!(
            rows(&conn).is_empty(),
            "nothing was rendered, so there is nothing to record"
        );
    }

    #[test]
    fn the_host_refuses_a_destination_it_was_not_given_properly() {
        let conn = workspace();
        let svg = hello_world_svg();

        for path in ["signatum.png", "code.jpg", "C:/somewhere/code.jpeg", ""] {
            let error = export_png_with(&conn, &svg, HELLO_WORLD, 512, path)
                .expect_err("this destination must be refused");
            assert_eq!(kind_of(&error), "invalid_input", "path: {path}");
        }
    }

    #[test]
    fn the_host_refuses_a_network_path_even_though_it_is_absolute() {
        for path in [
            "\\\\server\\share\\code.png",
            "\\\\?\\C:\\code.png",
            "//server/share/code.png",
        ] {
            let error = check_destination(path).expect_err(path);
            assert!(matches!(error, Error::InvalidInput(_)), "{path}: {error:?}");
            assert!(error.to_string().contains("network"), "{path}: {error}");
        }
    }

    #[test]
    fn an_export_report_reaches_the_interface_flat_and_in_snake_case() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("signatum.png");

        let export =
            export_png_with(&conn, &hello_world_svg(), HELLO_WORLD, 512, &path).expect("export");
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
