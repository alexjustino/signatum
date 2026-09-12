//! The SVG this product drew, turned into the pixels a camera would see.
//!
//! Nothing here knows about windows, commands or the database: it takes bytes
//! and returns bytes, which is what makes the scan gate testable without an
//! application running (ADR-010).
//!
//! The PNG is encoded here too, by the `png` crate rather than by tiny-skia,
//! for one reason: a printed code has a physical size, and the place that says
//! so in a PNG is the `pHYs` chunk, which tiny-skia's encoder does not write.
//! One encoder produces the bytes that are decoded and the bytes that are
//! written, so the hash in the report is the hash of the file — including its
//! resolution (ADR-010).
//!
//! What is deliberately *not* rendered: text, system fonts and raster images
//! are compiled out of `resvg` (see `Cargo.toml`), and an SVG that reaches for
//! anything outside itself is refused before the parser sees it. A code is one
//! background rectangle and one path of dark modules (spec §3); anything else
//! arriving here is either a defect of ours or an input that should not be
//! trusted (ADR-016).

use resvg::tiny_skia;
use resvg::usvg;

use crate::error::{Error, Result};

/// The largest SVG this host will parse. A code's scene is a few kilobytes;
/// a megabyte is already a hundred times more than the product can produce.
pub const MAX_SVG_BYTES: usize = 1024 * 1024;

/// The smallest useful square, in pixels. Below this a code stops being a code.
pub const MIN_PIXEL_SIZE: u32 = 64;

/// The largest square this host will rasterise: 4096² pixels is 64 MiB in
/// memory, which is the point past which "bigger" stops being a size and starts
/// being a way to exhaust the machine.
pub const MAX_PIXEL_SIZE: u32 = 4096;

/// A rendered code: the PNG bytes, and the size they came out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    /// The encoded PNG. These are the bytes that get decoded, and the same
    /// bytes that get written — the artefact is never re-rendered.
    pub png: Vec<u8>,
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
}

/// What a pre-parse scan of an SVG found.
///
/// The scan is shared with the logo importer (`imaging::logo`): a person's file
/// is refused for exactly the things our own drawing is refused for. Only the
/// sentence differs — a defect of ours reads differently from a file somebody
/// was sent — so the finding travels as a value and each caller words it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reaching {
    /// The bytes are not an SVG document at all.
    NotAnSvg,
    /// A `<script>` element, or an `on…=` event-handler attribute.
    Script,
    /// Something outside the document: another image, foreign content, an
    /// entity or doctype declaration, an `href` that is not a local `#id`, or a
    /// stylesheet that imports or fetches.
    Outside,
}

/// What an SVG is allowed to carry, which is not the same question for a
/// drawing this host rasterises and for a file it writes.
///
/// The renderer allows nothing: every reference has to point inside the
/// document, and `<image>` is refused outright, because an image is how a
/// parser is made to read a file for you. The **export** has one exception, and
/// exactly one — the logo this product itself normalised and encoded, carried
/// inside the file as a `data:` URI rather than fetched from beside it. That
/// asymmetry is deliberate and recorded in ADR-026: an SVG with a `data:` image
/// in it reaches nowhere, and an SVG with a logo nobody can see is not an
/// export of the code that was verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Embedded {
    /// Nothing. What this host rasterises is always scanned this way.
    Nothing,
    /// One `<image>` per logo, whose `href` is a `data:image/png;base64,` URI
    /// and whose other attributes are geometry and nothing else.
    DataPng,
}

/// Markers an SVG this product drew never contains, and which would make the
/// renderer reach outside the document: another image, a script, foreign
/// content, or an entity declaration (the classic way to make a parser read a
/// file for you).
const FORBIDDEN: [(&str, Reaching); 6] = [
    ("<image", Reaching::Outside),
    ("<script", Reaching::Script),
    ("<foreignobject", Reaching::Outside),
    ("<!entity", Reaching::Outside),
    ("<!doctype", Reaching::Outside),
    ("xlink:href", Reaching::Outside),
];

