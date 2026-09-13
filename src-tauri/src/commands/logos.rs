//! The four commands the Logo card calls: import one, list them, show one,
//! remove one.
//!
//! The only thing this boundary does that the pure code cannot is read the file
//! a person chose in the system's open dialog — and it reads exactly that one
//! path, capped, once. Everything after the first `read` is
//! `imaging::logo::normalise`, which owes a sentence for anything it will not
//! take (ADR-016).
//!
//! The interface never receives a path back, and never receives the file that
//! arrived: the thumbnail it shows is the **normalised** bytes as a `data:` URL,
//! which is the same thing that will be drawn on the code and the same thing
//! that was hashed.
//!
//! # Changelog of this boundary
//!
//! - F4: `import_logo`, `list_logos`, `logo_data_url`, `delete_logo`.
//! - F8: `delete_logo` refuses a logo something is drawn with, and says which
//!   things — the brand kits and the saved codes, by name. `ON DELETE RESTRICT`
//!   is the backstop in SQL; the sentence is here, because "it is in use"
//!   without saying where is a dead end for the person holding the mouse.

use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db::codes;
use crate::db::logos::{self, LogoFacts};
use crate::db::{brand_kits, Db};
use crate::error::{Error, Result};
use crate::imaging::logo::{normalise_named, NormalisedLogo, MAX_LOGO_BYTES};

/// The longest stored name. A name is a label in a list, not a sentence — and
/// it is the same bound for a logo, a saved code and a brand kit, so it lives
/// beside the workspace rather than here.
pub use crate::db::MAX_NAME_CHARS;

/// Names Windows will not give a file, whatever the extension. The console
/// devices are in the list with the rest: `CONIN$` and `CONOUT$` are not
/// spelled like the others, and a list that leaves out the two that look
/// different is a list somebody wrote from memory.
const RESERVED: [&str; 24] = [
    "con", "prn", "aux", "nul", "conin$", "conout$", "com1", "com2", "com3", "com4", "com5",
    "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
    "lpt9",
];

/// What the interface is told about a logo.
///
/// `data_url` is absent from a list — a list of thumbnails would be a list of
/// base64 blobs, and the screen asks for the ones it shows.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct LogoInfo {
    /// UUID v7.
    pub id: String,
    /// The sanitised file name.
    pub name: String,
    /// `raster` or `vector`.
    pub kind: String,
    /// What the bytes were: `png`, `jpeg`, `gif`, `webp` or `svg`.
    pub format: String,
    /// Pixels for a raster; the `viewBox` for an SVG.
    pub width: u32,
    /// The same, vertically.
    pub height: u32,
    /// What normalisation changed, in one sentence.
    pub note: Option<String>,
    /// Hex SHA-256 of the stored bytes.
    pub sha256: String,
    /// The stored bytes, for the screen. Absent in a list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

/// Read the file a person chose, normalise it, and keep the result.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a path this host will not read and for every
/// file normalisation refuses, each with its own sentence; [`Error::File`] when
/// the read itself failed; [`Error::Database`] when the row could not be
/// written.
#[tauri::command(rename_all = "snake_case")]
pub fn import_logo(db: State<'_, Db>, path: String) -> Result<LogoInfo> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    import_logo_with(&conn, &path)
}

/// Every logo in the workspace, newest first.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
#[tauri::command(rename_all = "snake_case")]
pub fn list_logos(db: State<'_, Db>) -> Result<Vec<LogoInfo>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    Ok(logos::list(&conn)?.into_iter().map(info).collect())
}

/// One logo's normalised bytes, as the `data:` URL the screen shows.
///
/// # Errors
///
/// [`Error::InvalidInput`] when there is no such logo; [`Error::Database`] when
/// the row could not be read.
#[tauri::command(rename_all = "snake_case")]
pub fn logo_data_url(db: State<'_, Db>, id: String) -> Result<String> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    let (_, logo) = logos::get(&conn, &id)?.ok_or_else(missing)?;
    Ok(data_url(&logo))
}

