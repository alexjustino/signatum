//! The library: one row per saved code, and a repository thin enough to stay
//! honest about what it does not know.
//!
//! A saved code is its fields and the hash of the scene they made (ADR-028).
//! There is no image in this table: opening a code rebuilds the scene through
//! the same domain pipeline that drew it in the first place, and the gate reads
//! it again. `scene_sha256` is what makes that claim checkable after a restart.
//!
//! The three JSON columns are opaque here. What a payload, a style or a size
//! *is* belongs to the domain (ADR-003); this module stores the strings
//! verbatim, and checks only two things about them — that they are JSON, and
//! that they are not absurdly long. That is also why the Wi-Fi opt-out
//! (ADR-018) needs nothing from the host: the interface blanks the password
//! before it calls, and what arrives is written as it arrives.

use rusqlite::Connection;
use serde::Serialize;

use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The most one JSON column may hold.
///
/// A style is a few hundred bytes and a payload is capped far below this by the
/// code itself; the bound exists so a workspace edited by something other than
/// this product cannot make the host allocate a megabyte per row of a list.
pub const MAX_JSON_BYTES: usize = 64 * 1024;

/// A saved code, whole — everything needed to rebuild the scene.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SavedCode {
    /// UUID v7, so the rows sort by when they were saved.
    pub id: String,
    /// When it was first saved: UTC, milliseconds, `Z`.
    pub created_at: String,
    /// When what the code *is* last changed. A rename does not touch it.
    pub updated_at: String,
    /// What the library calls it.
    pub name: String,
    /// The payload kind, as the domain names it: `link`, `wifi`, `contact`…
    pub kind: String,
    /// The payload's fields, as JSON. Never the encoded string.
    pub payload_json: String,
    /// The look, as JSON.
    pub style_json: String,
    /// The printed size, as JSON.
    pub size_json: String,
    /// The logo drawn on it, if any.
    pub logo_id: Option<String>,
    /// How that logo is drawn — the plate and the size choice — as JSON.
    pub logo_json: Option<String>,
    /// Hex SHA-256 of the scene at save time, lower case.
    pub scene_sha256: String,
}

/// A saved code as a list shows it: everything but the JSON.
///
/// The library screen draws its own preview from the fields, which it asks for
/// one code at a time. A list that carried every payload would be the whole
/// workspace in one reply, and most of it never looked at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SavedCodeSummary {
    /// UUID v7.
    pub id: String,
    /// When it was first saved.
    pub created_at: String,
    /// When what the code is last changed.
    pub updated_at: String,
    /// What the library calls it.
    pub name: String,
    /// The payload kind.
    pub kind: String,
    /// The logo drawn on it, if any — enough for the list to say it has one.
    pub logo_id: Option<String>,
}

/// A code about to be written. Borrowed: every field of it already exists in
/// the request the command is answering.
pub struct NewCode<'a> {
    /// Trimmed, 1 to [`crate::db::MAX_NAME_CHARS`] characters.
    pub name: &'a str,
    /// The payload kind, as the domain names it.
    pub kind: &'a str,
    /// The payload's fields, as JSON.
    pub payload_json: &'a str,
    /// The look, as JSON.
    pub style_json: &'a str,
    /// The printed size, as JSON.
    pub size_json: &'a str,
    /// The logo drawn on it, if any. It must exist; the foreign key says so.
    pub logo_id: Option<&'a str>,
    /// How that logo is drawn, as JSON.
    pub logo_json: Option<&'a str>,
    /// Hex SHA-256 of the scene, 64 lower-case characters.
    pub scene_sha256: &'a str,
}

/// Whether a string is a JSON value this workspace will keep.
///
/// The one predicate, used in both directions: on the way in, so nothing that
/// cannot be read back is written; on the way out, so a row somebody else's
/// tool wrote is a sentence rather than a panic. The sentence differs by
/// direction, which is why this returns a `bool` and not an error — a person
/// saving and a person opening are owed different words.
pub fn is_storable_json(value: &str) -> bool {
    value.len() <= MAX_JSON_BYTES && serde_json::from_str::<serde_json::Value>(value).is_ok()
}

/// Save a code and return what was written.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be written — including the
/// foreign key, when `logo_id` names a logo that is not in the workspace.
pub fn insert(conn: &Connection, new: &NewCode) -> Result<SavedCode> {
    let at = now();
    let code = SavedCode {
        id: new_id(),
        created_at: at.clone(),
        updated_at: at,
        name: new.name.to_string(),
        kind: new.kind.to_string(),
        payload_json: new.payload_json.to_string(),
        style_json: new.style_json.to_string(),
        size_json: new.size_json.to_string(),
        logo_id: new.logo_id.map(str::to_string),
        logo_json: new.logo_json.map(str::to_string),
        scene_sha256: new.scene_sha256.to_string(),
    };

    conn.execute(
        "INSERT INTO codes
           (id, created_at, updated_at, name, kind, payload_json, style_json, size_json,
            logo_id, logo_json, scene_sha256)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            code.id,
            code.created_at,
            code.updated_at,
            code.name,
            code.kind,
            code.payload_json,
            code.style_json,
            code.size_json,
            code.logo_id,
            code.logo_json,
            code.scene_sha256,
        ],
    )?;

    Ok(code)
}