/// True when an attribute named `on…` is assigned anywhere in `text`.
///
/// `usvg` ignores event handlers, but what this host stores is re-serialised
/// and what it exports is opened in a browser — so a handler is refused at the
/// door rather than trusted to be dropped downstream. The match has to be at an
/// attribute boundary: the letters `on` inside a word, an identifier or path
/// data are not a handler.
fn has_event_handler(text: &str) -> bool {
    let bytes = text.as_bytes();
    for (index, _) in text.match_indices("on") {
        let at_boundary = index > 0
            && matches!(
                bytes[index - 1],
                b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'"' | b'\'' | b';'
            );
        if !at_boundary {
            continue;
        }
        let rest = &text[index + 2..];
        let name = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        if name > 0 && rest[name..].trim_start().starts_with('=') {
            return true;
        }
    }
    false
}

/// True when a `<style>` block imports a stylesheet or fetches a URL.
///
/// A local paint reference (`fill="url(#gradient)"`) is fine and common; the
/// same text inside a stylesheet is not worth telling apart, so a style block
/// that contains either is refused whole.
fn style_reaches_out(text: &str) -> bool {
    for (index, _) in text.match_indices("<style") {
        let rest = &text[index..];
        let block = rest.find("</style").map_or(rest, |end| &rest[..end]);
        if block.contains("@import") || block.contains("url(") {
            return true;
        }
    }
    false
}

/// Replace every `<image>` element that carries a PNG as a `data:` URI with
/// spaces, so the rest of the document can be scanned as if it were not there.
///
/// Spaces rather than deletion: the length of the text is unchanged, which
/// keeps the remaining rules — all of which look at what precedes a match —
/// looking at the same neighbours they would have seen.
///
/// # Errors
///
/// [`Reaching::Outside`] for an `<image>` that is not exactly this: an
/// unterminated tag, an attribute that is not geometry, no `href`, more than
/// one, or an `href` that is not a base64 PNG. An image this host did not build
/// is an image pointing somewhere.
fn blank_carried_images(text: &str) -> std::result::Result<String, Reaching> {
    let mut out = text.to_string();
    let mut from = 0;

    while let Some(offset) = out[from..].find("<image") {
        let start = from + offset;
        let end = out[start..].find('>').ok_or(Reaching::Outside)? + start + 1;
        let inside = &out[start + "<image".len()..end - 1];
        if !is_carried_png(inside) {
            return Err(Reaching::Outside);
        }
        out.replace_range(start..end, &" ".repeat(end - start));
        from = end;
    }

    Ok(out)
}

/// True when an `<image>`'s attributes are geometry plus one base64 PNG.
///
/// The attributes are parsed rather than searched for, because a value may hold
/// a space (`preserveAspectRatio="xMidYMid meet"`) and because a name this host
/// does not write is the whole thing worth refusing.
fn is_carried_png(attributes: &str) -> bool {
    const ALLOWED: [&str; 6] = ["x", "y", "width", "height", "href", "preserveaspectratio"];
    const DATA_PNG: &str = "data:image/png;base64,";

    let mut rest = attributes.trim();
    let mut carried = 0;

    while !rest.is_empty() {
        if rest == "/" {
            break;
        }
        let Some(equals) = rest.find('=') else {
            return false;
        };
        let name = rest[..equals].trim();
        let after = rest[equals + 1..].trim_start();
        let Some(quote) = after.chars().next().filter(|q| *q == '"' || *q == '\'') else {
            return false;
        };
        let Some(close) = after[1..].find(quote) else {
            return false;
        };
        let value = &after[1..1 + close];

        if !ALLOWED.contains(&name) {
            return false;
        }
        if name == "href" {
            let Some(data) = value.strip_prefix(DATA_PNG) else {
                return false;
            };
            if data.is_empty()
                || !data
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
            {
                return false;
            }
            carried += 1;
        }

        rest = after[1 + close + 1..].trim_start();
    }

    carried == 1
}

/// Scan an SVG for everything that points outside it, before a parser sees it.
///
/// One lowercase copy of the document and a linear pass over it, which is what
/// makes it cheap enough to run on a file that is mostly hostile.
///
/// # Errors
///
/// The [`Reaching`] that was found. The caller turns it into a sentence.
pub fn scan_external_references(svg: &[u8]) -> std::result::Result<(), Reaching> {
    scan_references(svg, Embedded::Nothing)
}

