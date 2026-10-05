//! The proof sheet: one A4 page carrying the same code at several printed sizes,
//! so a person can print one sheet on their own printer and find the smallest
//! size that reads **before** a thousand copies are made.
//!
//! Every picture on the page is the verified raster of its own size — rendered
//! at that size's pixels, read back by the decoder, and embedded exactly as
//! `pdf::one_page` embeds one. A size that did not read, or that the resolution
//! cannot render, is a dashed box with the reason in it and **never a picture**:
//! the sheet teaches which sizes do not work rather than leaving them out.
//!
//! Under the codes, a filled bar exactly 50 mm long. "Fit to page" is the most
//! common way a 25 mm code becomes 23 mm, and the bar is how a person finds out
//! with a ruler instead of with a box of misprinted labels.
//!
//! What the page does not carry, as no export does: a date, an author, a title,
//! a path. The document information holds the producer and nothing else.
//!
//! The text is set in the two Helvetica faces every PDF reader has, with
//! `/WinAnsiEncoding`, so nothing is embedded and nothing has to be shaped. A
//! string with a character that encoding cannot draw is **not printed** — the
//! summary of the code is replaced by a sentence saying so rather than mangled.
//! The content stream is left uncompressed: it is a few kilobytes, and a stream
//! a person (or a test) can read is a page whose measurements can be checked.
//!
//! Pure: bytes in, bytes out. Nothing here opens a file.

use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, Str, TextStr};

use crate::error::{Error, Result};
use crate::export::pdf::{points, Picture};

/// The page, A4 portrait, in millimetres.
pub const PAGE_WIDTH_MM: f64 = 210.0;

/// The other side of the same page.
pub const PAGE_HEIGHT_MM: f64 = 297.0;

/// The margin on every side, in millimetres. 210 mm less two of these is the
/// 190 mm the domain's `MAX_PROOF_MM` allows.
pub const MARGIN_MM: f64 = 10.0;

/// The calibration bar's length, in millimetres.
pub const BAR_MM: f64 = 50.0;

/// The calibration bar's height, in millimetres.
pub const BAR_HEIGHT_MM: f64 = 3.0;

/// A tick above the bar every this many millimetres.
pub const TICK_MM: f64 = 10.0;

/// The smallest box a refusal is written in. A 5 mm box holds no sentence.
pub const SMALLEST_BOX_MM: f64 = 15.0;

/// The heading of every sheet.
pub const TITLE: &str = "Signatum proof sheet";

/// What is printed in place of a summary the font cannot draw.
pub const UNPRINTABLE_SUMMARY: &str =
    "What this code does is shown in Signatum; this sheet prints \
                                       only the characters its font can draw.";

/// The sentence under the bar.
pub const BAR_CAPTION: &str = "This bar is 50 mm. If it measures anything else, the printer \
                               scaled the page and the sizes above are wrong.";

/// The heading of the block that says how to use the sheet.
pub const GUIDE_TITLE: &str = "How to use this sheet";

/// The four steps under it, numbered as printed.
pub const GUIDE: [(&str, &str); 4] = [
    (
        "1.",
        "Print this page at 100 % (Actual size), on the paper the codes will be printed on.",
    ),
    (
        "2.",
        "Measure the bar. If it is not 50 mm, change the print settings and print again.",
    ),
    (
        "3.",
        "Scan each code with the phone cameras your readers use, from the distance under it.",
    ),
    (
        "4.",
        "Print the smallest size that read every time, or the next one up for a margin.",
    ),
];

/// The longest summary printed. A longer one — a long international link can
/// pass it honestly — is replaced by [`UNPRINTABLE_SUMMARY`], as one the font
/// cannot draw is, rather than refused.
pub const MAX_SUMMARY_CHARS: usize = 200;

/// The sentence for a set of sizes that cannot be laid out on one page. The
/// domain's plans always fit — four standard sizes and a chosen one of at most
/// 190 mm — so this answers a request the interface would never make.
pub const DOES_NOT_FIT: &str = "These sizes do not fit on one A4 page.";

/// The horizontal gap between two cells, in millimetres.
const GAP_MM: f64 = 4.0;

/// The vertical gap between two rows, and between the heading and the first.
const ROW_GAP: f64 = 8.0;

/// The space between a picture or a box and the text under it.
const LABEL_GAP: f64 = 3.0;

/// The space inside a refusal's box, around its sentence.
const BOX_PADDING: f64 = 4.0;

/// How far the ticks rise above the bar.
const TICK_HEIGHT: f64 = 4.0;

/// The space between the bar's caption and the guide under it.
const STACK_GAP: f64 = 6.0;

/// The space between the guide's heading and its first step.
const GUIDE_GAP: f64 = 2.0;

/// The narrowest column the guide is set in. Narrower, and a step is a column
/// of single words.
const GUIDE_MIN_WIDTH: f64 = 120.0;

/// The type sizes, in points.
const TITLE_PT: f64 = 14.0;
const BODY_PT: f64 = 9.0;
const LABEL_PT: f64 = 8.0;
const GUIDE_PT: f64 = 9.0;
const REASON_PT: f64 = 7.0;

/// Line spacing as a multiple of the type size.
const LEADING: f64 = 1.25;

/// Where a line's baseline sits below the top of its line, as a multiple of the
/// type size: a little above Helvetica's ascender, so a line starts where the
/// line before it ended.
const ASCENT: f64 = 0.78;

/// The most lines a summary takes. This host caps it at [`MAX_SUMMARY_CHARS`],
/// which is at most four lines at the body size; a summary that wraps worse
/// than that is cut with an ellipsis rather than pushing the codes off the page.
const MAX_SUMMARY_LINES: usize = 4;

/// The slack allowed when comparing widths that are sums of rounded numbers.
const EPSILON: f64 = 0.01;

/// The fonts' names in the page's resources.
const REGULAR: Name<'static> = Name(b"F1");
const BOLD: Name<'static> = Name(b"F2");

/// The ellipsis, in WinAnsi.
const ELLIPSIS: u8 = 0x85;

/// What the sheet is told: the decoder that read every picture on it, the
/// summary of the code, the domain's note, and each size as it ended.
pub struct Sheet<'a> {
    /// Name and version, e.g. `rqrr 0.10.1`, as the instruction line names it.
    pub decoder: &'a str,
    /// One sentence about what the code does; printed only if every character
    /// of it is one the font can draw.
    pub summary: &'a str,
    /// The domain's sentence for a chosen size the page cannot hold.
    pub note: Option<&'a str>,
    /// Every size on the sheet, in any order: the sheet draws them smallest
    /// first.
    pub sizes: &'a [Size<'a>],
}

/// One size on the sheet.
pub struct Size<'a> {
    /// The printed width of the whole code, quiet zone included.
    pub mm: f64,
    /// The size chosen on the Create screen.
    pub chosen: bool,
    /// What is drawn for it.
    pub drawn: Drawn<'a>,
}

/// A picture of a verified code, or a box saying why there is none.
pub enum Drawn<'a> {
    /// The decoder read this raster back as the payload.
    Verified {
        /// The exact artefact that was decoded.
        png: &'a [u8],
        /// The `verifications` row the decoder's answer is recorded in.
        verification_id: &'a str,
    },
    /// Not drawn, for this reason.
    Refused {
        /// One sentence: the domain's for a size it cannot render, the
        /// decoder's for one that did not read.
        reason: &'a str,
    },
}

/// How far away a phone reads a code this wide, in centimetres: ten times the
/// width, the printers' rule of thumb. Rounded as `readingDistanceCm` rounds,
/// half away from zero — which, for a width, is half up.
pub fn reading_distance_cm(mm: f64) -> u32 {
    mm.round().max(0.0) as u32
}

