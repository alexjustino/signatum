//! The commands the Batch screen calls: read the file a person chose, run the
//! plan the domain made, cancel a run, and write the report beside the codes.
//!
//! A batch is the Create pipeline in a loop (ADR-029) and nothing more
//! ambitious than that: every line is rendered, decoded and compared by the
//! very function a single export uses, writes its own `verifications` row, and
//! reaches the disk only if the decoder read it back. What the loop adds is
//! that **a line that cannot be made never stops the rest** — a refusal or a
//! failure is a line of a report, not the end of a run.
//!
//! Two promises are kept here rather than upstream, because upstream is the
//! interface and the interface is not where a filesystem is defended:
//!
//! - **Every file stays in the folder that was chosen.** The folder is
//!   canonicalised once; each file name is a single segment, re-checked here
//!   even though the domain already sanitised it (a separator, a `..`, a
//!   reserved Windows name or a control character is a *refused line*, never a
//!   path); and the path that is finally built is asserted to sit directly in
//!   that folder before anything is written.
//! - **The host does not build the report.** The domain neutralises the
//!   formulas (`=`, `+`, `-`, `@`) and hands over a finished CSV; this module
//!   writes it, into the same folder, without a previous report ever being
//!   overwritten.
//!
//! `read_text_file` is the second and last command in this product that reads a
//! file somebody chose — `import_logo` is the first. It is capped by the
//! directory entry before a byte is read, it takes only a `.csv` or a `.txt`,
//! and it never echoes the path back.
//!
//! # Changelog of this boundary
//!
//! - F9: `read_text_file`, `run_batch`, `cancel_batch`, `write_batch_report`,
//!   the `batch:progress` event, and the `batches`/`batch_rows` record
//!   (migration 005).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::codes::{self, Asked, LogoRef, Written as FileKind};
use crate::commands::logos::RESERVED;
use crate::db::batches::{self, Counts, NewBatch, NewRow};
use crate::db::{Db, MAX_NAME_CHARS};
use crate::error::{Error, Result};

/// The most lines one run will take. The same ceiling the domain's parser
/// enforces, stated again on this side because a host that trusts a number it
/// was handed is not a boundary.
pub const MAX_BATCH_ROWS: usize = 10_000;

/// The largest text file this host will read for a batch. A CSV of ten thousand
/// links is a fraction of this; a file past it is not a list of codes.
pub const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

/// The largest report this host will write. Ten thousand lines of
/// `line,name,file,status,reason` do not approach it.
pub const MAX_REPORT_BYTES: usize = 4 * 1024 * 1024;

/// The most scene bytes one run will hold at once. A plan arrives whole, so
/// this is the ceiling on what one call to `run_batch` can ask this process to
/// keep in memory; a list past it is run in parts.
pub const MAX_BATCH_SVG_BYTES: usize = 256 * 1024 * 1024;

/// What the report file is called, before the number that keeps an earlier one.
pub const REPORT_STEM: &str = "signatum-report";

/// How many reports one folder will hold before this host stops inventing
/// names. A folder with a thousand reports in it is not a folder somebody is
/// still reading.
const MAX_REPORTS: u32 = 999;

/// The event every finished line is announced on, so the screen can count.
pub const PROGRESS_EVENT: &str = "batch:progress";

/// What a cancelled line's report says. The run stopped; this line was never
/// attempted, and saying anything else about it would be an invention.
pub const CANCELLED: &str = "Cancelled.";

/// The flag [`cancel_batch`] raises and a run reads between lines.
///
/// Managed state rather than an argument: the command that stops a run is not
/// the command that is running it, and the two meet on this one boolean. It is
/// lowered when a run starts and when it ends, so a cancel that arrived while
/// nothing was running cannot kill the next run.
#[derive(Default)]
pub struct BatchCancel {
    /// Raised by `cancel_batch`, read between lines by the run.
    pub flag: Mutex<bool>,
    /// Whether a run is in progress. One at a time, by construction: two runs
    /// would share the one cancel flag, and a Cancel that stops the wrong run
    /// is a promise broken. A second `run_batch` while one is going is refused
    /// with a sentence.
    pub running: AtomicBool,
}

/// One line of the plan, as the domain made it: the scene it drew, what that
/// scene must read back as, and the file name it chose.
///
/// The host does not plan and does not name — it verifies and writes. `line` is
/// the line of the CSV as a person sees it in their spreadsheet, and is carried
/// through untouched so a report can be read beside the file it came from.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PlannedRow {
    /// The line of the CSV this came from.
    pub line: u32,
    /// The file name, without an extension and without a folder.
    pub file: String,
    /// The scene to render.
    pub svg: String,
    /// What the decoder has to read back, byte for byte.
    pub payload: String,
    /// The logo to draw, when there is one.
    pub logo: Option<LogoRef>,
    /// How many pixels square the artefact is made at.
    pub pixel_size: u32,
}

/// How one line ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RowStatus {
    /// The file is on the disk, and a decoder read it back first.
    Written,
    /// The scan gate said no. Nothing was written.
    Refused,
    /// The line could not be attempted, or could not be saved.
    Failed,
    /// The run was cancelled before this line was reached.
    Skipped,
}

impl RowStatus {
    /// The word the record keeps and the report shows — one word for one idea.
    fn token(self) -> &'static str {
        match self {
            RowStatus::Written => "written",
            RowStatus::Refused => "refused",
            RowStatus::Failed => "failed",
            RowStatus::Skipped => "skipped",
        }
    }
}

