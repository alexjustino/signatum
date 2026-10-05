//! The scan gate's evidence: one row per code this product rendered and read.
//!
//! Written for a preview and for an export alike, and written whether the
//! decoder agreed or not — a refusal is as much a fact as a success, and a
//! product that only records its successes is not recording anything.
//!
//! Only hashes are stored. What the code says belongs to the person; whether it
//! read back belongs to the product (ADR-010).

use rusqlite::Connection;

use crate::db::{new_id, now};
use crate::error::Result;

/// One verification, ready to be written. Borrowed, because every field of it
/// already exists in the report the command is about to return.
pub struct VerificationRow<'a> {
    /// `verify` for a preview, `export` for a file that was written.
    pub kind: &'a str,
    /// Decoder name and version, e.g. `rqrr 0.10.1`.
    pub decoder: &'a str,
    /// True only when the decoded bytes were the payload bytes.
    pub verified: bool,
    /// Hex SHA-256 of what was asked for.
    pub payload_sha256: &'a str,
    /// Hex SHA-256 of what the decoder read; `None` when it found no code.
    pub decoded_sha256: Option<&'a str>,
    /// Hex SHA-256 of the PNG bytes that were decoded.
    pub artefact_sha256: &'a str,
    /// Pixel width of the artefact.
    pub width: u32,
    /// Pixel height of the artefact.
    pub height: u32,
    /// How long the render and the decode took together.
    pub duration_ms: u64,
    /// Where the file went; only an export has one.
    pub path: Option<&'a str>,
    /// The sentence shown when the code was not verified.
    pub reason: Option<&'a str>,
    /// The resolution the artefact was made for, in dots per inch; `None` for a
    /// preview, which is not going to be printed.
    pub dpi: Option<u32>,
    /// What the export was: `png`, `svg`, `pdf` or `clipboard`. `None` for a
    /// preview, which wrote nothing anywhere.
    pub format: Option<&'a str>,
    /// The saved code this was a verification of, when there is one (F8).
    /// `None` for a code that has never been saved — which is most of them,
    /// because a code is proved long before anybody decides to keep it.
    pub code_id: Option<&'a str>,
    /// The stamp's reference, a UUID v4, when the file written was stamped
    /// (P2). Never the row's own identifier: that is a v7, and carries a time.
    pub stamp_ref: Option<&'a str>,
    /// The digest the stamp in the file carries; set with `stamp_ref` or not
    /// at all.
    pub stamp_digest: Option<&'a str>,
}

/// Write one verification and return its identifier.
///
/// The database's own CHECK refuses a row that claims a verified code while
/// recording a different decoded hash, so this function cannot write a lie even
/// if a caller hands it one.
pub fn record(conn: &Connection, row: &VerificationRow) -> Result<String> {
    record_as(conn, &new_id(), row)
}

/// Write one verification under an identifier the caller already holds.
///
/// For the one artefact that has to *print* the identifier of its own evidence:
/// a proof sheet names each size's verification on the page, so the identifier
/// exists before the page does — and the row is still written only after the
/// file is, exactly as for every other export. The CHECK that refuses a lie
/// applies here as it does to [`record`].
pub fn record_as(conn: &Connection, id: &str, row: &VerificationRow) -> Result<String> {
    conn.execute(
        "INSERT INTO verifications
           (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
            artefact_sha256, width, height, duration_ms, path, reason, dpi, format, code_id,
            stamp_ref, stamp_digest)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            id,
            now(),
            row.kind,
            row.decoder,
            i64::from(row.verified),
            row.payload_sha256,
            row.decoded_sha256,
            row.artefact_sha256,
            row.width,
            row.height,
            row.duration_ms as i64,
            row.path,
            row.reason,
            row.dpi,
            row.format,
            row.code_id,
            row.stamp_ref,
            row.stamp_digest,
        ],
    )?;
    Ok(id.to_string())
}

