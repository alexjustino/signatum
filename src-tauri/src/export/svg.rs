//! The SVG that gets written, and the logo it carries inside it.
//!
//! The scene is written **as the domain handed it over** — already carrying its
//! printed width (`width="25mm"`), viewBox and content untouched. The host adds
//! one thing and only when there is a logo: the logo itself, inside the file.
//!
//! The honest asymmetry, recorded in ADR-026: for an SVG the bytes that were
//! decoded are not the bytes that are written. What the decoder read is the
//! rasterisation of this same scene with this same logo composed onto it, from
//! the same stored bytes; what is written is the scene plus the logo as markup.
//! They are the same picture produced two ways, and the reason they must be is
//! that a renderer is not allowed to fetch an image (`render.rs` refuses
//! `<image>` outright), while a file a person opens in a browser has to carry its
//! logo or arrive without one.
//!
//! A raster logo is carried as a `data:image/png;base64,` URI; a vector logo is
//! inlined as a nested `<svg>` at the box, with its root attributes rewritten so
//! it lands exactly where the box is. Both are the **normalised** bytes this
//! product stored, never a file somebody sent (ADR-016). What comes out is
//! scanned before it is handed back, with the one allowance the export has and
//! nothing more.
//!
//! Pure: strings in, a string out.

use base64::Engine;

use crate::error::{Error, Result};
use crate::imaging::compose::LogoBox;
use crate::imaging::logo::{LogoKind, NormalisedLogo};
use crate::imaging::render::scan_exported_references;

/// How a logo is fitted into its box, in both exports and on screen: scaled
/// uniformly, centred, nothing cropped. The same rule `compose::draw_logo`
/// applies to the pixels, spelled the way SVG spells it.
const FIT: &str = "xMidYMid meet";

/// The SVG to write: the scene as it was given, with the logo carried in it.
///
/// `svg` is returned unchanged when there is no logo — not re-serialised, not
/// reformatted. The scene is the domain's, and a host that rewrote it would be a
/// second opinion about what was verified.
///
/// # Errors
///
/// [`Error::Render`] when the scene has no `<svg>` element to insert into, when
/// the stored logo cannot be read as a document, or when the result would refer
/// to anything outside itself. The last one should be impossible — the host
/// built the string — which is exactly why it is checked.
pub fn to_write(svg: &str, logo: Option<(&NormalisedLogo, LogoBox)>) -> Result<String> {
    let written = match logo {
        None => svg.to_string(),
        Some((logo, area)) => {
            let carried = match logo.kind {
                LogoKind::Raster => carried_png(logo, area),
                LogoKind::Vector => nested_svg(logo, area)?,
            };
            insert_before_close(svg, &carried)?
        }
    };

    scan_exported_references(written.as_bytes()).map_err(|finding| {
        log::error!("the SVG this host composed would reach outside itself: {finding:?}");
        Error::Render("the export could not be composed".to_string())
    })?;

    Ok(written)
}

/// A number as an SVG attribute: up to four decimals, and no trailing noise.
///
/// `format!("{value}")` would be shorter, and would also print `1e-7` for a
/// small number, which is valid SVG in some readers and not in others. Four
/// decimals of a module is far finer than any press.
fn number(value: f32) -> String {
    let text = format!("{value:.4}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The box, as the four attributes every embedded logo carries.
fn geometry(area: LogoBox) -> String {
    format!(
        r#"x="{}" y="{}" width="{}" height="{}""#,
        number(area.x),
        number(area.y),
        number(area.width),
        number(area.height)
    )
}

/// The stored PNG, carried inside the file as a `data:` URI.
fn carried_png(logo: &NormalisedLogo, area: LogoBox) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(&logo.bytes);
    format!(
        r#"<image {} href="data:image/png;base64,{encoded}" preserveAspectRatio="{FIT}"/>"#,
        geometry(area)
    )
}

/// The stored SVG, inlined as a nested `<svg>` placed at the box.
///
/// The stored bytes are `usvg`'s own serialisation (the importer normalised them
/// on the way in), so what is inlined is already a clean tree — no scripts, no
/// references, no entities. Only the root element's attributes are rewritten: its
/// `viewBox` is kept, because that is the coordinate system its contents are
/// drawn in, and the position, size and fit are the box's.
fn nested_svg(logo: &NormalisedLogo, area: LogoBox) -> Result<String> {
    let document = std::str::from_utf8(&logo.bytes)
        .map_err(|_| Error::Render("a stored logo is not a document".to_string()))?;

    let lowercase = document.to_ascii_lowercase();
    let opens = lowercase
        .find("<svg")
        .ok_or_else(|| Error::Render("a stored logo has no <svg> element".to_string()))?;
    let closes = document[opens..]
        .find('>')
        .map(|at| opens + at)
        .ok_or_else(|| Error::Render("a stored logo has no <svg> element".to_string()))?;

    let root = &document[opens..closes];
    let view_box = attribute(root, "viewBox")
        .unwrap_or_else(|| format!("0 0 {} {}", logo.width.max(1), logo.height.max(1)));
    let rest = &document[closes + 1..];
    let self_closing = root.trim_end().ends_with('/');

    let open = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" {} viewBox="{view_box}" preserveAspectRatio="{FIT}""#,
        geometry(area)
    );
    Ok(if self_closing {
        format!("{open}/>")
    } else {
        format!("{open}>{rest}")
    })
}

