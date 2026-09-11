//! Ten thousand symbols, read back by the decoder, byte for byte.
//!
//! F1's proof of done (spec §7): every randomised payload the encoder drew
//! comes back out of an independent decoder as the same bytes, and what the
//! decoder reads in the format information — version, error correction level,
//! mask — is what the encoder said it put there. A code that decodes to the
//! right bytes from the wrong matrix is a coincidence, not a correct encoder,
//! which is why all four are asserted and not just the payload.
//!
//! The corpus is generated, never committed: `npm run corpus` writes
//! `target/corpus/corpus.ndjson`, one JSON object per line. Ten thousand
//! symbols take minutes to rasterise and decode, so this test is `#[ignore]`d
//! and run deliberately:
//!
//!     cargo test --release --test corpus -- --ignored --nocapture
//!
//! Payloads are compared as **bytes**. Some of them are not valid UTF-8 at all,
//! and a comparison through `String` would quietly turn a defect into a pass.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::time::Instant;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Deserialize;
use signatum_lib::imaging::matrix::{rasterise_modules, unpack_modules};

/// Exactly how many symbols the corpus holds. A corpus that lost lines is not
/// the proof, so the count is asserted like everything else.
const EXPECTED_LINES: usize = 10_000;

/// What to say when the file is not there. It is generated, so this is an
/// instruction, not a diagnosis — and never a silent pass.
const MISSING_CORPUS: &str =
    "run `npm run corpus:generate` first — the corpus is generated, not committed";

/// The quiet zone a QR code needs around it, in modules (spec §2.4).
const QUIET_ZONE: u32 = 4;

/// How many failures are spelled out in the assertion message. The count is
/// always the true one; ten examples are enough to see the pattern.
const FAILURES_SHOWN: usize = 10;

/// One line of the corpus: what the encoder produced, and what it claims.
#[derive(Deserialize)]
struct CorpusLine {
    id: u64,
    /// Base64 of the payload bytes — arbitrary bytes, not necessarily text.
    payload: String,
    ecl: String,
    version: usize,
    mask: u16,
    size: usize,
    /// Base64 of the module bits, row-major, 8 per byte, most significant bit
    /// first, 1 = dark.
    modules: String,
}

/// A symbol that did not come back as it went in.
struct Failure {
    id: u64,
    version: usize,
    ecl: String,
    mask: u16,
    reason: String,
}

/// The error correction level as `rqrr` reports it.
///
/// `rqrr`'s `MetaData::ecc_level` is the raw two-bit error-correction field of
/// the format information, not an ordering of its own: `rqrr` 0.10.1
/// `src/decode.rs::read_format` computes `ecc_level = fdata >> 3` from the
/// unmasked five-bit format value, and `src/version_db.rs` then indexes its
/// Reed-Solomon table with it — for version 1 that table reads data-word counts
/// 16, 19, 9, 13, which are M, L, H, Q in that order. That is ISO/IEC 18004
/// Table 12: L = 0b01, M = 0b00, Q = 0b11, H = 0b10.
fn ecc_level_of(ecl: &str) -> Option<u16> {
    match ecl {
        "M" => Some(0),
        "L" => Some(1),
        "H" => Some(2),
        "Q" => Some(3),
        _ => None,
    }
}

/// Pixels per module.
///
/// Three is enough for a decoder to find the grid in a raster that is already
/// perfectly square and unblurred, and keeps the largest symbol inside a
/// manageable image. The big versions get a fourth pixel: from version 30 up
/// the sampling grid spans enough modules that a rounding of a third of a pixel
/// starts to land on the wrong one, and a symbol that failed for want of a
/// pixel would read as an encoder defect — the one thing this test must not
/// invent.
fn px_per_module(version: usize) -> u32 {
    if version >= 30 {
        4
    } else {
        3
    }
}

/// Where the generated corpus lives, relative to the crate.
fn corpus_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("corpus")
        .join("corpus.ndjson")
}

/// Decode one line's symbol and say what, if anything, disagreed.
fn check(line: &CorpusLine) -> Result<(), String> {
    let payload = STANDARD
        .decode(&line.payload)
        .map_err(|error| format!("the payload is not base64: {error}"))?;
    let packed = STANDARD
        .decode(&line.modules)
        .map_err(|error| format!("the modules are not base64: {error}"))?;

    let expected_ecc = ecc_level_of(&line.ecl)
        .ok_or_else(|| format!("`{}` is not an error correction level", line.ecl))?;

    let modules =
        unpack_modules(line.size, &packed).map_err(|error| format!("unpacking: {error}"))?;
    let image = rasterise_modules(line.size, &modules, px_per_module(line.version), QUIET_ZONE);

    let mut prepared = rqrr::PreparedImage::prepare(image);
    let grids = prepared.detect_grids();
    let grid = match grids.len() {
        1 => &grids[0],
        0 => return Err("the decoder found no grid".to_string()),
        many => return Err(format!("the decoder found {many} grids, not one")),
    };

    // `decode_to` writes bytes, not a `String`: a payload that is not valid
    // UTF-8 has to survive this comparison unchanged.
    let mut decoded = Vec::new();
    let meta = grid
        .decode_to(&mut decoded)
        .map_err(|error| format!("the grid did not decode: {error}"))?;

    if decoded != payload {
        return Err(format!(
            "the bytes differ: {} in, {} out",
            payload.len(),
            decoded.len()
        ));
    }
    if meta.version.0 != line.version {
        return Err(format!(
            "the decoder read version {}, not {}",
            meta.version.0, line.version
        ));
    }
    if meta.ecc_level != expected_ecc {
        return Err(format!(
            "the decoder read error correction {}, not {} ({})",
            meta.ecc_level, expected_ecc, line.ecl
        ));
    }
    if meta.mask != line.mask {
        return Err(format!(
            "the decoder read mask {}, not {}",
            meta.mask, line.mask
        ));
    }

    Ok(())
}

#[test]
#[ignore = "minutes long, and needs the generated corpus"]
fn ten_thousand_randomised_payloads_decode_byte_exact_through_rqrr() {
    let path = corpus_path();
    let file = File::open(&path).unwrap_or_else(|_| panic!("{MISSING_CORPUS}"));

    let started = Instant::now();
    let mut read = 0usize;
    let mut failures: Vec<Failure> = Vec::new();

    for (index, line) in BufReader::new(file).lines().enumerate() {
        let text = line.unwrap_or_else(|error| panic!("line {}: {error}", index + 1));
        if text.trim().is_empty() {
            continue;
        }

        let entry: CorpusLine = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("line {} is not a corpus entry: {error}", index + 1));

        read += 1;
        if let Err(reason) = check(&entry) {
            failures.push(Failure {
                id: entry.id,
                version: entry.version,
                ecl: entry.ecl,
                mask: entry.mask,
                reason,
            });
        }
    }

    let seconds = started.elapsed().as_secs_f64();
    println!(
        "corpus: {} decoded, byte-exact, in {seconds:.1} s",
        read - failures.len()
    );

    assert!(
        failures.is_empty(),
        "{} of {read} symbols did not read back as they were encoded:\n{}",
        failures.len(),
        failures
            .iter()
            .take(FAILURES_SHOWN)
            .map(|failure| format!(
                "  id {} (version {}, {}, mask {}): {}",
                failure.id, failure.version, failure.ecl, failure.mask, failure.reason
            ))
            .collect::<Vec<_>>()
            .join("\n")
    );

    assert_eq!(
        read, EXPECTED_LINES,
        "the corpus holds a different number of symbols than the {EXPECTED_LINES} it must — a corpus that lost lines is not the proof"
    );
}
