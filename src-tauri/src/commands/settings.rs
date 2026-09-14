//! The commands the Settings screen calls: read one choice, write one choice,
//! read them all.
//!
//! The list below is the schema of the settings. Not the table — the table
//! holds a key and a value and has no opinion (migration 006) — but this array,
//! in code, next to the commands that enforce it. Anything not on it is refused
//! by name, so the settings table is the set of choices this product offers and
//! never a place the interface can leave notes for itself. A key with a value
//! that does not fit is refused the same way, with the range spelled out: a
//! preference is read at start-up, and a resolution of `six hundred` written
//! once is a screen that cannot draw until somebody edits the file.
//!
//! Which is also why the read side checks the same rules. A value that does not
//! fit its key — a workspace edited by hand, or written by a newer build that
//! knows a choice this one does not — is reported as never having been set, and
//! the interface starts from its own default. What comes out of this boundary
//! is always something that could have gone in.
//!
//! The defaults themselves are the interface's, not the host's. This module
//! knows what a setting may hold and nothing about what it means: which theme
//! is the ordinary one, and what size a code is when nobody said, are decisions
//! the domain and the screen make (ADR-003).
//!
//! # Changelog of this boundary
//!
//! - F11: `settings_get`, `settings_set`, `settings_all`, and the theme moved
//!   out of the browser store and into the workspace.

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db::{settings, Db};
use crate::error::{Error, Result};

/// What one setting is worth, as the interface receives it. `null` when it has
/// never been set — an object rather than a bare value, so the reply has room
/// to grow without changing shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SettingValue {
    /// The stored value, or `None` when there is none this build will hand back.
    pub value: Option<String>,
}

/// One setting, in the list of all of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Setting {
    /// The key, from the closed list below.
    pub key: String,
    /// What it is worth.
    pub value: String,
}

/// What a setting may hold.
///
/// Three shapes cover every choice this product offers, and each one knows how
/// to say what it wanted — the sentence a person reads is built from the rule
/// rather than written beside it, so a bound can never be changed in one place
/// and explained in the other.
enum Rule {
    /// One of a fixed set of words, exactly as written.
    OneOf(&'static [&'static str]),
    /// A number, whole or not, between two bounds inclusive.
    Number { low: f64, high: f64 },
    /// A whole number between two bounds inclusive.
    Whole { low: i64, high: i64 },
}

/// Every setting this product keeps, and what each may hold.
///
/// Closed, on purpose. A key that is not here is not a setting: the answer is
/// one sentence, not a row.
const SETTINGS: &[(&str, Rule)] = &[
    ("theme", Rule::OneOf(&["system", "light", "dark"])),
    (
        "default_width_mm",
        Rule::Number {
            low: 5.0,
            high: 1000.0,
        },
    ),
    (
        "default_dpi",
        Rule::Whole {
            low: 72,
            high: 1200,
        },
    ),
    ("default_quiet_zone", Rule::Whole { low: 0, high: 16 }),
    ("keep_wifi_passwords", Rule::OneOf(&["true", "false"])),
];

/// What one setting is worth, or `null` when nobody has chosen.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the key is not a setting this product keeps;
/// [`Error::Database`] when the table could not be read.
#[tauri::command(rename_all = "snake_case")]
pub fn settings_get(db: State<'_, Db>, key: String) -> Result<SettingValue> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    settings_get_with(&conn, &key)
}

/// Write one setting.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the key is not a setting this product keeps, or
/// the value does not fit it; [`Error::Database`] when the row could not be
/// written.
#[tauri::command(rename_all = "snake_case")]
pub fn settings_set(db: State<'_, Db>, key: String, value: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    settings_set_with(&conn, &key, &value)
}

/// Every setting that has been chosen, by key. A choice nobody has made is
/// absent rather than guessed at.
///
/// # Errors
///
/// [`Error::Database`] when the table could not be read.
#[tauri::command(rename_all = "snake_case")]
pub fn settings_all(db: State<'_, Db>) -> Result<Vec<Setting>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    settings_all_with(&conn)
}

