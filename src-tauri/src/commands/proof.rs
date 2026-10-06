//! The command the Create screen calls for a proof sheet: the export at several
//! sizes, each one proved, on one A4 page that checks the printer.
//!
//! The domain plans the sheet (`proof.ts`): which sizes, how many pixels each,
//! and which of them the resolution cannot render at all. The host takes that
//! plan and does for **each** remaining size exactly what an export does —
//! render at that size's pixels, draw the logo, decode, compare — and draws only
//! the sizes the decoder read back. A size that did not read is a box with the
//! decoder's sentence; a size the domain refused is a box with the domain's. If
//! nothing reads at all, nothing is written.
//!
//! The evidence is one `verifications` row per size that was attempted, written
//! after the file — as every export's is — with the path only on the rows whose
//! picture is in it. The identifier of each row is printed under its picture, so
//! the identifiers are made before the page is; the rows themselves still wait
//! for the file.
//!
//! From P2 the sheet carries a stamp, as every exported file does: its digest
//! covers the whole sheet, and its reference belongs to one row — the chosen
//! size's when that size was drawn, else the smallest drawn size's — because a
//! reference names one verification and a sheet holds several.
//!
//! # Changelog of this boundary
//!
//! - P1: `export_proof_sheet`.
//! - P2: the sheet is stamped unless `stamp_exports` is off.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::codes::{
    self, check_destination, check_inputs, load_logo, refusal, write_atomically, Asked, LogoRef,
};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::export::proof::{self as proof_page, Drawn, Sheet};
use crate::export::stamp::{Mark, Stamp};
use crate::imaging::verify::{decoder, verify, Verification};

/// The most sizes one sheet carries: the four standard ones and a chosen one.
pub const MAX_SIZES: usize = 5;

/// The smallest size the host will put on a sheet, in millimetres.
pub const MIN_MM: f64 = 5.0;

/// The largest: an A4 page less its two 10 mm margins — the domain's
/// `MAX_PROOF_MM`.
pub const MAX_MM: f64 = 190.0;

/// The longest note the domain's plan carries. Its notes are short and fixed;
/// one past this is not one of them.
pub const MAX_NOTE_CHARS: usize = 300;

/// The longest reason a size refused by the plan may carry — the same bound as
/// the note, for the same reason: it is printed, and the domain's are short.
pub const MAX_REASON_CHARS: usize = 300;

/// What is said when no size on the sheet read back, and nothing was written.
pub const NOTHING_READ: &str = "This code does not read at any size on the sheet.";

/// One size of the plan, as the domain made it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PlannedSize {
    /// The printed width of the whole code, quiet zone included.
    pub mm: f64,
    /// The raster's side at the sheet's resolution, rounded as the export rounds.
    pub pixel_size: u32,
    /// The size chosen on the Create screen.
    pub chosen: bool,
    /// The domain's sentence for a size this resolution cannot render; such a
    /// size is drawn as a box and never rendered.
    pub refused: Option<String>,
}

/// How one size ended.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SizeResult {
    /// The size, as it was asked for.
    pub mm: f64,
    /// Whether it was the chosen one.
    pub chosen: bool,
    /// True only when the decoder read this size back and its picture is on
    /// the sheet.
    pub verified: bool,
    /// One sentence when it is not: the domain's or the decoder's.
    pub reason: Option<String>,
    /// The `verifications` row for this size; `None` for a size the domain
    /// refused, which was never rendered.
    pub verification_id: Option<String>,
}

/// What the command answers with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ProofReport {
    /// The file that now exists.
    pub path: String,
    /// How many bytes it holds.
    pub bytes_written: u64,
    /// The decoder that read every picture on it, name and version.
    pub decoder: String,
    /// Every size, in the order it was asked for.
    pub sizes: Vec<SizeResult>,
}

/// Verify the code at every size of the plan, and write the sheet of the ones
/// that read.
///
/// Off the main thread: up to five renders and five decodes, the largest of
/// them 4096 pixels square.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a plan, a drawing, a payload, a resolution or a
/// path the host will not accept — before anything is rendered.
/// [`Error::Refused`] with [`NOTHING_READ`] when no size read back; nothing was
/// written, and every attempt is recorded. [`Error::Render`] and
/// [`Error::File`] as for every export.
#[tauri::command(async, rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
// Flat, snake-case arguments are the contract with the interface, as for every
// export.
pub fn export_proof_sheet(
    db: State<'_, Db>,
    svg: String,
    payload: String,
    logo: Option<LogoRef>,
    dpi: u32,
    sizes: Vec<PlannedSize>,
    summary: String,
    note: Option<String>,
    path: String,
    code_id: Option<String>,
) -> Result<ProofReport> {
    export_proof_sheet_with(
        &db.0,
        &ProofAsked {
            svg: &svg,
            payload: &payload,
            logo: logo.as_ref(),
            dpi,
            sizes: &sizes,
            summary: &summary,
            note: note.as_deref(),
            path: &path,
            code_id: code_id.as_deref(),
        },
    )
}