/// A number of millimetres as a person writes it — `25`, `12.5` — rounded to
/// the hundredth exactly as the domain's `formatMillimetres` does.
pub fn millimetres(mm: f64) -> String {
    let rounded = (mm * 100.0).round() / 100.0;
    format!("{rounded}")
}

/// The line under a code: `25 mm`, and ` · chosen` for the chosen one.
pub fn size_label(mm: f64, chosen: bool) -> String {
    if chosen {
        format!("{} mm \u{b7} chosen", millimetres(mm))
    } else {
        format!("{} mm", millimetres(mm))
    }
}

/// The line that says how far away to hold the phone.
pub fn distance_label(mm: f64) -> String {
    format!("Hold about {} cm away", reading_distance_cm(mm))
}

/// The line that names the evidence: the **last** eight hex digits of the
/// verification's identifier.
///
/// Never the first eight. An identifier is a UUID v7, whose leading digits are
/// the moment it was made in milliseconds — printing them would put the time on
/// the paper, which no export does. The trailing digits are random, and enough
/// to find the row.
pub fn verified_label(verification_id: &str) -> String {
    let hex: Vec<char> = verification_id
        .chars()
        .filter(char::is_ascii_hexdigit)
        .collect();
    let short: String = hex[hex.len().saturating_sub(8)..].iter().collect();
    format!("Verified \u{b7} {short}")
}

/// The instruction under the heading.
pub fn instruction(decoder: &str) -> String {
    format!(
        "Print this page at 100 % (Actual size). Every code below was read back by {decoder} \
         before it was drawn."
    )
}

/// `text` in the encoding the page's fonts use, one byte a character; `None`
/// when any character is one the encoding cannot draw.
///
/// WinAnsi is ASCII from `0x20` to `0x7E`, Latin-1 from `0xA0` to `0xFF`, and
/// twenty-seven typographic characters in between — the dashes, the curly
/// quotes, the ellipsis, the euro sign. A control character, a C1 code point and
/// anything past Latin-1 that is not among those twenty-seven is a `None`.
pub fn encode(text: &str) -> Option<Vec<u8>> {
    text.chars().map(winansi).collect()
}

/// One character in WinAnsi, or `None`.
fn winansi(c: char) -> Option<u8> {
    let code = u32::from(c);
    match code {
        0x20..=0x7E | 0xA0..=0xFF => Some(code as u8),
        _ => Some(match c {
            '\u{20AC}' => 0x80,
            '\u{201A}' => 0x82,
            '\u{0192}' => 0x83,
            '\u{201E}' => 0x84,
            '\u{2026}' => 0x85,
            '\u{2020}' => 0x86,
            '\u{2021}' => 0x87,
            '\u{02C6}' => 0x88,
            '\u{2030}' => 0x89,
            '\u{0160}' => 0x8A,
            '\u{2039}' => 0x8B,
            '\u{0152}' => 0x8C,
            '\u{017D}' => 0x8E,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{02DC}' => 0x98,
            '\u{2122}' => 0x99,
            '\u{0161}' => 0x9A,
            '\u{203A}' => 0x9B,
            '\u{0153}' => 0x9C,
            '\u{017E}' => 0x9E,
            '\u{0178}' => 0x9F,
            _ => return None,
        }),
    }
}

