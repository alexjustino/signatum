//! The scan gate itself: render, decode, compare, and say so in one sentence.
//!
//! The rule this module exists to keep (ADR-010): nothing leaves this product
//! as a file until an independent decoder has read the pixels back and the
//! bytes it read are the bytes that were asked for. Not "looks right", not
//! "the encoder says so" — read back, byte for byte.

use std::time::Instant;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::imaging::decode::decode_png;
use crate::imaging::render::render_png;

/// The decoder's name, as the report and the record spell it.
pub const DECODER_NAME: &str = "rqrr";

/// The decoder's version. Declared here so the report can carry a number a
/// person could look up, and held to `Cargo.lock` by a test — a version nobody
/// can check is a decoration, not evidence.
pub const DECODER_VERSION: &str = "0.10.1";

/// What is said when the decoder found nothing to read.
pub const REASON_NO_CODE: &str = "The decoder found no code.";

/// What is said when the decoder read something, but not this.
pub const REASON_DIFFERENT: &str = "The decoder read something else.";

/// Name and version together, as they appear in a report: `rqrr 0.10.1`.
pub fn decoder() -> String {
    format!("{DECODER_NAME} {DECODER_VERSION}")
}

/// What the interface shows, and what the workspace records.
///
/// Everything in it is either a fact about the attempt or a hash. What the code
/// carries is never echoed back except as `decoded`, which is what the *decoder*
/// read — and which the interface shows only to say that the two disagree.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VerificationReport {
    /// True only when the decoded bytes were the payload bytes.
    pub verified: bool,
    /// The decoder that read it, name and version.
    pub decoder: String,
    /// What the decoder read, as text (lossy); `None` when it found no code.
    pub decoded: Option<String>,
    /// Hex SHA-256 of the payload.
    pub payload_sha256: String,
    /// Hex SHA-256 of what was decoded; `None` when nothing was.
    pub decoded_sha256: Option<String>,
    /// Hex SHA-256 of the PNG bytes that were decoded — and, for an export, of
    /// the bytes that were written.
    pub artefact_sha256: String,
    /// Pixel width of the artefact.
    pub width: u32,
    /// Pixel height of the artefact.
    pub height: u32,
    /// How long the render and the decode took together.
    pub duration_ms: u64,
    /// One sentence when the code did not verify; `None` when it did.
    pub reason: Option<String>,
}

/// A finished attempt: what to say about it, and the bytes it produced.
///
/// The report is the value that crosses the command boundary; the PNG stays on
/// this side until an export writes it. They travel together so that no caller
/// can write bytes other than the ones that were decoded.
pub struct Verification {
    /// What the interface and the workspace are told.
    pub report: VerificationReport,
    /// The exact artefact that was decoded.
    pub png: Vec<u8>,
}

/// Hex SHA-256, the way every hash in this product is written.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Render `svg`, decode the pixels, and compare what came back with `payload`.
///
/// Writes nothing and touches nothing outside memory. `decoder` is the name to
/// record — [`decoder()`] in the product, a fixed string in a test that must
/// not change when the dependency does.
///
/// # Errors
///
/// [`crate::error::Error::Render`] when the drawing could not be rasterised or
/// its PNG could not be read back. A code that simply does not read is not an
/// error: it is a report with `verified: false` and a reason.
pub fn verify(svg: &[u8], payload: &[u8], pixel_size: u32, decoder: &str) -> Result<Verification> {
    let started = Instant::now();

    let rendered = render_png(svg, pixel_size)?;
    let decoded = decode_png(&rendered.png)?;

    let duration_ms = started.elapsed().as_millis() as u64;

    let verified = decoded.as_deref() == Some(payload);
    let reason = match (&decoded, verified) {
        (_, true) => None,
        (None, _) => Some(REASON_NO_CODE.to_string()),
        (Some(_), _) => Some(REASON_DIFFERENT.to_string()),
    };

    let report = VerificationReport {
        verified,
        decoder: decoder.to_string(),
        decoded: decoded
            .as_deref()
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned()),
        payload_sha256: sha256_hex(payload),
        decoded_sha256: decoded.as_deref().map(sha256_hex),
        artefact_sha256: sha256_hex(&rendered.png),
        width: rendered.width,
        height: rendered.height,
        duration_ms,
        reason,
    };

    Ok(Verification {
        report,
        png: rendered.png,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::{blank_svg, hello_world_svg, HELLO_WORLD};

    #[test]
    fn a_code_that_reads_back_is_verified() {
        let verification = verify(
            hello_world_svg().as_bytes(),
            HELLO_WORLD.as_bytes(),
            512,
            &decoder(),
        )
        .expect("verify");
        let report = verification.report;

        assert!(report.verified, "reason: {:?}", report.reason);
        assert_eq!(report.decoded.as_deref(), Some(HELLO_WORLD));
        assert_eq!(report.reason, None);
        assert_eq!(report.decoded_sha256, Some(report.payload_sha256.clone()));
        assert_eq!(report.artefact_sha256, sha256_hex(&verification.png));
        assert_eq!((report.width, report.height), (512, 512));
    }

    #[test]
    fn an_empty_square_says_the_decoder_found_no_code() {
        let report = verify(
            blank_svg().as_bytes(),
            HELLO_WORLD.as_bytes(),
            512,
            &decoder(),
        )
        .expect("verify")
        .report;

        assert!(!report.verified);
        assert_eq!(report.decoded, None);
        assert_eq!(report.decoded_sha256, None);
        assert_eq!(report.reason.as_deref(), Some(REASON_NO_CODE));
    }

    #[test]
    fn a_code_of_something_else_says_so_and_the_hashes_differ() {
        let report = verify(
            hello_world_svg().as_bytes(),
            b"HELLO THERE",
            512,
            &decoder(),
        )
        .expect("verify")
        .report;

        assert!(!report.verified);
        assert_eq!(report.reason.as_deref(), Some(REASON_DIFFERENT));
        assert_eq!(report.decoded.as_deref(), Some(HELLO_WORLD));
        assert_ne!(report.decoded_sha256, Some(report.payload_sha256.clone()));
    }

    #[test]
    fn the_report_speaks_snake_case_to_the_interface() {
        let report = verify(blank_svg().as_bytes(), b"x", 64, "rqrr 0.0.0")
            .expect("verify")
            .report;
        let json = serde_json::to_value(&report).expect("serialise");

        for key in [
            "verified",
            "decoder",
            "decoded",
            "payload_sha256",
            "decoded_sha256",
            "artefact_sha256",
            "width",
            "height",
            "duration_ms",
            "reason",
        ] {
            assert!(
                json.get(key).is_some(),
                "`{key}` is missing from the report"
            );
        }
    }

    /// The version in the report has to be the version that ran. A number
    /// nobody can check is a decoration; this is the check.
    #[test]
    fn the_decoder_version_is_the_one_that_is_linked() {
        let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.lock"))
            .expect("Cargo.lock is committed next to Cargo.toml");

        let mut locked = None;
        let mut in_decoder = false;
        for line in lock.lines() {
            if let Some(name) = line.strip_prefix("name = ") {
                in_decoder = name.trim_matches('"') == DECODER_NAME;
            } else if in_decoder {
                if let Some(version) = line.strip_prefix("version = ") {
                    locked = Some(version.trim_matches('"').to_string());
                    break;
                }
            }
        }

        assert_eq!(
            locked.as_deref(),
            Some(DECODER_VERSION),
            "the decoder version in the report is not the one in Cargo.lock"
        );
    }
}