/// Remove a logo, unless something is drawn with it.
///
/// A logo a brand kit or a saved code carries is not removable, and the refusal
/// names them: the person is one click from being able to delete it, and a
/// sentence that does not say which kit to open is a sentence that sends them
/// looking through all of them.
///
/// # Errors
///
/// [`Error::Refused`] when a brand kit or a saved code is drawn with it;
/// [`Error::InvalidInput`] when there is no such logo; [`Error::Database`] when
/// the row could not be deleted.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_logo(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    delete_logo_with(&conn, &id)
}

/// What [`delete_logo`] does once the database is in hand.
fn delete_logo_with(conn: &Connection, id: &str) -> Result<()> {
    let kits = brand_kits::names_using_logo(conn, id)?;
    let saved = codes::names_using_logo(conn, id)?;
    if let Some(sentence) = in_use(&kits, &saved) {
        log::info!(
            "a logo was kept: {} brand kit(s) and {} saved code(s) are drawn with it",
            kits.len(),
            saved.len()
        );
        return Err(Error::Refused(sentence));
    }

    if logos::delete(conn, id)? {
        Ok(())
    } else {
        Err(missing())
    }
}

/// The most names one refusal spells out. Past this the sentence stops being a
/// sentence, and a count says the rest.
const MOST_NAMED: usize = 5;

/// The sentence a logo's refusal is, or `None` when nothing is drawn with it.
///
/// Pure, and tested in every grammatical shape it can take: one kit or several,
/// one saved code or several, either part on its own or both together. The
/// grammar is the point — a refusal a person reads twice is a refusal that has
/// not explained anything.
fn in_use(kits: &[String], codes: &[String]) -> Option<String> {
    let parts: Vec<String> = [
        phrase("the brand kit", "the brand kits", kits),
        phrase("the saved code", "the saved codes", codes),
    ]
    .into_iter()
    .flatten()
    .collect();

    if parts.is_empty() {
        return None;
    }
    Some(format!("This logo is used by {}.", parts.join(", and by ")))
}

/// One half of the sentence: a noun that agrees with how many there are, and the
/// names, quoted, with the last joined by "and".
fn phrase(one: &str, many: &str, names: &[String]) -> Option<String> {
    if names.is_empty() {
        return None;
    }

    let mut items: Vec<String> = names
        .iter()
        .take(MOST_NAMED)
        .map(|name| format!("\"{name}\""))
        .collect();
    if let Some(beyond) = names.len().checked_sub(MOST_NAMED).filter(|rest| *rest > 0) {
        items.push(format!("{beyond} more"));
    }

    let listed = match items.split_last() {
        Some((last, [])) => last.clone(),
        Some((last, before)) => format!("{} and {last}", before.join(", ")),
        // `items` holds at least one name: `names` is not empty.
        None => return None,
    };
    let noun = if names.len() == 1 { one } else { many };
    Some(format!("{noun} {listed}"))
}

/// What [`import_logo`] does once the database is in hand.
fn import_logo_with(conn: &Connection, path: &str) -> Result<LogoInfo> {
    let source = check_source(path)?;

    // The size is read from the directory entry, so a file far too large to be
    // a logo is refused without being read at all.
    let claimed = std::fs::metadata(source)
        .map_err(|error| {
            log::error!("a logo could not be opened: {error}");
            Error::File("that file could not be opened")
        })?
        .len();
    if claimed > MAX_LOGO_BYTES as u64 {
        return Err(Error::InvalidInput(format!(
            "This file is {:.1} MB; a logo can be at most {:.1} MB.",
            claimed as f64 / (1024.0 * 1024.0),
            MAX_LOGO_BYTES as f64 / (1024.0 * 1024.0)
        )));
    }

    let bytes = std::fs::read(source).map_err(|error| {
        log::error!("a logo could not be read: {error}");
        Error::File("that file could not be read")
    })?;

    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = sanitise_name(&file_name)?;

    let logo = normalise_named(&bytes, &file_name)?;
    let facts = logos::insert(conn, &name, &logo)?;
    log::info!(
        "imported a {} logo, {}×{}, stored as {} bytes",
        facts.format,
        facts.width,
        facts.height,
        logo.bytes.len()
    );

    let mut shown = info(facts);
    shown.data_url = Some(data_url(&logo));
    Ok(shown)
}