/// The same scan, run over a file this host is about to **write**, where a logo
/// may be carried as a `data:image/png;base64,` image and nothing else may be
/// carried at all.
///
/// The allowance is narrow on purpose: the `<image>` element's attributes are
/// checked against a closed list before it is exempted, so an element that is
/// an image in name only is still refused, and everything around it is scanned
/// exactly as a rendered drawing would be.
///
/// # Errors
///
/// The [`Reaching`] that was found, as [`scan_external_references`] reports it.
pub fn scan_exported_references(svg: &[u8]) -> std::result::Result<(), Reaching> {
    scan_references(svg, Embedded::DataPng)
}

/// The one scan both entry points run, differing only in what it allows.
fn scan_references(svg: &[u8], allowed: Embedded) -> std::result::Result<(), Reaching> {
    let lowercase = String::from_utf8_lossy(svg).to_lowercase();

    if !lowercase.contains("<svg") {
        return Err(Reaching::NotAnSvg);
    }
    // The exempted images are blanked out of the working copy before anything
    // else looks at it, so every rule below runs on the rest of the document
    // unchanged — there is no rule that has to be taught about the exception.
    let text = match allowed {
        Embedded::Nothing => lowercase,
        Embedded::DataPng => blank_carried_images(&lowercase)?,
    };

    for (marker, finding) in FORBIDDEN {
        if text.contains(marker) {
            return Err(finding);
        }
    }
    if has_event_handler(&text) {
        return Err(Reaching::Script);
    }
    if style_reaches_out(&text) {
        return Err(Reaching::Outside);
    }
    // A local reference (`href="#id"`) is fine; anything else is a fetch.
    for (index, _) in text.match_indices("href") {
        let rest = &text[index + "href".len()..];
        let value = rest.trim_start().strip_prefix('=').map(str::trim_start);
        let points_at_itself = value
            .and_then(|v| v.strip_prefix('"').or_else(|| v.strip_prefix('\'')))
            .is_some_and(|v| v.starts_with('#'));
        if !points_at_itself {
            return Err(Reaching::Outside);
        }
    }
    Ok(())
}

/// Refuse anything that points outside the document before it is parsed, in the
/// words that suit a drawing this product made itself.
fn refuse_external_references(svg: &[u8]) -> Result<()> {
    scan_external_references(svg).map_err(|finding| {
        Error::Render(
            match finding {
                Reaching::NotAnSvg => "that is not an SVG document",
                Reaching::Script => "the drawing contains a script, which points outside itself",
                Reaching::Outside => "the drawing refers to something outside itself",
            }
            .to_string(),
        )
    })
}

/// A rasterised drawing, before it is encoded: the pixels, and the scale that
/// took the drawing's own coordinates to them.
///
/// The scale is returned rather than recomputed by the caller, because anything
/// drawn on top of a code — a logo, from F4 — is positioned in the scene's units
/// and has to land on the same pixels the modules did. Two copies of that
/// arithmetic is one copy too many.
pub struct Raster {
    /// The pixels, with the code already on them.
    pub pixmap: tiny_skia::Pixmap,
    /// Pixels per horizontal unit of the drawing's `viewBox`.
    pub scale_x: f32,
    /// Pixels per vertical unit of the drawing's `viewBox`.
    pub scale_y: f32,
}

/// The width and height of the drawing's own coordinate system, read from its
/// `viewBox`.
///
/// This is not the same number as `usvg`'s tree size once the drawing carries a
/// physical width: an export writes `width="25mm"` onto the scene (F7), and the
/// tree then measures 94.49 units of its own because that is 25 mm at 96 dpi.
/// Rasterising is unaffected — the `viewBox` transform is inside the tree — but
/// a logo's box arrives in `viewBox` units, and scaling it by pixels-per-tree-unit
/// would put it a third of the way across the code.
///
/// A drawing without a `viewBox` falls back to the tree's size, which is what it
/// means there.
fn view_box_units(svg: &[u8]) -> Option<(f32, f32)> {
    let text = String::from_utf8_lossy(svg).into_owned();
    // ASCII lowercase only: it is one byte per byte, so an offset into the copy
    // is an offset into the original.
    let lowercase = text.to_ascii_lowercase();
    let at = lowercase.find("viewbox")?;

    let after = text[at + "viewbox".len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let quote = after.chars().next().filter(|q| *q == '"' || *q == '\'')?;
    let value = after[1..].split(quote).next()?;

    let numbers: Vec<f32> = value
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<f32>().ok())
        .collect();

    match numbers[..] {
        [_, _, width, height]
            if width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0 =>
        {
            Some((width, height))
        }
        _ => None,
    }
}

