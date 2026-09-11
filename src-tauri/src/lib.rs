//! Signatum — a code you can hold up to a phone, proven readable before it is
//! saved.
//!
//! # Layering
//!
//! This crate is deliberately thin. It owns four things and nothing else:
//! storage (SQLite, migrations, the record of every verification), the scan
//! gate (render the drawing, hand the pixels to an independent decoder, compare
//! byte for byte), the operating system (the accent colour, and the one file a
//! person asked to be written), and the typed command boundary. What a link is,
//! what a code looks like and how it is encoded are pure TypeScript in
//! `src/domain/`, where they can be unit-tested without a window (ADR-011,
//! ADR-012).
//!
//! # Changelog of this entry point
//!
//! - F0: database opened and migrated at startup, rotating file log, accent
//!   ramp, and the two commands the Create screen needs — a code verified live,
//!   and a PNG written only after an independent decoder read it back as what
//!   was typed. Closing the window ends the product: there is nothing here that
//!   has to outlive it.

pub mod commands;
pub mod db;
pub mod error;
pub mod imaging;
pub mod os;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The system's own file dialogs, and nothing else from the filesystem:
        // the plugin returns a path, and the host's own command writes exactly
        // that one file — after the code in it has been read back.
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                // `Builder::new` arrives with a default target set. Adding to it
                // rather than replacing it writes every line twice.
                .clear_targets()
                // Logs stay on this machine. There is no remote sink, by design.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let connection = db::open(app.handle())?;
            app.manage(db::Db(Mutex::new(connection)));
            log::info!(
                "workspace opened; Signatum {} ready",
                env!("CARGO_PKG_VERSION")
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::accent_ramp,
            commands::codes::verify_code,
            commands::codes::export_png,
        ])
        .run(tauri::generate_context!())
        .expect("Signatum failed to start");
}
