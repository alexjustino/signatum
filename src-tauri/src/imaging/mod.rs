//! The scan gate: pixels, and what an independent decoder reads in them.
//!
//! Pure by construction — no Tauri types, no database, no window. It takes the
//! drawing the interface produced and answers one question: would a phone read
//! this back as what was asked for? Everything in here can therefore be tested
//! without an application running, which is the only way a gate stays honest
//! (ADR-010, ADR-011).
//!
//! The split: `render` turns the SVG into pixels, `decode` reads a code out of
//! those bytes, `verify` puts the two together and says so in a sentence.
//! `matrix` sits beside them for the case where the modules are already known
//! and only the decoder's reading of them is in question. `logo` normalises a
//! file somebody was sent and `compose` draws the result onto the code —
//! between the render and the encode, so the pixels that are decoded are the
//! pixels that carry the logo.

pub mod compose;
pub mod decode;
pub mod logo;
pub mod matrix;
pub mod render;
pub mod verify;

#[cfg(test)]
pub mod fixtures;