/// Rasterise an SVG into a square pixmap of `pixel_size` on each side.
///
/// Everything [`render_png`] refuses is refused here; the difference is that
/// the pixels are still open, so a caller can compose onto them before they are
/// encoded — and what is encoded is what gets decoded (ADR-010).
///
/// # Errors
///
/// [`Error::Render`] when the document is not an SVG, points outside itself, is
/// larger than [`MAX_SVG_BYTES`], asks for a size outside
/// [`MIN_PIXEL_SIZE`]..=[`MAX_PIXEL_SIZE`], or cannot be parsed.
pub fn render_pixmap(svg: &[u8], pixel_size: u32) -> Result<Raster> {
    if svg.len() > MAX_SVG_BYTES {
        return Err(Error::Render(
            "the drawing is too large to render".to_string(),
        ));
    }
    if !(MIN_PIXEL_SIZE..=MAX_PIXEL_SIZE).contains(&pixel_size) {
        return Err(Error::Render(format!(
            "a code is rendered between {MIN_PIXEL_SIZE} and {MAX_PIXEL_SIZE} pixels square"
        )));
    }
    refuse_external_references(svg)?;

    // The defaults are governed by feature flags; the one that matters most is stated here so
    // that a flag switched on by mistake cannot silently give the parser the disk back.
    let options = usvg::Options {
        resources_dir: None,
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(svg, &options)
        .map_err(|error| Error::Render(format!("the drawing could not be read: {error}")))?;

    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return Err(Error::Render("the drawing has no size".to_string()));
    }

    let mut pixmap = tiny_skia::Pixmap::new(pixel_size, pixel_size)
        .ok_or_else(|| Error::Render("that size could not be allocated".to_string()))?;

    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(
            pixel_size as f32 / size.width(),
            pixel_size as f32 / size.height(),
        ),
        &mut pixmap.as_mut(),
    );

    // What is returned is the scale of the drawing's *own* coordinates, which is
    // the one a logo's box is expressed in. For a scene with no physical width
    // the two are the same number; for one with `width="25mm"` on it they are
    // not, and this is the one that is right in both cases.
    let (units_x, units_y) = view_box_units(svg).unwrap_or((size.width(), size.height()));

    Ok(Raster {
        pixmap,
        scale_x: pixel_size as f32 / units_x,
        scale_y: pixel_size as f32 / units_y,
    })
}

/// Pixels per metre, as a PNG's `pHYs` chunk records them: 300 dpi is 11 811.
///
/// The domain computes the same number for the caption it shows
/// (`pixelsPerMetre` in `size.ts`); this is the one that reaches the file.
pub fn pixels_per_metre(dpi: u32) -> u32 {
    (f64::from(dpi) / 0.0254).round() as u32
}

/// The pixmap's colours with the alpha divided back out, row by row, as a PNG
/// expects them.
///
/// tiny-skia keeps premultiplied pixels; a PNG stores straight ones. Its own
/// encoder does this conversion internally, which is why this exists here: this
/// host encodes elsewhere, and the conversion has to come with it.
fn straight_alpha(pixmap: &tiny_skia::Pixmap) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(pixmap.width() as usize * pixmap.height() as usize * 4);
    for pixel in pixmap.pixels() {
        let colour = pixel.demultiply();
        bytes.extend_from_slice(&[colour.red(), colour.green(), colour.blue(), colour.alpha()]);
    }
    bytes
}