/// Helvetica's advance widths, in thousandths of the type size, for the WinAnsi
/// codes `0x20` to `0xFF` (Adobe's metrics). The six codes WinAnsi leaves
/// undefined are zero; `encode` never produces them.
#[rustfmt::skip]
const HELVETICA: [u16; 224] = [
    // 0x20
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    // 0x30
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    // 0x40
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    // 0x50
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    // 0x60
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    // 0x70
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
    // 0x80
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    // 0x90
    0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
    // 0xA0
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    // 0xB0
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    // 0xC0
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    // 0xD0
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    // 0xE0
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    // 0xF0
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/// How wide `text` (WinAnsi) is in Helvetica at `size` points.
fn measure(text: &[u8], size: f64) -> f64 {
    let thousandths: u32 = text
        .iter()
        .map(|&byte| {
            byte.checked_sub(0x20)
                .map_or(0, |at| u32::from(HELVETICA[usize::from(at)]))
        })
        .sum();
    f64::from(thousandths) * size / 1000.0
}

/// Break `text` (WinAnsi) into lines no wider than `width` at `size` points:
/// at spaces where it can, inside a word only when the word alone is wider
/// than the line. Every line holds at least one character, so the loop always
/// ends.
fn wrap(text: &[u8], size: f64, width: f64) -> Vec<Vec<u8>> {
    let mut lines: Vec<Vec<u8>> = Vec::new();
    let mut line: Vec<u8> = Vec::new();

    for word in text
        .split(|&byte| byte == b' ')
        .filter(|word| !word.is_empty())
    {
        let mut candidate = line.clone();
        if !candidate.is_empty() {
            candidate.push(b' ');
        }
        candidate.extend_from_slice(word);
        if measure(&candidate, size) <= width + EPSILON {
            line = candidate;
            continue;
        }
        if !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        if measure(word, size) <= width + EPSILON {
            line = word.to_vec();
            continue;
        }
        // A word wider than the line — a long link — is broken where it has to be.
        for &byte in word {
            let mut longer = line.clone();
            longer.push(byte);
            if !line.is_empty() && measure(&longer, size) > width + EPSILON {
                lines.push(std::mem::replace(&mut line, vec![byte]));
            } else {
                line = longer;
            }
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// Product text in WinAnsi. Every sentence this module writes is chosen to be
/// encodable, so a `None` here is a defect, said as one.
fn product_text(text: &str) -> Result<Vec<u8>> {
    encode(text)
        .ok_or_else(|| Error::Render("a sentence on the proof sheet could not be set".to_string()))
}

/// The height of `lines` lines at `size` points.
fn text_height(lines: usize, size: f64) -> f64 {
    lines as f64 * size * LEADING
}

/// A number as the page writes it: to the hundredth of a point.
fn at(value: f64) -> f32 {
    ((value * 100.0).round() / 100.0) as f32
}

/// What a size is drawn as.
enum Block {
    /// A verified code: the index of its image, and its side.
    Code { image: usize, side: f64 },
    /// A dashed box of this side with a refusal in it.
    Box { side: f64, reason: Vec<Vec<u8>> },
}

/// A size's block, the lines under it, and the room it takes.
struct Cell {
    block: Block,
    labels: Vec<Vec<u8>>,
    /// The square's side: the picture's or the box's.
    side: f64,
    /// The widest label.
    label_width: f64,
    /// The width the cell takes in its row: its square or its widest label.
    width: f64,
}

/// One row of cells, left to right, standing on a common line: every square in
/// it ends where the tallest one ends, so every label block under them starts
/// on the same line.
#[derive(Default, Clone)]
struct Row {
    cells: Vec<(f64, usize)>,
    used: f64,
    /// The tallest square — the distance from the row's top to its baseline.
    side: f64,
    /// The tallest label block under the baseline.
    labels: f64,
    /// The height something set beside the cells needs, measured from the top.
    aside: f64,
}

impl Row {
    /// Whether `width` more fits on the row, after a gap.
    fn room_for(&self, width: f64, content: f64) -> bool {
        self.cells.is_empty() || self.used + points(GAP_MM) + width <= content + EPSILON
    }

    /// Put cell `index` at the end of the row.
    fn push(&mut self, margin: f64, index: usize, cell: &Cell) {
        let x = if self.cells.is_empty() {
            margin
        } else {
            margin + self.used + points(GAP_MM)
        };
        self.used = x - margin + cell.width;
        self.side = self.side.max(cell.side);
        self.labels = self
            .labels
            .max(LABEL_GAP + text_height(cell.labels.len(), LABEL_PT));
        self.cells.push((x, index));
    }

    /// From the row's top to its lowest mark.
    fn height(&self) -> f64 {
        (self.side + self.labels).max(self.aside)
    }
}

/// Where the bar or the guide is set.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Spot {
    /// To the right of a row's last cell, from the row's top.
    Right(usize),
    /// Under a row's baseline, to the right of the labels of a row whose one
    /// cell is wider than its labels — the band beside a large code's labels.
    Band(usize),
    /// On a row of its own under the codes.
    Below,
}

/// Something set beside or under the codes: the bar and its caption, the
/// guide, or both stacked — the bar first.
#[derive(Clone)]
struct Aside {
    spot: Spot,
    x: f64,
    width: f64,
    caption: Option<Vec<Vec<u8>>>,
    guide: Option<Vec<Step>>,
}

/// One numbered step of the guide, wrapped.
#[derive(Clone)]
struct Step {
    number: Vec<u8>,
    lines: Vec<Vec<u8>>,
}

/// The guide's heading and steps, as WinAnsi.
struct GuideText {
    title: Vec<u8>,
    steps: Vec<(Vec<u8>, Vec<u8>)>,
}

/// The widest step number, plus a space: the hanging indent of every step.
fn guide_indent(text: &GuideText) -> f64 {
    text.steps
        .iter()
        .map(|(number, _)| measure(number, LABEL_PT))
        .fold(0.0, f64::max)
        + measure(b" ", LABEL_PT)
}

impl Aside {
    /// Set the bar, the guide or both in a column `width` wide at `spot`.
    fn new(
        spot: Spot,
        x: f64,
        width: f64,
        bar: bool,
        guide: bool,
        caption: &[u8],
        text: &GuideText,
    ) -> Self {
        let indent = guide_indent(text);
        Self {
            spot,
            x,
            width,
            caption: bar.then(|| wrap(caption, LABEL_PT, width)),
            guide: guide.then(|| {
                text.steps
                    .iter()
                    .map(|(number, step)| Step {
                        number: number.clone(),
                        lines: wrap(step, LABEL_PT, width - indent),
                    })
                    .collect()
            }),
        }
    }

    /// The narrowest column this can be set in.
    fn fits_width(&self) -> bool {
        let wanted = match (&self.caption, &self.guide) {
            (Some(_), _) => points(BAR_MM),
            (None, Some(_)) => GUIDE_MIN_WIDTH,
            (None, None) => 0.0,
        };
        self.width + EPSILON >= wanted
    }

    /// How tall it is.
    fn height(&self) -> f64 {
        let mut height = 0.0;
        if let Some(caption) = &self.caption {
            height += TICK_HEIGHT
                + points(BAR_HEIGHT_MM)
                + LABEL_GAP
                + text_height(caption.len(), LABEL_PT);
        }
        if let Some(steps) = &self.guide {
            if self.caption.is_some() {
                height += STACK_GAP;
            }
            height += text_height(1, GUIDE_PT) + GUIDE_GAP;
            height += steps
                .iter()
                .map(|step| text_height(step.lines.len(), LABEL_PT))
                .sum::<f64>();
        }
        height
    }
}

/// The side of the box a refusal is written in, and the sentence wrapped to it.
///
/// The box is the size's own square. When the sentence does not fit inside it,
/// the box is at least [`SMALLEST_BOX_MM`] and grows a millimetre at a time
/// until it does — never past the width of the page.
fn refusal_box(mm: f64, reason: &[u8], content: f64) -> (f64, Vec<Vec<u8>>) {
    let fits = |side: f64| {
        let inner = side - 2.0 * BOX_PADDING;
        if inner <= 0.0 {
            return None;
        }
        let lines = wrap(reason, REASON_PT, inner);
        let tall = 2.0 * BOX_PADDING + text_height(lines.len(), REASON_PT);
        (widest(&lines, REASON_PT) <= inner + EPSILON && tall <= side + EPSILON).then_some(lines)
    };

    let mut side = points(mm).min(content);
    if let Some(lines) = fits(side) {
        return (side, lines);
    }
    side = side.max(points(SMALLEST_BOX_MM));
    loop {
        if let Some(lines) = fits(side) {
            return (side, lines);
        }
        if side >= content {
            let inner = content - 2.0 * BOX_PADDING;
            return (content, wrap(reason, REASON_PT, inner));
        }
        side = (side + points(1.0)).min(content);
    }
}

/// The widest of some lines at a size.
fn widest(lines: &[Vec<u8>], size: f64) -> f64 {
    lines
        .iter()
        .map(|line| measure(line, size))
        .fold(0.0, f64::max)
}

/// The places beside the codes where the bar or the guide could go, in the
/// order they are tried: for each row, the room to the right of its last cell,
/// or — when there is none — the band to the right of the labels of a row whose
/// one cell is wider than its labels.
fn spots(rows: &[Row], cells: &[Cell], margin: f64, content: f64) -> Vec<(Spot, f64, f64)> {
    let gap = points(GAP_MM);
    let mut found = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let right = content - row.used - gap;
        if right + EPSILON >= GUIDE_MIN_WIDTH.min(points(BAR_MM)) {
            found.push((Spot::Right(index), margin + row.used + gap, right));
        } else if let [(x, only)] = row.cells.as_slice() {
            let cell = &cells[*only];
            let left = x + cell.label_width + gap;
            let band = margin + content - left;
            if band + EPSILON >= GUIDE_MIN_WIDTH.min(points(BAR_MM)) {
                found.push((Spot::Band(index), left, band));
            }
        }
    }
    found
}

/// The arrangements of the bar and the guide, most preferred first.
///
/// Stacked on a row of their own under the codes — where "the sizes above" is
/// true — first. Only when the page cannot hold that (a chosen 190 mm under a
/// long summary) are they set beside the codes: stacked in one place if one
/// place holds both, else the guide in one place and the bar in another.
fn arrangements(
    spots: &[(Spot, f64, f64)],
    margin: f64,
    content: f64,
    caption: &[u8],
    text: &GuideText,
) -> Vec<Vec<Aside>> {
    let aside = |spot: Spot, x: f64, width: f64, bar: bool, guide: bool| {
        Aside::new(spot, x, width, bar, guide, caption, text)
    };
    let below = |bar: bool, guide: bool| aside(Spot::Below, margin, content, bar, guide);

    let mut tried = vec![vec![below(true, true)]];
    for &(spot, x, width) in spots {
        tried.push(vec![aside(spot, x, width, true, true)]);
    }
    for &(guide_spot, guide_x, guide_width) in spots {
        for &(bar_spot, bar_x, bar_width) in spots {
            if guide_spot != bar_spot {
                tried.push(vec![
                    aside(guide_spot, guide_x, guide_width, false, true),
                    aside(bar_spot, bar_x, bar_width, true, false),
                ]);
            }
        }
    }
    for &(spot, x, width) in spots {
        tried.push(vec![aside(spot, x, width, true, false), below(false, true)]);
        tried.push(vec![aside(spot, x, width, false, true), below(true, false)]);
    }
    tried
        .into_iter()
        .filter(|arrangement| arrangement.iter().all(Aside::fits_width))
        .collect()
}

/// Write the sheet.
///
/// The sizes are drawn smallest first, left to right, wrapping onto a new row
/// when a row is full. Within a row every square stands on the same line — the
/// bottom of the tallest — so every label block starts at the same height. Each
/// verified size is its raster at exactly `pdf::points(mm)` square, placed as
/// `q w 0 0 w x y cm /ImN Do Q`, with three lines under it: the size, how far
/// away to hold the phone, and the evidence. Under the codes, the 50 mm bar,
/// its caption, and how to use the sheet; beside the codes only when the page
/// cannot hold them under. The note, if there is one, at the foot of the page.
///
/// # Errors
///
/// [`Error::Render`] when a verified artefact cannot be read back or
/// compressed — this host's own bytes. [`Error::InvalidInput`] with
/// [`DOES_NOT_FIT`] when the sizes do not fit on one page, which no plan the
/// domain makes can cause.
pub fn sheet(sheet: &Sheet) -> Result<Vec<u8>> {
    let page_width = points(PAGE_WIDTH_MM);
    let page_height = points(PAGE_HEIGHT_MM);
    let margin = points(MARGIN_MM);
    let content_width = page_width - 2.0 * margin;

    // The heading: the title, the summary or the sentence that replaces it, and
    // the instruction.
    let title = product_text(TITLE)?;
    let summary = if sheet.summary.trim().is_empty() {
        Vec::new()
    } else {
        let encoded = if sheet.summary.chars().count() > MAX_SUMMARY_CHARS {
            log::info!("a proof sheet's summary was longer than {MAX_SUMMARY_CHARS} characters");
            None
        } else {
            let encoded = encode(sheet.summary);
            if encoded.is_none() {
                log::info!("a proof sheet's summary had characters its font cannot draw");
            }
            encoded
        };
        let printable = match encoded {
            Some(bytes) => bytes,
            None => product_text(UNPRINTABLE_SUMMARY)?,
        };
        let mut lines = wrap(&printable, BODY_PT, content_width);
        if lines.len() > MAX_SUMMARY_LINES {
            lines.truncate(MAX_SUMMARY_LINES);
            let last = lines.last_mut().expect("four lines were kept");
            while !last.is_empty()
                && measure(last, BODY_PT) + measure(&[ELLIPSIS], BODY_PT) > content_width
            {
                last.pop();
            }
            last.push(ELLIPSIS);
        }
        lines
    };
    let instruction = wrap(
        &product_text(&instruction(sheet.decoder))?,
        BODY_PT,
        content_width,
    );
    let note = match sheet.note.filter(|note| !note.trim().is_empty()) {
        Some(note) => match encode(note) {
            Some(bytes) => wrap(&bytes, LABEL_PT, content_width),
            None => {
                log::warn!("a proof sheet's note had characters its font cannot draw");
                Vec::new()
            }
        },
        None => Vec::new(),
    };
    let caption = product_text(BAR_CAPTION)?;
    let guide = GuideText {
        title: product_text(GUIDE_TITLE)?,
        steps: GUIDE
            .iter()
            .map(|(number, step)| Ok((product_text(number)?, product_text(step)?)))
            .collect::<Result<_>>()?,
    };

    // The cells, smallest first.
    let mut order: Vec<&Size> = sheet.sizes.iter().collect();
    order.sort_by(|a, b| a.mm.total_cmp(&b.mm));

    let mut pictures: Vec<Picture> = Vec::new();
    let mut cells: Vec<Cell> = Vec::with_capacity(order.len());
    for size in &order {
        let label = product_text(&size_label(size.mm, size.chosen))?;
        let (block, side, labels) = match size.drawn {
            Drawn::Verified {
                png,
                verification_id,
            } => {
                let side = points(size.mm);
                pictures.push(Picture::from_png(png)?);
                let labels = vec![
                    label,
                    product_text(&distance_label(size.mm))?,
                    product_text(&verified_label(verification_id))?,
                ];
                let block = Block::Code {
                    image: pictures.len() - 1,
                    side,
                };
                (block, side, labels)
            }
            Drawn::Refused { reason } => {
                let reason = encode(reason).unwrap_or_else(|| {
                    log::warn!("a refusal on a proof sheet had characters its font cannot draw");
                    b"This size cannot be drawn.".to_vec()
                });
                let (side, reason) = refusal_box(size.mm, &reason, content_width);
                (Block::Box { side, reason }, side, vec![label])
            }
        };
        let label_width = widest(&labels, LABEL_PT);
        cells.push(Cell {
            block,
            labels,
            side,
            label_width,
            width: side.max(label_width),
        });
    }

    let mut rows: Vec<Row> = Vec::new();
    for (index, cell) in cells.iter().enumerate() {
        match rows.last_mut() {
            Some(row) if row.room_for(cell.width, content_width) => {
                row.push(margin, index, cell);
            }
            _ => {
                let mut row = Row::default();
                row.push(margin, index, cell);
                rows.push(row);
            }
        }
    }

    // The heading and the foot, which do not move.
    let heading = text_height(1, TITLE_PT)
        + text_height(summary.len(), BODY_PT)
        + text_height(instruction.len(), BODY_PT)
        + ROW_GAP;
    let foot = if note.is_empty() {
        0.0
    } else {
        ROW_GAP + text_height(note.len(), LABEL_PT)
    };
    let room = page_height - 2.0 * margin - heading - foot;

    // The bar and the guide: the first arrangement the page holds.
    let candidates = arrangements(
        &spots(&rows, &cells, margin, content_width),
        margin,
        content_width,
        &caption,
        &guide,
    );
    let (rows, asides) = candidates
        .into_iter()
        .find_map(|asides| {
            let mut placed = rows.clone();
            let mut below = 0.0;
            for aside in &asides {
                match aside.spot {
                    Spot::Right(index) => {
                        placed[index].aside = placed[index].aside.max(aside.height());
                    }
                    Spot::Band(index) => {
                        let row = &mut placed[index];
                        row.aside = row.aside.max(row.side + LABEL_GAP + aside.height());
                    }
                    Spot::Below => {
                        below += aside.height() + if below > 0.0 { STACK_GAP } else { 0.0 };
                    }
                }
            }
            let body: f64 = placed.iter().map(Row::height).sum::<f64>()
                + ROW_GAP * placed.len().saturating_sub(1) as f64
                + if below > 0.0 {
                    below + if placed.is_empty() { 0.0 } else { ROW_GAP }
                } else {
                    0.0
                };
            (body <= room + EPSILON).then_some((placed, asides))
        })
        .ok_or_else(|| Error::InvalidInput(DOES_NOT_FIT.to_string()))?;

    // The page.
    let mut content = Content::new();
    let mut cursor = page_height - margin;
    cursor = lines(&mut content, BOLD, TITLE_PT, margin, cursor, &[title]);
    cursor = lines(&mut content, REGULAR, BODY_PT, margin, cursor, &summary);
    cursor = lines(&mut content, REGULAR, BODY_PT, margin, cursor, &instruction);
    cursor -= ROW_GAP;

    let names: Vec<String> = (1..=pictures.len()).map(|n| format!("Im{n}")).collect();
    let mut tops = Vec::with_capacity(rows.len());
    for row in &rows {
        let baseline = cursor - row.side;
        for &(x, index) in &row.cells {
            draw(&mut content, &names, x, baseline, &cells[index]);
        }
        tops.push(cursor);
        cursor -= row.height() + ROW_GAP;
    }
    for aside in &asides {
        let top = match aside.spot {
            Spot::Right(index) => tops[index],
            Spot::Band(index) => tops[index] - rows[index].side - LABEL_GAP,
            Spot::Below => {
                let top = cursor;
                cursor -= aside.height() + STACK_GAP;
                top
            }
        };
        set_aside(&mut content, top, aside, &guide);
    }
    if !note.is_empty() {
        let top = margin + text_height(note.len(), LABEL_PT);
        lines(&mut content, REGULAR, LABEL_PT, margin, top, &note);
    }

    // The objects.
    let catalogue = Ref::new(1);
    let tree = Ref::new(2);
    let page = Ref::new(3);
    let drawing = Ref::new(4);
    let regular = Ref::new(5);
    let bold = Ref::new(6);
    let about = Ref::new(7);
    let image_ref = |index: usize| Ref::new(8 + index as i32);

    let mut pdf = Pdf::new();
    pdf.catalog(catalogue).pages(tree);
    pdf.pages(tree).kids([page]).count(1);
    {
        let mut written = pdf.page(page);
        written.parent(tree);
        written.media_box(Rect::new(0.0, 0.0, at(page_width), at(page_height)));
        written.contents(drawing);
        let mut resources = written.resources();
        resources.fonts().pair(REGULAR, regular).pair(BOLD, bold);
        {
            let mut images = resources.x_objects();
            for (index, name) in names.iter().enumerate() {
                images.pair(Name(name.as_bytes()), image_ref(index));
            }
        }
        resources.finish();
        written.finish();
    }
    pdf.type1_font(regular)
        .base_font(Name(b"Helvetica"))
        .encoding_predefined(Name(b"WinAnsiEncoding"));
    pdf.type1_font(bold)
        .base_font(Name(b"Helvetica-Bold"))
        .encoding_predefined(Name(b"WinAnsiEncoding"));
    for (index, picture) in pictures.iter().enumerate() {
        picture.embed(&mut pdf, image_ref(index));
    }

    // Uncompressed on purpose: the measurements in it are there to be read.
    pdf.stream(drawing, &content.finish());

    // As every export: the producer and nothing else. No date, no author, no
    // title, no path.
    pdf.document_info(about).producer(TextStr("Signatum"));

    Ok(pdf.finish())
}

/// Set `text` one line under another from `top` down, and return where the
/// next line would start.
fn lines(content: &mut Content, font: Name, size: f64, x: f64, top: f64, text: &[Vec<u8>]) -> f64 {
    let mut cursor = top;
    for line in text {
        let baseline = cursor - ASCENT * size;
        content.begin_text();
        content.set_font(font, size as f32);
        content.set_text_matrix([1.0, 0.0, 0.0, 1.0, at(x), at(baseline)]);
        content.show(Str(line));
        content.end_text();
        cursor -= LEADING * size;
    }
    cursor
}

/// Draw one cell standing on `baseline`, its left edge at `x`: the square ends
/// on the baseline, and the labels start under it.
fn draw(content: &mut Content, names: &[String], x: f64, baseline: f64, cell: &Cell) {
    let top = baseline + cell.side;
    match &cell.block {
        Block::Code { image, side } => {
            // The image's own space is the unit square, so the matrix that
            // places it is its printed side: `points(mm)`, and nothing else.
            let width = *side as f32;
            content.save_state();
            content.transform([width, 0.0, 0.0, width, at(x), at(baseline)]);
            content.x_object(Name(names[*image].as_bytes()));
            content.restore_state();
        }
        Block::Box { side, reason } => {
            content.save_state();
            content.set_line_width(0.75);
            content.set_dash_pattern([3.0, 2.0], 0.0);
            content.rect(at(x), at(baseline), *side as f32, *side as f32);
            content.stroke();
            content.restore_state();
            lines(
                content,
                REGULAR,
                REASON_PT,
                x + BOX_PADDING,
                top - BOX_PADDING,
                reason,
            );
        }
    }
    lines(
        content,
        REGULAR,
        LABEL_PT,
        x,
        baseline - LABEL_GAP,
        &cell.labels,
    );
}

/// Set the bar and its caption, the guide, or both, from `top` down.
fn set_aside(content: &mut Content, top: f64, aside: &Aside, text: &GuideText) {
    let x = aside.x;
    let mut cursor = top;
    if let Some(caption) = &aside.caption {
        let bar_top = cursor - TICK_HEIGHT;
        let bar_bottom = bar_top - points(BAR_HEIGHT_MM);
        content.save_state();
        content.rect(
            at(x),
            at(bar_bottom),
            points(BAR_MM) as f32,
            points(BAR_HEIGHT_MM) as f32,
        );
        content.fill_nonzero();
        content.set_line_width(0.5);
        let ticks = (BAR_MM / TICK_MM).round() as u32;
        for tick in 0..=ticks {
            let tick_x = x + points(TICK_MM * f64::from(tick));
            content.move_to(at(tick_x), at(bar_top));
            content.line_to(at(tick_x), at(cursor));
        }
        content.stroke();
        content.restore_state();
        cursor = lines(
            content,
            REGULAR,
            LABEL_PT,
            x,
            bar_bottom - LABEL_GAP,
            caption,
        );
    }
    if let Some(steps) = &aside.guide {
        if aside.caption.is_some() {
            cursor -= STACK_GAP;
        }
        cursor = lines(
            content,
            BOLD,
            GUIDE_PT,
            x,
            cursor,
            std::slice::from_ref(&text.title),
        );
        cursor -= GUIDE_GAP;
        let indent = guide_indent(text);
        for step in steps {
            lines(
                content,
                REGULAR,
                LABEL_PT,
                x,
                cursor,
                std::slice::from_ref(&step.number),
            );
            cursor = lines(content, REGULAR, LABEL_PT, x + indent, cursor, &step.lines);
        }
    }
}

/// Reading a sheet back, for the tests of this module and of the command: the
/// objects, the images, the text and the placements, out of the bytes alone.
#[cfg(test)]
pub(crate) mod inspect {
    /// One indirect object: its dictionary and, if it has one, its stream.
    pub struct Object {
        pub dictionary: String,
        pub stream: Option<Vec<u8>>,
    }

    /// Every object in the file, in order, walking stream by stream so the
    /// bytes of a compressed image are never mistaken for a keyword.
    pub fn objects(pdf: &[u8]) -> Vec<Object> {
        let mut found = Vec::new();
        let mut at = 0;
        while let Some(start) = find(&pdf[at..], b" 0 obj").map(|offset| offset + at) {
            let body = start + b" 0 obj".len();
            let end = find(&pdf[body..], b"endobj").map_or(pdf.len(), |offset| offset + body);
            let stream_at = find(&pdf[body..end], b"stream").map(|offset| offset + body);
            match stream_at {
                Some(keyword) => {
                    let dictionary = String::from_utf8_lossy(&pdf[body..keyword]).into_owned();
                    let length = number_after(&dictionary, "/Length").expect("a /Length") as usize;
                    let mut data = keyword + b"stream".len();
                    data += if pdf[data] == b'\r' { 2 } else { 1 };
                    found.push(Object {
                        dictionary,
                        stream: Some(pdf[data..data + length].to_vec()),
                    });
                    at = data + length;
                }
                None => {
                    found.push(Object {
                        dictionary: String::from_utf8_lossy(&pdf[body..end]).into_owned(),
                        stream: None,
                    });
                    at = end;
                }
            }
        }
        found
    }

    /// The number written after `key` in a dictionary.
    pub fn number_after(dictionary: &str, key: &str) -> Option<f64> {
        let rest = &dictionary[dictionary.find(key)? + key.len()..];
        rest.split_whitespace().next()?.parse().ok()
    }

    /// The page's content stream — the one stream that is not an image.
    pub fn content(pdf: &[u8]) -> String {
        let objects = objects(pdf);
        let content = objects
            .iter()
            .find(|object| object.stream.is_some() && !object.dictionary.contains("/Image"))
            .expect("a content stream");
        assert!(
            !content.dictionary.contains("/Filter"),
            "the content stream is compressed"
        );
        String::from_utf8(content.stream.clone().expect("a stream")).expect("plain text")
    }

    /// Every image on the page: its pixel side and its inflated RGB samples.
    pub fn images(pdf: &[u8]) -> Vec<(u32, Vec<u8>)> {
        objects(pdf)
            .into_iter()
            .filter(|object| object.dictionary.contains("/Subtype /Image"))
            .map(|object| {
                let width = number_after(&object.dictionary, "/Width").expect("a width") as u32;
                let mut inflated = Vec::new();
                let data = object.stream.expect("an image stream");
                let mut decoder = flate2::read::ZlibDecoder::new(&data[..]);
                std::io::Read::read_to_end(&mut decoder, &mut inflated).expect("inflate");
                (width, inflated)
            })
            .collect()
    }

    /// What the decoder reads in an image's samples.
    pub fn read(side: u32, rgb: &[u8]) -> Option<Vec<u8>> {
        let picture = image::RgbImage::from_raw(side, side, rgb.to_vec()).expect("a square");
        crate::imaging::decode::decode_luma(image::DynamicImage::ImageRgb8(picture).to_luma8())
    }

    /// Every placement of an image: the matrix's width and the image's name.
    pub fn placements(content: &str) -> Vec<(f64, String)> {
        let lines: Vec<&str> = content.lines().collect();
        lines
            .windows(2)
            .filter_map(|pair| {
                let name = pair[1].strip_suffix(" Do")?;
                let width = pair[0]
                    .strip_suffix(" cm")?
                    .split_whitespace()
                    .next()?
                    .parse()
                    .ok()?;
                Some((width, name.trim_start_matches('/').to_string()))
            })
            .collect()
    }

    /// Every string the page shows, in order: where its baseline starts and
    /// its WinAnsi bytes.
    pub fn texts(content: &str) -> Vec<(f64, f64, Vec<u8>)> {
        let mut found = Vec::new();
        let mut origin = (0.0, 0.0);
        for line in content.lines() {
            if let Some(matrix) = line.strip_suffix(" Tm") {
                let numbers: Vec<f64> = matrix
                    .split_whitespace()
                    .map(|n| n.parse().expect("a number"))
                    .collect();
                origin = (numbers[4], numbers[5]);
                continue;
            }
            let Some(operand) = line.strip_suffix(" Tj") else {
                continue;
            };
            let mut text = Vec::new();
            if let Some(hex) = operand.strip_prefix('<').and_then(|o| o.strip_suffix('>')) {
                for pair in hex.as_bytes().chunks(2) {
                    let digits = std::str::from_utf8(pair).expect("hex");
                    text.push(u8::from_str_radix(digits, 16).expect("a hex byte"));
                }
            } else {
                let literal = operand
                    .strip_prefix('(')
                    .and_then(|o| o.strip_suffix(')'))
                    .expect("a literal string");
                let mut bytes = literal.bytes();
                while let Some(byte) = bytes.next() {
                    if byte == b'\\' {
                        text.push(bytes.next().expect("an escaped byte"));
                    } else {
                        text.push(byte);
                    }
                }
            }
            found.push((origin.0, origin.1, text));
        }
        found
    }

    /// Every string the page shows, decoded to its WinAnsi bytes and joined
    /// with spaces — so a sentence that was wrapped reads as one again.
    pub fn shown(content: &str) -> Vec<u8> {
        texts(content)
            .into_iter()
            .map(|(_, _, text)| text)
            .collect::<Vec<_>>()
            .join(&b' ')
    }

    /// Where the line that reads exactly `text` starts.
    pub fn baseline_of(content: &str, text: &[u8]) -> Option<(f64, f64)> {
        texts(content)
            .into_iter()
            .find(|(_, _, shown)| shown == text)
            .map(|(x, y, _)| (x, y))
    }

    /// Whether `haystack` holds `needle`.
    pub fn holds(haystack: &[u8], needle: &[u8]) -> bool {
        find(haystack, needle).is_some()
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }
}

#[cfg(test)]
mod tests {
    use super::inspect::{baseline_of, content, holds, images, placements, read, shown, texts};
    use super::*;
    use crate::imaging::fixtures::{hello_world_svg, HELLO_WORLD};
    use crate::imaging::render::render_png;
    use crate::imaging::verify::REASON_NO_CODE;

    /// 300 dpi pixels for a width, as the domain rounds them.
    fn pixels(mm: f64) -> u32 {
        (mm / 25.4 * 300.0).round() as u32
    }

    fn raster(mm: f64) -> Vec<u8> {
        render_png(hello_world_svg().as_bytes(), pixels(mm))
            .expect("render")
            .png
    }

    const ID: &str = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

    fn written(sizes: &[Size], summary: &str, note: Option<&str>) -> Vec<u8> {
        sheet(&Sheet {
            decoder: "rqrr 0.10.1",
            summary,
            note,
            sizes,
        })
        .expect("write the sheet")
    }

    fn text_of(pdf: &[u8]) -> Vec<u8> {
        shown(&content(pdf))
    }

    fn says(pdf: &[u8], sentence: &str) -> bool {
        holds(&text_of(pdf), &encode(sentence).expect("encodable"))
    }

    #[test]
    fn the_page_is_a4() {
        let png = raster(25.0);
        let pdf = written(
            &[Size {
                mm: 25.0,
                chosen: true,
                drawn: Drawn::Verified {
                    png: &png,
                    verification_id: ID,
                },
            }],
            "Opens example.com",
            None,
        );

        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/MediaBox [0 0 595.28 841.89]"), "not A4");
        assert_eq!(&pdf[..8], b"%PDF-1.7");
    }

    /// Every verified size is its own raster, placed at exactly its printed
    /// width, and every picture on the page reads back as the payload.
    #[test]
    fn every_picture_reads_back_and_measures_its_size() {
        let millimetres = [15.0, 20.0, 25.0, 30.0];
        let rasters: Vec<Vec<u8>> = millimetres.iter().map(|&mm| raster(mm)).collect();
        let sizes: Vec<Size> = millimetres
            .iter()
            .zip(&rasters)
            .map(|(&mm, png)| Size {
                mm,
                chosen: mm == 25.0,
                drawn: Drawn::Verified {
                    png,
                    verification_id: ID,
                },
            })
            .collect();

        let pdf = written(&sizes, "Opens example.com", None);

        let pictures = images(&pdf);
        assert_eq!(pictures.len(), 4);
        for (side, samples) in &pictures {
            assert_eq!(
                read(*side, samples).as_deref(),
                Some(HELLO_WORLD.as_bytes()),
                "the {side} px picture does not read"
            );
        }

        let placed = placements(&content(&pdf));
        assert_eq!(placed.len(), 4);
        for ((width, name), (&mm, (side, _))) in
            placed.iter().zip(millimetres.iter().zip(&pictures))
        {
            assert!(
                (width - points(mm)).abs() < 0.005,
                "{name} is placed {width} wide, not {}",
                points(mm)
            );
            assert_eq!(*side, pixels(mm), "{name} is not the {mm} mm raster");
        }

        assert!(says(&pdf, "25 mm \u{b7} chosen"));
        assert!(says(&pdf, "Hold about 25 cm away"));
        assert!(says(&pdf, "Verified \u{b7} 2e3f4a5b"));
        assert!(says(&pdf, "Hold about 15 cm away"));
        assert!(says(&pdf, TITLE));
        assert!(says(&pdf, &instruction("rqrr 0.10.1")));
        assert!(says(&pdf, "Opens example.com"));
    }

    /// Smallest first, whatever order the sizes arrive in.
    #[test]
    fn the_sizes_are_drawn_smallest_first() {
        let small = raster(15.0);
        let large = raster(30.0);
        let pdf = written(
            &[
                Size {
                    mm: 30.0,
                    chosen: false,
                    drawn: Drawn::Verified {
                        png: &large,
                        verification_id: ID,
                    },
                },
                Size {
                    mm: 15.0,
                    chosen: false,
                    drawn: Drawn::Verified {
                        png: &small,
                        verification_id: ID,
                    },
                },
            ],
            "",
            None,
        );

        let widths: Vec<f64> = placements(&content(&pdf)).iter().map(|p| p.0).collect();
        assert_eq!(widths, vec![points(15.0), points(30.0)]);
    }

    /// A size refused — by the domain or by the decoder — is a dashed box with
    /// its sentence in it, and never a picture.
    #[test]
    fn a_refused_size_is_a_box_with_its_reason_and_no_picture() {
        let png = raster(25.0);
        let domain =
            "At 72 dpi, 15 mm is 43 pixels \u{2014} too few to render. Choose a finer resolution.";
        let pdf = written(
            &[
                Size {
                    mm: 15.0,
                    chosen: false,
                    drawn: Drawn::Refused { reason: domain },
                },
                Size {
                    mm: 20.0,
                    chosen: false,
                    drawn: Drawn::Refused {
                        reason: REASON_NO_CODE,
                    },
                },
                Size {
                    mm: 25.0,
                    chosen: true,
                    drawn: Drawn::Verified {
                        png: &png,
                        verification_id: ID,
                    },
                },
            ],
            "Opens example.com",
            None,
        );

        assert_eq!(images(&pdf).len(), 1, "only the verified size is a picture");
        assert_eq!(placements(&content(&pdf)).len(), 1);
        assert!(says(&pdf, domain), "the domain's sentence is in the box");
        assert!(says(&pdf, REASON_NO_CODE), "and so is the decoder's");
        assert!(says(&pdf, "15 mm"), "a box still says which size it is");
        let stream = content(&pdf);
        assert!(stream.contains("[3 2] 0 d"), "the box is dashed");
        assert_eq!(stream.matches(" re\n").count(), 3, "two boxes and the bar");
    }

    /// The bar is exactly 50 mm wide in the page's own units, ticked every
    /// 10 mm, and says what it is for.
    #[test]
    fn the_bar_is_fifty_millimetres() {
        let png = raster(25.0);
        let pdf = written(
            &[Size {
                mm: 25.0,
                chosen: true,
                drawn: Drawn::Verified {
                    png: &png,
                    verification_id: ID,
                },
            }],
            "",
            None,
        );

        let stream = content(&pdf);
        let bar = format!(
            " {} {} re",
            points(BAR_MM) as f32,
            points(BAR_HEIGHT_MM) as f32
        );
        assert_eq!(bar, " 141.73 8.5 re");
        assert!(stream.contains(&bar), "no 50 mm bar in:\n{stream}");
        assert_eq!(stream.matches(" l\n").count(), 6, "a tick every 10 mm");
        assert!(says(&pdf, BAR_CAPTION));
    }

    #[test]
    fn the_sheet_carries_no_date_no_author_and_no_title() {
        let png = raster(25.0);
        let pdf = written(
            &[Size {
                mm: 25.0,
                chosen: true,
                drawn: Drawn::Verified {
                    png: &png,
                    verification_id: ID,
                },
            }],
            "Opens example.com",
            Some("A note."),
        );

        let text = String::from_utf8_lossy(&pdf);
        for key in ["/CreationDate", "/ModDate", "/Author", "/Title", "/Creator"] {
            assert!(!text.contains(key), "{key} is in the file");
        }
        assert!(text.contains("/Producer (Signatum)"));
        assert!(text.contains("/BaseFont /Helvetica"));
        assert!(text.contains("/Encoding /WinAnsiEncoding"));
    }

    /// A summary the font cannot draw is replaced by a sentence that says so,
    /// rather than printed as boxes or question marks.
    #[test]
    fn a_summary_the_font_cannot_draw_is_replaced_by_a_sentence() {
        let png = raster(25.0);
        let size = [Size {
            mm: 25.0,
            chosen: true,
            drawn: Drawn::Verified {
                png: &png,
                verification_id: ID,
            },
        }];

        let foreign = written(&size, "Opens \u{6771}\u{4eac}.example", None);
        assert!(says(&foreign, UNPRINTABLE_SUMMARY));
        assert!(!says(&foreign, "Opens"));

        let latin = written(&size, "Opens caf\u{e9}.example \u{2014} the menu", None);
        assert!(says(&latin, "Opens caf\u{e9}.example \u{2014} the menu"));
        assert!(!says(&latin, UNPRINTABLE_SUMMARY));
    }

    #[test]
    fn the_note_is_printed_at_the_foot() {
        let png = raster(25.0);
        let note = "The chosen 250 mm is wider than an A4 page can hold, so it is not on this \
                    sheet; the four smaller sizes are.";
        let pdf = written(
            &[Size {
                mm: 25.0,
                chosen: false,
                drawn: Drawn::Verified {
                    png: &png,
                    verification_id: ID,
                },
            }],
            "",
            Some(note),
        );

        assert!(says(&pdf, note));
    }

    /// The largest plan the domain makes — four sizes and a chosen 190 mm, with
    /// a summary as long and as wide as the domain allows — fits on the page.
    #[test]
    fn the_largest_plan_the_domain_makes_fits_on_one_page() {
        let rasters: Vec<(f64, Vec<u8>)> = [15.0, 20.0, 25.0, 30.0, 190.0]
            .into_iter()
            .map(|mm| (mm, raster(mm)))
            .collect();
        let sizes: Vec<Size> = rasters
            .iter()
            .map(|(mm, png)| Size {
                mm: *mm,
                chosen: *mm == 190.0,
                drawn: Drawn::Verified {
                    png,
                    verification_id: ID,
                },
            })
            .collect();
        let summary = "W".repeat(200);
        let worded = ["Wide"; 40].join(" ");

        for summary in [summary.as_str(), worded.as_str()] {
            let pdf = written(&sizes, summary, None);
            let stream = content(&pdf);
            assert_eq!(placements(&stream).len(), 5);
            assert!(stream.contains(" 141.73 8.5 re"), "the bar is on the page");
            assert!(says(&pdf, BAR_CAPTION));
            assert!(says(&pdf, GUIDE_TITLE));
            for (number, step) in GUIDE {
                assert!(says(&pdf, &format!("{number} {step}")), "{number}");
            }
            assert!(
                texts(&stream)
                    .iter()
                    .all(|(_, y, _)| *y >= points(MARGIN_MM)),
                "a line is in the bottom margin"
            );
        }
    }

    /// The bar sits under every code, where "the sizes above" is true, and
    /// the guide under its caption — whenever the page has room for that.
    #[test]
    fn the_bar_and_the_guide_are_under_the_codes_when_the_page_has_room() {
        let rasters: Vec<(f64, Vec<u8>)> = [15.0, 25.0, 120.0]
            .into_iter()
            .map(|mm| (mm, raster(mm)))
            .collect();
        let sizes: Vec<Size> = rasters
            .iter()
            .map(|(mm, png)| Size {
                mm: *mm,
                chosen: false,
                drawn: Drawn::Verified {
                    png,
                    verification_id: ID,
                },
            })
            .collect();

        let stream = content(&written(&sizes, "Opens example.com", None));

        let lowest_code = stream
            .lines()
            .filter_map(|line| line.strip_suffix(" cm"))
            .map(|matrix| {
                matrix
                    .split_whitespace()
                    .nth(5)
                    .unwrap()
                    .parse::<f64>()
                    .unwrap()
            })
            .fold(f64::MAX, f64::min);
        let bar = stream
            .lines()
            .find(|line| line.ends_with(" 141.73 8.5 re"))
            .expect("the bar");
        let bar_y: f64 = bar.split_whitespace().nth(1).unwrap().parse().unwrap();
        assert!(
            bar_y < lowest_code,
            "the bar at {bar_y} is not under the codes"
        );
        assert!(bar_y >= points(MARGIN_MM), "the bar is in the margin");
        let caption = encode(BAR_CAPTION).unwrap();
        let caption_end = texts(&stream)
            .iter()
            .filter(|(_, _, text)| holds(&caption, text))
            .map(|(_, y, _)| *y)
            .fold(f64::MAX, f64::min);
        let (_, guide_y) = baseline_of(&stream, &encode(GUIDE_TITLE).unwrap()).expect("the guide");
        assert!(guide_y < caption_end, "the guide is not under the caption");
        assert!(caption_end < bar_y, "the caption is not under the bar");
    }

    #[test]
    fn sizes_that_cannot_fit_on_a_page_are_refused_with_a_sentence() {
        let sizes: Vec<Size> = [150.0, 160.0, 170.0, 180.0, 190.0]
            .into_iter()
            .map(|mm| Size {
                mm,
                chosen: false,
                drawn: Drawn::Refused {
                    reason: REASON_NO_CODE,
                },
            })
            .collect();

        let refused = sheet(&Sheet {
            decoder: "rqrr 0.10.1",
            summary: "",
            note: None,
            sizes: &sizes,
        })
        .expect_err("five big boxes on one page");

        assert!(matches!(refused, Error::InvalidInput(_)));
        assert_eq!(refused.to_string(), DOES_NOT_FIT);
    }

    /// Within a row every square stands on one line, so every label block —
    /// a refused box's included — starts at the same height.
    #[test]
    fn a_row_stands_on_one_line_and_its_labels_start_together() {
        let small = raster(15.0);
        let medium = raster(25.0);
        let large = raster(30.0);
        let verified = |png| Drawn::Verified {
            png,
            verification_id: ID,
        };
        let pdf = written(
            &[
                Size {
                    mm: 15.0,
                    chosen: false,
                    drawn: verified(&small),
                },
                Size {
                    mm: 20.0,
                    chosen: false,
                    drawn: Drawn::Refused {
                        reason: REASON_NO_CODE,
                    },
                },
                Size {
                    mm: 25.0,
                    chosen: true,
                    drawn: verified(&medium),
                },
                Size {
                    mm: 30.0,
                    chosen: false,
                    drawn: verified(&large),
                },
            ],
            "Opens example.com",
            None,
        );
        let stream = content(&pdf);

        let bottoms: Vec<f64> = stream
            .lines()
            .filter_map(|line| line.strip_suffix(" cm"))
            .map(|matrix| matrix.split_whitespace().nth(5).unwrap().parse().unwrap())
            .collect();
        assert_eq!(bottoms.len(), 3);
        assert!(bottoms.iter().all(|y| *y == bottoms[0]), "{bottoms:?}");
        let box_bottom: f64 = stream
            .lines()
            .find(|line| line.ends_with(" re") && !line.contains(" 141.73 8.5 re"))
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(box_bottom, bottoms[0], "the box stands on the same line");

        let firsts = ["15 mm", "20 mm", "25 mm \u{b7} chosen", "30 mm"].map(|label| {
            baseline_of(&stream, &encode(label).unwrap())
                .expect(label)
                .1
        });
        assert!(firsts.iter().all(|y| *y == firsts[0]), "{firsts:?}");
        let seconds = [
            "Hold about 15 cm away",
            "Hold about 25 cm away",
            "Hold about 30 cm away",
        ]
        .map(|label| baseline_of(&stream, label.as_bytes()).expect(label).1);
        assert!(seconds.iter().all(|y| *y == seconds[0]), "{seconds:?}");
        assert!(firsts[0] < bottoms[0], "the labels are under the squares");
    }

    #[test]
    fn the_encoder_draws_winansi_and_nothing_else() {
        assert_eq!(encode("A z~"), Some(b"A z~".to_vec()));
        assert_eq!(encode("\u{2014}"), Some(vec![0x97]));
        assert_eq!(encode("\u{b7}"), Some(vec![0xB7]));
        assert_eq!(encode("\u{e9}\u{ff}\u{a0}"), Some(vec![0xE9, 0xFF, 0xA0]));
        assert_eq!(
            encode("\u{20ac}\u{2026}\u{2019}"),
            Some(vec![0x80, 0x85, 0x92])
        );
        for refused in [
            "\u{6771}",
            "\u{80}",
            "\u{9f}",
            "a\nb",
            "\t",
            "\u{1f600}",
            "\u{7f}",
        ] {
            assert_eq!(encode(refused), None, "{refused:?}");
        }
    }

    /// The labels agree with the domain: `formatMillimetres` and
    /// `readingDistanceCm`.
    #[test]
    fn the_labels_round_as_the_domain_does() {
        assert_eq!(millimetres(25.0), "25");
        assert_eq!(millimetres(12.5), "12.5");
        assert_eq!(millimetres(12.345), "12.35");
        assert_eq!(reading_distance_cm(12.5), 13);
        assert_eq!(reading_distance_cm(25.4), 25);
        assert_eq!(size_label(25.0, true), "25 mm \u{b7} chosen");
        assert_eq!(distance_label(30.0), "Hold about 30 cm away");
        assert_eq!(verified_label(ID), "Verified \u{b7} 2e3f4a5b");
    }

    /// The reference under a code is the identifier's last eight hex digits.
    /// The first eight of a UUID v7 are the time it was made, and a sheet
    /// carries no date — so they are nowhere on the page.
    #[test]
    fn the_reference_is_the_last_eight_hex_digits_and_never_the_time() {
        let png = raster(25.0);
        let id = crate::db::new_id();
        let hex: String = id.chars().filter(char::is_ascii_hexdigit).collect();
        let (first, last) = (&hex[..8], &hex[hex.len() - 8..]);

        let pdf = written(
            &[Size {
                mm: 25.0,
                chosen: true,
                drawn: Drawn::Verified {
                    png: &png,
                    verification_id: &id,
                },
            }],
            "",
            None,
        );

        assert!(says(&pdf, &format!("Verified \u{b7} {last}")));
        assert!(
            !content(&pdf).contains(first),
            "the time the id was made is on the page"
        );
        assert!(!holds(&pdf, first.as_bytes()), "nor anywhere in the file");
    }

    /// A summary past 200 characters is replaced, not refused.
    #[test]
    fn a_summary_longer_than_the_cap_is_replaced_by_the_sentence() {
        let png = raster(25.0);
        let size = [Size {
            mm: 25.0,
            chosen: true,
            drawn: Drawn::Verified {
                png: &png,
                verification_id: ID,
            },
        }];

        // Words, so the wrapped lines join back into the sentence.
        let at_cap = "menus ".repeat(33) + "ab";
        assert_eq!(at_cap.chars().count(), MAX_SUMMARY_CHARS);
        let past_cap = at_cap.clone() + "c";

        let printed = written(&size, &at_cap, None);
        assert!(says(&printed, &at_cap));
        assert!(!says(&printed, UNPRINTABLE_SUMMARY));

        let replaced = written(&size, &past_cap, None);
        assert!(says(&replaced, UNPRINTABLE_SUMMARY));
        assert!(!says(&replaced, "menus menus"));
    }

    #[test]
    fn a_long_word_is_broken_and_every_line_fits() {
        let link = "https://example.com/".to_string() + &"a".repeat(300);
        let lines = wrap(link.as_bytes(), BODY_PT, 200.0);
        assert!(lines.len() > 1);
        assert!(lines
            .iter()
            .all(|line| measure(line, BODY_PT) <= 200.0 + EPSILON));
        assert_eq!(lines.concat(), link.as_bytes());
    }
}