/// What [`settings_get`] does once the database is in hand.
fn settings_get_with(conn: &Connection, key: &str) -> Result<SettingValue> {
    let rule = rule_for(key).ok_or_else(unknown_setting)?;
    let value = settings::get(conn, key)?.and_then(|stored| keep(rule, key, stored));
    Ok(SettingValue { value })
}

/// What [`settings_set`] does once the database is in hand.
fn settings_set_with(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let rule = rule_for(key).ok_or_else(unknown_setting)?;
    let value = value.trim();
    if !rule.accepts(value) {
        return Err(Error::InvalidInput(rule.expectation(key)));
    }
    settings::set(conn, key, value)?;
    log::info!("the setting `{key}` is now `{value}`");
    Ok(())
}

/// What [`settings_all`] does once the database is in hand.
fn settings_all_with(conn: &Connection) -> Result<Vec<Setting>> {
    let found = settings::all(conn)?
        .into_iter()
        .filter_map(|(key, value)| {
            let Some(rule) = rule_for(&key) else {
                log::warn!("the workspace holds `{key}`, which is not a setting this build keeps");
                return None;
            };
            let value = keep(rule, &key, value)?;
            Some(Setting { key, value })
        })
        .collect();
    Ok(found)
}

/// The rule for a key, or `None` when the key is not a setting.
fn rule_for(key: &str) -> Option<&'static Rule> {
    SETTINGS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, rule)| rule)
}

/// A stored value, if this build will hand it back.
///
/// Something else wrote it — a newer version, or a person with a database
/// editor — and it is not what the key allows. It is left in the file, because
/// deleting somebody's row to tidy up is not this command's business, and it is
/// not returned, because the interface would act on it.
fn keep(rule: &Rule, key: &str, value: String) -> Option<String> {
    if rule.accepts(&value) {
        Some(value)
    } else {
        log::warn!("the stored value of `{key}` is not one this build accepts; it is ignored");
        None
    }
}

impl Rule {
    /// Whether a value fits. The value is already trimmed on the way in, and is
    /// compared as it is stored on the way out.
    fn accepts(&self, value: &str) -> bool {
        match self {
            Rule::OneOf(allowed) => allowed.contains(&value),
            // `is_finite` is the part that matters: `inf` and `NaN` both parse,
            // and neither is a width anybody printed.
            Rule::Number { low, high } => value
                .parse::<f64>()
                .is_ok_and(|number| number.is_finite() && number >= *low && number <= *high),
            Rule::Whole { low, high } => value
                .parse::<i64>()
                .is_ok_and(|number| number >= *low && number <= *high),
        }
    }

    /// The sentence for a value that does not fit, naming the key and what it
    /// takes.
    fn expectation(&self, key: &str) -> String {
        match self {
            Rule::OneOf(allowed) => format!("{key} is {}.", in_words(allowed)),
            Rule::Number { low, high } => format!("{key} is a number from {low} to {high}."),
            Rule::Whole { low, high } => format!("{key} is a whole number from {low} to {high}."),
        }
    }
}

/// A list of words as a person reads one: `a, b or c`.
fn in_words(words: &[&str]) -> String {
    match words {
        [] => String::new(),
        [only] => (*only).to_string(),
        [rest @ .., last] => format!("{} or {last}", rest.join(", ")),
    }
}