/// What the workspace holds about a stamped file, found by the stamp's
/// reference.
///
/// Everything a person is told about *when* and *as what* a file was verified
/// comes from here, and never from the file: a stamp carries no date, and one
/// that did could say anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StampedRecord {
    /// When the verification was recorded, as every timestamp column stores it.
    pub created_at: String,
    /// The payload digest the row recorded.
    pub payload_sha256: String,
    /// The digest the row says was written into the file.
    pub stamp_digest: String,
    /// What the export was: `png`, `svg` or `pdf`.
    pub format: Option<String>,
    /// The resolution it was made for.
    pub dpi: Option<u32>,
    /// The saved code it was of, while that code is still in the library.
    pub code_id: Option<String>,
    /// That saved code's name.
    pub code_name: Option<String>,
}

/// The row a stamp's reference names, if this workspace holds one.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn find_by_stamp(conn: &Connection, stamp_ref: &str) -> Result<Option<StampedRecord>> {
    let mut statement = conn.prepare(
        "SELECT v.created_at, v.payload_sha256, v.stamp_digest, v.format, v.dpi, v.code_id,
                c.name
           FROM verifications AS v
           LEFT JOIN codes AS c ON c.id = v.code_id
          WHERE v.stamp_ref = ?1",
    )?;
    let mut rows = statement.query([stamp_ref])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some(StampedRecord {
        created_at: row.get(0)?,
        payload_sha256: row.get(1)?,
        stamp_digest: row.get(2)?,
        format: row.get(3)?,
        dpi: row.get(4)?,
        code_id: row.get(5)?,
        code_name: row.get(6)?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    #[test]
    fn a_verified_export_is_recorded_with_its_path() {
        let conn = workspace();
        let id = record(
            &conn,
            &VerificationRow {
                kind: "export",
                decoder: "rqrr 0.0.0",
                verified: true,
                payload_sha256: "aaaa",
                decoded_sha256: Some("aaaa"),
                artefact_sha256: "cccc",
                width: 1024,
                height: 1024,
                duration_ms: 12,
                path: Some("C:/somewhere/signatum.png"),
                reason: None,
                dpi: Some(300),
                format: Some("png"),
                code_id: None,
                stamp_ref: None,
                stamp_digest: None,
            },
        )
        .expect("record");

        let (kind, verified, path): (String, i64, Option<String>) = conn
            .query_row(
                "SELECT kind, verified, path FROM verifications WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("read back");
        assert_eq!(kind, "export");
        assert_eq!(verified, 1);
        assert_eq!(path.as_deref(), Some("C:/somewhere/signatum.png"));

        let (dpi, format): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT dpi, format FROM verifications WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read back what was exported");
        assert_eq!(dpi, Some(300));
        assert_eq!(format.as_deref(), Some("png"));
    }

    #[test]
    fn a_refusal_is_recorded_too_with_its_reason() {
        let conn = workspace();
        record(
            &conn,
            &VerificationRow {
                kind: "verify",
                decoder: "rqrr 0.0.0",
                verified: false,
                payload_sha256: "aaaa",
                decoded_sha256: None,
                artefact_sha256: "cccc",
                width: 64,
                height: 64,
                duration_ms: 3,
                path: None,
                reason: Some("The decoder found no code."),
                dpi: None,
                format: None,
                code_id: None,
                stamp_ref: None,
                stamp_digest: None,
            },
        )
        .expect("record");

        let (verified, reason): (i64, Option<String>) = conn
            .query_row("SELECT verified, reason FROM verifications", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .expect("read back");
        assert_eq!(verified, 0);
        assert_eq!(reason.as_deref(), Some("The decoder found no code."));
    }

    #[test]
    fn the_database_refuses_a_row_that_contradicts_itself() {
        let conn = workspace();
        let written = record(
            &conn,
            &VerificationRow {
                kind: "export",
                decoder: "rqrr 0.0.0",
                verified: true,
                payload_sha256: "aaaa",
                decoded_sha256: Some("bbbb"),
                artefact_sha256: "cccc",
                width: 64,
                height: 64,
                duration_ms: 3,
                path: None,
                reason: None,
                dpi: None,
                format: None,
                code_id: None,
                stamp_ref: None,
                stamp_digest: None,
            },
        );
        assert!(
            written.is_err(),
            "a verified row whose hashes disagree must not be writable"
        );
    }
}
