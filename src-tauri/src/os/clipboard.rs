//! The clipboard: the one place a code goes without a file.
//!
//! What is placed there is the **image** and only the image. Never the payload
//! as text — a link sitting on the clipboard is a link that gets pasted into the
//! wrong window, and this product's whole promise is that what leaves it is what
//! was verified (`SECURITY.md`).
//!
//! F10 adds the other direction, and it is not symmetrical: what is *read* is
//! an **image** and only an image — a screenshot of a code somebody was sent.
//! Text on the clipboard is never looked at, so nothing a person copied for
//! another purpose is inspected by this product.
//!
//! No capability is granted for either: the clipboard is the host's own, reached
//! through `arboard` rather than through a plugin the interface could call. The
//! interface asks for a copy or asks what was copied; it cannot touch the
//! clipboard itself.

use image::ImageFormat;

use crate::error::{Error, Result};

/// What is said when the clipboard holds something that is not an image.
pub const NO_IMAGE: &str = "There is no image on the clipboard.";

/// What the caller has to do to place an image, so a test can watch it happen
/// without a desktop.
///
/// The clipboard is the one part of an export that cannot be proved in a
/// headless run: there is no window, no session and nothing to paste into. So
/// the *decision* — verify first, place second, record either way — is tested
/// against this, and the real implementation is the one line that talks to the
/// system.
pub type Placement = fn(image: &Image) -> Result<()>;

/// An image ready for the clipboard: straight RGBA, row by row.
pub struct Image {
    /// Pixel width.
    pub width: usize,
    /// Pixel height.
    pub height: usize,
    /// Four bytes per pixel, not premultiplied.
    pub rgba: Vec<u8>,
}

/// Read a PNG this host encoded back into the pixels the clipboard wants.
///
/// # Errors
///
/// [`Error::Render`] when the artefact cannot be read back — these are bytes
/// this host encoded moments ago, so that is a defect rather than a person's
/// mistake.
pub fn image_from_png(png: &[u8]) -> Result<Image> {
    let decoded = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|error| Error::Render(format!("the artefact could not be read back: {error}")))?
        .to_rgba8();

    Ok(Image {
        width: decoded.width() as usize,
        height: decoded.height() as usize,
        rgba: decoded.into_raw(),
    })
}

/// Take the image on the system clipboard, as straight RGBA.
///
/// The caps on how large that image may be are the reader's, not this
/// function's: this is the system surface, and what a picture may be is one
/// rule in one place (`commands::read`).
///
/// # Errors
///
/// [`Error::InvalidInput`] when there is no image on the clipboard — which is
/// the ordinary case, not a fault, and is why it is a person's sentence rather
/// than a failure; [`Error::File`] when the clipboard could not be opened at
/// all.
pub fn read_image() -> Result<Image> {
    let mut clipboard = arboard::Clipboard::new().map_err(unavailable)?;
    let copied = clipboard.get_image().map_err(|error| match error {
        // Nothing there, or something there that is not a picture.
        arboard::Error::ContentNotAvailable | arboard::Error::ConversionFailure => {
            Error::InvalidInput(NO_IMAGE.to_string())
        }
        other => unavailable(other),
    })?;

    Ok(Image {
        width: copied.width,
        height: copied.height,
        rgba: copied.bytes.into_owned(),
    })
}

/// Put the image on the system clipboard.
///
/// # Errors
///
/// [`Error::File`] with one sentence when the clipboard could not be opened or
/// written. It happens: another application can hold the clipboard open, and a
/// remote session may have none at all. The detail goes to the log, and the
/// verification that was already done is recorded either way — a copy that
/// failed is not a code that failed.
pub fn place(image: &Image) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new().map_err(refused)?;
    clipboard
        .set_image(arboard::ImageData {
            width: image.width,
            height: image.height,
            bytes: std::borrow::Cow::Borrowed(&image.rgba),
        })
        .map_err(refused)
}

/// One sentence for a clipboard that could not be opened at all.
fn unavailable(error: arboard::Error) -> Error {
    log::error!("the clipboard could not be read: {error}");
    Error::File("The clipboard could not be read.")
}

/// One sentence for a person, and the reason in the log.
fn refused(error: arboard::Error) -> Error {
    log::error!("the clipboard could not be written: {error}");
    Error::File("The clipboard could not be written.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::fixtures::hello_world_svg;
    use crate::imaging::render::render_png;

    #[test]
    fn an_artefact_becomes_four_bytes_a_pixel() {
        let artefact = render_png(hello_world_svg().as_bytes(), 128).expect("render");

        let image = image_from_png(&artefact.png).expect("read back");

        assert_eq!((image.width, image.height), (128, 128));
        assert_eq!(image.rgba.len(), 128 * 128 * 4);
        assert_eq!(
            image.rgba[3], 255,
            "a code is opaque, so the alpha is not a surprise"
        );
    }

    #[test]
    fn bytes_that_are_not_an_image_are_a_defect_not_an_answer() {
        assert!(image_from_png(b"certainly not a png").is_err());
    }
}
