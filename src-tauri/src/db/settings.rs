//! The settings table: key, value, and when it last changed.
//!
//! This module has no opinion about which settings exist or what they may hold.
//! That list is the host's, in `commands/settings.rs`, and it is what every
//! write goes through — here a key is a string and a value is a string, exactly
//! as they are in the file. Keeping the repository ignorant is what lets the
//! list grow with the interface without a migration, and what keeps this file
//! four short functions long.
//!
//! Every statement is parametrised. A key never reaches SQLite as text spliced
//! into a statement, even though the only keys that get this far came off a
//! closed list — a repository that is safe only because of who calls it is one
//! rename away from not being.

use rusqlite::Connection;

use crate::db::now;
use crate::error::Result;

/// What one setting is worth, or `None` when it has never been set.
///
/// Never having chosen is an answer, not an error: the interface starts from
/// its own default, and a workspace where nothing was ever changed is the
/// ordinary case rather than a missing row to apologise for.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let found = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(found)
}

/// Write one setting, replacing what was there.
///
/// An upsert rather than a delete and an insert: the row is the setting, and a
/// reader that arrives while it is being written must never find the moment in
/// between, when the person has no theme at all.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written —
/// including a key or a value the schema's own bounds refuse.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                         updated_at = excluded.updated_at",
        rusqlite::params![key, value, now()],
    )?;
    Ok(())
}

/// Every setting that has been written, by key.
///
/// Ordered by key so the same workspace answers in the same order twice, which
/// matters for a list a test compares and for a screen that draws one.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn all(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut statement = conn.prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
    let found = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
}

/// When a setting last changed, or `None` when it has never been set.
///
/// Not on the wire: the interface has no use for it. It is here because the
/// column exists and an upsert that quietly stopped moving it would otherwise
/// be untestable.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn updated_at(conn: &Connection, key: &str) -> Result<Option<String>> {
    let found = conn
        .query_row(
            "SELECT updated_at FROM settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(found)
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
    fn a_setting_that_was_never_written_is_an_answer_not_an_error() {
        let conn = workspace();

        assert_eq!(get(&conn, "theme").expect("get"), None);
        assert_eq!(updated_at(&conn, "theme").expect("get"), None);
        assert!(all(&conn).expect("all").is_empty());
    }

    #[test]
    fn what_was_set_is_what_comes_back() {
        let conn = workspace();

        set(&conn, "theme", "dark").expect("set");

        assert_eq!(get(&conn, "theme").expect("get").as_deref(), Some("dark"));
        assert_eq!(
            all(&conn).expect("all"),
            vec![("theme".to_string(), "dark".to_string())]
        );
    }

    #[test]
    fn the_list_is_by_key_and_carries_every_setting_written() {
        let conn = workspace();

        set(&conn, "theme", "light").expect("set");
        set(&conn, "default_dpi", "600").expect("set");
        set(&conn, "keep_wifi_passwords", "false").expect("set");

        let keys: Vec<String> = all(&conn)
            .expect("all")
            .into_iter()
            .map(|(key, _)| key)
            .collect();
        assert_eq!(keys, vec!["default_dpi", "keep_wifi_passwords", "theme"]);
    }

    /// Writing a setting twice leaves one row, holding the second value — and
    /// says when that happened.
    #[test]
    fn writing_again_replaces_the_value_and_moves_the_instant() {
        let conn = workspace();
        set(&conn, "theme", "light").expect("set");
        let first = updated_at(&conn, "theme").expect("get").expect("it is set");

        // The timestamp has millisecond resolution; two writes inside the same
        // millisecond would carry the same instant and prove nothing.
        std::thread::sleep(std::time::Duration::from_millis(10));
        set(&conn, "theme", "dark").expect("set again");

        let rows: i64 = conn
            .query_row("SELECT count(*) FROM settings", [], |r| r.get(0))
            .expect("count");
        assert_eq!(rows, 1, "a setting is one row, not a history");
        assert_eq!(get(&conn, "theme").expect("get").as_deref(), Some("dark"));
        let second = updated_at(&conn, "theme").expect("get").expect("it is set");
        assert!(
            second > first,
            "`updated_at` must move: {first} then {second}"
        );
    }

    /// Every statement here is parametrised, so a key is a key even when it
    /// reads like SQL. It is not a key this product keeps — the closed list is
    /// the command's job — and that is exactly why the repository has to be
    /// safe on its own.
    #[test]
    fn a_key_that_reads_like_sql_is_stored_as_a_key() {
        let conn = workspace();
        let hostile = "theme'; DROP TABLE settings; --";
        let value = "'; DROP TABLE codes; --";

        set(&conn, hostile, value).expect("set");

        assert_eq!(get(&conn, hostile).expect("get").as_deref(), Some(value));
        for table in ["settings", "codes"] {
            let found: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .expect("read the schema");
            assert_eq!(found, 1, "`{table}` must still be there");
        }
    }

    /// The bounds are in the schema as well as in the host: a key is an
    /// identifier and a value is a short string, whatever the list of settings
    /// grows into.
    #[test]
    fn the_database_refuses_a_key_or_a_value_it_cannot_hold() {
        let conn = workspace();
        let long_key = "k".repeat(65);
        let long_value = "v".repeat(4097);

        for (case, key, value) in [
            ("a key of nothing", "", "dark"),
            ("a key of 65 characters", long_key.as_str(), "dark"),
            ("a value of 4097 characters", "theme", long_value.as_str()),
        ] {
            let refused = set(&conn, key, value).expect_err(case);
            assert!(
                matches!(refused, crate::error::Error::Database(_)),
                "{case} must be refused by the schema"
            );
        }

        set(&conn, &"k".repeat(64), &"v".repeat(4096)).expect("the largest pair there is");
    }
}
