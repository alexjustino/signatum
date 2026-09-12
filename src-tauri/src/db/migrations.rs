//! Forward-only, numbered migrations.
//!
//! Each migration runs inside a transaction and bumps `workspace.schema_version`.
//! There is no down-migration: a mistake is corrected by a new migration, never
//! by rewriting an applied one — an applied migration is history, and history
//! already ran on somebody's machine.

use rusqlite::Connection;

use crate::error::Result;

/// Every migration, in order. The index plus one is the schema version it
/// produces, so a migration can never be reordered without the compiler and the
/// round-trip test both objecting.
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_init", include_str!("../../migrations/001_init.sql")),
    ("002_logos", include_str!("../../migrations/002_logos.sql")),
    (
        "003_export_formats",
        include_str!("../../migrations/003_export_formats.sql"),
    ),
];

/// Every migration, name and SQL, in the order they apply.
///
/// Public so the round-trip test can walk the versions one at a time — the
/// runner itself only ever goes to head, which is right for the product and
/// wrong for a test that must stand at each step of somebody's history.
pub fn sources() -> &'static [(&'static str, &'static str)] {
    MIGRATIONS
}

/// The schema version this build expects.
pub fn target_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// Read the version currently stored in the database. A database that has never
/// been migrated has no `workspace` table yet, and reports 0.
pub fn current_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT schema_version FROM workspace WHERE id = 1",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Apply every migration the database has not seen yet.
pub fn apply(conn: &Connection) -> Result<()> {
    let from = current_version(conn);
    let to = target_version();

    if from >= to {
        log::debug!("schema is at version {from}; nothing to apply");
        return Ok(());
    }

    for (index, (name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version <= from {
            continue;
        }

        log::info!("applying migration {name}");
        conn.execute_batch(&format!(
            "BEGIN;
             {sql}
             UPDATE workspace SET schema_version = {version} WHERE id = 1;
             COMMIT;"
        ))?;
    }

    log::info!("schema migrated from version {from} to {to}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn
    }

    #[test]
    fn applies_from_empty() {
        let conn = memory();
        assert_eq!(current_version(&conn), 0);

        apply(&conn).expect("migrate");

        assert_eq!(current_version(&conn), target_version());
    }

    /// The version is a number this build states, and a number a workspace
    /// carries. A round trip has to end at the same one, from empty and from
    /// every version in between — which is what makes a migration safe to ship
    /// to somebody whose file is a release behind.
    #[test]
    fn a_workspace_at_any_earlier_version_migrates_to_this_one() {
        assert_eq!(target_version(), 3, "F7 adds the third migration");

        for stop_at in 0..=target_version() {
            let conn = memory();
            for (index, (_, sql)) in sources().iter().enumerate() {
                let version = index as i64 + 1;
                if version > stop_at {
                    break;
                }
                conn.execute_batch(&format!(
                    "BEGIN; {sql}
                     UPDATE workspace SET schema_version = {version} WHERE id = 1; COMMIT;"
                ))
                .expect("apply one migration by hand");
            }
            assert_eq!(current_version(&conn), stop_at);

            apply(&conn).expect("migrate the rest of the way");

            assert_eq!(current_version(&conn), target_version());
            let logos: i64 = conn
                .query_row("SELECT count(*) FROM logos", [], |r| r.get(0))
                .expect("the logos table exists at head");
            assert_eq!(logos, 0);
        }
    }

    /// What was in the file before the migration is still in it afterwards.
    #[test]
    fn migrating_keeps_what_was_already_recorded() {
        let conn = memory();
        let (_, first) = sources()[0];
        conn.execute_batch(&format!(
            "BEGIN; {first}
             UPDATE workspace SET schema_version = 1 WHERE id = 1; COMMIT;"
        ))
        .expect("apply 001");
        conn.execute(
            "INSERT INTO verifications
               (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
                artefact_sha256, width, height, duration_ms)
             VALUES ('kept', 't', 'export', 'rqrr 0.0.0', 1, 'aaaa', 'aaaa', 'cccc', 8, 8, 1)",
            [],
        )
        .expect("record something at version 1");

        apply(&conn).expect("migrate");

        let kept: i64 = conn
            .query_row(
                "SELECT count(*) FROM verifications WHERE id = 'kept'",
                [],
                |r| r.get(0),
            )
            .expect("read back");
        assert_eq!(kept, 1, "a migration must not lose a row");
        assert_eq!(current_version(&conn), target_version());
    }

    #[test]
    fn is_idempotent() {
        let conn = memory();
        apply(&conn).expect("first");
        apply(&conn).expect("second");
        apply(&conn).expect("third");

        assert_eq!(current_version(&conn), target_version());
    }

    #[test]
    fn creates_every_table_the_product_needs() {
        let conn = memory();
        apply(&conn).expect("migrate");

        for table in ["workspace", "verifications", "logos"] {
            let found: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            assert_eq!(found, 1, "table `{table}` is missing after migration");
        }
    }

    #[test]
    fn workspace_holds_exactly_one_row() {
        let conn = memory();
        apply(&conn).expect("migrate");

        let inserted = conn.execute("INSERT INTO workspace (id) VALUES (2)", []);
        assert!(inserted.is_err(), "a second workspace row must be rejected");
    }

    /// The scan gate is in the schema, not only in the code: a row cannot say a
    /// code was verified while recording that the decoder read something else.
    #[test]
    fn a_verified_row_cannot_disagree_with_itself() {
        let conn = memory();
        apply(&conn).expect("migrate");

        let insert = "INSERT INTO verifications
             (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
              artefact_sha256, width, height, duration_ms)
             VALUES (?1, 't', 'export', 'rqrr 0.0.0', ?2, 'aaaa', ?3, 'cccc', 8, 8, 1)";

        let mismatched = conn.execute(insert, rusqlite::params!["a", 1, "bbbb"]);
        assert!(
            mismatched.is_err(),
            "a verified row with a different decoded hash must be rejected"
        );

        let missing = conn.execute(insert, rusqlite::params!["b", 1, None::<String>]);
        assert!(
            missing.is_err(),
            "a verified row with nothing decoded must be rejected"
        );

        conn.execute(insert, rusqlite::params!["c", 1, "aaaa"])
            .expect("a verified row whose hashes agree is accepted");
        conn.execute(insert, rusqlite::params!["d", 0, "bbbb"])
            .expect("an unverified row may record what was read instead");
    }

    /// The columns F7 adds, and the promise the schema makes about them: a
    /// format is one of the four things a code can leave as, and nothing else.
    /// The clipboard is one of them and has no path, which is why the kind of
    /// an export is recorded beside the fact of it.
    #[test]
    fn an_export_records_what_it_wrote_and_at_what_resolution() {
        let conn = memory();
        apply(&conn).expect("migrate");

        let insert = "INSERT INTO verifications
             (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
              artefact_sha256, width, height, duration_ms, dpi, format)
             VALUES (?1, 't', 'export', 'rqrr 0.0.0', 1, 'aaaa', 'aaaa', 'cccc', 8, 8, 1, ?2, ?3)";

        for (index, format) in ["png", "svg", "pdf", "clipboard"].iter().enumerate() {
            conn.execute(insert, rusqlite::params![index.to_string(), 300, format])
                .unwrap_or_else(|error| panic!("`{format}` must be recordable: {error}"));
        }
        conn.execute(
            insert,
            rusqlite::params!["none", None::<i64>, None::<String>],
        )
        .expect("a preview records neither, and says so with NULL");

        let refused = conn.execute(insert, rusqlite::params!["bad", 300, "tiff"]);
        assert!(
            refused.is_err(),
            "`tiff` is not something this product exports"
        );
    }

    #[test]
    fn a_verification_records_only_the_two_kinds_that_exist() {
        let conn = memory();
        apply(&conn).expect("migrate");

        let inserted = conn.execute(
            "INSERT INTO verifications
               (id, created_at, kind, decoder, verified, payload_sha256, artefact_sha256,
                width, height, duration_ms)
             VALUES ('e', 't', 'printed', 'rqrr 0.0.0', 0, 'aaaa', 'cccc', 8, 8, 1)",
            [],
        );
        assert!(inserted.is_err(), "`printed` is not a kind of verification");
    }
}