/// Everything the command is told, gathered so the core takes two arguments.
struct ProofAsked<'a> {
    svg: &'a str,
    payload: &'a str,
    logo: Option<&'a LogoRef>,
    dpi: u32,
    sizes: &'a [PlannedSize],
    summary: &'a str,
    note: Option<&'a str>,
    path: &'a str,
    code_id: Option<&'a str>,
}

impl ProofAsked<'_> {
    /// The export a single size is, in the shape `codes.rs` checks and
    /// verifies.
    fn at(&self, pixel_size: u32) -> Asked<'_> {
        Asked {
            svg: self.svg,
            payload: self.payload,
            pixel_size,
            logo: self.logo,
            dpi: Some(self.dpi),
            code_id: self.code_id,
        }
    }
}

/// One size, after the gate: never rendered, or rendered with this outcome
/// under this identifier.
enum Attempt<'a> {
    /// The plan refused it; it was not rendered.
    Planned(&'a str),
    /// It was rendered and decoded.
    Rendered {
        verification: Verification,
        id: String,
    },
}

/// What [`export_proof_sheet`] does once the database is in hand.
///
/// The lock is taken to load the logo and to write the rows, and not held
/// across the renders: five of them are seconds, and a workspace held shut for
/// seconds is a window that cannot do anything else.
fn export_proof_sheet_with(db: &Mutex<Connection>, asked: &ProofAsked) -> Result<ProofReport> {
    check_destination(asked.path, "pdf")?;
    check_plan(asked)?;

    let (logo, stamping) = {
        let conn = db.lock().expect("the database lock was poisoned");
        (
            load_logo(&conn, asked.logo)?,
            super::settings::stamp_exports(&conn)?,
        )
    };
    let placed = logo.as_ref().map(|(logo, area)| (logo, *area));
    let decoder = decoder();

    let mut attempts: Vec<Attempt> = Vec::with_capacity(asked.sizes.len());
    for size in asked.sizes {
        let attempt = match &size.refused {
            Some(reason) => Attempt::Planned(reason),
            None => Attempt::Rendered {
                verification: verify(
                    asked.svg.as_bytes(),
                    asked.payload.as_bytes(),
                    size.pixel_size,
                    &decoder,
                    placed,
                    Some(asked.dpi),
                )?,
                // Made now, because the page prints it; written as a row only
                // after the page is on the disk.
                id: crate::db::new_id(),
            },
        };
        attempts.push(attempt);
    }

    let any_read = attempts.iter().any(|attempt| {
        matches!(attempt, Attempt::Rendered { verification, .. } if verification.report.verified)
    });
    if !any_read {
        // Every attempt is a fact, and none of them is a file.
        record(db, asked, &attempts, None, None)?;
        log::warn!("a proof sheet was refused: no size read back");
        return Err(Error::Refused(NOTHING_READ.to_string()));
    }

    let drawn: Vec<proof_page::Size> = asked
        .sizes
        .iter()
        .zip(&attempts)
        .map(|(size, attempt)| proof_page::Size {
            mm: size.mm,
            chosen: size.chosen,
            drawn: match attempt {
                Attempt::Planned(reason) => Drawn::Refused { reason },
                Attempt::Rendered { verification, id } if verification.report.verified => {
                    Drawn::Verified {
                        png: &verification.png,
                        verification_id: id,
                    }
                }
                Attempt::Rendered { verification, .. } => Drawn::Refused {
                    reason: verification
                        .report
                        .reason
                        .as_deref()
                        .unwrap_or("The code did not read back."),
                },
            },
        })
        .collect();
    // The stamp's reference is its own v4, never a row's identifier; the row it
    // is recorded on is the one whose picture the stamp speaks for first.
    let reference = crate::db::new_stamp_ref();
    let stamped_row = if stamping {
        stamped_attempt(asked.sizes, &attempts)
    } else {
        None
    };
    let mark = stamped_row.and_then(|index| match &attempts[index] {
        Attempt::Rendered { verification, .. } => Some(Mark {
            reference: &reference,
            decoder: &verification.report.decoder,
        }),
        Attempt::Planned(_) => None,
    });
    let sealed = proof_page::sheet(&Sheet {
        decoder: &decoder,
        summary: asked.summary,
        note: asked.note,
        sizes: &drawn,
        stamp: mark,
    })?;
    let stamp = stamped_row.zip(sealed.stamp.as_ref());

    let bytes_written = write_atomically(Path::new(asked.path), &sealed.bytes)?;
    record(db, asked, &attempts, Some(asked.path), stamp)?;

    let sizes: Vec<SizeResult> = asked
        .sizes
        .iter()
        .zip(&attempts)
        .map(|(size, attempt)| match attempt {
            Attempt::Planned(reason) => SizeResult {
                mm: size.mm,
                chosen: size.chosen,
                verified: false,
                reason: Some((*reason).to_string()),
                verification_id: None,
            },
            Attempt::Rendered { verification, id } => SizeResult {
                mm: size.mm,
                chosen: size.chosen,
                verified: verification.report.verified,
                reason: (!verification.report.verified).then(|| refusal(&verification.report)),
                verification_id: Some(id.clone()),
            },
        })
        .collect();
    let read = sizes.iter().filter(|size| size.verified).count();
    log::info!(
        "a proof sheet of {bytes_written} bytes was written: {read} of {} sizes read by {decoder}",
        sizes.len()
    );

    Ok(ProofReport {
        path: asked.path.to_string(),
        bytes_written,
        decoder,
        sizes,
    })
}

