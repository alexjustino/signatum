//! One run over one CSV, and the append-only report of what happened to each
//! line of it.
//!
//! The run is a row in `batches`: the folder that was chosen, what was asked
//! for, and — once it is over — how many lines were written, refused, failed or
//! skipped. Each line is a row in `batch_rows`, written as the run goes and
//! never rewritten (migration 005 enforces that with triggers, not with good
//! intentions). What a code carried is not here: a report row holds the file
//! name it made and the sentence for why it could not be made, and the evidence
//! of the code itself stays in `verifications`, as hashes.

use rusqlite::Connection;

use crate::db::{new_id, now};
use crate::error::Result;

/// A run about to start. The counts are not here: they are what the run
/// produces, and a row carrying them at the start would be a prediction.
pub struct NewBatch<'a> {
    /// The canonical folder every file of this run is written into.
    pub folder: &'a str,
    /// `png` or `svg` — what each line is written as.
    pub format: &'a str,
    /// The resolution each file is made for, in dots per inch.
    pub dpi: Option<u32>,
    /// How many lines the run was handed.
    pub rows_total: usize,
}

/// How a run ended, by kind of outcome.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    /// Lines whose file is on the disk, verified.
    pub written: u32,
    /// Lines the scan gate refused; nothing was written for them.
    pub refused: u32,
    /// Lines that could not be attempted, or could not be saved.
    pub failed: u32,
    /// Lines never reached, because the run was cancelled.
    pub skipped: u32,
}

/// One line of the report, as it is written down.
pub struct NewRow<'a> {
    /// The run it belongs to.
    pub batch_id: &'a str,
    /// The line of the CSV this was, as the person sees it in a spreadsheet.
    pub line: u32,
    /// The file name the domain planned for it, without the extension.
    pub file: &'a str,
    /// `written`, `refused`, `failed` or `skipped`.
    pub status: &'a str,
    /// One sentence for anything other than a file that now exists.
    pub reason: Option<&'a str>,
    /// The verification this line produced, when one was made.
    pub verification_id: Option<&'a str>,
}

/// Open a run and return its identifier.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written.
pub fn start(conn: &Connection, new: &NewBatch) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO batches (id, created_at, folder, format, dpi, rows_total)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            now(),
            new.folder,
            new.format,
            new.dpi,
            new.rows_total as i64,
        ],
    )?;
    Ok(id)
}

/// Write one line of the report.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written — which
/// includes a status the schema does not know.
pub fn record(conn: &Connection, row: &NewRow) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO batch_rows
           (id, batch_id, line, file, status, reason, verification_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            row.batch_id,
            row.line,
            row.file,
            row.status,
            row.reason,
            row.verification_id,
        ],
    )?;
    Ok(id)
}

