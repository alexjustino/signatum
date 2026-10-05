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
    (
        "004_library",
        include_str!("../../migrations/004_library.sql"),
    ),
    (
        "005_batches",
        include_str!("../../migrations/005_batches.sql"),
    ),
    (
        "006_settings",
        include_str!("../../migrations/006_settings.sql"),
    ),
    (
        "007_stamps",
        include_str!("../../migrations/007_stamps.sql"),
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
        assert_eq!(target_version(), 7, "P2 adds the seventh migration");

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
            for table in [
                "logos",
                "codes",
                "brand_kits",
                "batches",
                "batch_rows",
                "settings",
            ] {
                let rows: i64 = conn
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                    .unwrap_or_else(|error| panic!("`{table}` is missing at head: {error}"));
                assert_eq!(rows, 0);
            }
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

        for table in [
            "workspace",
            "verifications",
            "logos",
            "codes",
            "brand_kits",
            "batches",
            "batch_rows",
            "settings",
        ] {
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

    /// The migration this slice adds, from the version the last release left
    /// behind. The round-trip above covers every version at once, which is the
    /// property; this is the one case a person actually upgrading is in, and it
    /// says so by name — with a row already in the file, because a settings
    /// table that arrives by way of a rebuilt workspace would arrive empty.
    #[test]
    fn a_workspace_at_version_five_gains_the_settings_table_and_keeps_its_rows() {
        let conn = memory();
        for (index, (_, sql)) in sources().iter().enumerate() {
            let version = index as i64 + 1;
            if version > 5 {
                break;
            }
            conn.execute_batch(&format!(
                "BEGIN; {sql}
                 UPDATE workspace SET schema_version = {version} WHERE id = 1; COMMIT;"
            ))
            .expect("apply one migration by hand");
        }
        conn.execute(
            "INSERT INTO codes
               (id, created_at, updated_at, name, kind, payload_json, style_json, size_json,
                scene_sha256)
             VALUES ('kept', 't', 't', 'Menu', 'link', '{}', '{}', '{}', ?1)",
            ["a".repeat(64)],
        )
        .expect("save a code at version 5");
        assert_eq!(current_version(&conn), 5);

        apply(&conn).expect("migrate");

        assert_eq!(current_version(&conn), target_version());
        let settings: i64 = conn
            .query_row("SELECT count(*) FROM settings", [], |r| r.get(0))
            .expect("`settings` is missing after migrating from 5");
        assert_eq!(settings, 0, "a new table starts empty");
        let kept: i64 = conn
            .query_row("SELECT count(*) FROM codes WHERE id = 'kept'", [], |r| {
                r.get(0)
            })
            .expect("read back");
        assert_eq!(kept, 1, "and the library is still there");
    }

    /// The upgrade a person on 1.1's previous build makes: an export recorded at
    /// version 6 is still there at 7, with no stamp — it was written before there
    /// was one, and NULL says so rather than inventing one.
    #[test]
    fn a_workspace_at_version_six_gains_the_stamp_columns_and_keeps_its_rows() {
        let conn = memory();
        for (index, (_, sql)) in sources().iter().enumerate() {
            let version = index as i64 + 1;
            if version > 6 {
                break;
            }
            conn.execute_batch(&format!(
                "BEGIN; {sql}
                 UPDATE workspace SET schema_version = {version} WHERE id = 1; COMMIT;"
            ))
            .expect("apply one migration by hand");
        }
        conn.execute(
            "INSERT INTO verifications
               (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
                artefact_sha256, width, height, duration_ms, path, format)
             VALUES ('kept', 't', 'export', 'rqrr 0.0.0', 1, 'aaaa', 'aaaa', 'cccc', 8, 8, 1,
                     'C:/somewhere/code.png', 'png')",
            [],
        )
        .expect("record an export at version 6");
        assert_eq!(current_version(&conn), 6);

        apply(&conn).expect("migrate");

        assert_eq!(current_version(&conn), 7);
        let (stamp_ref, stamp_digest): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT stamp_ref, stamp_digest FROM verifications WHERE id = 'kept'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("the row is still there, and has the new columns");
        assert_eq!((stamp_ref, stamp_digest), (None, None));
    }

    /// What the schema promises about a stamp: a v4 reference, a digest of 64
    /// lowercase hex, both or neither, only on a written file, and never one
    /// reference on two rows.
    #[test]
    fn a_stamp_is_a_v4_reference_and_a_digest_on_a_written_file() {
        let conn = memory();
        apply(&conn).expect("migrate");

        let insert = "INSERT INTO verifications
             (id, created_at, kind, decoder, verified, payload_sha256, decoded_sha256,
              artefact_sha256, width, height, duration_ms, path, stamp_ref, stamp_digest)
             VALUES (?1, 't', 'export', 'rqrr 0.0.0', ?2, 'aaaa', 'aaaa', 'cccc', 8, 8, 1,
                     ?3, ?4, ?5)";
        let v4 = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
        let digest = "0123456789abcdef".repeat(4);
        let path = Some("C:/somewhere/code.png");

        conn.execute(insert, rusqlite::params!["ok", 1, path, v4, digest])
            .expect("a v4 reference and a digest on a written file are accepted");

        for (name, verified, path, reference, digest) in [
            (
                "v7",
                1,
                path,
                Some("0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"),
                Some(digest.clone()),
            ),
            (
                "upper",
                1,
                path,
                Some("3F2A9C1E-5B7D-4E8F-9A0B-1C2D3E4F5A6B"),
                Some(digest.clone()),
            ),
            (
                "variant",
                1,
                path,
                Some("3f2a9c1e-5b7d-4e8f-7a0b-1c2d3e4f5a6b"),
                Some(digest.clone()),
            ),
            (
                "short",
                1,
                path,
                Some("3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6"),
                Some(digest.clone()),
            ),
            ("digest", 1, path, Some(v4), Some("ABC".repeat(21) + "a")),
            ("ref alone", 1, path, Some(v4), None),
            ("digest alone", 1, path, None, Some(digest.clone())),
            ("refused", 0, None, Some(v4), Some(digest.clone())),
            ("no file", 1, None, Some(v4), Some(digest.clone())),
        ] {
            let refused = conn.execute(
                insert,
                rusqlite::params![name, verified, path, reference, digest],
            );
            assert!(refused.is_err(), "`{name}` must be refused");
        }

        let twice = conn.execute(
            insert,
            rusqlite::params!["again", 1, path, v4, "f".repeat(64)],
        );
        assert!(twice.is_err(), "one reference names one row");

        conn.execute(
            insert,
            rusqlite::params!["unstamped", 1, path, None::<String>, None::<String>],
        )
        .expect("a file written with stamping off has neither");
        conn.execute(
            insert,
            rusqlite::params!["unstamped too", 1, path, None::<String>, None::<String>],
        )
        .expect("and any number of rows may have none");
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
