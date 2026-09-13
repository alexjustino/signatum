//! The commands the Library screen and the Brand kit card call: keep a code,
//! list what is kept, open one, rename one, remove one — and the same three for
//! a brand kit.
//!
//! What is kept is fields, never an image (ADR-028). Opening a saved code hands
//! its payload, style and size back to the domain, which rebuilds the scene and
//! hands it to the gate again; `scene_sha256` is what the interface compares
//! afterwards to know it got the same code back. Nothing here renders anything.
//!
//! The JSON this boundary passes through is the domain's shape and stays opaque
//! (ADR-003): it is checked for being JSON and for being a sane length, and for
//! nothing else. That is what lets the Wi-Fi opt-out (ADR-018) live entirely in
//! the interface — the password is blanked before `save_code` is called, and the
//! host writes what it is given without knowing which field mattered.
//!
//! # Changelog of this boundary
//!
//! - F8: `save_code`, `list_codes`, `get_code`, `rename_code`, `delete_code`,
//!   `save_brand_kit`, `list_brand_kits`, `delete_brand_kit`.

use rusqlite::Connection;
use tauri::State;

use crate::db::brand_kits::{self, BrandKit, NewBrandKit};
use crate::db::codes::{self, is_storable_json, NewCode, SavedCode, SavedCodeSummary};
use crate::db::{logos, Db, MAX_NAME_CHARS};
use crate::error::{Error, Result};

/// The longest payload kind this host will store. A kind is a word the domain
/// chose (`link`, `wifi`, `contact`), not a sentence, and the schema says so in
/// SQL as well.
pub const MAX_KIND_CHARS: usize = 32;

/// The length of a SHA-256 in hex.
const SHA256_CHARS: usize = 64;

/// Keep a code: its fields, its look, its size, and the hash of the scene they
/// made.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that is not a name, a kind or a scene
/// hash this host will not store, a JSON column that is not JSON or is too
/// large, and a `logo_id` that names a logo the workspace does not have;
/// [`Error::Database`] when the row could not be written.
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
// Flat, snake-case arguments are the contract with the interface: one value per
// thing the screen holds. Gathering them into a struct would nest the wire shape.
pub fn save_code(
    db: State<'_, Db>,
    name: String,
    kind: String,
    payload_json: String,
    style_json: String,
    size_json: String,
    logo_id: Option<String>,
    logo_json: Option<String>,
    scene_sha256: String,
) -> Result<SavedCode> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    save_code_with(
        &conn,
        &NewCode {
            name: &name,
            kind: &kind,
            payload_json: &payload_json,
            style_json: &style_json,
            size_json: &size_json,
            logo_id: logo_id.as_deref(),
            logo_json: logo_json.as_deref(),
            scene_sha256: &scene_sha256,
        },
    )
}

/// Every saved code, newest first, without the JSON.
///
/// # Errors
///
/// [`Error::Database`] when the library could not be read.
#[tauri::command(rename_all = "snake_case")]
pub fn list_codes(db: State<'_, Db>) -> Result<Vec<SavedCodeSummary>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    codes::list(&conn)
}

/// One saved code, whole, ready to be rebuilt into a scene.
///
/// # Errors
///
/// [`Error::InvalidInput`] when there is no such code, and when the row holds
/// JSON this build will not read; [`Error::Database`] when it could not be read
/// at all.
#[tauri::command(rename_all = "snake_case")]
pub fn get_code(db: State<'_, Db>, id: String) -> Result<SavedCode> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    codes::get(&conn, &id)?.ok_or_else(missing_code)
}

/// Give a saved code a new name.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that is not a name and for a code that is
/// no longer here; [`Error::Database`] when the row could not be written.
#[tauri::command(rename_all = "snake_case")]
pub fn rename_code(db: State<'_, Db>, id: String, name: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    rename_code_with(&conn, &id, &name)
}

/// Remove a saved code. Its verification rows stay, and lose their link.
///
/// # Errors
///
/// [`Error::InvalidInput`] when there is no such code; [`Error::Database`] when
/// the row could not be deleted.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_code(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    if codes::delete(&conn, &id)? {
        log::info!("a saved code was removed from the library");
        Ok(())
    } else {
        Err(missing_code())
    }
}