/// Encode a pixmap as the PNG that will be decoded, and perhaps written.
///
/// When `dpi` is given, the PNG carries a `pHYs` chunk with the matching
/// pixels-per-metre on both axes: that is where the physical size a person
/// chose survives being saved, and it is what a layout program reads to place a
/// 25 mm code at 25 mm. It is written **here**, before the decode, so the bytes
/// that carry the resolution are the bytes that were read back and the bytes
/// that reach the disk — a chunk inserted afterwards would be a file nobody
/// verified (ADR-010).
///
/// # Errors
///
/// [`Error::Render`] when the encoder failed — these are our own pixels by
/// then, so that is a defect rather than a person's mistake.
pub fn encode(pixmap: &tiny_skia::Pixmap, dpi: Option<u32>) -> Result<Rendered> {
    let mut png = Vec::new();
    let failed = |error: png::EncodingError| {
        Error::Render(format!("the image could not be encoded: {error}"))
    };

    {
        let mut encoder = png::Encoder::new(&mut png, pixmap.width(), pixmap.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        if let Some(dpi) = dpi {
            let per_metre = pixels_per_metre(dpi);
            encoder.set_pixel_dims(Some(png::PixelDimensions {
                xppu: per_metre,
                yppu: per_metre,
                unit: png::Unit::Meter,
            }));
        }

        let mut writer = encoder.write_header().map_err(failed)?;
        writer
            .write_image_data(&straight_alpha(pixmap))
            .map_err(failed)?;
        writer.finish().map_err(failed)?;
    }

    Ok(Rendered {
        png,
        width: pixmap.width(),
        height: pixmap.height(),
    })
}

/// Render an SVG into a square PNG of `pixel_size` on each side.
///
/// The drawing is scaled from its own `viewBox` to fill the square, so the
/// caller asks for a size in pixels and never has to know the code's module
/// count.
///
/// # Errors
///
/// [`Error::Render`] when the document is not an SVG, points outside itself, is
/// larger than [`MAX_SVG_BYTES`], asks for a size outside
/// [`MIN_PIXEL_SIZE`]..=[`MAX_PIXEL_SIZE`], or cannot be parsed or encoded.
pub fn render_png(svg: &[u8], pixel_size: u32) -> Result<Rendered> {
    encode(&render_pixmap(svg, pixel_size)?.pixmap, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLANK: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29">
         <rect width="29" height="29" fill="#ffffff"/></svg>"##;

    #[test]
    fn a_drawing_becomes_a_square_png_of_the_size_asked_for() {
        let rendered = render_png(BLANK.as_bytes(), 128).expect("render");

        assert_eq!((rendered.width, rendered.height), (128, 128));
        assert_eq!(
            &rendered.png[..8],
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
            "the artefact is a PNG"
        );
    }

    #[test]
    fn a_size_outside_the_range_is_refused() {
        for size in [0, MIN_PIXEL_SIZE - 1, MAX_PIXEL_SIZE + 1] {
            assert!(render_png(BLANK.as_bytes(), size).is_err(), "{size} passed");
        }
    }

    #[test]
    fn a_drawing_that_reaches_outside_itself_is_refused_before_it_is_parsed() {
        let hostile = [
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="file:///c:/windows/win.ini" width="8" height="8"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <script>fetch('http://elsewhere')</script></svg>"##,
            r##"<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text>&x;</text></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <use href="https://elsewhere/thing.svg#a"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"
                 onload="fetch('http://elsewhere')"><rect width="8" height="8"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <style>@import url("https://elsewhere/x.css");</style></svg>"##,
        ];
        for document in hostile {
            let refused = render_png(document.as_bytes(), 64);
            assert!(refused.is_err(), "this was rendered: {document}");
        }
    }

    #[test]
    fn a_local_reference_is_still_allowed() {
        let document = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
             <defs><rect id="m" width="1" height="1" fill="#000"/></defs>
             <rect width="8" height="8" fill="#fff"/><use href="#m" x="2" y="2"/></svg>"##;
        assert!(render_png(document.as_bytes(), 64).is_ok());
    }

    /// The bounds are mirrored in the domain (`MIN_PIXELS` / `MAX_PIXELS` in
    /// `src/domain/size.ts`), which refuses a size before it ever reaches a
    /// command. Two numbers in two languages have to be the same two numbers:
    /// this test fails on this side, and its twin fails on that one.
    #[test]
    fn the_raster_bounds_are_the_ones_the_domain_mirrors() {
        assert_eq!(MIN_PIXEL_SIZE, 64);
        assert_eq!(MAX_PIXEL_SIZE, 4096);
    }

    /// The `pHYs` chunk, read out of the bytes: pixels per unit on each axis and
    /// the unit itself. `None` when the file does not say.
    fn physical_dimensions(png: &[u8]) -> Option<(u32, u32, u8)> {
        let mut at = 8;
        while at + 8 <= png.len() {
            let length = u32::from_be_bytes(png[at..at + 4].try_into().ok()?) as usize;
            let kind = &png[at + 4..at + 8];
            if kind == b"pHYs" {
                let data = &png[at + 8..at + 8 + length];
                return Some((
                    u32::from_be_bytes(data[0..4].try_into().ok()?),
                    u32::from_be_bytes(data[4..8].try_into().ok()?),
                    data[8],
                ));
            }
            at += 12 + length;
        }
        None
    }

    #[test]
    fn a_png_made_for_print_carries_the_resolution_it_was_made_for() {
        let pixmap = render_pixmap(BLANK.as_bytes(), 128).expect("render").pixmap;

        let printed = encode(&pixmap, Some(300)).expect("encode");
        let screen = encode(&pixmap, None).expect("encode");

        assert_eq!(
            physical_dimensions(&printed.png),
            Some((11811, 11811, 1)),
            "300 dpi is 11 811 pixels per metre, and the unit is the metre"
        );
        assert_eq!(
            physical_dimensions(&screen.png),
            None,
            "a code with no physical size must not claim one"
        );
        assert_eq!(
            pixels_per_metre(1200),
            47244,
            "the arithmetic is rounded, not truncated"
        );
    }

    /// A code that has been given a physical width is the same square of pixels,
    /// and — the part that matters — the scale that positions a logo is still
    /// per unit of the `viewBox`. `usvg` measures a 25 mm drawing as 94.49 of
    /// its own units; a logo scaled by that would land a third of the way in.
    #[test]
    fn a_drawing_with_a_physical_width_keeps_the_scale_of_its_own_units() {
        let sized = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"
             width="25mm" height="25mm"><rect width="29" height="29" fill="#ffffff"/></svg>"##;

        let plain = render_pixmap(BLANK.as_bytes(), 512).expect("render");
        let printed = render_pixmap(sized.as_bytes(), 512).expect("render");

        assert_eq!(printed.pixmap.width(), 512);
        assert!(
            (printed.scale_x - plain.scale_x).abs() < 1e-4,
            "{} is not the scale of the scene's own units ({})",
            printed.scale_x,
            plain.scale_x
        );
        assert!((printed.scale_x - 512.0 / 29.0).abs() < 1e-4);
    }

    /// The written SVG may carry the logo this product encoded, as bytes inside
    /// the file. It may not carry anything else at all — and the allowance is
    /// only ever granted to the export path.
    #[test]
    fn an_exported_drawing_may_carry_a_logo_and_nothing_else() {
        let carried = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
             <rect width="8" height="8" fill="#fff"/>
             <image x="2" y="2" width="4" height="4"
                    href="data:image/png;base64,iVBORw0KGgo="
                    preserveAspectRatio="xMidYMid meet"/></svg>"##;

        assert!(
            scan_exported_references(carried.as_bytes()).is_ok(),
            "the logo an export embeds has to be allowed through"
        );
        assert_eq!(
            scan_external_references(carried.as_bytes()),
            Err(Reaching::Outside),
            "what is rasterised is never allowed an image"
        );

        let refused = [
            // A file, dressed as a carried logo.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="file:///c:/windows/win.ini" width="8" height="8"/></svg>"##,
            // An SVG in the URI, which is a document with its own ideas.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="8"/></svg>"##,
            // An attribute this host does not write.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="data:image/png;base64,iVBORw==" onload="fetch('http://x')"/></svg>"##,
            // A URI whose payload is not base64 at all.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="data:image/png;base64,../../etc/passwd" width="8"/></svg>"##,
            // A tag nobody closed.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="data:image/png;base64,iVBORw==" width="8" "##,
            // And everything a rendered drawing is refused for, still refused.
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">
                 <image href="data:image/png;base64,iVBORw==" width="8"/>
                 <script>fetch('http://elsewhere')</script></svg>"##,
        ];
        for document in refused {
            assert!(
                scan_exported_references(document.as_bytes()).is_err(),
                "this would have been written: {document}"
            );
        }
    }

    #[test]
    fn something_that_is_not_a_drawing_is_refused() {
        assert!(render_png(b"not an svg at all", 64).is_err());
        assert!(render_png(&vec![b'x'; MAX_SVG_BYTES + 1], 64).is_err());
    }
}
