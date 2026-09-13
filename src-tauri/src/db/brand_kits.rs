//! Brand kits: a logo, a look and a size, kept under a name and applied to a
//! new code in one click.
//!
//! A kit holds no payload, and that is the whole idea — it is the part of a
//! code that is the same every time, separated from the part that never is.
//! Applying one is the domain's business (`applyKit`); this module only keeps
//! the three things a kit is made of, with the same rule the library follows:
//! the JSON is opaque here (ADR-003), stored verbatim, checked only for being
//! JSON and for being a sane length.
//!
//! Two kits cannot share a name. A kit is picked from a list by its name, and a
//! list with two "Brand" in it is a list where the person's click means nothing
//! — so `UNIQUE` in the schema, and one sentence naming the kit that already
//! has it.

use rusqlite::Connection;
use serde::Serialize;

use crate::db::codes::is_storable_json;
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// A brand kit, whole. There is no summary of one: a kit is already small, and
/// the screen that lists kits is the screen that applies them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct BrandKit {
    /// UUID v7, so the rows sort by when they were saved.
    pub id: String,
    /// When it was saved: UTC, milliseconds, `Z`.
    pub created_at: String,
    /// When it last changed.
    pub updated_at: String,
    /// What the person calls it, and picks it by.
    pub name: String,
    /// The logo it carries, if it is more than colours.
    pub logo_id: Option<String>,
    /// How that logo is drawn — the plate and the size choice — as JSON.
    pub logo_json: Option<String>,
    /// The look, as JSON.
    pub style_json: String,
    /// The printed size, as JSON.
    pub size_json: String,
}

/// A kit about to be written. Borrowed, like [`crate::db::codes::NewCode`].
pub struct NewBrandKit<'a> {
    /// Trimmed, 1 to [`crate::db::MAX_NAME_CHARS`] characters, and not one
    /// another kit already has.
    pub name: &'a str,
    /// The logo it carries, if any. It must exist; the foreign key says so.
    pub logo_id: Option<&'a str>,
    /// How that logo is drawn, as JSON.
    pub logo_json: Option<&'a str>,
    /// The look, as JSON.
    pub style_json: &'a str,
    /// The printed size, as JSON.
    pub size_json: &'a str,
}

/// Save a kit and return what was written.
///
/// # Errors
///
/// [`Error::InvalidInput`] when another kit already has the name — the
/// `UNIQUE` constraint's own sentence, so the answer is the same whether the
/// command checked first or not. [`Error::Database`] for anything else the row
/// could not satisfy, including the foreign key when `logo_id` names a logo
/// that is not in the workspace.
pub fn insert(conn: &Connection, new: &NewBrandKit) -> Result<BrandKit> {
    let at = now();
    let kit = BrandKit {
        id: new_id(),
        created_at: at.clone(),
        updated_at: at,
        name: new.name.to_string(),
        logo_id: new.logo_id.map(str::to_string),
        logo_json: new.logo_json.map(str::to_string),
        style_json: new.style_json.to_string(),
        size_json: new.size_json.to_string(),
    };

    conn.execute(
        "INSERT INTO brand_kits
           (id, created_at, updated_at, name, logo_id, logo_json, style_json, size_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            kit.id,
            kit.created_at,
            kit.updated_at,
            kit.name,
            kit.logo_id,
            kit.logo_json,
            kit.style_json,
            kit.size_json,
        ],
    )
    .map_err(|error| taken(&kit.name, error))?;

    Ok(kit)
}

/// Every kit, newest first.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read, and
/// [`Error::InvalidInput`] when a kit holds JSON this build will not read —
/// unlike the library, a kit is small enough to be returned whole, so it is
/// checked here rather than on a second call.
pub fn list(conn: &Connection) -> Result<Vec<BrandKit>> {
    let mut statement = conn.prepare(
        "SELECT id, created_at, updated_at, name, logo_id, logo_json, style_json, size_json
           FROM brand_kits ORDER BY created_at DESC, id DESC",
    )?;
    let found = statement
        .query_map([], read)?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    for kit in &found {
        readable(kit)?;
    }
    Ok(found)
}

/// One kit. `Ok(None)` when there is no such kit, which is an answer.
///
/// # Errors
///
/// As [`list`].
pub fn get(conn: &Connection, id: &str) -> Result<Option<BrandKit>> {
    let row = conn
        .query_row(
            "SELECT id, created_at, updated_at, name, logo_id, logo_json, style_json, size_json
               FROM brand_kits WHERE id = ?1",
            [id],
            read,
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(Error::Database(other)),
        })?;

    let Some(kit) = row else {
        return Ok(None);
    };
    readable(&kit)?;
    Ok(Some(kit))
}