/// Keep a look as a brand kit: a logo, a style and a size, under a name.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a name that is not a name, a name another kit
/// already has, a JSON column that is not JSON or is too large, and a `logo_id`
/// that names a logo the workspace does not have; [`Error::Database`] when the
/// row could not be written.
#[tauri::command(rename_all = "snake_case")]
pub fn save_brand_kit(
    db: State<'_, Db>,
    name: String,
    logo_id: Option<String>,
    logo_json: Option<String>,
    style_json: String,
    size_json: String,
) -> Result<BrandKit> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    save_brand_kit_with(
        &conn,
        &NewBrandKit {
            name: &name,
            logo_id: logo_id.as_deref(),
            logo_json: logo_json.as_deref(),
            style_json: &style_json,
            size_json: &size_json,
        },
    )
}

/// Every brand kit, newest first.
///
/// # Errors
///
/// [`Error::Database`] when the kits could not be read, and
/// [`Error::InvalidInput`] when one of them holds JSON this build will not read.
#[tauri::command(rename_all = "snake_case")]
pub fn list_brand_kits(db: State<'_, Db>) -> Result<Vec<BrandKit>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    brand_kits::list(&conn)
}

/// Remove a brand kit. The codes started from it keep their look: a code holds
/// its own style, and never a reference to the kit it came from.
///
/// # Errors
///
/// [`Error::InvalidInput`] when there is no such kit; [`Error::Database`] when
/// the row could not be deleted.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_brand_kit(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    if brand_kits::delete(&conn, &id)? {
        log::info!("a brand kit was removed");
        Ok(())
    } else {
        Err(missing_kit())
    }
}

/// What [`save_code`] does once the database is in hand.
fn save_code_with(conn: &Connection, new: &NewCode) -> Result<SavedCode> {
    let name = checked_name(new.name)?;
    let kind = checked_kind(new.kind)?;
    for column in [new.payload_json, new.style_json, new.size_json] {
        check_json(column, "code")?;
    }
    let scene_sha256 = checked_hash(new.scene_sha256)?;
    let (logo_id, logo_json) = checked_logo(conn, new.logo_id, new.logo_json, "code")?;

    let saved = codes::insert(
        conn,
        &NewCode {
            name: &name,
            kind: &kind,
            payload_json: new.payload_json,
            style_json: new.style_json,
            size_json: new.size_json,
            logo_id,
            logo_json,
            scene_sha256: &scene_sha256,
        },
    )?;
    log::info!("a {} code was saved to the library", saved.kind);
    Ok(saved)
}

/// What [`rename_code`] does once the database is in hand.
fn rename_code_with(conn: &Connection, id: &str, name: &str) -> Result<()> {
    let name = checked_name(name)?;
    if codes::rename(conn, id, &name)? {
        Ok(())
    } else {
        Err(missing_code())
    }
}

/// What [`save_brand_kit`] does once the database is in hand.
fn save_brand_kit_with(conn: &Connection, new: &NewBrandKit) -> Result<BrandKit> {
    let name = checked_name(new.name)?;
    for column in [new.style_json, new.size_json] {
        check_json(column, "brand kit")?;
    }
    let (logo_id, logo_json) = checked_logo(conn, new.logo_id, new.logo_json, "brand kit")?;

    // Checked here as well as by the `UNIQUE` constraint underneath. The
    // constraint is what makes it true; this is what makes the sentence arrive
    // before anything was attempted, which is the difference between "that name
    // is taken" and a failed write.
    if brand_kits::find_by_name(conn, &name)?.is_some() {
        return Err(Error::InvalidInput(format!(
            "A brand kit called \"{name}\" already exists."
        )));
    }

    let saved = brand_kits::insert(
        conn,
        &NewBrandKit {
            name: &name,
            logo_id,
            logo_json,
            style_json: new.style_json,
            size_json: new.size_json,
        },
    )?;
    log::info!("a brand kit was saved");
    Ok(saved)
}

/// The name a person typed, as this workspace keeps it.
///
/// Trimmed, because trailing space is not part of what anybody meant; one line,
/// because a name is a row in a list and a newline in it would break the list
/// rather than the name; and bounded, because a label is not a sentence.
fn checked_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidInput("Give it a name.".to_string()));
    }
    if name.chars().any(char::is_control) {
        return Err(Error::InvalidInput(
            "A name is one line of text.".to_string(),
        ));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(Error::InvalidInput(format!(
            "A name can be at most {MAX_NAME_CHARS} characters."
        )));
    }
    Ok(name.to_string())
}

/// The payload kind, as the domain names it. A word, and this host does not say
/// which words exist: each kind arrives in its own slice, and a list here would
/// be a second list to keep in step with the domain's.
fn checked_kind(kind: &str) -> Result<String> {
    let kind = kind.trim();
    let plausible = !kind.is_empty()
        && kind.chars().count() <= MAX_KIND_CHARS
        && kind
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if plausible {
        Ok(kind.to_string())
    } else {
        Err(Error::InvalidInput(
            "That is not a kind of code.".to_string(),
        ))
    }
}