/// The path a person chose in the system's open dialog, checked before it is
/// read. Absolute, and on this machine.
fn check_source(path: &str) -> Result<&Path> {
    let source = Path::new(path);
    if !source.is_absolute() {
        return Err(Error::InvalidInput(
            "a logo is read from the full path of a file".to_string(),
        ));
    }
    // `is_absolute` is true of a UNC path (`\\host\share\logo.png`) and of a verbatim one
    // (`\\?\...`). Reading there would make the host open a network connection on the
    // interface's word, in a product that promises nothing leaves the machine — and the
    // system's open dialog never produces one for a local file.
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err(Error::InvalidInput(
            "a logo is read from a local drive, not from a network path".to_string(),
        ));
    }
    Ok(source)
}

/// Turn a file's name into the label this product will store.
///
/// A name here is never used to open anything: the file has already been read
/// by the time it is sanitised. It is still cut down to a label, because a
/// string that came out of somebody else's filesystem should not be able to
/// look like a path the next time it is shown, written into a CSV, or used to
/// suggest an export's file name (F7).
///
/// # Errors
///
/// [`Error::InvalidInput`] when nothing usable is left, or when the name is one
/// Windows reserves.
pub fn sanitise_name(file_name: &str) -> Result<String> {
    let unusable = || Error::InvalidInput("That file's name cannot be used.".to_string());

    // The last component only: `..\..\brand.png` is a logo called `brand`.
    let last = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim();
    let stem = last.rsplit_once('.').map_or(last, |(stem, _)| stem);

    let cleaned: String = stem
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();

    if cleaned.is_empty() {
        return Err(unusable());
    }
    if RESERVED.contains(&cleaned.to_ascii_lowercase().as_str()) {
        return Err(Error::InvalidInput(
            "That file's name is one Windows reserves; rename it and try again.".to_string(),
        ));
    }

    Ok(cleaned.chars().take(MAX_NAME_CHARS).collect())
}

/// The stored bytes as the screen can show them.
fn data_url(logo: &NormalisedLogo) -> String {
    let media = if logo.format == "svg" {
        "image/svg+xml"
    } else {
        // Every raster is stored as our own PNG, whatever it arrived as.
        "image/png"
    };
    format!("data:{media};base64,{}", STANDARD.encode(&logo.bytes))
}

/// Facts from the database, as the interface reads them.
fn info(facts: LogoFacts) -> LogoInfo {
    LogoInfo {
        id: facts.id,
        name: facts.name,
        kind: facts.kind,
        format: facts.format,
        width: facts.width,
        height: facts.height,
        note: facts.note,
        sha256: facts.sha256,
        data_url: None,
    }
}