/// Whether a kit already has this name, and which one. Case-sensitive, because
/// "Brand" and "brand" are two words a person may well have meant.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn find_by_name(conn: &Connection, name: &str) -> Result<Option<String>> {
    conn.query_row("SELECT id FROM brand_kits WHERE name = ?1", [name], |row| {
        row.get::<_, String>(0)
    })
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(Error::Database(other)),
    })
}

/// Give a kit a new name. `false` when there was no such kit.
///
/// # Errors
///
/// [`Error::InvalidInput`] when another kit already has the name;
/// [`Error::Database`] when the row could not be written.
pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<bool> {
    let changed = conn
        .execute(
            "UPDATE brand_kits SET name = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, name, now()],
        )
        .map_err(|error| taken(name, error))?;
    Ok(changed > 0)
}

/// Remove a kit. `false` when there was none to remove.
///
/// A kit is a starting point, not an owner: the codes started from it keep
/// their look, because a code holds its own style and never a reference to the
/// kit it came from.
///
/// # Errors
///
/// [`Error::Database`] when the row could not be deleted.
pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let removed = conn.execute("DELETE FROM brand_kits WHERE id = ?1", [id])?;
    Ok(removed > 0)
}

/// The names of the kits carrying one logo, oldest first.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
pub fn names_using_logo(conn: &Connection, logo_id: &str) -> Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT name FROM brand_kits WHERE logo_id = ?1 ORDER BY created_at ASC, id ASC",
    )?;
    let found = statement
        .query_map([logo_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
}

/// One row, in the column order both queries above use.
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<BrandKit> {
    Ok(BrandKit {
        id: row.get(0)?,
        created_at: row.get(1)?,
        updated_at: row.get(2)?,
        name: row.get(3)?,
        logo_id: row.get(4)?,
        logo_json: row.get(5)?,
        style_json: row.get(6)?,
        size_json: row.get(7)?,
    })
}

/// Refuse a kit whose JSON this build cannot read.
fn readable(kit: &BrandKit) -> Result<()> {
    let fine = [
        Some(kit.style_json.as_str()),
        Some(kit.size_json.as_str()),
        kit.logo_json.as_deref(),
    ]
    .into_iter()
    .flatten()
    .all(is_storable_json);
    if fine {
        return Ok(());
    }
    log::error!("a brand kit holds a column this build cannot read as JSON");
    Err(Error::InvalidInput(
        "That brand kit could not be read.".to_string(),
    ))
}

/// The sentence the `UNIQUE` constraint owes, and nothing else it might mean.
///
/// Only a unique-name violation becomes a sentence about the name; every other
/// constraint the row failed is a defect this build should report as one, so
/// the extended result code is matched rather than the family.
fn taken(name: &str, error: rusqlite::Error) -> Error {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
        {
            Error::InvalidInput(format!("A brand kit called \"{name}\" already exists."))
        }
        _ => Error::Database(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::{self, MAX_JSON_BYTES};
    use crate::db::{logos, migrations};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn a_logo(conn: &Connection, name: &str) -> String {
        let document = concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r##"<rect width="24" height="24" fill="#204080"/></svg>"##
        );
        let logo = crate::imaging::logo::normalise(document.as_bytes()).expect("normalise");
        logos::insert(conn, name, &logo).expect("insert").id
    }

    fn a_kit<'a>(name: &'a str, logo_id: Option<&'a str>) -> NewBrandKit<'a> {
        NewBrandKit {
            name,
            logo_id,
            logo_json: logo_id.map(|_| r#"{"plate":"circle","size":"medium"}"#),
            style_json: r##"{"foreground":"#204080"}"##,
            size_json: r#"{"value":25,"unit":"mm"}"#,
        }
    }

    #[test]
    fn a_saved_kit_comes_back_exactly_as_it_went_in() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");

        let saved = insert(&conn, &a_kit("Brand", Some(&logo))).expect("insert");
        let read = get(&conn, &saved.id).expect("get").expect("it is there");

        assert_eq!(read, saved);
        assert_eq!(read.name, "Brand");
        assert_eq!(read.logo_id.as_deref(), Some(logo.as_str()));
        assert_eq!(read.created_at, read.updated_at);
    }

    #[test]
    fn a_kit_may_be_colours_and_nothing_else() {
        let conn = workspace();

        let saved = insert(&conn, &a_kit("Plain", None)).expect("insert");

        assert_eq!(saved.logo_id, None);
        assert_eq!(saved.logo_json, None);
        assert_eq!(list(&conn).expect("list"), vec![saved]);
    }

    #[test]
    fn the_list_is_newest_first() {
        let conn = workspace();
        insert(&conn, &a_kit("older", None)).expect("insert");
        insert(&conn, &a_kit("newer", None)).expect("insert");

        let names: Vec<String> = list(&conn)
            .expect("list")
            .into_iter()
            .map(|kit| kit.name)
            .collect();

        assert_eq!(names, vec!["newer".to_string(), "older".to_string()]);
    }

    #[test]
    fn two_kits_cannot_share_a_name_and_the_sentence_says_which() {
        let conn = workspace();
        insert(&conn, &a_kit("Brand", None)).expect("insert");

        let refused = insert(&conn, &a_kit("Brand", None)).expect_err("the name is taken");

        assert_eq!(
            refused.to_string(),
            "A brand kit called \"Brand\" already exists."
        );
        assert_eq!(list(&conn).expect("list").len(), 1);
        assert!(find_by_name(&conn, "Brand").expect("find").is_some());
        assert!(find_by_name(&conn, "brand").expect("find").is_none());
    }

    #[test]
    fn renaming_a_kit_onto_a_name_already_taken_is_the_same_sentence() {
        let conn = workspace();
        insert(&conn, &a_kit("Brand", None)).expect("insert");
        let second = insert(&conn, &a_kit("Other", None)).expect("insert");

        let refused = rename(&conn, &second.id, "Brand").expect_err("the name is taken");

        assert_eq!(
            refused.to_string(),
            "A brand kit called \"Brand\" already exists."
        );
        assert!(rename(&conn, &second.id, "Second").expect("rename"));
        assert!(!rename(&conn, "not-a-kit", "Third").expect("rename"));
    }

    #[test]
    fn a_deleted_kit_is_gone_and_says_so_once() {
        let conn = workspace();
        let saved = insert(&conn, &a_kit("Brand", None)).expect("insert");

        assert!(delete(&conn, &saved.id).expect("delete"));
        assert!(!delete(&conn, &saved.id).expect("delete again"));
        assert_eq!(get(&conn, &saved.id).expect("get"), None);
        assert!(list(&conn).expect("list").is_empty());
    }

    #[test]
    fn the_kits_carrying_a_logo_are_named_in_the_order_they_were_saved() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");
        insert(&conn, &a_kit("Brand", Some(&logo))).expect("insert");
        insert(&conn, &a_kit("Winter", Some(&logo))).expect("insert");
        insert(&conn, &a_kit("Plain", None)).expect("insert");

        assert_eq!(
            names_using_logo(&conn, &logo).expect("names"),
            vec!["Brand".to_string(), "Winter".to_string()]
        );
    }

    /// RESTRICT is the backstop under the host's sentence, for a kit as much as
    /// for a saved code.
    #[test]
    fn the_database_refuses_to_delete_a_logo_a_kit_carries() {
        let conn = workspace();
        let logo = a_logo(&conn, "brand");
        insert(&conn, &a_kit("Brand", Some(&logo))).expect("insert");

        let refused = conn.execute("DELETE FROM logos WHERE id = ?1", [&logo]);

        assert!(refused.is_err(), "RESTRICT must hold");
        assert_eq!(logos::list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_kit_cannot_name_a_logo_that_is_not_there() {
        let conn = workspace();

        let refused = insert(&conn, &a_kit("Brand", Some("not-a-logo")));

        assert!(matches!(refused, Err(Error::Database(_))));
    }

    #[test]
    fn the_database_refuses_a_kit_it_cannot_make_sense_of() {
        let conn = workspace();
        let statement = "INSERT INTO brand_kits
             (id, created_at, updated_at, name, style_json, size_json)
             VALUES (?1, 't', 't', ?2, ?3, '{}')";
        let long = "a".repeat(81);

        for (case, name, style) in [
            ("a name of nothing", "", "{}"),
            ("a name of 81 characters", long.as_str(), "{}"),
            ("a look that is not JSON", "Brand", "not json"),
        ] {
            let written = conn.execute(statement, rusqlite::params![new_id(), name, style]);
            assert!(written.is_err(), "{case} must be refused");
        }
    }

    #[test]
    fn a_kit_too_large_to_read_is_one_sentence() {
        let conn = workspace();
        let saved = insert(&conn, &a_kit("Brand", None)).expect("insert");
        let enormous = format!(r#"{{"a":"{}"}}"#, "a".repeat(MAX_JSON_BYTES));
        conn.execute(
            "UPDATE brand_kits SET style_json = ?2 WHERE id = ?1",
            rusqlite::params![saved.id, enormous],
        )
        .expect("the schema allows it; this build does not");

        let refused = get(&conn, &saved.id).expect_err("it must not be read");

        assert_eq!(refused.to_string(), "That brand kit could not be read.");
        assert!(list(&conn).is_err(), "nor in a list");
        assert!(codes::list(&conn)
            .expect("the library is unaffected")
            .is_empty());
    }
}
