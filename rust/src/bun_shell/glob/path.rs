//! Path helpers of the glob walker (Node.js `path.posix` semantics).

/// `PATH_MAX` as used by Bun (`MAX_PATH_BYTES`).
pub(super) const MAX_PATH_BYTES: usize = if cfg!(target_os = "macos") {
    1024
} else {
    4096
};

/// Whether `p` is an absolute path. POSIX-style (`/...`) everywhere, plus
/// drive/UNC-absolute paths on Windows.
pub(super) fn is_absolute(p: &str) -> bool {
    p.starts_with('/') || (cfg!(windows) && std::path::Path::new(p).is_absolute())
}

/// Node's `normalizeString` (`path.posix`), on bytes.
pub(super) fn normalize_string(path: &str, allow_above_root: bool) -> String {
    let bytes = path.as_bytes();
    let mut res: Vec<u8> = Vec::new();
    let mut last_segment_length: usize = 0;
    let mut last_slash: isize = -1;
    let mut dots: i32 = 0;
    let mut code: u8 = 0;
    let mut i: usize = 0;
    while i <= bytes.len() {
        if i < bytes.len() {
            code = bytes[i];
        } else if code == b'/' {
            break;
        } else {
            code = b'/';
        }
        let ii = i as isize;
        if code == b'/' {
            if last_slash == ii - 1 || dots == 1 {
                // NOOP
            } else if dots == 2 {
                let ends_with_dotdot = res.len() >= 2
                    && last_segment_length == 2
                    && res[res.len() - 1] == b'.'
                    && res[res.len() - 2] == b'.';
                if !ends_with_dotdot {
                    if res.len() > 2 {
                        match res.iter().rposition(|&b| b == b'/') {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                res.truncate(idx);
                                last_segment_length = match res.iter().rposition(|&b| b == b'/') {
                                    Some(j) => res.len() - 1 - j,
                                    None => res.len(),
                                };
                            }
                        }
                        last_slash = ii;
                        dots = 0;
                        i += 1;
                        continue;
                    } else if !res.is_empty() {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = ii;
                        dots = 0;
                        i += 1;
                        continue;
                    }
                }
                if allow_above_root {
                    if res.is_empty() {
                        res.extend_from_slice(b"..");
                    } else {
                        res.extend_from_slice(b"/..");
                    }
                    last_segment_length = 2;
                }
            } else {
                let seg = &bytes[(last_slash + 1) as usize..i];
                if !res.is_empty() {
                    res.push(b'/');
                }
                res.extend_from_slice(seg);
                last_segment_length = (ii - last_slash - 1) as usize;
            }
            last_slash = ii;
            dots = 0;
        } else if code == b'.' && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
        i += 1;
    }
    String::from_utf8_lossy(&res).into_owned()
}

/// Node's `path.posix.normalize`.
pub(super) fn posix_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = path.starts_with('/');
    let trailing_sep = path.ends_with('/');
    let mut p = normalize_string(path, !absolute);
    if p.is_empty() {
        if absolute {
            return "/".to_string();
        }
        return if trailing_sep { "./" } else { "." }.to_string();
    }
    if trailing_sep {
        p.push('/');
    }
    if absolute {
        format!("/{p}")
    } else {
        p
    }
}

/// Node's `path.posix.join`.
pub(super) fn posix_join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".to_string();
    }
    posix_normalize(&joined)
}

/// paths::join_sep_vec: non-normalizing join with `/`.
pub(super) fn join_sep(dir: &str, name: &str) -> String {
    let mut out = String::with_capacity(dir.len() + name.len() + 1);
    let mut prev_last: Option<char> = None;
    for p in [dir, name] {
        let Some(last) = p.chars().last() else {
            continue;
        };
        match prev_last {
            None => out.push_str(p),
            Some(prev) => {
                let prev_sep = prev == '/';
                let this_sep = p.starts_with('/');
                if !prev_sep && !this_sep {
                    out.push('/');
                }
                out.push_str(if prev_sep && this_sep { &p[1..] } else { p });
            }
        }
        prev_last = Some(last);
    }
    out
}

pub(super) fn current_dir_string() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}