/// Every saved code, newest first, without the JSON.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn list(conn: &Connection) -> Result<Vec<SavedCodeSummary>> {
    let mut statement = conn.prepare(
        "SELECT id, created_at, updated_at, name, kind, logo_id
           FROM codes ORDER BY created_at DESC, id DESC",
    )?;
    let found = statement
        .query_map([], |row| {
            Ok(SavedCodeSummary {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                name: row.get(3)?,
                kind: row.get(4)?,
                logo_id: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
}

/// One saved code, whole.
///
/// `Ok(None)` means there is no such code — a deleted one, or an interface
/// holding an identifier from a workspace that has moved on. That is an answer,
/// not an error.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be read, and
/// [`Error::InvalidInput`] when one of its JSON columns is not JSON this build
/// will keep, which the schema's own `json_valid` makes impossible for a row
/// this product wrote.
pub fn get(conn: &Connection, id: &str) -> Result<Option<SavedCode>> {
    let row = conn
        .query_row(
            "SELECT id, created_at, updated_at, name, kind, payload_json, style_json,
                    size_json, logo_id, logo_json, scene_sha256
               FROM codes WHERE id = ?1",
            [id],
            |row| {
                Ok(SavedCode {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    updated_at: row.get(2)?,
                    name: row.get(3)?,
                    kind: row.get(4)?,
                    payload_json: row.get(5)?,
                    style_json: row.get(6)?,
                    size_json: row.get(7)?,
                    logo_id: row.get(8)?,
                    logo_json: row.get(9)?,
                    scene_sha256: row.get(10)?,
                })
            },
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(Error::Database(other)),
        })?;

    let Some(code) = row else {
        return Ok(None);
    };

    let readable = [
        Some(code.payload_json.as_str()),
        Some(code.style_json.as_str()),
        Some(code.size_json.as_str()),
        code.logo_json.as_deref(),
    ]
    .into_iter()
    .flatten()
    .all(is_storable_json);
    if !readable {
        log::error!("a saved code holds a column this build cannot read as JSON");
        return Err(unreadable());
    }

    Ok(Some(code))
}

/// Whether a saved code is in this workspace, without reading it.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn exists(conn: &Connection, id: &str) -> Result<bool> {
    let found: i64 = conn.query_row("SELECT count(*) FROM codes WHERE id = ?1", [id], |row| {
        row.get(0)
    })?;
    Ok(found > 0)
}

/// Give a saved code a new name. `false` when there was no such code.
///
/// `updated_at` is deliberately left alone: it records when what the code *is*
/// last changed, and a verification is matched against the scene that carried
/// it (`DATA_MODEL.md`). A name is what the library calls the code, not part of
/// the code — renaming one must not make a verified code look stale.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be written.
pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE codes SET name = ?2 WHERE id = ?1",
        rusqlite::params![id, name],
    )?;
    Ok(changed > 0)
}

/// Remove a saved code. `false` when there was none to remove.
///
/// Its verification rows stay, and lose their link (`ON DELETE SET NULL`): what
/// a decoder read once is a fact about an artefact, not a property of a library
/// entry.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be deleted.
pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let removed = conn.execute("DELETE FROM codes WHERE id = ?1", [id])?;
    Ok(removed > 0)
}