/// What happened to one line, as the interface reads it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RowResult {
    /// The line of the CSV.
    pub line: u32,
    /// The file name it was given.
    pub file: String,
    /// How it ended.
    pub status: RowStatus,
    /// One sentence for anything other than a file that now exists.
    pub reason: Option<String>,
}

/// What a run answers with: the counts, and every line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct BatchReport {
    /// The run this was, as the workspace recorded it.
    pub batch_id: String,
    /// Lines whose file is on the disk.
    pub written: u32,
    /// Lines the scan gate refused.
    pub refused: u32,
    /// Lines that could not be attempted or saved.
    pub failed: u32,
    /// Lines never reached, because the run was cancelled.
    pub skipped: u32,
    /// Every line, in the order it was handed over.
    pub results: Vec<RowResult>,
}

/// What the screen is told after every line, so a counter can move.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct Progress<'a> {
    /// The run this belongs to.
    pub batch_id: &'a str,
    /// How many lines are finished.
    pub done: usize,
    /// How many there are.
    pub total: usize,
    /// The line that just finished.
    pub line: u32,
    /// How it ended.
    pub status: RowStatus,
}

/// The text of a file somebody chose. A shape rather than a bare string so the
/// answer can grow a fact about the file without changing the call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct TextFile {
    /// The file's contents, decoded as UTF-8, without a byte-order mark.
    pub text: String,
}

/// Where the report went.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportFile {
    /// The full path of the file that now exists.
    pub path: String,
}

/// Read the CSV a person chose in the open dialog.
///
/// The only reason this exists: the interface cannot read files, and a batch
/// starts with one. It is therefore as narrow as it can be — an absolute local
/// path, a `.csv` or a `.txt`, capped by the directory entry before a byte is
/// read, decoded as UTF-8 or refused. The path is never echoed back, in the
/// answer or in an error.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path this host will not read, a file that is
/// too large, and a file that is not UTF-8 text; [`Error::File`] when the read
/// itself failed.
#[tauri::command(async, rename_all = "snake_case")]
pub fn read_text_file(path: String) -> Result<TextFile> {
    read_text_file_at(&path)
}

/// Run the plan: one verified file per line, into the folder that was chosen.
///
/// Off the main thread, because a run is minutes of rendering and the window
/// must stay alive to show the counter and offer the Cancel. Every line emits
/// [`PROGRESS_EVENT`]; the answer arrives when the last one is done.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a format, a folder or a number of lines the host
/// will not take — the things that make the whole run impossible. Nothing that
/// happens to a single line is an error here: it is a line of the report.
#[tauri::command(async, rename_all = "snake_case")]
pub fn run_batch(
    app: AppHandle,
    db: State<'_, Db>,
    cancel: State<'_, BatchCancel>,
    folder: String,
    format: String,
    dpi: u32,
    rows: Vec<PlannedRow>,
) -> Result<BatchReport> {
    if cancel
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(Error::InvalidInput(
            "A batch is already running.".to_string(),
        ));
    }
    lower(&cancel);
    let report = run_batch_with(
        &db.0,
        &BatchAsked {
            folder: &folder,
            format: &format,
            dpi,
            rows: &rows,
        },
        &|progress| {
            if let Err(error) = app.emit(PROGRESS_EVENT, progress) {
                // A screen that stopped listening is not a reason to stop
                // writing files.
                log::warn!("a batch progress event could not be delivered: {error}");
            }
        },
        &|| *cancel.flag.lock().expect("the cancel lock was poisoned"),
    );
    lower(&cancel);
    cancel.running.store(false, Ordering::Release);
    report
}

/// Ask the run in progress to stop. The line being written finishes; the rest
/// are reported as skipped.
///
/// Cheap and idempotent on purpose: it raises a flag and returns. A cancel with
/// no run in progress is not an error — it is lowered again when the next run
/// starts.
#[tauri::command(rename_all = "snake_case")]
pub fn cancel_batch(cancel: State<'_, BatchCancel>) {
    *cancel.flag.lock().expect("the cancel lock was poisoned") = true;
    log::info!("a batch was asked to stop");
}

/// Write the report the domain built, beside the codes it is about.
///
/// The host does not build this CSV and does not alter it: escaping and the
/// formula neutralising (`=`, `+`, `-`, `@` — the OWASP rule) are the domain's,
/// tested there. What is decided here is where it goes and what it is called —
/// into the same canonical folder, and never over a report that is already
/// there: a second run writes `signatum-report-2.csv`.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a folder this host will not write into and a
/// report larger than [`MAX_REPORT_BYTES`]; [`Error::File`] when the write
/// failed, or when the folder already holds every name this host will use.
#[tauri::command(rename_all = "snake_case")]
pub fn write_batch_report(folder: String, csv: String) -> Result<ReportFile> {
    write_report_into(&folder, &csv)
}

/// Everything one run is told, gathered so the core takes four arguments and
/// the wire keeps its flat shape.
struct BatchAsked<'a> {
    folder: &'a str,
    format: &'a str,
    dpi: u32,
    rows: &'a [PlannedRow],
}

/// How one line ended, with the evidence it produced.
struct Attempted {
    status: RowStatus,
    reason: Option<String>,
    verification_id: Option<String>,
}

impl Attempted {
    /// A line that never reached the gate. The sentence is the error's own —
    /// which is written for a person and names no path.
    fn failed(error: Error) -> Self {
        Self {
            status: RowStatus::Failed,
            reason: Some(error.to_string()),
            verification_id: None,
        }
    }
}

