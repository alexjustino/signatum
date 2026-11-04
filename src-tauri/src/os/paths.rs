//! Whether a path names a place on this machine.
//!
//! Every door that reads or writes a file a person chose — the exports, the logo import, Read, the
//! batch — asks the same question before it touches the path: is this a local drive? A network
//! path would make this host open a connection on the interface's word, in a product that
//! promises nothing leaves the machine; on Windows it also hands the machine's credentials to
//! whatever server answers.
//!
//! The question is answered from the prefix Windows itself parses, never from the characters the
//! string starts with. A check that looked for a leading `\\` let `\/server/share/x.png` through,
//! because Windows reads either slash as a separator and treats that string as a UNC path. Only a
//! plain drive letter is accepted, and then only when that drive is not a network share mapped to
//! a letter — a mapped `Z:` looks local to every string test and is not.

/// True when `path` is absolute and on a drive of this machine.
///
/// Refused: UNC paths in any spelling (`\\host\share`, `//host/share`, `\/host/share`), verbatim
/// paths (`\\?\…`, `\\?\UNC\…`), device paths (`\\.\…`), a rooted path with no drive (`\x`), and,
/// on Windows, a drive letter mapped to a network share.
pub fn is_local(path: &str) -> bool {
    #[cfg(windows)]
    {
        windows_local(path)
    }
    #[cfg(not(windows))]
    {
        // Elsewhere the only network spelling a path has is a leading `//`, which POSIX leaves
        // implementation-defined; refused for the same reason.
        path.starts_with('/') && !path.starts_with("//")
    }
}

/// What a reading door says about a path whose last component is a link.
pub const A_LINK: &str = "That file is a link to somewhere else; open the file itself.";

/// True when the last component of `path` is a symbolic link (on Windows, any name-surrogate
/// reparse point — a symlink or a junction).
///
/// Every door that reads a file a person chose refuses one: the dialog showed the link's name
/// and its folder, and what would be read is somewhere else that nobody chose. Asked of the
/// link itself (`symlink_metadata`), never of what it points at; a path whose metadata cannot
/// be read is not a link, and the read that follows says what is wrong with it.
pub fn is_link(path: &str) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|facts| facts.file_type().is_symlink())
}

/// Make `link` a symbolic link to the file `target`, for the tests of the doors that refuse
/// one. `false` when the system will not let this process make one — Windows asks for a
/// privilege, or for developer mode — so the test can say it was skipped.
#[cfg(test)]
pub(crate) fn make_link(target: &std::path::Path, link: &std::path::Path) -> bool {
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(target, link);
    #[cfg(not(windows))]
    let made = std::os::unix::fs::symlink(target, link);
    match made {
        Ok(()) => true,
        Err(error) => {
            eprintln!("skipped: this system would not make a symbolic link ({error})");
            false
        }
    }
}

#[cfg(windows)]
fn windows_local(path: &str) -> bool {
    use std::path::{Component, Path, Prefix};

    let mut components = Path::new(path).components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return false;
    };
    let Prefix::Disk(letter) = prefix.kind() else {
        return false;
    };
    // `C:x` is relative to the current directory of drive C; only `C:\…` is absolute.
    if !matches!(components.next(), Some(Component::RootDir)) {
        return false;
    }
    !is_network_drive(letter)
}

/// True when the drive letter is a network share mapped to a letter.
///
/// `GetDriveTypeW` answers from the drive's root without touching the share's contents; a drive
/// it cannot classify is treated as not network, so a removable drive or a fresh volume is not
/// refused — the open and save that follow will fail on their own if the drive is not there.
#[cfg(windows)]
fn is_network_drive(letter: u8) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;

    /// `DRIVE_REMOTE` from `winbase.h`.
    const DRIVE_REMOTE: u32 = 4;

    let root = HSTRING::from(format!("{}:\\", char::from(letter)));
    // SAFETY: `GetDriveTypeW` reads a NUL-terminated wide string that lives for the call; it
    // writes nothing and has no other precondition.
    unsafe { GetDriveTypeW(&root) == DRIVE_REMOTE }
}

#[cfg(test)]
mod tests {
    use super::{is_link, is_local, make_link};

    #[test]
    fn a_link_is_a_link_and_a_file_is_not() {
        let folder = std::env::temp_dir().join(format!("signatum-{}", crate::db::new_id()));
        std::fs::create_dir_all(&folder).expect("scratch directory");
        let file = folder.join("code.png");
        std::fs::write(&file, b"bytes").expect("seed");
        let link = folder.join("link.png");

        assert!(!is_link(&file.to_string_lossy()), "a file is not a link");
        assert!(
            !is_link(&folder.join("gone.png").to_string_lossy()),
            "nothing there is not a link"
        );
        if make_link(&file, &link) {
            assert!(is_link(&link.to_string_lossy()));
        }
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[cfg(windows)]
    #[test]
    fn a_drive_letter_path_is_local() {
        let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        for path in [format!(r"{system}\code.png"), format!("{system}/code.png")] {
            assert!(is_local(&path), "{path}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn every_spelling_of_a_network_or_device_path_is_refused() {
        for path in [
            r"\\server\share\code.png",
            "//server/share/code.png",
            r"\/server/share/code.png",
            r"/\server\share\code.png",
            r"\\?\C:\code.png",
            r"\\?\UNC\server\share\code.png",
            r"\\.\C:\code.png",
            r"\\.\pipe\name",
            r"\code.png",
            "C:code.png",
            "code.png",
            "",
        ] {
            assert!(!is_local(path), "{path:?} should not be local");
        }
    }
}