/// The names of the saved codes drawn with one logo, oldest first.
///
/// Empty when the logo is free to go. The order is the order they were saved,
/// so the sentence that names them reads the same way twice.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn names_using_logo(conn: &Connection, logo_id: &str) -> Result<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT name FROM codes WHERE logo_id = ?1 ORDER BY created_at ASC, id ASC")?;
    let found = statement
        .query_map([logo_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
}

/// The one sentence for a row this build cannot make sense of.
pub fn unreadable() -> Error {
    Error::InvalidInput("The saved code could not be read.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{logos, migrations, verifications};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    /// A logo in the workspace, the way an import leaves one there.
    fn a_logo(conn: &Connection, name: &str) -> String {
        let document = concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r##"<rect width="24" height="24" fill="#204080"/></svg>"##
        );
        let logo = crate::imaging::logo::normalise(document.as_bytes()).expect("normalise");
        logos::insert(conn, name, &logo).expect("insert").id
    }

    const SCENE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn a_code<'a>(name: &'a str, logo_id: Option<&'a str>) -> NewCode<'a> {
        NewCode {
            name,
            kind: "link",
            payload_json: r#"{"kind":"link","url":"https://example.com"}"#,
            style_json: r##"{"foreground":"#000000"}"##,
            size_json: r#"{"value":25,"unit":"mm"}"#,
            logo_id,
            logo_json: logo_id.map(|_| r#"{"plate":"circle","size":"medium"}"#),
            scene_sha256: SCENE,
        }
    }

    #[test]
    fn a_saved_code_comes_back_exactly_as_it_went_in() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");

        let saved = insert(&conn, &a_code("Menu", Some(&logo))).expect("insert");
        let read = get(&conn, &saved.id).expect("get").expect("it is there");

        assert_eq!(read, saved);
        assert_eq!(read.name, "Menu");
        assert_eq!(read.kind, "link");
        assert_eq!(read.scene_sha256, SCENE);
        assert_eq!(read.logo_id.as_deref(), Some(logo.as_str()));
        assert_eq!(read.created_at, read.updated_at, "nothing has changed yet");
    }

    #[test]
    fn a_code_with_no_logo_is_saved_without_one() {
        let conn = workspace();

        let saved = insert(&conn, &a_code("Text", None)).expect("insert");

        let read = get(&conn, &saved.id).expect("get").expect("it is there");
        assert_eq!(read.logo_id, None);
        assert_eq!(read.logo_json, None);
    }

    #[test]
    fn the_list_is_newest_first_and_carries_no_json() {
        let conn = workspace();
        insert(&conn, &a_code("older", None)).expect("insert");
        insert(&conn, &a_code("newer", None)).expect("insert");

        let listed = list(&conn).expect("list");

        let names: Vec<&str> = listed.iter().map(|code| code.name.as_str()).collect();
        assert_eq!(names, vec!["newer", "older"]);
        let json = serde_json::to_value(&listed).expect("serialise");
        for absent in ["payload_json", "style_json", "size_json", "scene_sha256"] {
            assert!(
                json[0].get(absent).is_none(),
                "a list does not carry `{absent}`"
            );
        }
        for present in ["id", "created_at", "updated_at", "name", "kind", "logo_id"] {
            assert!(json[0].get(present).is_some(), "`{present}` is missing");
        }
    }

    #[test]
    fn an_identifier_nobody_saved_is_an_answer_not_an_error() {
        let conn = workspace();

        assert_eq!(get(&conn, "not-a-code").expect("get"), None);
        assert!(!exists(&conn, "not-a-code").expect("exists"));
        assert!(!rename(&conn, "not-a-code", "Menu").expect("rename"));
        assert!(!delete(&conn, "not-a-code").expect("delete"));
    }

    /// A name is what the library calls a code. Renaming it does not make the
    /// code a different code, so it does not touch `updated_at`.
    #[test]
    fn renaming_changes_the_name_and_nothing_else() {
        let conn = workspace();
        let saved = insert(&conn, &a_code("Menu", None)).expect("insert");

        assert!(rename(&conn, &saved.id, "Lunch menu").expect("rename"));

        let read = get(&conn, &saved.id).expect("get").expect("it is there");
        assert_eq!(read.name, "Lunch menu");
        assert_eq!(read.updated_at, saved.updated_at);
        assert_eq!(read.payload_json, saved.payload_json);
    }

    #[test]
    fn a_deleted_code_is_gone_and_says_so_once() {
        let conn = workspace();
        let saved = insert(&conn, &a_code("Menu", None)).expect("insert");

        assert!(delete(&conn, &saved.id).expect("delete"));
        assert!(!delete(&conn, &saved.id).expect("delete again"));
        assert_eq!(get(&conn, &saved.id).expect("get"), None);
        assert!(list(&conn).expect("list").is_empty());
    }

    /// The library entry goes; the evidence stays, and admits it belongs to
    /// nothing now.
    #[test]
    fn deleting_a_code_keeps_its_verifications_and_unlinks_them() {
        let conn = workspace();
        let saved = insert(&conn, &a_code("Menu", None)).expect("insert");
        let row = verifications::record(
            &conn,
            &verifications::VerificationRow {
                kind: "export",
                decoder: "rqrr 0.0.0",
                verified: true,
                payload_sha256: "aaaa",
                decoded_sha256: Some("aaaa"),
                artefact_sha256: "cccc",
                width: 64,
                height: 64,
                duration_ms: 1,
                path: None,
                reason: None,
                dpi: Some(300),
                format: Some("png"),
                code_id: Some(&saved.id),
            },
        )
        .expect("record");

        let linked: Option<String> = conn
            .query_row(
                "SELECT code_id FROM verifications WHERE id = ?1",
                [&row],
                |r| r.get(0),
            )
            .expect("read back");
        assert_eq!(linked.as_deref(), Some(saved.id.as_str()));

        delete(&conn, &saved.id).expect("delete");

        let (kept, unlinked): (i64, Option<String>) = conn
            .query_row(
                "SELECT count(*), max(code_id) FROM verifications WHERE id = ?1",
                [&row],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("read back");
        assert_eq!(
            kept, 1,
            "a verification is a fact, not a property of a code"
        );
        assert_eq!(unlinked, None, "and it no longer names a code");
    }

    /// The sentence naming which codes use a logo is built from this, in the
    /// order they were saved.
    #[test]
    fn the_codes_drawn_with_a_logo_are_named_in_the_order_they_were_saved() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");
        let other = a_logo(&conn, "other");
        insert(&conn, &a_code("Menu", Some(&logo))).expect("insert");
        insert(&conn, &a_code("Card", Some(&logo))).expect("insert");
        insert(&conn, &a_code("Poster", Some(&other))).expect("insert");
        insert(&conn, &a_code("Plain", None)).expect("insert");

        assert_eq!(
            names_using_logo(&conn, &logo).expect("names"),
            vec!["Menu".to_string(), "Card".to_string()]
        );
        assert_eq!(
            names_using_logo(&conn, &other).expect("names"),
            vec!["Poster".to_string()]
        );
        assert!(names_using_logo(&conn, "nobody").expect("names").is_empty());
    }

    /// The sentence is the host's; RESTRICT is the backstop under it. A delete
    /// that goes round the command still cannot orphan a saved code.
    #[test]
    fn the_database_refuses_to_delete_a_logo_a_code_is_drawn_with() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");
        insert(&conn, &a_code("Menu", Some(&logo))).expect("insert");

        let refused = conn.execute("DELETE FROM logos WHERE id = ?1", [&logo]);

        assert!(
            refused.is_err(),
            "RESTRICT must hold even when nothing asked the host first"
        );
        assert_eq!(logos::list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_code_cannot_name_a_logo_that_is_not_there() {
        let conn = workspace();

        let refused = insert(&conn, &a_code("Menu", Some("not-a-logo")));

        assert!(refused.is_err(), "the foreign key must refuse it");
    }

    /// The schema will not hold a column that is not JSON, and will not hold a
    /// name or a scene hash that is not one either.
    #[test]
    fn the_database_refuses_what_it_cannot_make_sense_of() {
        let conn = workspace();
        let statement = "INSERT INTO codes
             (id, created_at, updated_at, name, kind, payload_json, style_json, size_json,
              scene_sha256)
             VALUES (?1, 't', 't', ?2, ?3, ?4, '{}', '{}', ?5)";
        let long = "a".repeat(81);

        for (case, name, kind, payload, scene) in [
            ("a name of nothing", "", "link", "{}", SCENE),
            (
                "a name of 81 characters",
                long.as_str(),
                "link",
                "{}",
                SCENE,
            ),
            (
                "a payload that is not JSON",
                "Menu",
                "link",
                "not json",
                SCENE,
            ),
            ("a scene hash that is short", "Menu", "link", "{}", "abcdef"),
            (
                "a scene hash in capitals",
                "Menu",
                "link",
                "{}",
                "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            ("a kind of nothing", "Menu", "", "{}", SCENE),
        ] {
            let written = conn.execute(
                statement,
                rusqlite::params![new_id(), name, kind, payload, scene],
            );
            assert!(written.is_err(), "{case} must be refused");
        }

        conn.execute(
            statement,
            rusqlite::params![new_id(), "Menu", "link", "{}", SCENE],
        )
        .expect("a row that makes sense is accepted");
    }

    /// A row a different tool wrote is a sentence, not a panic — and the size
    /// cap is the host's, because SQL's `json_valid` has no opinion on length.
    #[test]
    fn a_column_too_large_to_read_is_one_sentence() {
        let conn = workspace();
        let saved = insert(&conn, &a_code("Menu", None)).expect("insert");
        let enormous = format!(r#"{{"text":"{}"}}"#, "a".repeat(MAX_JSON_BYTES));
        conn.execute(
            "UPDATE codes SET payload_json = ?2 WHERE id = ?1",
            rusqlite::params![saved.id, enormous],
        )
        .expect("the schema allows it; this build does not");

        let refused = get(&conn, &saved.id).expect_err("it must not be read");

        assert_eq!(refused.to_string(), "The saved code could not be read.");
    }

    #[test]
    fn what_counts_as_storable_json() {
        assert!(is_storable_json("{}"));
        assert!(is_storable_json(r#"{"kind":"link"}"#));
        assert!(is_storable_json("null"));
        assert!(!is_storable_json(""));
        assert!(!is_storable_json("not json"));
        assert!(!is_storable_json("{"));
        assert!(!is_storable_json(&format!(
            r#"{{"a":"{}"}}"#,
            "a".repeat(MAX_JSON_BYTES)
        )));
    }
}
