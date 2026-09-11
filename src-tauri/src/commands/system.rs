//! System-level commands: what this build is, and the colour the desktop uses.
//!
//! # Changelog of this boundary
//!
//! - F0: `system_info` for About and Diagnostics, `accent_ramp` for the token
//!   layer.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{migrations, Db, DATA_DIR_ENV};
use crate::error::Result;
use crate::os::accent;

/// What Diagnostics and About read. Never a hand-typed constant: the version
/// comes from the running binary.
#[derive(Serialize)]
pub struct SystemInfo {
    /// The product's name, as it is written.
    pub name: &'static str,
    /// The version of the binary that is running.
    pub version: &'static str,
    /// The schema version the workspace file is at.
    pub schema_version: i64,
    /// The schema version this build expects.
    pub expected_schema_version: i64,
    /// Where the workspace lives.
    pub database_path: String,
    /// How large it is.
    pub database_bytes: u64,
    /// True when `SIGNATUM_DATA_DIR` moved the workspace — a relocated
    /// workspace is never a silent one.
    pub database_relocated: bool,
    /// The operating system this is running on.
    pub platform: &'static str,
}

/// Identity, schema and workspace, as Diagnostics shows them.
#[tauri::command]
pub fn system_info(app: AppHandle, db: State<'_, Db>) -> Result<SystemInfo> {
    let path = crate::db::database_path(&app)?;
    let database_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let database_relocated = std::env::var_os(DATA_DIR_ENV).is_some_and(|v| !v.is_empty());

    let conn = db.0.lock().expect("the database lock was poisoned");

    Ok(SystemInfo {
        name: "Signatum",
        version: env!("CARGO_PKG_VERSION"),
        schema_version: migrations::current_version(&conn),
        expected_schema_version: migrations::target_version(),
        database_path: path.to_string_lossy().into_owned(),
        database_bytes,
        database_relocated,
        platform: std::env::consts::OS,
    })
}

/// The Windows accent ramp. The frontend writes it into the token layer, so the
/// application follows the colour the user chose for their desktop.
#[tauri::command]
pub fn accent_ramp() -> accent::AccentRamp {
    accent::read()
}
