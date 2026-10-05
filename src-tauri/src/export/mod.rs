//! What a verified code becomes on its way out: a file's bytes.
//!
//! Everything here takes the artefact the scan gate answered for and produces
//! the bytes of one kind of file. Nothing here decides *whether* a code may
//! leave — that is the gate's answer and the command's refusal — and nothing
//! here touches a disk. A serialiser that could also write would be a serialiser
//! that could write something nobody verified.
//!
//! The PNG is not here: it is the artefact itself, encoded once by `imaging` with
//! the resolution written into it, because the bytes that are decoded have to be
//! the bytes that are written (ADR-010). What is here is the two files that are
//! *built around* that artefact — an SVG that carries the same scene and the same
//! logo as markup (ADR-026), and a PDF page of exactly the millimetres a person
//! asked for with the verified raster on it — and, from P1, the proof sheet: the
//! same code at several sizes on one A4 page, each one a verified raster of its
//! own size, with a bar that checks the printer.

pub mod pdf;
pub mod proof;
pub mod svg;