/// The one sentence for an identifier that names nothing.
fn missing() -> Error {
    Error::InvalidInput("That logo is no longer in this workspace.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::brand_kits::NewBrandKit;
    use crate::db::codes::NewCode;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    /// A directory of its own for each test that writes, removed when it ends.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("signatum-{}", crate::db::new_id()));
            std::fs::create_dir_all(&path).expect("scratch directory");
            Self(path)
        }

        fn holding(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).expect("seed");
            path.to_string_lossy().into_owned()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn a_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(24, 24, image::Rgba([32, 64, 128, 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode");
        png
    }

    #[test]
    fn an_imported_logo_is_stored_normalised_and_shown_as_a_data_url() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("brand.png", &a_png());

        let shown = import_logo_with(&conn, &path).expect("import");

        assert_eq!(shown.name, "brand");
        assert_eq!(shown.kind, "raster");
        assert_eq!(shown.format, "png");
        assert_eq!((shown.width, shown.height), (24, 24));
        assert!(shown
            .data_url
            .as_deref()
            .is_some_and(|url| url.starts_with("data:image/png;base64,")));
        assert_eq!(logos::list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_png_named_svg_is_imported_as_a_png_and_the_note_says_so() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("brand.svg", &a_png());

        let shown = import_logo_with(&conn, &path).expect("import");

        assert_eq!(shown.format, "png");
        assert_eq!(
            shown.note.as_deref(),
            Some("The file is named .svg but it is a PNG; it was read as a PNG.")
        );
    }

    #[test]
    fn a_file_that_is_refused_is_not_stored() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("empty.png", b"");

        let refused = import_logo_with(&conn, &path).expect_err("an empty file is refused");

        assert_eq!(refused.to_string(), "This file is empty.");
        assert!(
            logos::list(&conn).expect("list").is_empty(),
            "a refused import leaves nothing behind"
        );
    }

    #[test]
    fn the_host_refuses_a_source_it_was_not_given_properly() {
        for path in [
            "brand.png",
            "",
            "\\\\server\\share\\brand.png",
            "//server/share/brand.png",
        ] {
            let refused = check_source(path).expect_err("this source must be refused");
            assert!(
                matches!(refused, Error::InvalidInput(_)),
                "{path}: {refused:?}"
            );
        }
    }

    #[test]
    fn a_name_is_a_label_and_never_a_path() {
        assert_eq!(sanitise_name("../../x.png").expect("x"), "x");
        assert_eq!(sanitise_name("a\\b.png").expect("b"), "b");
        assert_eq!(
            sanitise_name("C:/brands/logo.final.svg").expect("stem"),
            "logo.final"
        );
        assert_eq!(sanitise_name("  spaced  .png").expect("trimmed"), "spaced");
    }

    #[test]
    fn a_name_windows_reserves_is_refused() {
        for name in [
            "CON",
            "con.png",
            "NUL.svg",
            "lpt9.gif",
            "AuX",
            "CONIN$",
            "conout$.png",
        ] {
            let refused = sanitise_name(name).expect_err("this name must be refused");
            assert!(
                refused.to_string().contains("Windows reserves"),
                "{name}: {refused}"
            );
        }
    }

    #[test]
    fn a_name_that_is_nothing_at_all_is_refused() {
        for name in ["", "   ", "...", "??", "/", "....png"] {
            let refused = sanitise_name(name).expect_err("this name must be refused");
            assert_eq!(refused.to_string(), "That file's name cannot be used.");
        }
    }

    #[test]
    fn a_very_long_name_is_cut_to_a_label() {
        let long = format!("{}.png", "a".repeat(200));

        let name = sanitise_name(&long).expect("cut");

        assert_eq!(name.chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn a_deleted_logo_is_gone_and_asking_twice_says_so() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("brand.png", &a_png());
        let shown = import_logo_with(&conn, &path).expect("import");

        assert!(logos::delete(&conn, &shown.id).expect("delete"));
        let refused = logos::get(&conn, &shown.id).expect("get");
        assert_eq!(refused, None);
    }

    #[test]
    fn the_facts_reach_the_interface_in_snake_case() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("brand.png", &a_png());

        let shown = import_logo_with(&conn, &path).expect("import");
        let json = serde_json::to_value(&shown).expect("serialise");

        for key in [
            "id", "name", "kind", "format", "width", "height", "note", "sha256", "data_url",
        ] {
            assert!(json.get(key).is_some(), "`{key}` is missing");
        }

        let listed = logos::list(&conn)
            .expect("list")
            .into_iter()
            .map(info)
            .collect::<Vec<_>>();
        let listed = serde_json::to_value(&listed).expect("serialise");
        assert!(
            listed[0].get("data_url").is_none(),
            "a list does not carry thumbnails"
        );
    }
    fn named(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn a_logo_nothing_is_drawn_with_has_no_refusal() {
        assert_eq!(in_use(&[], &[]), None);
    }

    /// The grammar, one shape at a time. One kit or several, one saved code or
    /// several, either part alone and both together.
    #[test]
    fn the_refusal_names_what_is_drawn_with_the_logo() {
        for (kits, codes, expected) in [
            (
                named(&["Brand"]),
                named(&[]),
                "This logo is used by the brand kit \"Brand\".",
            ),
            (
                named(&["Brand", "Winter"]),
                named(&[]),
                "This logo is used by the brand kits \"Brand\" and \"Winter\".",
            ),
            (
                named(&["Brand", "Winter", "Summer"]),
                named(&[]),
                "This logo is used by the brand kits \"Brand\", \"Winter\" and \"Summer\".",
            ),
            (
                named(&[]),
                named(&["Menu"]),
                "This logo is used by the saved code \"Menu\".",
            ),
            (
                named(&[]),
                named(&["Menu", "Card"]),
                "This logo is used by the saved codes \"Menu\" and \"Card\".",
            ),
            (
                named(&["Brand"]),
                named(&["Menu", "Card"]),
                "This logo is used by the brand kit \"Brand\", and by the saved codes \"Menu\" and \"Card\".",
            ),
            (
                named(&["Brand", "Winter"]),
                named(&["Menu"]),
                "This logo is used by the brand kits \"Brand\" and \"Winter\", and by the saved code \"Menu\".",
            ),
        ] {
            assert_eq!(in_use(&kits, &codes).as_deref(), Some(expected));
        }
    }

    /// Past five names the sentence stops naming and starts counting — and the
    /// fifth is still named, because a list of five is still a list.
    #[test]
    fn a_long_list_is_cut_and_the_rest_is_counted() {
        let five = named(&["A", "B", "C", "D", "E"]);
        assert_eq!(
            in_use(&five, &[]).as_deref(),
            Some("This logo is used by the brand kits \"A\", \"B\", \"C\", \"D\" and \"E\".")
        );

        let six = named(&["A", "B", "C", "D", "E", "F"]);
        assert_eq!(
            in_use(&[], &six).as_deref(),
            Some("This logo is used by the saved codes \"A\", \"B\", \"C\", \"D\", \"E\" and 1 more.")
        );

        let eight = named(&["A", "B", "C", "D", "E", "F", "G", "H"]);
        assert_eq!(
            in_use(&[], &eight).as_deref(),
            Some("This logo is used by the saved codes \"A\", \"B\", \"C\", \"D\", \"E\" and 3 more.")
        );
    }

    /// And the whole path: the refusal is the host's sentence, the logo is still
    /// there afterwards, and it goes once nothing is drawn with it.
    #[test]
    fn a_logo_a_kit_and_a_code_are_drawn_with_is_kept_until_they_are_gone() {
        let conn = workspace();
        let scratch = Scratch::new();
        let path = scratch.holding("brand.png", &a_png());
        let logo = import_logo_with(&conn, &path).expect("import");

        let kit = brand_kits::insert(
            &conn,
            &NewBrandKit {
                name: "Brand",
                logo_id: Some(&logo.id),
                logo_json: Some(r#"{"plate":"circle"}"#),
                style_json: "{}",
                size_json: "{}",
            },
        )
        .expect("a kit");
        let code = codes::insert(
            &conn,
            &NewCode {
                name: "Menu",
                kind: "link",
                payload_json: "{}",
                style_json: "{}",
                size_json: "{}",
                logo_id: Some(&logo.id),
                logo_json: None,
                scene_sha256: &"a".repeat(64),
            },
        )
        .expect("a code");

        let refused = delete_logo_with(&conn, &logo.id).expect_err("it is in use");
        assert_eq!(
            refused.to_string(),
            "This logo is used by the brand kit \"Brand\", and by the saved code \"Menu\"."
        );
        assert!(matches!(refused, Error::Refused(_)));
        assert_eq!(
            logos::list(&conn).expect("list").len(),
            1,
            "it is still here"
        );

        brand_kits::delete(&conn, &kit.id).expect("delete the kit");
        let refused = delete_logo_with(&conn, &logo.id).expect_err("the code still has it");
        assert_eq!(
            refused.to_string(),
            "This logo is used by the saved code \"Menu\"."
        );

        codes::delete(&conn, &code.id).expect("delete the code");
        delete_logo_with(&conn, &logo.id).expect("nothing is drawn with it now");
        assert!(logos::list(&conn).expect("list").is_empty());
    }

    #[test]
    fn removing_a_logo_that_is_not_there_is_one_sentence() {
        let conn = workspace();

        let refused = delete_logo_with(&conn, "not-a-logo").expect_err("no such logo");

        assert_eq!(
            refused.to_string(),
            "That logo is no longer in this workspace."
        );
    }
}