/// What [`run_batch`] does once the database and the two edges of the
/// application — the event and the flag — are in hand.
///
/// The lock is taken per line rather than for the run: a batch of ten thousand
/// codes is minutes long, and a workspace held shut for minutes is a window
/// that cannot do anything else.
fn run_batch_with(
    db: &Mutex<Connection>,
    asked: &BatchAsked,
    progress: &dyn Fn(&Progress),
    cancelled: &dyn Fn() -> bool,
) -> Result<BatchReport> {
    let kind = file_kind(asked.format)?;
    let total = asked.rows.len();
    if total > MAX_BATCH_ROWS {
        return Err(Error::InvalidInput(format!(
            "A batch is at most {MAX_BATCH_ROWS} rows."
        )));
    }
    let bytes: usize = asked.rows.iter().map(|row| row.svg.len()).sum();
    if bytes > MAX_BATCH_SVG_BYTES {
        return Err(Error::InvalidInput(
            "This batch is too large to run at once; split the list and run it in parts."
                .to_string(),
        ));
    }
    let folder = canonical_folder(asked.folder)?;

    let batch_id = {
        let conn = db.lock().expect("the database lock was poisoned");
        batches::start(
            &conn,
            &NewBatch {
                folder: text_of(&folder)?,
                format: kind.token(),
                dpi: Some(asked.dpi),
                rows_total: total,
            },
        )?
    };
    log::info!("a batch of {total} rows started, writing {}", kind.token());

    let mut results = Vec::with_capacity(total);
    let mut counts = Counts::default();
    let mut stopped = false;

    for (index, row) in asked.rows.iter().enumerate() {
        if !stopped && cancelled() {
            stopped = true;
            log::info!("a batch stopped after {index} of {total} rows");
        }
        let done = if stopped {
            Attempted {
                status: RowStatus::Skipped,
                reason: Some(CANCELLED.to_string()),
                verification_id: None,
            }
        } else {
            attempt(db, &folder, kind, asked.dpi, row)
        };

        match done.status {
            RowStatus::Written => counts.written += 1,
            RowStatus::Refused => counts.refused += 1,
            RowStatus::Failed => counts.failed += 1,
            RowStatus::Skipped => counts.skipped += 1,
        }

        let file = shown(&row.file);
        {
            let conn = db.lock().expect("the database lock was poisoned");
            // A line that could not be recorded is not a line that did not
            // happen: the file is there either way, so this is logged and the
            // run goes on rather than throwing away the work.
            if let Err(error) = batches::record(
                &conn,
                &NewRow {
                    batch_id: &batch_id,
                    line: row.line,
                    file: &file,
                    status: done.status.token(),
                    reason: done.reason.as_deref(),
                    verification_id: done.verification_id.as_deref(),
                },
            ) {
                log::error!("a batch line could not be recorded: {error}");
            }
        }

        progress(&Progress {
            batch_id: &batch_id,
            done: index + 1,
            total,
            line: row.line,
            status: done.status,
        });
        results.push(RowResult {
            line: row.line,
            file,
            status: done.status,
            reason: done.reason,
        });
    }

    {
        let conn = db.lock().expect("the database lock was poisoned");
        if let Err(error) = batches::finish(&conn, &batch_id, &counts) {
            log::error!("a batch could not be closed in the record: {error}");
        }
    }
    log::info!(
        "a batch ended: {} written, {} refused, {} failed, {} skipped",
        counts.written,
        counts.refused,
        counts.failed,
        counts.skipped
    );

    Ok(BatchReport {
        batch_id,
        written: counts.written,
        refused: counts.refused,
        failed: counts.failed,
        skipped: counts.skipped,
        results,
    })
}

/// One line: the containment checks, then the export, unchanged.
///
/// Nothing in here returns an error. Every way a line can end is one of the
/// four statuses, because the run must reach the last line whatever the first
/// one did.
fn attempt(
    db: &Mutex<Connection>,
    folder: &Path,
    kind: FileKind,
    dpi: u32,
    row: &PlannedRow,
) -> Attempted {
    let path = match destination(folder, &row.file, kind.token()) {
        Ok(path) => path,
        Err(error) => return Attempted::failed(error),
    };
    let path = match path.to_str() {
        Some(text) => text.to_string(),
        None => return Attempted::failed(Error::File("that path is not text this host can use")),
    };

    let asked = Asked {
        svg: &row.svg,
        payload: &row.payload,
        pixel_size: row.pixel_size,
        logo: row.logo.as_ref(),
        dpi: Some(dpi),
        // A batch line is not a saved code. It is planned from a CSV, and the
        // library knows nothing about it.
        code_id: None,
    };

    let conn = db.lock().expect("the database lock was poisoned");
    match codes::export_once(&conn, &asked, &path, kind) {
        Ok(done) if done.bytes_written.is_some() => Attempted {
            status: RowStatus::Written,
            reason: None,
            verification_id: Some(done.verification_id),
        },
        Ok(done) => Attempted {
            status: RowStatus::Refused,
            reason: Some(
                done.report
                    .reason
                    .clone()
                    .unwrap_or_else(|| "The code did not read back.".to_string()),
            ),
            verification_id: Some(done.verification_id),
        },
        Err(error) => Attempted::failed(error),
    }
}

/// The file this line writes, inside the folder and nowhere else.
///
/// Three checks for one promise, and the third is the one that cannot be argued
/// with: whatever the name was, the path that comes out of the join sits
/// directly in the canonical folder, or nothing is written.
fn destination(folder: &Path, file: &str, extension: &str) -> Result<PathBuf> {
    check_leaf(file)?;
    let path = folder.join(format!("{file}.{extension}"));
    if path.parent() != Some(folder) {
        return Err(Error::InvalidInput(
            "That file name would write outside the folder chosen.".to_string(),
        ));
    }
    // Whatever is already there under that name — a file, a link, anything —
    // stays. A list run twice into one folder is a report of failed rows, not
    // a folder of replaced files.
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err(Error::InvalidInput(
            "A file with that name is already in the folder.".to_string(),
        ));
    }
    codes::check_destination(text_of(&path)?, extension)?;
    Ok(path)
}

