//! The single error type that crosses the command boundary.
//!
//! Everything the frontend can see is serialised as `{ "kind": ..., "message": ... }`.
//! Internal detail (paths, SQL, OS codes) is logged, never returned — a message
//! that reaches the UI is written for a person.
//!
//! A code that does not read back is **not** a failure of the host: for
//! `verify_code` it is a `VerificationReport` with `verified: false`, which the
//! interface shows as the scan gate's state. It becomes an error — `refused` —
//! only for `export_png`, because there the export did not happen, and an
//! export that did not happen must not look like one that did (ADR-010).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the workspace database could not be opened or written")]
    Database(#[from] rusqlite::Error),

    #[error("the application data directory is not available")]
    DataDir,

    #[error("{0}")]
    InvalidInput(String),

    /// The SVG could not be turned into pixels. The SVG is this product's own,
    /// so this is a defect rather than a person's mistake — but it still has to
    /// arrive as a sentence.
    #[error("{0}")]
    Render(String),

    /// The code did not read back, so nothing was written. The message is the
    /// reason the decoder gave, and never echoes what was encoded.
    #[error("{0}")]
    Refused(String),

    #[error("{0}")]
    File(&'static str),
}

/// What the frontend receives. `kind` is stable and machine-readable; `message`
/// is the human sentence.
#[derive(Serialize)]
pub struct SerializedError {
    kind: &'static str,
    message: String,
}

impl Serialize for Error {
    // `Result` in this module is the crate alias, so the trait signature has to
    // spell out the standard one.
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let kind = match self {
            Error::Database(_) => "database",
            Error::DataDir => "data_dir",
            Error::InvalidInput(_) => "invalid_input",
            Error::Render(_) => "render",
            Error::Refused(_) => "refused",
            Error::File(_) => "file",
        };
        // The detail goes to the log; the frontend gets the sentence.
        log::error!("{kind}: {self:?}");
        SerializedError {
            kind,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