/// The value of `name` in an element's attributes, if it is there.
fn attribute(element: &str, name: &str) -> Option<String> {
    let lowercase = element.to_ascii_lowercase();
    let at = lowercase.find(&name.to_ascii_lowercase())?;
    let after = element[at + name.len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let quote = after.chars().next().filter(|q| *q == '"' || *q == '\'')?;
    Some(after[1..].split(quote).next()?.to_string())
}

/// Put `addition` immediately before the document's last `</svg>`.
///
/// The last one, not the first: a scene may hold a nested document one day, and
/// the logo belongs to the outermost.
fn insert_before_close(svg: &str, addition: &str) -> Result<String> {
    let lowercase = svg.to_ascii_lowercase();
    let at = lowercase
        .rfind("</svg")
        .ok_or_else(|| Error::Render("the scene has no </svg> to insert into".to_string()))?;

    let mut written = String::with_capacity(svg.len() + addition.len());
    written.push_str(&svg[..at]);
    written.push_str(addition);
    written.push_str(&svg[at..]);
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imaging::logo::normalise;

    /// The scene, sized the way the domain sizes it for an export.
    const SCENE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="25mm" height="25mm"><rect width="29" height="29" fill="#ffffff"/><path d="M4 4h1v1h-1z" fill="#000000"/></svg>"##;

    fn centred(fraction: f32) -> LogoBox {
        let side = 21.0 * fraction;
        LogoBox {
            x: (29.0 - side) / 2.0,
            y: (29.0 - side) / 2.0,
            width: side,
            height: side,
        }
    }

    fn raster_logo() -> NormalisedLogo {
        let image = image::RgbaImage::from_pixel(32, 32, image::Rgba([20, 20, 20, 255]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode");
        normalise(&png).expect("normalise")
    }

    fn vector_logo() -> NormalisedLogo {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">
             <rect width="40" height="20" fill="#1a1a1a"/></svg>"##;
        normalise(document.as_bytes()).expect("normalise")
    }

    #[test]
    fn a_code_without_a_logo_is_written_exactly_as_it_was_given() {
        assert_eq!(to_write(SCENE, None).expect("compose"), SCENE);
    }

    #[test]
    fn a_raster_logo_is_carried_inside_the_file() {
        let logo = raster_logo();

        let written = to_write(SCENE, Some((&logo, centred(0.2)))).expect("compose");

        assert!(written.contains("<image "));
        assert!(written.contains("href=\"data:image/png;base64,"));
        assert!(written.contains("preserveAspectRatio=\"xMidYMid meet\""));
        assert!(
            written.contains(r#"width="4.2" height="4.2""#),
            "the box is the one the domain asked for: {written}"
        );
        assert!(
            written.ends_with("</svg>"),
            "the logo goes inside the document"
        );
        assert!(
            written.contains(r#"width="25mm""#),
            "the printed size the domain wrote is still there"
        );
    }

    #[test]
    fn a_vector_logo_is_inlined_at_the_box_with_its_own_view_box() {
        let logo = vector_logo();

        let written = to_write(SCENE, Some((&logo, centred(0.2)))).expect("compose");

        assert!(
            written.contains(r#"viewBox="0 0 40 20""#),
            "the logo keeps the coordinate system its contents are drawn in: {written}"
        );
        assert_eq!(
            written.matches("<svg").count(),
            2,
            "one document, one nested logo"
        );
        assert!(
            !written.contains("<image"),
            "a vector logo is not a picture"
        );
        assert!(written.contains("preserveAspectRatio=\"xMidYMid meet\""));
    }

    /// The one rule the written file has to pass, and the reason the checker
    /// grew an allowance rather than an exception: no script, no external
    /// reference, no foreign content — for either kind of logo.
    #[test]
    fn what_is_written_refers_to_nothing_outside_itself() {
        for logo in [raster_logo(), vector_logo()] {
            let written = to_write(SCENE, Some((&logo, centred(0.2)))).expect("compose");

            assert!(!written.contains("<script"));
            assert!(!written.contains("<foreignObject"));
            assert!(!written.contains("xlink:href"));
            assert!(!written.to_ascii_lowercase().contains("<!doctype"));
            for (index, _) in written.match_indices("href") {
                let value = &written[index + "href".len()..];
                assert!(
                    value.starts_with("=\"data:image/png;base64,") || value.starts_with("=\"#"),
                    "an external reference reached the file: {}",
                    &value[..value.len().min(60)]
                );
            }
        }
    }

    #[test]
    fn a_scene_that_is_not_a_document_is_refused_rather_than_patched() {
        let logo = raster_logo();

        let refused = to_write("not a drawing at all", Some((&logo, centred(0.2))))
            .expect_err("that was written");

        assert!(matches!(refused, Error::Render(_)), "{refused:?}");
    }

    #[test]
    fn numbers_are_written_the_way_a_person_would() {
        assert_eq!(number(4.0), "4");
        assert_eq!(number(4.2), "4.2");
        assert_eq!(number(4.19999), "4.2");
        assert_eq!(number(0.000001), "0");
    }
}
