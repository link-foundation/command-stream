//! Node.js `path` semantics (`lib/path.js`, MIT), which the JavaScript port
//! uses for every path it prints, so the Rust port produces the same bytes.
//!
//! [`posix`] and [`win32`] mirror `path.posix` and `path.win32`; the free
//! functions at the top level pick the platform flavour like `path.*` does.
//! Strings are handled as UTF-8; every character the algorithms look at is
//! ASCII, so byte indices are always char boundaries.

// `normalize` and `SEP` serve the ls/rm/mkdir/touch/mv builtins, which are
// not ported yet.
#![allow(dead_code)]

/// The platform path separator (`path.sep`).
pub(crate) const SEP: &str = if cfg!(windows) { "\\" } else { "/" };

/// `path.isAbsolute`.
pub(crate) fn is_absolute(p: &str) -> bool {
    if cfg!(windows) {
        win32::is_absolute(p)
    } else {
        posix::is_absolute(p)
    }
}

/// `path.normalize`.
pub(crate) fn normalize(p: &str) -> String {
    if cfg!(windows) {
        win32::normalize(p)
    } else {
        posix::normalize(p)
    }
}

/// `path.join(...parts)`.
pub(crate) fn join(parts: &[&str]) -> String {
    if cfg!(windows) {
        win32::join(parts)
    } else {
        posix::join(parts)
    }
}

/// `path.resolve(...parts)` (relative results are resolved against the
/// process working directory, like Node).
pub(crate) fn resolve(parts: &[&str]) -> String {
    if cfg!(windows) {
        win32::resolve(parts)
    } else {
        posix::resolve(parts)
    }
}

fn process_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Node's `normalizeString`: resolves `.` and `..` segments.
fn normalize_string(
    path: &str,
    allow_above_root: bool,
    separator: u8,
    is_sep: fn(u8) -> bool,
) -> String {
    let bytes = path.as_bytes();
    let sep_str = if separator == b'/' { "/" } else { "\\" };
    let mut res = String::new();
    let mut last_segment_length: usize = 0;
    let mut last_slash: isize = -1;
    let mut dots: i32 = 0;
    let mut code: u8 = 0;
    let len = bytes.len();
    for i in 0..=len {
        if i < len {
            code = bytes[i];
        } else if is_sep(code) {
            break;
        } else {
            code = b'/';
        }
        let ii = i as isize;
        if is_sep(code) {
            if last_slash == ii - 1 || dots == 1 {
                // NOOP
            } else if dots == 2 {
                let rb = res.as_bytes();
                if rb.len() < 2
                    || last_segment_length != 2
                    || rb[rb.len() - 1] != b'.'
                    || rb[rb.len() - 2] != b'.'
                {
                    if res.len() > 2 {
                        match res.rfind(sep_str) {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                res.truncate(idx);
                                last_segment_length = match res.rfind(sep_str) {
                                    Some(j) => res.len() - 1 - j,
                                    None => res.len(),
                                };
                            }
                        }
                        last_slash = ii;
                        dots = 0;
                        continue;
                    } else if !res.is_empty() {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = ii;
                        dots = 0;
                        continue;
                    }
                }
                if allow_above_root {
                    if res.is_empty() {
                        res.push_str("..");
                    } else {
                        res.push_str(sep_str);
                        res.push_str("..");
                    }
                    last_segment_length = 2;
                }
            } else {
                let seg = &path[(last_slash + 1) as usize..i];
                if !res.is_empty() {
                    res.push_str(sep_str);
                }
                res.push_str(seg);
                last_segment_length = (ii - last_slash - 1) as usize;
            }
            last_slash = ii;
            dots = 0;
        } else if code == b'.' && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
    }
    res
}

/// `path.posix`.
pub(crate) mod posix {
    use super::normalize_string;

    fn is_sep(c: u8) -> bool {
        c == b'/'
    }

    pub(crate) fn is_absolute(p: &str) -> bool {
        p.starts_with('/')
    }

    pub(crate) fn normalize(p: &str) -> String {
        if p.is_empty() {
            return ".".into();
        }
        let is_abs = p.starts_with('/');
        let trailing = p.ends_with('/');
        let mut out = normalize_string(p, !is_abs, b'/', is_sep);
        if out.is_empty() {
            if is_abs {
                return "/".into();
            }
            return if trailing { "./".into() } else { ".".into() };
        }
        if trailing {
            out.push('/');
        }
        if is_abs {
            format!("/{out}")
        } else {
            out
        }
    }