/// The scene's hash, which is what makes reopening a saved code checkable.
///
/// Sixty-four lower-case hexadecimal characters, and nothing else: the domain
/// computes it with its own SHA-256, and a hash this host cannot compare is a
/// promise it cannot keep.
fn checked_hash(hash: &str) -> Result<String> {
    let proper = hash.len() == SHA256_CHARS
        && hash
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
    if proper {
        Ok(hash.to_string())
    } else {
        Err(Error::InvalidInput(
            "That code's scene was not hashed, so it cannot be saved.".to_string(),
        ))
    }
}

/// One JSON column, checked for what this host is allowed to have an opinion
/// about: that it is JSON, and that it is not enormous.
fn check_json(value: &str, subject: &str) -> Result<()> {
    if value.len() > codes::MAX_JSON_BYTES {
        return Err(Error::InvalidInput(format!(
            "This {subject} is too large to save."
        )));
    }
    if !is_storable_json(value) {
        return Err(Error::InvalidInput(format!(
            "This {subject} could not be saved."
        )));
    }
    Ok(())
}

/// The logo a row will be drawn with, if any — and how it is drawn, which is
/// only a fact while there is a logo to draw.
///
/// A logo that is not in the workspace is a sentence rather than a foreign-key
/// failure: the person chose it, and a saved code that silently comes back
/// without it is a code they will print.
fn checked_logo<'a>(
    conn: &Connection,
    logo_id: Option<&'a str>,
    logo_json: Option<&'a str>,
    subject: &str,
) -> Result<(Option<&'a str>, Option<&'a str>)> {
    let Some(id) = logo_id else {
        if logo_json.is_some() {
            // Not an error: a plate and a size with no logo to draw describe
            // nothing, and the screen is about to send them again with a logo.
            log::warn!("a saved row was sent a logo's placement without a logo; it is not kept");
        }
        return Ok((None, None));
    };
    if !logos::exists(conn, id)? {
        return Err(Error::InvalidInput(
            "That logo is no longer in this workspace.".to_string(),
        ));
    }
    if let Some(json) = logo_json {
        check_json(json, subject)?;
    }
    Ok((Some(id), logo_json))
}

/// The one sentence for a code the library no longer holds.
fn missing_code() -> Error {
    Error::InvalidInput("That code is no longer in this workspace.".to_string())
}