/// Write one row per size that was rendered: `export`, `pdf`, the resolution,
/// the saved code, and the path only on a row whose picture is in the file —
/// and the stamp on the one row it belongs to, given as the index of its
/// attempt.
///
/// In one transaction: the rows of one sheet are one fact, and a failure part
/// of the way through leaves none of them rather than some — a sheet whose
/// record says three sizes were tried when five were is a record that lies.
fn record(
    db: &Mutex<Connection>,
    asked: &ProofAsked,
    attempts: &[Attempt],
    written: Option<&str>,
    stamp: Option<(usize, &Stamp)>,
) -> Result<()> {
    let conn = db.lock().expect("the database lock was poisoned");
    // `unchecked_transaction` because the connection is shared behind the lock
    // rather than borrowed mutably; nothing else can open one while it is held.
    let transaction = conn.unchecked_transaction()?;
    for (index, attempt) in attempts.iter().enumerate() {
        let Attempt::Rendered { verification, id } = attempt else {
            continue;
        };
        let report = &verification.report;
        codes::record_as(
            &transaction,
            id,
            "export",
            report,
            written.filter(|_| report.verified),
            Some(asked.dpi),
            Some("pdf"),
            asked.code_id,
            stamp
                .filter(|(stamped, _)| *stamped == index)
                .map(|(_, stamp)| stamp),
        )?;
    }
    // Dropped without a commit on any `?` above, which rolls every row back.
    transaction.commit()?;
    Ok(())
}

/// The attempt whose row the sheet's stamp is recorded on: the chosen size's
/// when it was drawn, else the smallest drawn size's. `None` when nothing was
/// drawn, which is a sheet that is not written.
fn stamped_attempt(sizes: &[PlannedSize], attempts: &[Attempt]) -> Option<usize> {
    let drawn = |index: &usize| {
        matches!(
            &attempts[*index],
            Attempt::Rendered { verification, .. } if verification.report.verified
        )
    };
    let indices = 0..sizes.len().min(attempts.len());
    indices
        .clone()
        .filter(drawn)
        .find(|index| sizes[*index].chosen)
        .or_else(|| {
            indices
                .filter(drawn)
                .min_by(|a, b| sizes[*a].mm.total_cmp(&sizes[*b].mm))
        })
}

