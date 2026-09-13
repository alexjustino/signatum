//! The typed boundary between the host and the interface.
//!
//! A command is thin: it validates, delegates and returns. What a link is and
//! how a code is drawn live in `src/domain/` (TypeScript, pure); the scan gate
//! lives in `imaging`; storage lives in `db`; the operating system lives in
//! `os`.

pub mod batch;
pub mod codes;
pub mod library;
pub mod logos;
pub mod system;
