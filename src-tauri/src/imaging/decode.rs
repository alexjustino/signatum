//! The other side of the gate: what an independent decoder reads in the pixels.
//!
//! `rqrr` shares nothing with the encoder that drew the code — not a table, not
//! a line (ADR-011). That is the whole point: a product that checked its own
//! work with its own code would only ever prove it is self-consistent.
//!
//! The bytes handed in are the bytes that will be written to disk. Nothing is
//! re-rendered, softened or retried between here and the file.

use image::ImageFormat;

use crate::error::{Error, Result};

/// Read a QR code out of PNG bytes.
///
/// Returns the decoded content as bytes — exactly the bytes the code carries,
/// not a string, so a payload is compared byte for byte and never through a
/// lossy conversion.
///
/// `Ok(None)` means the decoder found nothing it could read: no code at all, or
/// one too damaged to correct. That is an answer, not an error.
///
/// # Errors
///
/// [`Error::Render`] when the PNG cannot be decoded — these are bytes this host
/// encoded moments ago, so that would be a defect, not a person's mistake.
pub fn decode_png(png: &[u8]) -> Result<Option<Vec<u8>>> {
    let image = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| Error::Render(format!("the image could not be read back: {error}")))?;

    let mut prepared = rqrr::PreparedImage::prepare(image.to_luma8());
    let grids = prepared.detect_grids();
    let Some(grid) = grids.first() else {
        return Ok(None);
    };

    let mut content = Vec::new();
    match grid.decode_to(&mut content) {
        Ok(_) => Ok(Some(content)),
        Err(error) => {
            // A grid was found but could not be corrected. For the person this
            // is the same sentence as "no code"; the detail belongs in the log.
            log::debug!("a grid was detected but did not decode: {error}");
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::render::render_png;

    #[test]
    fn a_blank_square_holds_no_code() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29">
             <rect width="29" height="29" fill="#ffffff"/></svg>"##;
        let rendered = render_png(svg.as_bytes(), 256).expect("render");

        assert_eq!(decode_png(&rendered.png).expect("decode"), None);
    }

    #[test]
    fn bytes_that_are_not_an_image_are_a_defect_not_an_answer() {
        assert!(decode_png(b"certainly not a png").is_err());
    }
}