/// A file name, and everything it must not be.
///
/// The domain sanitised this already (`sanitiseFileName`) — which is exactly
/// why this is a *refusal* and not a second sanitiser. A name that arrives here
/// still carrying a separator means the two sides disagree, and the honest
/// answer to that is a reported line rather than a quietly renamed file. The
/// reserved-name list is the one `import_logo` uses; there is one such list in
/// this product.
fn check_leaf(file: &str) -> Result<()> {
    if file.is_empty() {
        return Err(Error::InvalidInput(
            "That row has no file name.".to_string(),
        ));
    }
    if file.chars().count() > MAX_NAME_CHARS {
        return Err(Error::InvalidInput(format!(
            "That file name is longer than {MAX_NAME_CHARS} characters."
        )));
    }
    if file.contains(['/', '\\']) {
        return Err(Error::InvalidInput(
            "A file name cannot contain a folder separator.".to_string(),
        ));
    }
    if file.contains("..") {
        return Err(Error::InvalidInput(
            "A file name cannot contain two dots in a row.".to_string(),
        ));
    }
    if file.chars().any(char::is_control) {
        return Err(Error::InvalidInput(
            "That file name contains characters a file name cannot have.".to_string(),
        ));
    }
    if file.contains([':', '<', '>', '"', '|', '?', '*']) {
        return Err(Error::InvalidInput(
            "That file name contains characters a file name cannot have.".to_string(),
        ));
    }
    if file.trim() != file || file.starts_with('.') || file.ends_with('.') {
        return Err(Error::InvalidInput(
            "A file name cannot begin or end with a space or a dot.".to_string(),
        ));
    }
    let stem = file.split('.').next().unwrap_or(file);
    if RESERVED.contains(&stem.to_ascii_lowercase().as_str()) {
        return Err(Error::InvalidInput(
            "That file name is one Windows reserves.".to_string(),
        ));
    }
    Ok(())
}

/// The folder a person chose in the system's folder dialog, resolved once.
///
/// Canonicalising is what makes the containment check mean anything: every path
/// a line writes is joined onto *this*, and compared against *this*. The UNC
/// refusal happens before it, on the string that arrived, because a network
/// path must not be resolved at all in a product that promises nothing leaves
/// the machine — and Windows hands back a verbatim `\\?\C:\…` prefix of its
/// own, which is stripped afterwards so the rest of the host sees the plain
/// path a person would recognise.
fn canonical_folder(folder: &str) -> Result<PathBuf> {
    let network = || {
        Error::InvalidInput(
            "A batch is written to a local drive, not to a network path.".to_string(),
        )
    };
    if !Path::new(folder).is_absolute() {
        return Err(Error::InvalidInput(
            "A batch needs the full path of a folder to write into.".to_string(),
        ));
    }
    if folder.starts_with("\\\\") || folder.starts_with("//") {
        return Err(network());
    }

    let canonical = std::fs::canonicalize(folder).map_err(|error| {
        log::error!("a batch folder could not be opened: {error}");
        Error::InvalidInput("That folder is not there.".to_string())
    })?;
    if !canonical.is_dir() {
        return Err(Error::InvalidInput(
            "That is a file, not a folder.".to_string(),
        ));
    }

    let plain = match text_of(&canonical)?.strip_prefix(r"\\?\") {
        Some(rest) if rest.starts_with(r"UNC\") => return Err(network()),
        Some(rest) => PathBuf::from(rest),
        None => canonical,
    };
    Ok(plain)
}

/// Which of the two kinds of file a run writes. A batch makes codes to hand
/// out, so the page-sized PDF and the clipboard are not among them.
fn file_kind(format: &str) -> Result<FileKind> {
    match format {
        "png" => Ok(FileKind::Png),
        "svg" => Ok(FileKind::Svg),
        _ => Err(Error::InvalidInput(
            "A batch writes PNG or SVG files.".to_string(),
        )),
    }
}

/// What [`write_batch_report`] does once the folder is resolved.
fn write_report_into(folder: &str, csv: &str) -> Result<ReportFile> {
    let folder = canonical_folder(folder)?;
    if csv.len() > MAX_REPORT_BYTES {
        return Err(Error::InvalidInput(
            "That report is larger than this host will write.".to_string(),
        ));
    }
    // The CSV arrives as a Rust `String`, so bytes that are not UTF-8 cannot
    // reach this function at all: the deserialiser refuses them one layer out.

    for attempt in 1..=MAX_REPORTS {
        let name = if attempt == 1 {
            format!("{REPORT_STEM}.csv")
        } else {
            format!("{REPORT_STEM}-{attempt}.csv")
        };
        let path = folder.join(&name);
        if path.exists() {
            continue;
        }
        codes::write_atomically(&path, csv.as_bytes())?;
        log::info!("a batch report was written as {name}");
        return Ok(ReportFile {
            path: text_of(&path)?.to_string(),
        });
    }

    Err(Error::File(
        "that folder already holds every report name this host will use",
    ))
}

/// What [`read_text_file`] does with the path it was handed.
fn read_text_file_at(path: &str) -> Result<TextFile> {
    let source = Path::new(path);
    if !source.is_absolute() {
        return Err(Error::InvalidInput(
            "A batch is read from the full path of a file.".to_string(),
        ));
    }
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(Error::InvalidInput(
            "A batch is read from a local drive, not from a network path.".to_string(),
        ));
    }
    let named_properly = source.extension().is_some_and(|found| {
        found.eq_ignore_ascii_case("csv") || found.eq_ignore_ascii_case("txt")
    });
    if !named_properly {
        return Err(Error::InvalidInput(
            "A batch is read from a .csv or a .txt file.".to_string(),
        ));
    }
    // `COM3.csv` is a device on a Windows that has the port, and opening it can
    // wait forever. Refused by name, before anything is opened.
    let stem = source
        .file_stem()
        .and_then(|found| found.to_str())
        .unwrap_or("");
    let base = stem
        .split('.')
        .next()
        .unwrap_or(stem)
        .trim_end_matches([' ', '.']);
    if RESERVED.contains(&base.to_ascii_lowercase().as_str()) {
        return Err(Error::InvalidInput(
            "That is a name Windows reserves for a device, not a file.".to_string(),
        ));
    }

    // The size comes from the directory entry, so a file far too large to be a
    // list of codes is refused without being read at all.
    let facts = std::fs::metadata(source).map_err(|error| {
        log::error!("a batch file could not be opened: {error}");
        Error::File("that file could not be opened")
    })?;
    if !facts.is_file() {
        return Err(Error::InvalidInput(
            "That is a folder, not a file.".to_string(),
        ));
    }
    if facts.len() > MAX_TEXT_BYTES {
        return Err(Error::InvalidInput(format!(
            "This file is {:.1} MB; a batch can be at most {:.1} MB.",
            facts.len() as f64 / (1024.0 * 1024.0),
            MAX_TEXT_BYTES as f64 / (1024.0 * 1024.0)
        )));
    }

    let bytes = std::fs::read(source).map_err(|error| {
        log::error!("a batch file could not be read: {error}");
        Error::File("that file could not be read")
    })?;
    let text = String::from_utf8(bytes)
        .map_err(|_| Error::InvalidInput("This file is not UTF-8 text.".to_string()))?;
    // A byte-order mark is tolerated and dropped: a spreadsheet writes one, and
    // it is not a column.
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();

    log::info!("a batch file of {} characters was read", text.len());
    Ok(TextFile { text })
}

