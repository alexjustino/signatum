//! Persistence: a thin repository over SQLite. No business logic lives here.
//!
//! The rule that keeps this module small: what a link is, and how a code is
//! drawn, are pure TypeScript in `src/domain/`. Rust owns storage, migrations,
//! the scan gate's evidence, and the operating system.

pub mod batches;
pub mod brand_kits;
pub mod codes;
pub mod logos;
pub mod migrations;
pub mod verifications;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// The open database, held for the lifetime of the process.
pub struct Db(pub Mutex<Connection>);

/// The environment variable that relocates the workspace.
///
/// Set by the end-to-end suite so a test run never opens the person's real
/// workspace. It is read once, here, and reported by Diagnostics, so a relocated
/// workspace is never a silent one.
pub const DATA_DIR_ENV: &str = "SIGNATUM_DATA_DIR";

/// The workspace file name.
pub const DATABASE_FILE: &str = "signatum.sqlite3";

/// The longest name any row in this workspace keeps.
///
/// One number for a logo's label, a saved code's name and a brand kit's name,
/// because they are the same idea — the word a person picks a thing by in a
/// list — and two numbers for one idea eventually disagree. The `CHECK`
/// constraints in `004_library.sql` spell it out in SQL; if this changes, they
/// change with it, in a migration.
pub const MAX_NAME_CHARS: usize = 80;

/// Resolve the workspace file: `%APPDATA%/io.github.alexjustino.signatum/signatum.sqlite3`,
/// or `$SIGNATUM_DATA_DIR/signatum.sqlite3` when the variable is set.
pub fn database_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = match std::env::var_os(DATA_DIR_ENV) {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => app.path().app_data_dir().map_err(|_| Error::DataDir)?,
    };
    std::fs::create_dir_all(&dir).map_err(|_| Error::DataDir)?;
    Ok(dir.join(DATABASE_FILE))
}

/// Open the workspace, apply pending migrations, and return the connection.
pub fn open(app: &AppHandle) -> Result<Connection> {
    let path = database_path(app)?;
    open_at(&path)
}

/// Open a workspace file the way start-up does.
pub fn open_at(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    // WAL keeps readers from blocking the writer and survives a hard kill far
    // better than the rollback journal. NORMAL is the correct companion to WAL:
    // durable across application crash, and only at risk on OS power loss.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;

    migrations::apply(&conn)?;
    Ok(conn)
}

/// The instant, as every timestamp column stores it: UTC, milliseconds, `Z`.
pub fn now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// A new identifier. UUID v7 sorts by creation time, which keeps insertion
/// order readable in the file without a second column.
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}
#[cfg(test)]
mod tests {
    use super::*;

    /// The path the product actually takes: a file on disk, opened the way
    /// start-up opens it — WAL, foreign keys on, migrations applied. Every other
    /// test in this crate migrates an in-memory database, which is the same SQL
    /// and not the same file.
    #[test]
    fn a_real_file_is_opened_migrated_and_enforcing_its_foreign_keys() {
        let directory = std::env::temp_dir().join(format!("signatum-{}", new_id()));
        std::fs::create_dir_all(&directory).expect("scratch directory");
        let path = directory.join(DATABASE_FILE);

        let conn = open_at(&path).expect("open a new workspace");
        assert_eq!(
            migrations::current_version(&conn),
            migrations::target_version()
        );
        let enforcing: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("read the pragma back");
        assert_eq!(enforcing, 1, "a workspace that does not enforce its keys");
        let orphan = conn.execute(
            "INSERT INTO codes
               (id, created_at, updated_at, name, kind, payload_json, style_json, size_json,
                logo_id, scene_sha256)
             VALUES ('a', 't', 't', 'Menu', 'link', '{}', '{}', '{}', 'not-a-logo', ?1)",
            ["a".repeat(64)],
        );
        assert!(orphan.is_err(), "on disk as much as in memory");

        drop(conn);
        let again = open_at(&path).expect("open it a second time");
        assert_eq!(
            migrations::current_version(&again),
            migrations::target_version(),
            "opening an already migrated workspace changes nothing"
        );

        drop(again);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