    pub(crate) fn join(parts: &[&str]) -> String {
        let joined = parts
            .iter()
            .filter(|p| !p.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join("/");
        if joined.is_empty() {
            return ".".into();
        }
        normalize(&joined)
    }

    pub(crate) fn resolve(parts: &[&str]) -> String {
        let mut resolved = String::new();
        let mut absolute = false;
        let mut i = parts.len() as isize - 1;
        while i >= -1 && !absolute {
            let p: String = if i >= 0 {
                parts[i as usize].to_string()
            } else {
                super::process_cwd()
            };
            i -= 1;
            if p.is_empty() {
                continue;
            }
            resolved = format!("{p}/{resolved}");
            absolute = p.starts_with('/');
        }
        let out = normalize_string(&resolved, !absolute, b'/', is_sep);
        if absolute {
            format!("/{out}")
        } else if out.is_empty() {
            ".".into()
        } else {
            out
        }
    }
}

/// `path.win32`.
pub(crate) mod win32 {
    use super::normalize_string;

    pub(crate) fn is_sep(c: u8) -> bool {
        c == b'/' || c == b'\\'
    }

    fn is_device_root(c: u8) -> bool {
        c.is_ascii_alphabetic()
    }

    pub(crate) fn is_absolute(p: &str) -> bool {
        let b = p.as_bytes();
        if b.is_empty() {
            return false;
        }
        is_sep(b[0]) || (b.len() > 2 && is_device_root(b[0]) && b[1] == b':' && is_sep(b[2]))
    }

    /// Matches a `\\server\share` root starting at `path[0..2]` (both
    /// separators): returns `(first_part, share_start, share_end)`.
    fn match_unc(b: &[u8]) -> Option<(usize, usize, usize, usize)> {
        let len = b.len();
        let mut j = 2;
        let mut last = j;
        while j < len && !is_sep(b[j]) {
            j += 1;
        }
        if j < len && j != last {
            let first = (last, j);
            last = j;
            while j < len && is_sep(b[j]) {
                j += 1;
            }
            if j < len && j != last {
                last = j;
                while j < len && !is_sep(b[j]) {
                    j += 1;
                }
                return Some((first.0, first.1, last, j));
            }
        }
        None
    }

    pub(crate) fn normalize(path: &str) -> String {
        let b = path.as_bytes();
        let len = b.len();
        if len == 0 {
            return ".".into();
        }
        let mut root_end = 0;
        let mut device: Option<String> = None;
        let mut is_abs = false;
        let code = b[0];
        if len == 1 {
            return if code == b'/' {
                "\\".into()
            } else {
                path.into()
            };
        }
        if is_sep(code) {
            is_abs = true;
            if is_sep(b[1]) {
                if let Some((f0, f1, last, j)) = match_unc(b) {
                    let first = &path[f0..f1];
                    if j == len {
                        return format!("\\\\{first}\\{}\\", &path[last..]);
                    }
                    if j != last {
                        device = Some(format!("\\\\{first}\\{}", &path[last..j]));
                        root_end = j;
                    }
                }
            } else {
                root_end = 1;
            }
        } else if is_device_root(code) && b[1] == b':' {
            device = Some(path[..2].to_string());
            root_end = 2;
            if len > 2 && is_sep(b[2]) {
                is_abs = true;
                root_end = 3;
            }
        }
        let mut tail = if root_end < len {
            normalize_string(&path[root_end..], !is_abs, b'\\', is_sep)
        } else {
            String::new()
        };
        if tail.is_empty() && !is_abs {
            tail = ".".into();
        }
        if !tail.is_empty() && is_sep(b[len - 1]) {
            tail.push('\\');
        }
        match device {
            None => {
                if is_abs {
                    format!("\\{tail}")
                } else {
                    tail
                }
            }
            Some(d) => {
                if is_abs {
                    format!("{d}\\{tail}")
                } else {
                    format!("{d}{tail}")
                }
            }
        }
    }

    pub(crate) fn join(parts: &[&str]) -> String {
        let non_empty: Vec<&str> = parts.iter().filter(|p| !p.is_empty()).copied().collect();
        let Some(first) = non_empty.first() else {
            return ".".into();
        };
        let mut joined = non_empty.join("\\");
        let fb = first.as_bytes();
        let mut needs_replace = true;
        let mut slash_count = 0;
        if is_sep(fb[0]) {
            slash_count += 1;
            if fb.len() > 1 && is_sep(fb[1]) {
                slash_count += 1;
                if fb.len() > 2 {
                    if is_sep(fb[2]) {
                        slash_count += 1;
                    } else {
                        needs_replace = false;
                    }
                }
            }
        }
        if needs_replace {
            let jb = joined.as_bytes();
            while slash_count < jb.len() && is_sep(jb[slash_count]) {
                slash_count += 1;
            }
            if slash_count >= 2 {
                joined = format!("\\{}", &joined[slash_count..]);
            }
        }
        normalize(&joined)
    }

