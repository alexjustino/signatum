//! A real QR code, written down, so the gate can be tested without an encoder.
//!
//! The host has no encoder and must not grow one: drawing the code is the
//! domain's job, in TypeScript (ADR-011). So the test data is the drawing
//! itself — the 21×21 modules of a version-1 code of `HELLO WORLD`, derived
//! once with the vendored encoder and written here as rows of `#` and `.`.
//!
//! If the decoder ever stops reading this, the gate is broken; if the encoder
//! changes, this file does not have to, which is exactly the independence the
//! scan gate is built on.

/// The content of the code below. Short and alphanumeric, so it fits a
/// version-1 symbol at quartile error correction: 21 modules, the smallest a QR
/// code can be.
pub const HELLO_WORLD: &str = "HELLO WORLD";

/// The quiet zone, in modules, that a QR code needs around it (spec §2.4).
pub const QUIET_ZONE: usize = 4;

/// The 21 rows of the symbol, dark modules as `#`.
const MODULES: [&str; 21] = [
    "#######.##....#######",
    "#.....#.#..#..#.....#",
    "#.###.#.#..##.#.###.#",
    "#.###.#.#.....#.###.#",
    "#.###.#.#.#...#.###.#",
    "#.....#...#...#.....#",
    "#######.#.#.#.#######",
    "........#............",
    ".##.#.##....#.#.#####",
    ".#......####....#...#",
    "..##.###.##...#.##...",
    ".##.##.#..##.#.#.###.",
    "#...#.#.#.###.###.#.#",
    "........##.#..#...#.#",
    "#######.#.#....#.##..",
    "#.....#..#.##.##.#...",
    "#.###.#.#.#...#######",
    "#.###.#..#.#.#.#...#.",
    "#.###.#.#..#.###.#..#",
    "#.....#.#.####...#.##",
    "#######....#.###....#",
];

/// The scene the interface draws, as the host receives it: one background
/// rectangle and one path of dark modules, self-contained, no external anything
/// (spec §3).
pub fn hello_world_svg() -> String {
    let side = MODULES.len() + QUIET_ZONE * 2;

    let mut path = String::new();
    for (y, row) in MODULES.iter().enumerate() {
        for (x, module) in row.chars().enumerate() {
            if module == '#' {
                path.push_str(&format!("M{} {}h1v1h-1z", x + QUIET_ZONE, y + QUIET_ZONE));
            }
        }
    }

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {side} {side}\" \
         shape-rendering=\"crispEdges\">\
         <rect width=\"{side}\" height=\"{side}\" fill=\"#ffffff\"/>\
         <path d=\"{path}\" fill=\"#000000\"/></svg>"
    )
}

/// The same square with nothing in it: a drawing that is valid, renders, and
/// holds no code at all.
pub fn blank_svg() -> String {
    let side = MODULES.len() + QUIET_ZONE * 2;
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {side} {side}\">\
         <rect width=\"{side}\" height=\"{side}\" fill=\"#ffffff\"/></svg>"
    )
}