/// Close a run: its counts, and the instant it ended.
///
/// The only UPDATE this module makes, and it is on `batches` rather than on a
/// report line — a summary of lines that already exist, written once.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written.
pub fn finish(conn: &Connection, id: &str, counts: &Counts) -> Result<()> {
    conn.execute(
        "UPDATE batches
            SET written = ?2, refused = ?3, failed = ?4, skipped = ?5, finished_at = ?6
          WHERE id = ?1",
        rusqlite::params![
            id,
            counts.written,
            counts.refused,
            counts.failed,
            counts.skipped,
            now(),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::verifications::{self, VerificationRow};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn a_batch(conn: &Connection) -> String {
        start(
            conn,
            &NewBatch {
                folder: "C:/somewhere/codes",
                format: "png",
                dpi: Some(300),
                rows_total: 2,
            },
        )
        .expect("start a run")
    }

    fn a_row(conn: &Connection, batch_id: &str, status: &str) -> String {
        record(
            conn,
            &NewRow {
                batch_id,
                line: 2,
                file: "001-menu",
                status,
                reason: None,
                verification_id: None,
            },
        )
        .expect("record a line")
    }

    #[test]
    fn a_run_is_opened_reported_on_and_closed() {
        let conn = workspace();
        let batch_id = a_batch(&conn);
        a_row(&conn, &batch_id, "written");
        a_row(&conn, &batch_id, "refused");

        let open: Option<String> = conn
            .query_row("SELECT finished_at FROM batches", [], |r| r.get(0))
            .expect("read back");
        assert!(open.is_none(), "a run still going has not finished");

        finish(
            &conn,
            &batch_id,
            &Counts {
                written: 1,
                refused: 1,
                ..Counts::default()
            },
        )
        .expect("close the run");

        let (total, written, refused, finished): (i64, i64, i64, Option<String>) = conn
            .query_row(
                "SELECT rows_total, written, refused, finished_at FROM batches",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("read back");
        assert_eq!((total, written, refused), (2, 1, 1));
        assert!(finished.is_some(), "a closed run says when it ended");
    }

    /// The status column is a closed list, and the schema is where that is
    /// true — not only the host that writes it.
    #[test]
    fn a_line_can_only_have_ended_one_of_four_ways() {
        let conn = workspace();
        let batch_id = a_batch(&conn);

        for status in ["written", "refused", "failed", "skipped"] {
            a_row(&conn, &batch_id, status);
        }

        let invented = record(
            &conn,
            &NewRow {
                batch_id: &batch_id,
                line: 9,
                file: "009-thing",
                status: "probably",
                reason: None,
                verification_id: None,
            },
        );
        assert!(invented.is_err(), "`probably` is not an outcome");
    }

    /// The promise of the report: what it says happened is what happened. A
    /// line cannot be edited afterwards, and cannot be quietly removed.
    #[test]
    fn a_report_line_cannot_be_rewritten_or_removed() {
        let conn = workspace();
        let batch_id = a_batch(&conn);
        let row_id = a_row(&conn, &batch_id, "refused");

        let rewritten = conn.execute(
            "UPDATE batch_rows SET status = 'written', reason = NULL WHERE id = ?1",
            [&row_id],
        );
        assert!(rewritten.is_err(), "a report line must not be rewritable");

        let removed = conn.execute("DELETE FROM batch_rows WHERE id = ?1", [&row_id]);
        assert!(removed.is_err(), "a report line must not be removable");

        let (status, still_there): (String, i64) = conn
            .query_row(
                "SELECT status, count(*) FROM batch_rows WHERE id = ?1",
                [&row_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read back");
        assert_eq!(status, "refused", "and it still says what it said");
        assert_eq!(still_there, 1);
    }

    /// Append-only is about editing the report, not about keeping a run
    /// forever: deleting the batch takes its lines with it.
    #[test]
    fn deleting_the_run_takes_its_lines_with_it() {
        let conn = workspace();
        let batch_id = a_batch(&conn);
        a_row(&conn, &batch_id, "written");
        a_row(&conn, &batch_id, "failed");

        conn.execute("DELETE FROM batches WHERE id = ?1", [&batch_id])
            .expect("a run can be deleted");

        let left: i64 = conn
            .query_row("SELECT count(*) FROM batch_rows", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(left, 0, "the cascade must not be blocked by the trigger");
    }

    /// A line points at the evidence it produced, and the pointer is a link to
    /// a row that exists: a report cannot name a verification nobody wrote.
    #[test]
    fn a_line_can_name_the_verification_it_produced() {
        let conn = workspace();
        let batch_id = a_batch(&conn);
        let verification = verifications::record(
            &conn,
            &VerificationRow {
                kind: "export",
                decoder: "rqrr 0.0.0",
                verified: true,
                payload_sha256: "aaaa",
                decoded_sha256: Some("aaaa"),
                artefact_sha256: "cccc",
                width: 128,
                height: 128,
                duration_ms: 4,
                path: Some("C:/somewhere/codes/001-menu.png"),
                reason: None,
                dpi: Some(300),
                format: Some("png"),
                code_id: None,
            },
        )
        .expect("record the evidence");

        record(
            &conn,
            &NewRow {
                batch_id: &batch_id,
                line: 2,
                file: "001-menu",
                status: "written",
                reason: None,
                verification_id: Some(&verification),
            },
        )
        .expect("record the line");

        let named: Option<String> = conn
            .query_row("SELECT verification_id FROM batch_rows", [], |r| r.get(0))
            .expect("read back");
        assert_eq!(named.as_deref(), Some(verification.as_str()));

        let orphan = record(
            &conn,
            &NewRow {
                batch_id: &batch_id,
                line: 3,
                file: "002-menu",
                status: "written",
                reason: None,
                verification_id: Some("not-a-verification"),
            },
        );
        assert!(
            orphan.is_err(),
            "a line cannot name evidence that is not there"
        );
    }
}
