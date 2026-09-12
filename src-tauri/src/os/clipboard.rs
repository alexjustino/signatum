//! The clipboard: the one place a code goes without a file.
//!
//! What is placed there is the **image** and only the image. Never the payload
//! as text — a link sitting on the clipboard is a link that gets pasted into the
//! wrong window, and this product's whole promise is that what leaves it is what
//! was verified (`SECURITY.md`).
//!
//! No capability is granted for this: the clipboard is the host's own, reached
//! through `arboard` rather than through a plugin the interface could call. The
//! interface asks for a copy; it cannot put anything on the clipboard itself.

use image::ImageFormat;

use crate::error::{Error, Result};

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