/// The one sentence for a key this product does not keep. It does not repeat
/// the key back: whatever asked for it was not a person typing.
fn unknown_setting() -> Error {
    Error::InvalidInput("That is not a setting this product keeps.".to_string())
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

    /// One value per key that must be accepted — the same list the interface
    /// starts from.
    const ORDINARY: &[(&str, &str)] = &[
        ("theme", "dark"),
        ("default_width_mm", "40"),
        ("default_dpi", "300"),
        ("default_quiet_zone", "4"),
        ("keep_wifi_passwords", "true"),
    ];

    #[test]
    fn a_setting_that_was_never_chosen_is_null_and_not_an_error() {
        let conn = workspace();

        assert_eq!(
            settings_get_with(&conn, "theme").expect("get"),
            SettingValue { value: None }
        );
        assert!(settings_all_with(&conn).expect("all").is_empty());
    }

    #[test]
    fn every_key_on_the_list_round_trips() {
        let conn = workspace();

        for (key, value) in ORDINARY {
            settings_set_with(&conn, key, value)
                .unwrap_or_else(|error| panic!("`{key}` must be writable: {error}"));
            assert_eq!(
                settings_get_with(&conn, key).expect("get").value.as_deref(),
                Some(*value),
                "`{key}` did not come back"
            );
        }

        let all = settings_all_with(&conn).expect("all");
        assert_eq!(all.len(), SETTINGS.len(), "every setting is in the list");
        for (key, value) in ORDINARY {
            let found = all
                .iter()
                .find(|setting| setting.key == *key)
                .unwrap_or_else(|| panic!("`{key}` is missing from the list"));
            assert_eq!(found.value, *value);
        }
    }

    /// The list is the schema of the settings. Anything else — including a key
    /// that is nearly right — is one sentence, and no row.
    #[test]
    fn a_key_that_is_not_on_the_list_is_refused() {
        let conn = workspace();
        let sentence = "That is not a setting this product keeps.";

        for key in [
            "",
            " ",
            "Theme",
            "theme ",
            "themes",
            "default_width",
            "wifi_password",
            "last_folder",
            "window_x",
            "theme'; DROP TABLE settings; --",
        ] {
            let refused = settings_set_with(&conn, key, "dark").expect_err("not a setting");
            assert_eq!(refused.to_string(), sentence, "writing `{key}`");
            let refused = settings_get_with(&conn, key).expect_err("not a setting");
            assert_eq!(refused.to_string(), sentence, "reading `{key}`");
        }

        assert!(
            settings::all(&conn).expect("all").is_empty(),
            "nothing that is not a setting reached the table"
        );
    }

    #[test]
    fn a_value_that_does_not_fit_its_key_names_the_key_and_the_range() {
        let conn = workspace();

        for (key, value, sentence) in [
            ("theme", "midnight", "theme is system, light or dark."),
            ("theme", "Dark", "theme is system, light or dark."),
            ("theme", "", "theme is system, light or dark."),
            (
                "default_width_mm",
                "4.9",
                "default_width_mm is a number from 5 to 1000.",
            ),
            (
                "default_width_mm",
                "1000.5",
                "default_width_mm is a number from 5 to 1000.",
            ),
            (
                "default_width_mm",
                "forty",
                "default_width_mm is a number from 5 to 1000.",
            ),
            (
                "default_width_mm",
                "inf",
                "default_width_mm is a number from 5 to 1000.",
            ),
            (
                "default_width_mm",
                "NaN",
                "default_width_mm is a number from 5 to 1000.",
            ),
            (
                "default_dpi",
                "71",
                "default_dpi is a whole number from 72 to 1200.",
            ),
            (
                "default_dpi",
                "1201",
                "default_dpi is a whole number from 72 to 1200.",
            ),
            (
                "default_dpi",
                "300.5",
                "default_dpi is a whole number from 72 to 1200.",
            ),
            (
                "default_quiet_zone",
                "-1",
                "default_quiet_zone is a whole number from 0 to 16.",
            ),
            (
                "default_quiet_zone",
                "17",
                "default_quiet_zone is a whole number from 0 to 16.",
            ),
            (
                "keep_wifi_passwords",
                "yes",
                "keep_wifi_passwords is true or false.",
            ),
            (
                "keep_wifi_passwords",
                "True",
                "keep_wifi_passwords is true or false.",
            ),
        ] {
            let refused =
                settings_set_with(&conn, key, value).expect_err("a value that does not fit");
            assert_eq!(refused.to_string(), sentence, "`{key}` = `{value}`");
        }

        assert!(
            settings::all(&conn).expect("all").is_empty(),
            "a refused value is not written"
        );
    }

    /// The edges are in, on both sides of every range, and a width may be
    /// fractional because a printed size is measured rather than counted.
    #[test]
    fn the_ends_of_every_range_are_allowed() {
        let conn = workspace();

        for (key, value) in [
            ("theme", "system"),
            ("theme", "light"),
            ("theme", "dark"),
            ("default_width_mm", "5"),
            ("default_width_mm", "1000"),
            ("default_width_mm", "25.4"),
            ("default_dpi", "72"),
            ("default_dpi", "1200"),
            ("default_quiet_zone", "0"),
            ("default_quiet_zone", "16"),
            ("keep_wifi_passwords", "true"),
            ("keep_wifi_passwords", "false"),
        ] {
            settings_set_with(&conn, key, value)
                .unwrap_or_else(|error| panic!("`{key}` must accept `{value}`: {error}"));
            assert_eq!(
                settings_get_with(&conn, key).expect("get").value.as_deref(),
                Some(value)
            );
        }
    }

    /// A person types a space; the value is a value.
    #[test]
    fn a_value_is_trimmed_before_it_is_stored() {
        let conn = workspace();

        settings_set_with(&conn, "default_dpi", "  600 ").expect("set");

        assert_eq!(
            settings_get_with(&conn, "default_dpi")
                .expect("get")
                .value
                .as_deref(),
            Some("600")
        );
    }

    #[test]
    fn choosing_again_replaces_the_choice() {
        let conn = workspace();

        settings_set_with(&conn, "theme", "light").expect("set");
        settings_set_with(&conn, "theme", "dark").expect("set again");

        assert_eq!(
            settings_get_with(&conn, "theme")
                .expect("get")
                .value
                .as_deref(),
            Some("dark")
        );
        assert_eq!(settings_all_with(&conn).expect("all").len(), 1);
    }

    /// A row this build did not write — a newer version's key, or a value
    /// somebody edited into the file — is not handed to the interface as though
    /// this build had agreed to it.
    #[test]
    fn a_row_this_build_does_not_recognise_is_reported_as_unset() {
        let conn = workspace();
        settings::set(&conn, "theme", "midnight").expect("write it behind the command's back");
        settings::set(&conn, "sync_to_cloud", "true").expect("a key from nowhere");

        assert_eq!(
            settings_get_with(&conn, "theme").expect("get").value,
            None,
            "a value the rule refuses is not handed back"
        );
        assert!(
            settings_all_with(&conn).expect("all").is_empty(),
            "and neither is a key that is not a setting"
        );
        assert_eq!(
            settings::all(&conn).expect("all").len(),
            2,
            "the rows are left where they are"
        );
    }

    #[test]
    fn what_reaches_the_interface_is_a_value_and_a_list_of_pairs() {
        let conn = workspace();
        settings_set_with(&conn, "theme", "dark").expect("set");

        let one = serde_json::to_value(settings_get_with(&conn, "theme").expect("get"))
            .expect("serialise");
        assert_eq!(one["value"], serde_json::json!("dark"));
        let none = serde_json::to_value(settings_get_with(&conn, "default_dpi").expect("get"))
            .expect("serialise");
        assert_eq!(none["value"], serde_json::Value::Null);

        let all = serde_json::to_value(settings_all_with(&conn).expect("all")).expect("serialise");
        assert_eq!(
            all,
            serde_json::json!([{ "key": "theme", "value": "dark" }])
        );
    }

    /// The list a person reads, for each shape of rule that has one.
    #[test]
    fn a_list_of_choices_is_written_the_way_it_is_read() {
        assert_eq!(
            in_words(&["system", "light", "dark"]),
            "system, light or dark"
        );
        assert_eq!(in_words(&["true", "false"]), "true or false");
        assert_eq!(in_words(&["only"]), "only");
        assert_eq!(in_words(&[]), "");
    }
}
