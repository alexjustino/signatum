//! The logos that were let in: a thin repository over one table.
//!
//! No normalisation happens here and none is undone here. What arrives is a
//! [`NormalisedLogo`] — bytes this product produced, from a file it refused to
//! pass through (ADR-016) — and what is read back is the same thing, ready to
//! be drawn. The hash is of the stored bytes, so it is the hash of what will be
//! exported rather than of what was opened.

use rusqlite::Connection;

use crate::db::{new_id, now};
use crate::error::{Error, Result};
use crate::imaging::logo::{LogoKind, NormalisedLogo};
use crate::imaging::verify::sha256_hex;

/// What a person is shown about a stored logo. Everything but the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogoFacts {
    /// UUID v7, so the rows sort by when they arrived.
    pub id: String,
    /// When it was imported: UTC, milliseconds, `Z`.
    pub created_at: String,
    /// The file's name, sanitised — a label, never a path.
    pub name: String,
    /// `raster` or `vector`.
    pub kind: String,
    /// What the bytes were: `png`, `jpeg`, `gif`, `webp` or `svg`.
    pub format: String,
    /// Hex SHA-256 of the stored bytes.
    pub sha256: String,
    /// Pixels for a raster; the `viewBox` for an SVG.
    pub width: u32,
    /// The same, vertically.
    pub height: u32,
    /// What normalisation changed, in one sentence.
    pub note: Option<String>,
}

/// Store a normalised logo under a name, and return what was written.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be written.
pub fn insert(conn: &Connection, name: &str, logo: &NormalisedLogo) -> Result<LogoFacts> {
    let facts = LogoFacts {
        id: new_id(),
        created_at: now(),
        name: name.to_string(),
        kind: logo.kind.as_str().to_string(),
        format: logo.format.to_string(),
        sha256: sha256_hex(&logo.bytes),
        width: logo.width,
        height: logo.height,
        note: logo.note.clone(),
    };

    conn.execute(
        "INSERT INTO logos
           (id, created_at, name, kind, format, bytes, sha256, width, height, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            facts.id,
            facts.created_at,
            facts.name,
            facts.kind,
            facts.format,
            logo.bytes,
            facts.sha256,
            facts.width,
            facts.height,
            facts.note,
        ],
    )?;

    Ok(facts)
}

/// Every logo in the workspace, newest first, without the bytes.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn list(conn: &Connection) -> Result<Vec<LogoFacts>> {
    let mut statement = conn.prepare(
        "SELECT id, created_at, name, kind, format, sha256, width, height, note
           FROM logos ORDER BY created_at DESC, id DESC",
    )?;
    let found = statement
        .query_map([], |row| {
            Ok(LogoFacts {
                id: row.get(0)?,
                created_at: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                format: row.get(4)?,
                sha256: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                note: row.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
}

/// One logo, with the bytes, ready to be drawn.
///
/// `Ok(None)` means there is no such logo — a deleted one, or an interface
/// holding an identifier from a workspace that has moved on. That is an answer,
/// not an error.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be read, and
/// [`Error::InvalidInput`] when the row's `kind` or `format` is not one this
/// build knows — which would mean a newer schema opened by an older binary.
pub fn get(conn: &Connection, id: &str) -> Result<Option<(LogoFacts, NormalisedLogo)>> {
    let row = conn
        .query_row(
            "SELECT id, created_at, name, kind, format, sha256, width, height, note, bytes
               FROM logos WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    LogoFacts {
                        id: row.get(0)?,
                        created_at: row.get(1)?,
                        name: row.get(2)?,
                        kind: row.get(3)?,
                        format: row.get(4)?,
                        sha256: row.get(5)?,
                        width: row.get(6)?,
                        height: row.get(7)?,
                        note: row.get(8)?,
                    },
                    row.get::<_, Vec<u8>>(9)?,
                ))
            },
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(Error::Database(other)),
        })?;

    let Some((facts, bytes)) = row else {
        return Ok(None);
    };

    let kind = LogoKind::from_token(&facts.kind).ok_or_else(|| {
        Error::InvalidInput("This logo was stored by a newer version of Signatum.".to_string())
    })?;
    let format = stored_format(&facts.format).ok_or_else(|| {
        Error::InvalidInput("This logo was stored by a newer version of Signatum.".to_string())
    })?;

    let logo = NormalisedLogo {
        kind,
        format,
        bytes,
        width: facts.width,
        height: facts.height,
        note: facts.note.clone(),
    };
    Ok(Some((facts, logo)))
}

/// Remove a logo. `false` when there was none to remove.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be deleted.
pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let removed = conn.execute("DELETE FROM logos WHERE id = ?1", [id])?;
    Ok(removed > 0)
}

/// The stored format token, as a borrowed name this build knows.
///
/// A stored string becomes a `&'static str` here rather than at every call
/// site, which is what keeps [`NormalisedLogo`] free of allocations it does not
/// need — and refuses a token this build has never heard of.
fn stored_format(token: &str) -> Option<&'static str> {
    match token {
        "png" => Some("png"),
        "jpeg" => Some("jpeg"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "svg" => Some("svg"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::imaging::logo::normalise;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn a_logo() -> NormalisedLogo {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
             <rect width="24" height="24" fill="#204080"/></svg>"##;
        normalise(document.as_bytes()).expect("normalise")
    }

    #[test]
    fn a_stored_logo_comes_back_byte_for_byte() {
        let conn = workspace();
        let logo = a_logo();

        let facts = insert(&conn, "brand", &logo).expect("insert");
        let (read, back) = get(&conn, &facts.id).expect("get").expect("it is there");

        assert_eq!(read, facts);
        assert_eq!(back, logo, "what is drawn is what was stored");
        assert_eq!(
            facts.sha256,
            crate::imaging::verify::sha256_hex(&logo.bytes)
        );
        assert_eq!(facts.kind, "vector");
        assert_eq!(facts.format, "svg");
    }

    #[test]
    fn the_list_holds_what_was_imported_newest_first() {
        let conn = workspace();
        let logo = a_logo();

        let first = insert(&conn, "older", &logo).expect("insert");
        let second = insert(&conn, "newer", &logo).expect("insert");

        let names: Vec<String> = list(&conn)
            .expect("list")
            .into_iter()
            .map(|facts| facts.name)
            .collect();
        assert_eq!(names, vec!["newer".to_string(), "older".to_string()]);
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn a_logo_that_was_deleted_is_gone_and_says_so_once() {
        let conn = workspace();
        let facts = insert(&conn, "brand", &a_logo()).expect("insert");

        assert!(delete(&conn, &facts.id).expect("delete"));
        assert!(!delete(&conn, &facts.id).expect("delete again"));
        assert_eq!(get(&conn, &facts.id).expect("get"), None);
        assert!(list(&conn).expect("list").is_empty());
    }

    #[test]
    fn an_identifier_nobody_stored_is_an_answer_not_an_error() {
        let conn = workspace();

        assert_eq!(get(&conn, "not-a-logo").expect("get"), None);
    }

    #[test]
    fn the_database_refuses_a_kind_that_is_not_a_kind() {
        let conn = workspace();

        let written = conn.execute(
            "INSERT INTO logos (id, created_at, name, kind, format, bytes, sha256, width, height)
             VALUES ('a', 't', 'brand', 'photograph', 'png', x'00', 'aaaa', 8, 8)",
            [],
        );
        assert!(written.is_err(), "`photograph` is not how a logo is stored");
    }
}