/// A path as text, or a sentence. Every path this module builds is joined from
/// strings, so the `None` is the unreachable side of a boundary that still has
/// to be answered.
fn text_of(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or(Error::File("that path is not text this host can use"))
}

/// A file name as the report keeps it and the screen shows it: control
/// characters dropped, and no longer than any other name in this workspace.
///
/// A name that needs either of these is a refused line, so this only ever
/// trims something that was never going to be written — but a report is read by
/// a person, and a hostile string is not made harmless by being quoted.
fn shown(file: &str) -> String {
    file.chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect()
}

/// Lower the cancel flag. Done at both ends of a run, so a cancel that arrived
/// between runs cannot stop the next one before it starts.
fn lower(cancel: &BatchCancel) {
    *cancel.flag.lock().expect("the cancel lock was poisoned") = false;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeSet;

    use crate::db::migrations;
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};

    /// The resolution every line of these runs is made for.
    const DPI: u32 = 300;

    /// Small enough that fifty of them render in a test, large enough that the
    /// decoder has something to read.
    const PIXELS: u32 = 128;

    fn workspace() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        Mutex::new(conn)
    }

    /// A directory of its own for each test that writes, removed when it ends.
    /// It holds an `outer` folder and the `inner` one a run is pointed at, so a
    /// test can prove nothing appeared beside the folder that was chosen.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("signatum-{}", crate::db::new_id()));
            std::fs::create_dir_all(path.join("inner")).expect("scratch directory");
            Self(path)
        }

        /// The folder a run writes into.
        fn inner(&self) -> String {
            self.0.join("inner").to_string_lossy().into_owned()
        }

        /// What is in a folder right now, by name.
        fn listing(path: &Path) -> BTreeSet<String> {
            std::fs::read_dir(path)
                .expect("read the folder")
                .map(|entry| {
                    entry
                        .expect("entry")
                        .file_name()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
        }

        /// What is beside the folder that was chosen.
        fn outside(&self) -> BTreeSet<String> {
            Self::listing(&self.0)
        }

        /// What is inside it.
        fn inside(&self) -> BTreeSet<String> {
            Self::listing(&self.0.join("inner"))
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A line that will verify: the fixture's own scene and payload, under the
    /// name given.
    fn good(line: u32, file: &str) -> PlannedRow {
        PlannedRow {
            line,
            file: file.to_string(),
            svg: hello_world_svg(),
            payload: HELLO_WORLD.to_string(),
            logo: None,
            pixel_size: PIXELS,
        }
    }

    /// A run, with the two edges stubbed: nothing listening, nothing
    /// cancelling.
    fn run(db: &Mutex<Connection>, folder: &str, rows: &[PlannedRow]) -> Result<BatchReport> {
        run_batch_with(
            db,
            &BatchAsked {
                folder,
                format: "png",
                dpi: DPI,
                rows,
            },
            &|_| {},
            &|| false,
        )
    }

    fn statuses(report: &BatchReport) -> Vec<RowStatus> {
        report.results.iter().map(|row| row.status).collect()
    }

    /// Every line of the report as the workspace kept it.
    fn recorded(db: &Mutex<Connection>) -> Vec<(i64, String, String, Option<String>)> {
        let conn = db.lock().expect("lock");
        let mut statement = conn
            .prepare("SELECT line, file, status, verification_id FROM batch_rows ORDER BY line, id")
            .expect("prepare");
        let found = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
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

    /// The proof of done, in miniature: fifty lines become fifty verified
    /// files, every one of them recorded, every one of them pointing at the
    /// verification it was written on the strength of.
    #[test]
    fn fifty_rows_become_fifty_verified_files() {
        let db = workspace();
        let scratch = Scratch::new();
        let rows: Vec<PlannedRow> = (0..50)
            .map(|index| good(index + 2, &format!("{index:03}-code")))
            .collect();

        let report = run(&db, &scratch.inner(), &rows).expect("the run itself succeeds");

        assert_eq!(
            (
                report.written,
                report.refused,
                report.failed,
                report.skipped
            ),
            (50, 0, 0, 0)
        );
        assert_eq!(scratch.inside().len(), 50, "one file per line, and no more");
        assert!(
            scratch.inside().contains("049-code.png"),
            "named as the plan named them"
        );
        assert_eq!(scratch.outside(), BTreeSet::from(["inner".to_string()]));

        let lines = recorded(&db);
        assert_eq!(lines.len(), 50);
        assert!(
            lines
                .iter()
                .all(|(_, _, status, verification)| status == "written" && verification.is_some()),
            "every written line names its evidence"
        );

        let conn = db.lock().expect("lock");
        let (rows_total, written, finished): (i64, i64, Option<String>) = conn
            .query_row(
                "SELECT rows_total, written, finished_at FROM batches",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("the run is in the record");
        assert_eq!((rows_total, written), (50, 50));
        assert!(finished.is_some(), "a finished run says so");

        let exports: i64 = conn
            .query_row(
                "SELECT count(*) FROM verifications WHERE kind = 'export' AND format = 'png'
                   AND dpi = 300 AND verified = 1",
                [],
                |r| r.get(0),
            )
            .expect("read back");
        assert_eq!(exports, 50, "each line went through the export's own gate");
    }

    /// The one that AEGIS gates: a name that is a path, a name that is a
    /// traversal, a name Windows reserves, a name that is 200 characters and a
    /// name that is nothing at all. Each is a reported line, and the folder
    /// beside the one chosen is untouched.
    #[test]
    fn a_file_name_that_is_a_path_is_a_reported_line_and_never_a_file() {
        let db = workspace();
        let scratch = Scratch::new();
        let before = scratch.outside();
        let hostile = [
            "..",
            "../../evil",
            "a/b",
            "a\\b",
            "..\\..\\evil",
            "C:evil",
            "CON",
            "con",
            "nul",
            &"x".repeat(200),
            "",
            " ",
            "trailing.",
            ".hidden",
        ];
        let rows: Vec<PlannedRow> = hostile
            .iter()
            .enumerate()
            .map(|(index, file)| good(index as u32 + 2, file))
            .collect();

        let report = run(&db, &scratch.inner(), &rows).expect("the run itself succeeds");

        assert_eq!(report.failed as usize, hostile.len());
        assert_eq!(report.written, 0);
        assert!(
            statuses(&report)
                .iter()
                .all(|status| *status == RowStatus::Failed),
            "every hostile name is a failed line"
        );
        assert!(
            report.results.iter().all(|row| row.reason.is_some()),
            "and every one of them says why"
        );
        assert!(
            scratch.inside().is_empty(),
            "nothing was written inside the folder"
        );
        assert_eq!(
            scratch.outside(),
            before,
            "and nothing at all was written beside it"
        );
        assert_eq!(recorded(&db).len(), hostile.len(), "each one is recorded");
    }

    /// A line the decoder cannot read is a refusal, and a refusal writes
    /// nothing — the same rule as a single export, kept in a loop.
    #[test]
    fn a_line_that_does_not_read_back_is_refused_and_writes_no_file() {
        let db = workspace();
        let scratch = Scratch::new();
        let mut unreadable = good(3, "002-blank");
        unreadable.svg = blank_svg();

        let report = run(&db, &scratch.inner(), &[good(2, "001-code"), unreadable])
            .expect("the run itself succeeds");

        assert_eq!((report.written, report.refused), (1, 1));
        assert_eq!(
            statuses(&report),
            vec![RowStatus::Written, RowStatus::Refused]
        );
        assert_eq!(
            report.results[1].reason.as_deref(),
            Some(crate::imaging::verify::REASON_NO_CODE),
            "the decoder's own sentence, by line"
        );
        assert_eq!(
            scratch.inside(),
            BTreeSet::from(["001-code.png".to_string()]),
            "the refused line left nothing behind"
        );

        let lines = recorded(&db);
        assert_eq!(lines[1].2, "refused");
        assert!(
            lines[1].3.is_some(),
            "a refusal points at the verification that refused it"
        );
    }

    /// A line that fails does not end the run: the lines after it are still
    /// made.
    #[test]
    fn a_bad_line_in_the_middle_does_not_stop_the_rest() {
        let db = workspace();
        let scratch = Scratch::new();
        let rows = [
            good(2, "001-first"),
            good(3, "../evil"),
            good(4, "003-last"),
        ];

        let report = run(&db, &scratch.inner(), &rows).expect("the run itself succeeds");

        assert_eq!(
            statuses(&report),
            vec![RowStatus::Written, RowStatus::Failed, RowStatus::Written]
        );
        assert_eq!(
            scratch.inside(),
            BTreeSet::from(["001-first.png".to_string(), "003-last.png".to_string()])
        );
    }

    /// Cancelling stops the work and reports the rest — it does not pretend
    /// those lines were refused, and it does not leave them out.
    #[test]
    fn cancelling_skips_every_line_that_was_not_reached() {
        let db = workspace();
        let scratch = Scratch::new();
        let rows: Vec<PlannedRow> = (0..8)
            .map(|index| good(index + 2, &format!("{index:03}-code")))
            .collect();
        let done = RefCell::new(0usize);

        let report = run_batch_with(
            &db,
            &BatchAsked {
                folder: &scratch.inner(),
                format: "png",
                dpi: DPI,
                rows: &rows,
            },
            &|progress| *done.borrow_mut() = progress.done,
            &|| *done.borrow() >= 3,
        )
        .expect("the run itself succeeds");

        assert_eq!((report.written, report.skipped), (3, 5));
        assert_eq!(scratch.inside().len(), 3, "the work stopped where it said");
        assert!(
            report.results[3..]
                .iter()
                .all(|row| row.status == RowStatus::Skipped
                    && row.reason.as_deref() == Some(CANCELLED)),
            "every line after the cancel says it was cancelled"
        );
        assert_eq!(
            recorded(&db).len(),
            8,
            "a cancelled line is still a line of the report"
        );
    }

    /// Every line is announced, in order, with a total that does not move.
    #[test]
    fn every_line_is_announced_as_it_finishes() {
        let db = workspace();
        let scratch = Scratch::new();
        let rows: Vec<PlannedRow> = (0..3)
            .map(|index| good(index + 2, &format!("{index:03}-code")))
            .collect();
        let seen = RefCell::new(Vec::new());

        let report = run_batch_with(
            &db,
            &BatchAsked {
                folder: &scratch.inner(),
                format: "png",
                dpi: DPI,
                rows: &rows,
            },
            &|progress| {
                seen.borrow_mut().push((
                    progress.batch_id.to_string(),
                    progress.done,
                    progress.total,
                    progress.line,
                    progress.status,
                ));
            },
            &|| false,
        )
        .expect("the run itself succeeds");

        let seen = seen.into_inner();
        assert_eq!(seen.len(), 3);
        assert_eq!(
            seen.iter()
                .map(|(_, done, total, line, _)| (*done, *total, *line))
                .collect::<Vec<_>>(),
            vec![(1, 3, 2), (2, 3, 3), (3, 3, 4)]
        );
        assert!(
            seen.iter().all(|(id, _, _, _, _)| *id == report.batch_id),
            "the counter and the answer are about the same run"
        );
    }

    /// An SVG run writes SVG files, and the record says so.
    #[test]
    fn a_run_can_write_svg_instead() {
        let db = workspace();
        let scratch = Scratch::new();

        let report = run_batch_with(
            &db,
            &BatchAsked {
                folder: &scratch.inner(),
                format: "svg",
                dpi: DPI,
                rows: &[good(2, "001-code")],
            },
            &|_| {},
            &|| false,
        )
        .expect("the run itself succeeds");

        assert_eq!(report.written, 1);
        assert_eq!(
            scratch.inside(),
            BTreeSet::from(["001-code.svg".to_string()])
        );

        let conn = db.lock().expect("lock");
        let format: String = conn
            .query_row("SELECT format FROM batches", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(format, "svg");
    }

    #[test]
    fn a_run_refuses_a_format_a_batch_does_not_write() {
        let db = workspace();
        let scratch = Scratch::new();

        let refused = run_batch_with(
            &db,
            &BatchAsked {
                folder: &scratch.inner(),
                format: "pdf",
                dpi: DPI,
                rows: &[good(2, "001-code")],
            },
            &|_| {},
            &|| false,
        )
        .expect_err("a batch writes PNG or SVG");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert!(scratch.inside().is_empty());
    }

    #[test]
    fn a_run_refuses_a_folder_that_is_not_a_local_folder() {
        let db = workspace();
        let scratch = Scratch::new();

        for folder in [
            "codes",
            "\\\\server\\share\\codes",
            "//server/share/codes",
            "\\\\?\\C:\\codes",
        ] {
            let refused = run(&db, folder, &[good(2, "001-code")])
                .expect_err("only a local folder that is there");
            assert_eq!(kind_of(&refused), "invalid_input", "{folder}");
        }

        let missing = scratch.0.join("nowhere");
        let refused = run(&db, &missing.to_string_lossy(), &[good(2, "001-code")])
            .expect_err("a folder that is not there");
        assert_eq!(kind_of(&refused), "invalid_input");

        let recorded: i64 = {
            let conn = db.lock().expect("lock");
            conn.query_row("SELECT count(*) FROM batches", [], |r| r.get(0))
                .expect("read back")
        };
        assert_eq!(recorded, 0, "a run that never started is not a run");
    }

    #[test]
    fn a_run_refuses_more_rows_than_a_batch_holds() {
        let db = workspace();
        let scratch = Scratch::new();
        let rows: Vec<PlannedRow> = std::iter::repeat_with(|| good(2, "001-code"))
            .take(MAX_BATCH_ROWS + 1)
            .collect();

        let refused = run(&db, &scratch.inner(), &rows).expect_err("too many rows");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert!(scratch.inside().is_empty());
    }

    /// A second report does not overwrite the first, and a third does not
    /// overwrite the second.
    #[test]
    fn a_report_never_overwrites_the_one_before_it() {
        let scratch = Scratch::new();
        let folder = scratch.inner();

        let first = write_report_into(&folder, "line,name,file,status,reason\n").expect("first");
        let second = write_report_into(&folder, "second\n").expect("second");
        let third = write_report_into(&folder, "third\n").expect("third");

        assert!(first.path.ends_with("signatum-report.csv"));
        assert!(second.path.ends_with("signatum-report-2.csv"));
        assert!(third.path.ends_with("signatum-report-3.csv"));
        assert_eq!(
            std::fs::read_to_string(&first.path).expect("read back"),
            "line,name,file,status,reason\n",
            "the first report is exactly as it was written"
        );
        assert_eq!(
            scratch.inside(),
            BTreeSet::from([
                "signatum-report.csv".to_string(),
                "signatum-report-2.csv".to_string(),
                "signatum-report-3.csv".to_string(),
            ])
        );
    }

    /// The host writes the CSV it is handed, byte for byte: the neutralising is
    /// the domain's, and a host that re-escaped it would be a second answer.
    #[test]
    fn a_report_is_written_exactly_as_it_was_handed_over() {
        let scratch = Scratch::new();
        let csv = "line,name,file,status,reason\n2,'=HYPERLINK(\"x\"),001-code.png,written,\n";

        let written = write_report_into(&scratch.inner(), csv).expect("write");

        assert_eq!(
            std::fs::read_to_string(&written.path).expect("read back"),
            csv
        );
    }

    #[test]
    fn a_report_that_is_too_large_is_refused() {
        let scratch = Scratch::new();
        let huge = "x".repeat(MAX_REPORT_BYTES + 1);

        let refused = write_report_into(&scratch.inner(), &huge).expect_err("too large");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert!(scratch.inside().is_empty(), "and nothing was written");
    }

    #[test]
    fn a_csv_is_read_back_as_text_without_its_byte_order_mark() {
        let scratch = Scratch::new();
        let path = scratch.0.join("inner").join("contacts.csv");
        std::fs::write(&path, "\u{feff}url,name\nhttps://example.com,Menu\n").expect("write");

        let read = read_text_file_at(&path.to_string_lossy()).expect("read");

        assert_eq!(read.text, "url,name\nhttps://example.com,Menu\n");
    }

    #[test]
    fn a_file_already_in_the_folder_is_a_failed_row_and_stays() {
        let db = workspace();
        let scratch = Scratch::new();
        let kept = scratch.0.join("inner").join("002-code.png");
        std::fs::write(&kept, b"keep").expect("write");

        let report = run(
            &db,
            &scratch.inner(),
            &[good(2, "002-code"), good(3, "003-code")],
        )
        .expect("the run itself succeeds");

        assert_eq!((report.written, report.failed), (1, 1));
        assert_eq!(report.results[0].status, RowStatus::Failed);
        assert_eq!(
            report.results[0].reason.as_deref(),
            Some("A file with that name is already in the folder.")
        );
        assert_eq!(
            std::fs::read(&kept).expect("read"),
            b"keep",
            "the file that was there is untouched"
        );
    }

    #[test]
    fn a_device_name_is_refused_before_it_is_opened() {
        let scratch = Scratch::new();
        let path = scratch.0.join("inner").join("COM3.csv");

        let refused = read_text_file_at(&path.to_string_lossy()).expect_err("a device");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "That is a name Windows reserves for a device, not a file."
        );
    }

    #[test]
    fn a_file_that_is_not_utf8_is_refused_by_sentence() {
        let scratch = Scratch::new();
        let path = scratch.0.join("inner").join("latin1.csv");
        std::fs::write(&path, [b'u', b'r', b'l', b'\n', 0xff, 0xfe, 0x00]).expect("write");

        let refused = read_text_file_at(&path.to_string_lossy()).expect_err("not text");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert_eq!(refused.to_string(), "This file is not UTF-8 text.");
    }

    #[test]
    fn a_file_larger_than_the_cap_is_refused_without_being_read() {
        let scratch = Scratch::new();
        let path = scratch.0.join("inner").join("huge.csv");
        std::fs::write(&path, vec![b'a'; MAX_TEXT_BYTES as usize + 1]).expect("write");

        let refused = read_text_file_at(&path.to_string_lossy()).expect_err("too large");

        assert_eq!(kind_of(&refused), "invalid_input");
        assert!(
            refused.to_string().contains("2.0 MB"),
            "the sentence says how large a batch may be: {refused}"
        );
    }

    #[test]
    fn only_a_csv_or_a_txt_on_a_local_drive_is_read() {
        let scratch = Scratch::new();
        let png = scratch.0.join("inner").join("logo.png");
        std::fs::write(&png, b"not a csv").expect("write");

        for path in [
            png.to_string_lossy().into_owned(),
            "contacts.csv".to_string(),
            "\\\\server\\share\\contacts.csv".to_string(),
            "//server/share/contacts.csv".to_string(),
            scratch.0.join("inner").to_string_lossy().into_owned(),
        ] {
            let refused = read_text_file_at(&path).expect_err("refused");
            assert_eq!(kind_of(&refused), "invalid_input", "{path}");
        }

        let txt = scratch.0.join("inner").join("links.TXT");
        std::fs::write(&txt, "url\n").expect("write");
        let read = read_text_file_at(&txt.to_string_lossy()).expect("a .TXT is a .txt");
        assert_eq!(read.text, "url\n");
    }

    /// The path is not in the answer, and not in the refusal either — the
    /// screen shows a sentence, and the log holds the detail.
    #[test]
    fn a_refusal_never_echoes_the_path() {
        let scratch = Scratch::new();
        let secret = scratch.0.join("inner").join("private-folder.png");
        std::fs::write(&secret, b"x").expect("write");

        let refused = read_text_file_at(&secret.to_string_lossy()).expect_err("refused");

        assert!(
            !refused.to_string().contains("private-folder"),
            "the sentence must not carry the path: {refused}"
        );
    }
}