/// Everything about the plan the host refuses before it renders anything.
fn check_plan(asked: &ProofAsked) -> Result<()> {
    if asked.sizes.is_empty() || asked.sizes.len() > MAX_SIZES {
        return Err(Error::InvalidInput(format!(
            "A proof sheet carries between 1 and {MAX_SIZES} sizes."
        )));
    }
    if asked
        .note
        .is_some_and(|note| note.chars().count() > MAX_NOTE_CHARS)
    {
        return Err(Error::InvalidInput(format!(
            "A note on a proof sheet is at most {MAX_NOTE_CHARS} characters."
        )));
    }
    // The summary is not capped here: one too long to print is replaced on the
    // page by a sentence, as one the font cannot draw is (`export::proof`).

    for size in asked.sizes {
        if !size.mm.is_finite() || !(MIN_MM..=MAX_MM).contains(&size.mm) {
            return Err(Error::InvalidInput(format!(
                "A size on a proof sheet is between {MIN_MM} and {MAX_MM} millimetres."
            )));
        }
        if let Some(reason) = &size.refused {
            if reason.chars().count() > MAX_REASON_CHARS {
                return Err(Error::InvalidInput(format!(
                    "A size's reason is at most {MAX_REASON_CHARS} characters."
                )));
            }
            continue;
        }

        // The drawing, the payload, the resolution and the pixels — the checks
        // every export makes, made for this size.
        check_inputs(&asked.at(size.pixel_size))?;
        let expected = (size.mm / 25.4 * f64::from(asked.dpi)).round();
        if (f64::from(size.pixel_size) - expected).abs() > 1.0 {
            return Err(Error::InvalidInput(format!(
                "At {} dpi, {} mm is {expected} pixels, not {}.",
                asked.dpi,
                proof_page::millimetres(size.mm),
                size.pixel_size
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::export::pdf::points;
    use crate::export::proof::inspect::{content, holds, images, placements, read, shown};
    use crate::export::proof::{encode, UNPRINTABLE_SUMMARY};
    use crate::export::stamp::{read_stamp, Kind};
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};
    use crate::imaging::verify::{sha256_hex, REASON_NO_CODE};

    const DPI: u32 = 300;

    fn workspace() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        Mutex::new(conn)
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

        fn count(&self) -> usize {
            std::fs::read_dir(&self.0).expect("read").count()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The domain's rounding: `Math.round(mm / 25.4 * dpi)`.
    fn pixels(mm: f64, dpi: u32) -> u32 {
        (mm / 25.4 * f64::from(dpi)).round() as u32
    }

    /// A plan of these sizes at this resolution, chosen one marked.
    fn plan(millimetres: &[f64], dpi: u32, chosen: f64) -> Vec<PlannedSize> {
        millimetres
            .iter()
            .map(|&mm| PlannedSize {
                mm,
                pixel_size: pixels(mm, dpi),
                chosen: mm == chosen,
                refused: None,
            })
            .collect()
    }

    /// The standard sheet: 15, 20, 25 and 30 mm, 25 chosen.
    fn standard() -> Vec<PlannedSize> {
        plan(&[15.0, 20.0, 25.0, 30.0], DPI, 25.0)
    }

    struct Request<'a> {
        svg: String,
        dpi: u32,
        sizes: Vec<PlannedSize>,
        summary: &'a str,
        note: Option<&'a str>,
        path: String,
        code_id: Option<&'a str>,
    }

    impl<'a> Request<'a> {
        fn new(path: String) -> Self {
            Self {
                svg: hello_world_svg(),
                dpi: DPI,
                sizes: standard(),
                summary: "Opens example.com",
                note: None,
                path,
                code_id: None,
            }
        }

        fn send(&self, db: &Mutex<Connection>) -> Result<ProofReport> {
            export_proof_sheet_with(
                db,
                &ProofAsked {
                    svg: &self.svg,
                    payload: HELLO_WORLD,
                    logo: None,
                    dpi: self.dpi,
                    sizes: &self.sizes,
                    summary: self.summary,
                    note: self.note,
                    path: &self.path,
                    code_id: self.code_id,
                },
            )
        }
    }

    /// Every row: verified, path, format, dpi, code.
    #[allow(clippy::type_complexity)]
    fn rows(
        db: &Mutex<Connection>,
    ) -> Vec<(
        String,
        i64,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
    )> {
        let conn = db.lock().expect("lock");
        let mut statement = conn
            .prepare(
                "SELECT id, verified, path, format, dpi, code_id FROM verifications ORDER BY id",
            )
            .expect("prepare");
        let found = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .expect("query")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read back");
        found
    }

    fn kind_of(error: &Error) -> String {
        serde_json::to_value(error)
            .expect("serialise")
            .get("kind")
            .and_then(|kind| kind.as_str())
            .map(str::to_string)
            .expect("every error has a kind")
    }

    fn says(pdf: &[u8], sentence: &str) -> bool {
        holds(&shown(&content(pdf)), &encode(sentence).expect("encodable"))
    }

    /// The proof of done, on this side: four sizes, each verified at its own
    /// raster, each picture reading back as the payload at exactly its printed
    /// width — and four rows, each with the path, each named on the page.
    #[test]
    fn a_sheet_is_four_verified_sizes_each_at_its_own_width() {
        let db = workspace();
        let scratch = Scratch::new();
        let request = Request::new(scratch.file("menu-proof.pdf"));

        let report = request.send(&db).expect("the sheet is written");

        let pdf = std::fs::read(&request.path).expect("the file exists");
        assert_eq!(report.bytes_written, pdf.len() as u64);
        assert_eq!(report.path, request.path);
        assert_eq!(report.decoder, decoder());
        assert!(report.sizes.iter().all(|size| size.verified));
        assert_eq!(scratch.count(), 1, "the staged file was renamed, not left");

        let pictures = images(&pdf);
        assert_eq!(pictures.len(), 4);
        for (side, samples) in &pictures {
            assert_eq!(
                read(*side, samples).as_deref(),
                Some(HELLO_WORLD.as_bytes())
            );
        }
        let widths: Vec<f64> = placements(&content(&pdf)).iter().map(|p| p.0).collect();
        for (width, mm) in widths.iter().zip([15.0, 20.0, 25.0, 30.0]) {
            assert!(
                (width - points(mm)).abs() < 0.005,
                "{mm} mm is {width} wide"
            );
        }
        assert!(String::from_utf8_lossy(&pdf).contains("/MediaBox [0 0 595.28 841.89]"));

        let recorded = rows(&db);
        assert_eq!(recorded.len(), 4, "one row per size attempted");
        for (id, verified, path, format, dpi, _) in &recorded {
            assert_eq!(*verified, 1);
            assert_eq!(path.as_deref(), Some(request.path.as_str()));
            assert_eq!(format.as_deref(), Some("pdf"));
            assert_eq!(*dpi, Some(300));
            let tail: String = id.chars().filter(char::is_ascii_hexdigit).collect();
            let tail = &tail[tail.len() - 8..];
            assert!(
                says(&pdf, &format!("Verified \u{b7} {tail}")),
                "the page names row {id}"
            );
        }
        let reported: Vec<String> = report
            .sizes
            .iter()
            .filter_map(|size| size.verification_id.clone())
            .collect();
        let mut stored: Vec<String> = recorded.into_iter().map(|row| row.0).collect();
        let mut reported_sorted = reported.clone();
        reported_sorted.sort();
        stored.sort();
        assert_eq!(reported_sorted, stored, "the answer names the rows written");
    }

    /// A size the domain refused is never rendered: no row, no picture, its
    /// sentence in its box, and its answer says why.
    #[test]
    fn a_size_the_domain_refused_is_a_box_and_never_rendered() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        let sentence =
            "At 300 dpi, 15 mm is 177 pixels \u{2014} too few to render. Choose a finer resolution.";
        request.sizes[0].refused = Some(sentence.to_string());

        let report = request.send(&db).expect("the sheet is written");

        let first = &report.sizes[0];
        assert!(!first.verified);
        assert_eq!(first.reason.as_deref(), Some(sentence));
        assert_eq!(first.verification_id, None);
        assert_eq!(rows(&db).len(), 3, "the refused size was not attempted");

        let pdf = std::fs::read(&request.path).expect("the file exists");
        assert_eq!(images(&pdf).len(), 3);
        let widths: Vec<f64> = placements(&content(&pdf)).iter().map(|p| p.0).collect();
        assert!(!widths.contains(&points(15.0)), "15 mm was drawn");
        assert!(says(&pdf, sentence));
    }

    /// A size the decoder does not read back is a box with the decoder's
    /// sentence; its row is written, without a path.
    #[test]
    fn a_size_the_decoder_refuses_is_a_box_with_the_reason() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        // The HELLO WORLD symbol drawn in a quarter of a scene twice its size:
        // at 15 mm and 110 dpi it is 32 pixels for 29 modules, which no
        // decoder resolves, while the larger sizes on the same sheet still read.
        request.svg = hello_world_svg()
            .replace("viewBox=\"0 0 29 29\"", "viewBox=\"0 0 58 58\"")
            .replace(
                "<rect width=\"29\" height=\"29\"",
                "<rect width=\"58\" height=\"58\"",
            );
        assert!(request.svg.contains("viewBox=\"0 0 58 58\""));
        assert!(request.svg.contains("<rect width=\"58\""));
        request.dpi = 110;
        request.sizes = plan(&[15.0, 20.0, 25.0, 30.0], 110, 25.0);

        let report = request.send(&db).expect("the sheet is written");

        let smallest = &report.sizes[0];
        assert!(
            !smallest.verified,
            "15 mm read back; this test needs a size that does not"
        );
        assert!(
            report.sizes.iter().any(|size| size.verified),
            "no size read back; this test needs a sheet that is written"
        );
        assert_eq!(smallest.reason.as_deref(), Some(REASON_NO_CODE));
        assert!(smallest.verification_id.is_some(), "it was attempted");

        let pdf = std::fs::read(&request.path).expect("the file exists");
        let drawn = report.sizes.iter().filter(|size| size.verified).count();
        assert_eq!(images(&pdf).len(), drawn);
        assert!(says(&pdf, REASON_NO_CODE));

        let recorded = rows(&db);
        assert_eq!(recorded.len(), 4);
        assert_eq!(
            recorded.iter().filter(|row| row.2.is_some()).count(),
            drawn,
            "only the drawn sizes name the file"
        );
    }

    /// Nothing reads: nothing is written, and every attempt is recorded without
    /// a path.
    #[test]
    fn a_sheet_on_which_nothing_reads_is_refused_and_writes_nothing() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        request.svg = blank_svg();

        let refused = request.send(&db).expect_err("nothing read");

        assert_eq!(kind_of(&refused), "refused");
        assert_eq!(refused.to_string(), NOTHING_READ);
        assert!(!Path::new(&request.path).exists());
        assert_eq!(scratch.count(), 0, "not even a partial one");
        let recorded = rows(&db);
        assert_eq!(recorded.len(), 4, "every attempt is a fact");
        assert!(recorded.iter().all(|row| row.1 == 0 && row.2.is_none()));
        assert!(recorded.iter().all(|row| row.3.as_deref() == Some("pdf")));
    }

    /// The rows of one sheet are written together or not at all: the second
    /// of two rows that share an identifier is refused by the primary key, and
    /// the first goes with it.
    #[test]
    fn a_failing_row_leaves_none_of_the_sheet_recorded() {
        let db = workspace();
        let scratch = Scratch::new();
        let request = Request::new(scratch.file("menu-proof.pdf"));
        let attempt = |id: &str| Attempt::Rendered {
            verification: verify(
                hello_world_svg().as_bytes(),
                HELLO_WORLD.as_bytes(),
                128,
                &decoder(),
                None,
                Some(DPI),
            )
            .expect("verify"),
            id: id.to_string(),
        };
        let id = crate::db::new_id();
        let attempts = [attempt(&id), attempt(&id)];

        let failed = record(
            &db,
            &ProofAsked {
                svg: &request.svg,
                payload: HELLO_WORLD,
                logo: None,
                dpi: DPI,
                sizes: &request.sizes,
                summary: request.summary,
                note: None,
                path: &request.path,
                code_id: None,
            },
            &attempts,
            Some(&request.path),
            None,
        )
        .expect_err("two rows under one identifier");

        assert_eq!(kind_of(&failed), "database");
        assert!(rows(&db).is_empty(), "the first row was not rolled back");
    }

    #[test]
    fn a_sheet_with_only_sizes_the_domain_refused_is_refused() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        for size in &mut request.sizes {
            size.refused = Some("Too few pixels.".to_string());
        }

        let refused = request.send(&db).expect_err("nothing was rendered");

        assert_eq!(refused.to_string(), NOTHING_READ);
        assert!(!Path::new(&request.path).exists());
        assert!(rows(&db).is_empty(), "nothing was attempted");
    }

    /// Everything the host refuses before it renders: no file, no row.
    #[test]
    fn the_host_refuses_a_plan_it_will_not_render() {
        let db = workspace();
        let scratch = Scratch::new();
        let path = scratch.file("menu-proof.pdf");

        let mut mismatched = Request::new(path.clone());
        mismatched.sizes[2].pixel_size += 2;

        let mut six = Request::new(path.clone());
        six.sizes = plan(&[15.0, 20.0, 25.0, 30.0, 40.0, 50.0], DPI, 25.0);

        let mut none = Request::new(path.clone());
        none.sizes.clear();

        let mut too_small = Request::new(path.clone());
        too_small.sizes = plan(&[4.0, 25.0], DPI, 25.0);

        let mut too_large = Request::new(path.clone());
        too_large.sizes = plan(&[25.0, 191.0], DPI, 25.0);

        let mut not_a_number = Request::new(path.clone());
        not_a_number.sizes[0].mm = f64::NAN;

        let unc = Request::new("\\\\server\\share\\menu-proof.pdf".to_string());
        let wrong_extension = Request::new(scratch.file("menu-proof.png"));
        let relative = Request::new("menu-proof.pdf".to_string());

        let long_note = "n".repeat(MAX_NOTE_CHARS + 1);
        let mut noted = Request::new(path.clone());
        noted.note = Some(&long_note);

        let mut out_of_range = Request::new(path.clone());
        out_of_range.dpi = 20;
        out_of_range.sizes = plan(&[25.0], 20, 25.0);

        let mut no_resolution = Request::new(path.clone());
        no_resolution.dpi = 0;

        for (name, request) in [
            ("pixel/mm mismatch", mismatched),
            ("six sizes", six),
            ("no sizes", none),
            ("mm below 5", too_small),
            ("mm above 190", too_large),
            ("mm not a number", not_a_number),
            ("UNC path", unc),
            ("wrong extension", wrong_extension),
            ("relative path", relative),
            ("note too long", noted),
            ("pixels below the floor", out_of_range),
            ("zero dpi", no_resolution),
        ] {
            let refused = request.send(&db).expect_err(name);
            assert_eq!(kind_of(&refused), "invalid_input", "{name}: {refused}");
        }
        assert!(
            rows(&db).is_empty(),
            "nothing was rendered, so nothing is recorded"
        );
        assert_eq!(scratch.count(), 0);
    }

    /// The mismatch is said in numbers a person can check.
    #[test]
    fn a_pixel_size_the_domain_would_not_round_to_is_named() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        request.sizes[2].pixel_size = 300;

        let refused = request.send(&db).expect_err("mismatch");

        assert_eq!(
            refused.to_string(),
            "At 300 dpi, 25 mm is 295 pixels, not 300."
        );
    }

    /// One pixel either way is the domain's rounding and is accepted.
    #[test]
    fn one_pixel_either_way_is_accepted() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        request.sizes[2].pixel_size += 1;
        request.sizes[3].pixel_size -= 1;

        request.send(&db).expect("within the domain's rounding");
    }

    /// A long summary is replaced on the page, not refused (a long
    /// international link can pass 200 characters honestly); a summary the font
    /// cannot draw likewise.
    #[test]
    fn a_summary_the_sheet_cannot_print_is_replaced_and_not_refused() {
        let db = workspace();
        let scratch = Scratch::new();

        let long = "s".repeat(201);
        let mut request = Request::new(scratch.file("long-proof.pdf"));
        request.summary = &long;
        request.send(&db).expect("a long summary is not a refusal");
        let pdf = std::fs::read(&request.path).expect("written");
        assert!(says(&pdf, UNPRINTABLE_SUMMARY));

        let mut foreign = Request::new(scratch.file("foreign-proof.pdf"));
        foreign.summary = "Opens \u{6771}\u{4eac}.example";
        foreign.send(&db).expect("written");
        let pdf = std::fs::read(&foreign.path).expect("written");
        assert!(says(&pdf, UNPRINTABLE_SUMMARY));
    }

    #[test]
    fn the_sheet_carries_no_date_no_author_no_title_and_no_path() {
        let db = workspace();
        let scratch = Scratch::new();
        let request = Request::new(scratch.file("private-folder-proof.pdf"));

        request.send(&db).expect("written");

        let pdf = std::fs::read(&request.path).expect("written");
        let text = String::from_utf8_lossy(&pdf);
        for key in ["/CreationDate", "/ModDate", "/Author", "/Title", "/Creator"] {
            assert!(!text.contains(key), "{key} is in the file");
        }
        assert!(!text.contains("private-folder"), "the path is in the file");
        assert!(text.contains("/Producer (Signatum)"));
    }

    #[test]
    fn every_row_names_the_saved_code_it_was_of() {
        let db = workspace();
        let scratch = Scratch::new();
        let saved = {
            let conn = db.lock().expect("lock");
            crate::db::codes::insert(
                &conn,
                &crate::db::codes::NewCode {
                    name: "Menu",
                    kind: "link",
                    payload_json: "{}",
                    style_json: "{}",
                    size_json: "{}",
                    logo_id: None,
                    logo_json: None,
                    scene_sha256: &"a".repeat(64),
                },
            )
            .expect("save")
            .id
        };
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        request.code_id = Some(&saved);

        request.send(&db).expect("written");

        assert!(rows(&db)
            .iter()
            .all(|row| row.5.as_deref() == Some(saved.as_str())));
    }

    #[test]
    fn the_answer_reaches_the_interface_flat_and_in_snake_case() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        request.sizes[0].refused = Some("Too few pixels.".to_string());

        let report = request.send(&db).expect("written");
        let json = serde_json::to_value(&report).expect("serialise");

        for key in ["path", "bytes_written", "decoder", "sizes"] {
            assert!(json.get(key).is_some(), "`{key}` is missing");
        }
        let first = &json["sizes"][0];
        for key in ["mm", "chosen", "verified", "reason", "verification_id"] {
            assert!(first.get(key).is_some(), "`sizes[].{key}` is missing");
        }
        assert_eq!(first["verification_id"], serde_json::Value::Null);
        assert_eq!(first["mm"], serde_json::json!(15.0));
    }

    /// The plan arrives as the interface sends it.
    #[test]
    fn a_planned_size_is_read_in_snake_case() {
        let size: PlannedSize = serde_json::from_value(serde_json::json!({
            "mm": 25,
            "pixel_size": 295,
            "chosen": true,
            "refused": null
        }))
        .expect("deserialise");

        assert_eq!((size.mm, size.pixel_size, size.chosen), (25.0, 295, true));
        assert!(size.refused.is_none());
    }

    /// Every row's identifier, stamp reference and stamp digest.
    #[allow(clippy::type_complexity)]
    fn stamps(db: &Mutex<Connection>) -> Vec<(String, Option<String>, Option<String>)> {
        let conn = db.lock().expect("lock");
        let mut statement = conn
            .prepare("SELECT id, stamp_ref, stamp_digest FROM verifications ORDER BY id")
            .expect("prepare");
        let found = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .expect("query")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("read back");
        found
    }

    /// The sheet is stamped like every export: its digest covers the whole
    /// sheet, and its reference is on the chosen size's row and no other.
    #[test]
    fn a_sheet_is_stamped_and_the_chosen_size_holds_the_stamp() {
        let db = workspace();
        let scratch = Scratch::new();
        let request = Request::new(scratch.file("menu-proof.pdf"));

        let report = request.send(&db).expect("written");

        let pdf = std::fs::read(&request.path).expect("the file exists");
        let found = read_stamp(&pdf, Kind::Pdf)
            .expect("read")
            .expect("the sheet carries a stamp");
        assert!(found.intact);
        assert!(
            !found
                .stamp
                .json()
                .expect("json")
                .contains(&sha256_hex(HELLO_WORLD.as_bytes())),
            "the payload's digest is not in the stamp"
        );
        assert_eq!(found.stamp.decoder, decoder());

        let chosen = report
            .sizes
            .iter()
            .find(|size| size.chosen)
            .and_then(|size| size.verification_id.clone())
            .expect("the chosen size was drawn");
        let recorded = stamps(&db);
        let stamped: Vec<_> = recorded
            .iter()
            .filter(|(_, reference, _)| reference.is_some())
            .collect();
        assert_eq!(stamped.len(), 1, "one stamp, one row");
        let (id, reference, digest) = stamped[0];
        assert_eq!(*id, chosen);
        assert_eq!(reference.as_deref(), Some(found.stamp.reference.as_str()));
        assert_eq!(digest.as_deref(), Some(found.stamp.digest.as_str()));
        assert_ne!(found.stamp.reference, *id);
    }

    /// When the chosen size was not drawn, the stamp is the smallest drawn
    /// size's.
    #[test]
    fn a_sheet_whose_chosen_size_was_not_drawn_stamps_the_smallest_drawn_one() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut request = Request::new(scratch.file("menu-proof.pdf"));
        // 25 mm is chosen; refuse it and 15 mm in the plan, leaving 20 and 30.
        request.sizes[0].refused = Some("Too few pixels.".to_string());
        request.sizes[2].refused = Some("Too few pixels.".to_string());

        let report = request.send(&db).expect("written");

        let smallest_drawn = report
            .sizes
            .iter()
            .find(|size| size.mm == 20.0)
            .and_then(|size| size.verification_id.clone())
            .expect("20 mm was drawn");
        let stamped: Vec<String> = stamps(&db)
            .into_iter()
            .filter(|(_, reference, _)| reference.is_some())
            .map(|(id, _, _)| id)
            .collect();
        assert_eq!(stamped, vec![smallest_drawn]);
    }

    #[test]
    fn a_sheet_written_with_stamping_off_carries_no_stamp() {
        let db = workspace();
        {
            let conn = db.lock().expect("lock");
            crate::db::settings::set(&conn, crate::commands::settings::STAMP_EXPORTS, "false")
                .expect("turn it off");
        }
        let scratch = Scratch::new();
        let request = Request::new(scratch.file("menu-proof.pdf"));

        request.send(&db).expect("written");

        let pdf = std::fs::read(&request.path).expect("the file exists");
        assert_eq!(read_stamp(&pdf, Kind::Pdf).expect("read"), None);
        assert!(stamps(&db)
            .iter()
            .all(|(_, reference, digest)| reference.is_none() && digest.is_none()));
    }
}
