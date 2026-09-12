//! The operating-system surface: everything only the host can do.
//!
//! Windows-only paths are behind `cfg(windows)` and every one of them has a
//! declared fallback. A native capability that is unavailable must degrade
//! visibly — the frontend is told, and the user sees a plain surface instead of
//! Mica rather than a mysteriously wrong colour.
//!
//! In F0 there is exactly one such capability: the accent colour. This product
//! starts no processes and opens no files of its own; the one file it writes is
//! the one a person named in the system's save dialog.
//!
//! F7 adds the second: the clipboard, which takes the verified image and never
//! the payload text. It is reached from here rather than through a plugin, so the
//! interface can ask for a copy and cannot make one.

pub mod accent;
pub mod clipboard;