    pub(crate) fn resolve(parts: &[&str]) -> String {
        let mut resolved_device = String::new();
        let mut resolved_tail = String::new();
        let mut resolved_abs = false;
        let mut i = parts.len() as isize - 1;
        while i >= -1 {
            let owned: String;
            let path: &str = if i >= 0 {
                let p = parts[i as usize];
                if p.is_empty() {
                    i -= 1;
                    continue;
                }
                p
            } else if resolved_device.is_empty() {
                owned = super::process_cwd();
                &owned
            } else {
                let env_cwd = std::env::var(format!("={resolved_device}"))
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(super::process_cwd);
                let pb = env_cwd.as_bytes();
                let other_drive = env_cwd.len() >= 2
                    && !env_cwd[..2].eq_ignore_ascii_case(&resolved_device)
                    && pb.get(2) == Some(&b'\\');
                owned = if other_drive {
                    format!("{resolved_device}\\")
                } else {
                    env_cwd
                };
                &owned
            };
            i -= 1;

            let b = path.as_bytes();
            let len = b.len();
            let mut root_end = 0;
            let mut device = String::new();
            let mut is_abs = false;
            let code = b[0];
            if len == 1 {
                if is_sep(code) {
                    root_end = 1;
                    is_abs = true;
                }
            } else if is_sep(code) {
                is_abs = true;
                if is_sep(b[1]) {
                    if let Some((f0, f1, last, j)) = match_unc(b) {
                        if j == len || j != last {
                            device = format!("\\\\{}\\{}", &path[f0..f1], &path[last..j]);
                            root_end = j;
                        }
                    }
                } else {
                    root_end = 1;
                }
            } else if is_device_root(code) && b[1] == b':' {
                device = path[..2].to_string();
                root_end = 2;
                if len > 2 && is_sep(b[2]) {
                    is_abs = true;
                    root_end = 3;
                }
            }

            if !device.is_empty() {
                if !resolved_device.is_empty() {
                    if !device.eq_ignore_ascii_case(&resolved_device) {
                        continue;
                    }
                } else {
                    resolved_device = device;
                }
            }

            if resolved_abs {
                if !resolved_device.is_empty() {
                    break;
                }
            } else {
                resolved_tail = format!("{}\\{resolved_tail}", &path[root_end..]);
                resolved_abs = is_abs;
                if is_abs && !resolved_device.is_empty() {
                    break;
                }
            }
        }
        let tail = normalize_string(&resolved_tail, !resolved_abs, b'\\', is_sep);
        if resolved_abs {
            format!("{resolved_device}\\{tail}")
        } else {
            let s = format!("{resolved_device}{tail}");
            if s.is_empty() {
                ".".into()
            } else {
                s
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn posix_normalize_join_resolve() {
        assert_eq!(posix::normalize(""), ".");
        assert_eq!(
            posix::normalize("/foo/bar//baz/asdf/quux/.."),
            "/foo/bar/baz/asdf"
        );
        assert_eq!(posix::normalize("./"), "./");
        assert_eq!(posix::normalize("a/../.."), "..");
        assert_eq!(posix::normalize("a/"), "a/");
        assert_eq!(posix::normalize("//"), "/");
        assert_eq!(
            posix::join(&["/foo", "bar", "baz/asdf", "quux", ".."]),
            "/foo/bar/baz/asdf"
        );
        assert_eq!(posix::join(&["", ""]), ".");
        assert_eq!(posix::join(&["/tmp", "sub_dir/"]), "/tmp/sub_dir/");
        assert_eq!(posix::resolve(&["/foo/bar", "./baz"]), "/foo/bar/baz");
        assert_eq!(posix::resolve(&["/foo/bar", "/tmp/file/"]), "/tmp/file");
        assert_eq!(posix::resolve(&["/a", "../../.."]), "/");
        assert!(posix::resolve(&["rel"]).starts_with('/') || cfg!(windows));
    }

    #[test]
    fn win32_normalize_join_resolve() {
        assert_eq!(win32::normalize("C:/a/b/../c"), "C:\\a\\c");
        assert_eq!(win32::normalize("C:"), "C:.");
        assert_eq!(win32::normalize("\\\\server\\share"), "\\\\server\\share\\");
        assert_eq!(
            win32::normalize("\\\\server\\share\\x\\..\\y"),
            "\\\\server\\share\\y"
        );
        assert_eq!(win32::normalize("a/b/"), "a\\b\\");
        assert_eq!(win32::normalize("/"), "\\");
        assert_eq!(win32::join(&["C:\\tmp", "sub"]), "C:\\tmp\\sub");
        assert_eq!(win32::join(&["//server", "share"]), "\\\\server\\share\\");
        assert_eq!(win32::join(&["///x", "y"]), "\\x\\y");
        assert_eq!(win32::resolve(&["C:\\tmp", "sub\\x"]), "C:\\tmp\\sub\\x");
        assert_eq!(win32::resolve(&["C:\\tmp", "D:\\x"]), "D:\\x");
        assert_eq!(
            win32::resolve(&["C:\\tmp", "\\\\srv\\sh\\f"]),
            "\\\\srv\\sh\\f"
        );
        assert!(win32::is_absolute("C:\\x"));
        assert!(win32::is_absolute("/x"));
        assert!(!win32::is_absolute("C:x"));
        assert!(!win32::is_absolute(""));
    }
}
