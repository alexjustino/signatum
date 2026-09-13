//! Signatum — a code you can hold up to a phone, proven readable before it is
//! saved.
//!
//! # Layering
//!
//! This crate is deliberately thin. It owns four things and nothing else:
//! storage (SQLite, migrations, the record of every verification), the scan
//! gate (render the drawing, hand the pixels to an independent decoder, compare
//! byte for byte), the operating system (the accent colour, the clipboard, and
//! the one file a person asked to be written), and the typed command boundary. What a link is,
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
//! - F4: logos. A file a person was sent is normalised before it is stored —
//!   never passed through (ADR-016) — and is drawn onto the code *before* the
//!   PNG is encoded, so the artefact the decoder read is the artefact with the
//!   logo on it.
//! - F8: the library. A saved code is its fields and the hash of the scene they
//!   made, never a stored image (ADR-028): opening one rebuilds the scene and
//!   proves it again. A brand kit is the part of a code that is the same every
//!   time — a logo, a look and a size — and a logo a kit or a saved code is
//!   drawn with cannot be deleted from under it: the sentence names which ones.
//! - F7: the printed size. One code now leaves as four things — a PNG carrying
//!   its resolution, an SVG carrying its logo, a PDF page of exact millimetres,
//!   or an image on the clipboard — and every one of them passes the same gate
//!   first. `export/` builds the bytes of the two files that are made *around*
//!   the verified artefact; `os::clipboard` is the second thing in this crate
//!   that talks to the system. The scan margin reports how much the artefact
//!   survives and blocks nothing (ADR-026, ADR-027).
//! - F9: the batch. One CSV becomes one verified file per line, in the folder
//!   that was chosen and in no other: the run is the export pipeline in a loop,
//!   each line rendered, decoded and compared exactly as a single export is, and
//!   a line that cannot be made is a line of a report rather than the end of the
//!   run. `read_text_file` is the second and last command that reads a file
//!   somebody chose; `cancel_batch` is the only piece of state in this host that
//!   two commands share (ADR-029).

pub mod commands;
pub mod db;
pub mod error;
pub mod export;
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
            // The flag a run reads between lines. Managed rather than passed,
            // because the command that stops a batch is not the one running it.
            app.manage(commands::batch::BatchCancel::default());
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
            commands::codes::export_svg,
            commands::codes::export_pdf,
            commands::codes::copy_png,
            commands::codes::scan_margin,
            commands::logos::import_logo,
            commands::logos::list_logos,
            commands::logos::logo_data_url,
            commands::logos::delete_logo,
            commands::library::save_code,
            commands::library::list_codes,
            commands::library::get_code,
            commands::library::rename_code,
            commands::library::delete_code,
            commands::library::save_brand_kit,
            commands::library::list_brand_kits,
            commands::library::delete_brand_kit,
            commands::batch::read_text_file,
            commands::batch::run_batch,
            commands::batch::cancel_batch,
            commands::batch::write_batch_report,
        ])
        .run(tauri::generate_context!())
        .expect("Signatum failed to start");
}