/// The one sentence for a kit that is no longer there.
fn missing_kit() -> Error {
    Error::InvalidInput("That brand kit is no longer in this workspace.".to_string())
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

    fn a_logo(conn: &Connection) -> String {
        let document = concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r##"<rect width="24" height="24" fill="#204080"/></svg>"##
        );
        let logo = crate::imaging::logo::normalise(document.as_bytes()).expect("normalise");
        logos::insert(conn, "brand", &logo).expect("insert").id
    }

    const SCENE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const PAYLOAD: &str = r#"{"kind":"link","url":"https://example.com"}"#;
    const STYLE: &str = r##"{"foreground":"#000000","background":"#ffffff"}"##;
    const SIZE: &str = r#"{"value":25,"unit":"mm","dpi":300}"#;
    const PLATE: &str = r#"{"plate":"circle","size":"medium"}"#;

    fn a_code<'a>(name: &'a str, logo_id: Option<&'a str>) -> NewCode<'a> {
        NewCode {
            name,
            kind: "link",
            payload_json: PAYLOAD,
            style_json: STYLE,
            size_json: SIZE,
            logo_id,
            logo_json: logo_id.map(|_| PLATE),
            scene_sha256: SCENE,
        }
    }

    fn a_kit<'a>(name: &'a str, logo_id: Option<&'a str>) -> NewBrandKit<'a> {
        NewBrandKit {
            name,
            logo_id,
            logo_json: logo_id.map(|_| PLATE),
            style_json: STYLE,
            size_json: SIZE,
        }
    }

    #[test]
    fn a_saved_code_is_listed_and_comes_back_whole() {
        let conn = workspace();
        let logo = a_logo(&conn);

        let saved = save_code_with(&conn, &a_code("Menu", Some(&logo))).expect("save");

        let listed = codes::list(&conn).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);
        assert_eq!(listed[0].kind, "link");
        let read = codes::get(&conn, &saved.id)
            .expect("get")
            .expect("it is there");
        assert_eq!(read, saved);
        assert_eq!(read.payload_json, PAYLOAD);
        assert_eq!(read.scene_sha256, SCENE);
        assert_eq!(read.logo_json.as_deref(), Some(PLATE));
    }

    /// The payload is written exactly as it arrives, which is what ADR-018's
    /// opt-out rests on: the interface blanks the password, and the host has no
    /// idea that it did.
    #[test]
    fn the_payload_is_stored_verbatim() {
        let conn = workspace();
        let blanked = r#"{"kind":"wifi","ssid":"Office-5G","password":"","security":"wpa"}"#;

        let saved = save_code_with(
            &conn,
            &NewCode {
                name: "Office-5G",
                kind: "wifi",
                payload_json: blanked,
                ..a_code("Office-5G", None)
            },
        )
        .expect("save");

        let read = codes::get(&conn, &saved.id)
            .expect("get")
            .expect("it is there");
        assert_eq!(read.payload_json, blanked);
    }

    #[test]
    fn a_name_is_trimmed_and_bounded() {
        let conn = workspace();

        let saved = save_code_with(&conn, &a_code("  Menu  ", None)).expect("save");
        assert_eq!(saved.name, "Menu");

        let longest = "a".repeat(MAX_NAME_CHARS);
        assert_eq!(
            save_code_with(&conn, &a_code(&longest, None))
                .expect("the longest name there is")
                .name,
            longest
        );

        for (case, name) in [
            ("nothing at all", ""),
            ("only space", "   \t "),
            ("a tab and nothing else", "\t"),
        ] {
            let refused = save_code_with(&conn, &a_code(name, None)).expect_err(case);
            assert_eq!(refused.to_string(), "Give it a name.", "{case}");
        }

        let too_long = "a".repeat(MAX_NAME_CHARS + 1);
        let refused = save_code_with(&conn, &a_code(&too_long, None)).expect_err("too long");
        assert_eq!(refused.to_string(), "A name can be at most 80 characters.");

        let refused = save_code_with(&conn, &a_code("Menu\nCard", None)).expect_err("two lines");
        assert_eq!(refused.to_string(), "A name is one line of text.");
    }

    #[test]
    fn a_scene_that_was_not_hashed_cannot_be_saved() {
        let conn = workspace();
        let sentence = "That code's scene was not hashed, so it cannot be saved.";
        let too_long = "a".repeat(SHA256_CHARS + 1);

        for (case, hash) in [
            ("nothing", ""),
            ("too short", "abcdef"),
            ("too long", too_long.as_str()),
            (
                "in capitals",
                "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            (
                "not hexadecimal",
                "zzzz456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
        ] {
            let refused = save_code_with(
                &conn,
                &NewCode {
                    scene_sha256: hash,
                    ..a_code("Menu", None)
                },
            )
            .expect_err(case);
            assert_eq!(refused.to_string(), sentence, "{case}");
        }
        assert!(codes::list(&conn).expect("list").is_empty());
    }

    #[test]
    fn a_column_that_is_not_json_is_refused_and_so_is_an_enormous_one() {
        let conn = workspace();

        let refused = save_code_with(
            &conn,
            &NewCode {
                style_json: "not json",
                ..a_code("Menu", None)
            },
        )
        .expect_err("not JSON");
        assert_eq!(refused.to_string(), "This code could not be saved.");

        let enormous = format!(r#"{{"a":"{}"}}"#, "a".repeat(codes::MAX_JSON_BYTES));
        let refused = save_code_with(
            &conn,
            &NewCode {
                payload_json: &enormous,
                ..a_code("Menu", None)
            },
        )
        .expect_err("too large");
        assert_eq!(refused.to_string(), "This code is too large to save.");

        let refused = save_brand_kit_with(
            &conn,
            &NewBrandKit {
                style_json: &enormous,
                ..a_kit("Brand", None)
            },
        )
        .expect_err("too large");
        assert_eq!(refused.to_string(), "This brand kit is too large to save.");

        assert!(codes::list(&conn).expect("list").is_empty());
        assert!(brand_kits::list(&conn).expect("list").is_empty());
    }

    #[test]
    fn a_kind_this_host_will_not_store_is_refused() {
        let conn = workspace();

        let too_long = "k".repeat(MAX_KIND_CHARS + 1);

        for kind in ["", "  ", "Link", "a kind", too_long.as_str()] {
            let refused = save_code_with(
                &conn,
                &NewCode {
                    kind,
                    ..a_code("Menu", None)
                },
            )
            .expect_err("that is not a kind");
            assert_eq!(refused.to_string(), "That is not a kind of code.");
        }

        for kind in ["link", "wifi", "contact", "mecard", "geo", "sms"] {
            save_code_with(
                &conn,
                &NewCode {
                    kind,
                    ..a_code("Menu", None)
                },
            )
            .unwrap_or_else(|error| panic!("`{kind}` must be storable: {error}"));
        }
    }

    #[test]
    fn a_logo_the_workspace_does_not_have_is_one_sentence() {
        let conn = workspace();
        let sentence = "That logo is no longer in this workspace.";

        let refused = save_code_with(&conn, &a_code("Menu", Some("not-a-logo"))).expect_err("gone");
        assert_eq!(refused.to_string(), sentence);

        let refused =
            save_brand_kit_with(&conn, &a_kit("Brand", Some("not-a-logo"))).expect_err("gone");
        assert_eq!(refused.to_string(), sentence);
    }

    /// A plate and a size with no logo to draw describe nothing, so they are not
    /// kept — and saying no to the whole save over it would be worse.
    #[test]
    fn a_placement_with_no_logo_is_not_kept() {
        let conn = workspace();

        let saved = save_code_with(
            &conn,
            &NewCode {
                logo_id: None,
                logo_json: Some(PLATE),
                ..a_code("Menu", None)
            },
        )
        .expect("save");

        assert_eq!(saved.logo_id, None);
        assert_eq!(saved.logo_json, None);
    }

    #[test]
    fn renaming_and_removing_a_code_answer_for_a_code_that_is_not_there() {
        let conn = workspace();
        let saved = save_code_with(&conn, &a_code("Menu", None)).expect("save");

        rename_code_with(&conn, &saved.id, "  Lunch menu  ").expect("rename");
        let read = codes::get(&conn, &saved.id)
            .expect("get")
            .expect("it is there");
        assert_eq!(read.name, "Lunch menu");

        let refused = rename_code_with(&conn, "not-a-code", "Menu").expect_err("no such code");
        assert_eq!(
            refused.to_string(),
            "That code is no longer in this workspace."
        );

        let refused = rename_code_with(&conn, &saved.id, " ").expect_err("no name");
        assert_eq!(refused.to_string(), "Give it a name.");

        assert!(codes::delete(&conn, &saved.id).expect("delete"));
        assert_eq!(
            codes::get(&conn, &saved.id).expect("get"),
            None,
            "and it is gone"
        );
    }

    #[test]
    fn two_kits_cannot_share_a_name() {
        let conn = workspace();
        save_brand_kit_with(&conn, &a_kit("Brand", None)).expect("save");

        let refused = save_brand_kit_with(&conn, &a_kit("  Brand  ", None))
            .expect_err("the name is taken, trimmed or not");

        assert_eq!(
            refused.to_string(),
            "A brand kit called \"Brand\" already exists."
        );
        assert_eq!(brand_kits::list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_kit_is_saved_listed_and_removed() {
        let conn = workspace();
        let logo = a_logo(&conn);

        let saved = save_brand_kit_with(&conn, &a_kit("Brand", Some(&logo))).expect("save");

        assert_eq!(brand_kits::list(&conn).expect("list"), vec![saved.clone()]);
        assert_eq!(saved.logo_id.as_deref(), Some(logo.as_str()));
        assert_eq!(saved.style_json, STYLE);
        assert!(brand_kits::delete(&conn, &saved.id).expect("delete"));
        assert!(brand_kits::list(&conn).expect("list").is_empty());
    }

    #[test]
    fn what_reaches_the_interface_is_flat_and_in_snake_case() {
        let conn = workspace();
        let logo = a_logo(&conn);
        let code = save_code_with(&conn, &a_code("Menu", Some(&logo))).expect("save");
        let kit = save_brand_kit_with(&conn, &a_kit("Brand", Some(&logo))).expect("save");

        let code_json = serde_json::to_value(&code).expect("serialise");
        for key in [
            "id",
            "created_at",
            "updated_at",
            "name",
            "kind",
            "payload_json",
            "style_json",
            "size_json",
            "logo_id",
            "logo_json",
            "scene_sha256",
        ] {
            assert!(code_json.get(key).is_some(), "a code is missing `{key}`");
        }

        let kit_json = serde_json::to_value(&kit).expect("serialise");
        for key in [
            "id",
            "created_at",
            "updated_at",
            "name",
            "logo_id",
            "logo_json",
            "style_json",
            "size_json",
        ] {
            assert!(kit_json.get(key).is_some(), "a kit is missing `{key}`");
        }
    }
}
