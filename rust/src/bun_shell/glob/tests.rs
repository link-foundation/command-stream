use super::*;
use std::path::Path;

const MATCH_CASES: &[(&str, &str, bool)] = &[
    ("*", "abc", true),
    ("*", "a/b", false),
    ("*", "", true),
    ("**", "a/b/c", true),
    ("a/**/b", "a/b", true),
    ("a/**/b", "a/x/y/b", true),
    ("a/**", "a/", true),
    ("**/*.txt", "x/y/z.txt", true),
    ("**/*.txt", "z.md", false),
    ("?", "a", true),
    ("?", "/", false),
    ("?", "日", true),
    ("??", "😀", false),
    ("[abc]", "b", true),
    ("[!abc]", "b", false),
    ("[^abc]", "d", true),
    ("[a-z]*", "hello", true),
    ("[é-ü]", "ö", true),
    ("[é-ü]", "z", false),
    ("[]]", "]", true),
    ("[abc", "a", false),
    ("{a,b}", "a", true),
    ("{a,b}", "c", false),
    ("*.{js,ts}", "x.ts", true),
    ("{a,{b,c}}d", "cd", true),
    ("{,a}b", "b", true),
    ("!*.md", "x.txt", true),
    ("!*.md", "x.md", false),
    ("!!a", "a", true),
    ("\\*", "*", true),
    ("\\*", "a", false),
    ("a\\", "a", false),
    ("\\n", "\n", true),
    ("日本*", "日本語", true),
    ("*語", "日本語", true),
    ("a/*/c", "a/b/c", true),
    ("a/*/c", "a/b/x/c", false),
    ("", "", true),
    ("", "a", false),
];

#[test]
fn glob_match_cases() {
    for &(pattern, path, expected) in MATCH_CASES {
        assert_eq!(
            glob_match(pattern, path),
            expected,
            "{pattern:?} vs {path:?}"
        );
    }
}

#[test]
fn match_bytes_reports_negation_and_handles_invalid_utf8() {
    assert_eq!(
        match_bytes(b"!a", b"b"),
        MatchResult {
            matches: true,
            negated: true
        }
    );
    assert!(!match_bytes(b"!!a", b"b").negated);
    // A lone continuation byte is a one-byte "character".
    assert!(match_bytes(b"?", b"\x80").matches);
    assert!(match_bytes(b"[\x80]", b"\x80").matches);
}

#[test]
fn deeply_nested_braces_fail() {
    let p = format!("{}b{}", "{a,".repeat(12), "}".repeat(12));
    assert!(!glob_match(&p, "b"));
    let p = format!("{}b{}", "{a,".repeat(9), "}".repeat(9));
    assert!(glob_match(&p, "b"));
}

#[test]
fn has_glob_syntax_cases() {
    assert!(has_glob_syntax("*.txt"));
    assert!(has_glob_syntax("a{b,c}"));
    assert!(has_glob_syntax("!a"));
    assert!(has_glob_syntax("a?"));
    assert!(!has_glob_syntax("plain/path"));
    assert!(!has_glob_syntax("\\*"));
    assert!(has_glob_syntax("\\\\*"));
}

#[test]
fn posix_join_matches_node() {
    assert_eq!(posix_join(&["/a/b", "../c"]), "/a/c");
    assert_eq!(posix_join(&["a", ".."]), ".");
    assert_eq!(posix_join(&["a/", "./"]), "a/");
    assert_eq!(posix_join(&["", ""]), ".");
    assert_eq!(posix_join(&["..", "../x"]), "../../x");
    assert_eq!(posix_join(&["/", ".."]), "/");
    assert_eq!(join_sep("a/", "/b"), "a/b");
    assert_eq!(join_sep("", "b"), "b");
}

fn write(root: &Path, rel: &str) {
    fs::write(root.join(rel), "").unwrap();
}

/// The tree of js/tests/bun-shell-glob.test.mjs (symlinks on Unix only).
fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("a").join("b")).unwrap();
    fs::create_dir(root.join(".h")).unwrap();
    fs::create_dir(root.join("é")).unwrap();
    write(root, "a/x.txt");
    write(root, "a/b/y.txt");
    write(root, ".h/z");
    write(root, "é/日本.txt");
    write(root, "top");
    write(root, ".dot");
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink("a", root.join("la")).unwrap();
        symlink("top", root.join("lf")).unwrap();
        symlink("nowhere", root.join("broken")).unwrap();
        symlink("loop", root.join("loop")).unwrap();
    }
    dir
}

fn opts(root: &Path) -> WalkOptions {
    WalkOptions {
        cwd: root.to_string_lossy().into_owned(),
        ..WalkOptions::default()
    }
}

fn sorted(pattern: &str, o: &WalkOptions) -> Vec<String> {
    let mut v = walk(pattern, o).unwrap();
    v.sort();
    v
}

#[test]
fn walk_basics() {
    let dir = fixture();
    let o = opts(dir.path());
    assert_eq!(sorted("*", &o), ["top"]);
    let dot = WalkOptions {
        dot: true,
        ..o.clone()
    };
    assert_eq!(sorted("*", &dot), [".dot", "top"]);
    assert_eq!(sorted(".h/*", &o), [".h/z"]);
    assert_eq!(
        sorted("**/*.txt", &o),
        ["a/b/y.txt", "a/x.txt", "é/日本.txt"]
    );
    assert_eq!(sorted("./*", &o), ["./top"]);
    assert_eq!(sorted("a/../t*", &o), ["a/../top"]);
    assert_eq!(sorted("a/x.txt", &o), ["a/x.txt"]);
    assert!(sorted("a/missing", &o).is_empty());
    assert!(walk("", &o).unwrap().is_empty());
    let all = WalkOptions {
        only_files: false,
        ..o.clone()
    };
    assert_eq!(sorted("./", &all), ["."]);
    assert_eq!(sorted("{a,é}/", &all), ["a", "é"]);
    let everything = sorted("**", &all);
    assert!(everything.contains(&"a/b".to_string()));
    assert!(everything.contains(&"a/b/y.txt".to_string()));
    assert!(!everything.contains(&".h".to_string()));
}

#[test]
fn walk_absolute() {
    let dir = fixture();
    let root = dir.path().to_string_lossy().into_owned();
    let abs = WalkOptions {
        absolute: true,
        ..opts(dir.path())
    };
    let expected = posix_join(&[&root.replace('\\', "/"), "a/x.txt"]);
    let got: Vec<String> = sorted("a/*", &abs)
        .into_iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    assert_eq!(got, std::slice::from_ref(&expected));
    #[cfg(unix)]
    assert_eq!(
        walk(&format!("{root}/a/*"), &WalkOptions::default()).unwrap(),
        [expected]
    );
}

#[cfg(unix)]
#[test]
fn walk_symlinks() {
    let dir = fixture();
    let o = opts(dir.path());
    let follow = WalkOptions {
        follow_symlinks: true,
        ..o.clone()
    };
    assert_eq!(sorted("*", &follow), ["lf", "top"]);
    let all_nofollow = WalkOptions {
        only_files: false,
        ..o.clone()
    };
    assert_eq!(
        sorted("*", &all_nofollow),
        ["a", "broken", "la", "lf", "loop", "top", "é"]
    );
    assert_eq!(sorted("la/*", &o), ["la/x.txt"]);
    assert_eq!(
        sorted("**/*.txt", &follow),
        [
            "a/b/y.txt",
            "a/x.txt",
            "la/b/y.txt",
            "la/x.txt",
            "é/日本.txt"
        ]
    );
    let all = WalkOptions {
        only_files: false,
        ..follow.clone()
    };
    assert!(sorted("broken", &all).is_empty());
    assert_eq!(sorted("b*", &all), ["broken"]);
    let strict = WalkOptions {
        error_on_broken_symlinks: true,
        ..all
    };
    let err = walk("b*", &strict).unwrap_err();
    assert_eq!(
        (err.code, err.syscall, err.path.as_str()),
        (Some("ENOENT"), "open", "broken")
    );
    let err = walk("loop", &o).unwrap_err();
    assert_eq!((err.code, err.syscall), (Some("ELOOP"), "fstatat"));
    assert_eq!(
        err.message,
        "ELOOP: too many symbolic links encountered, fstatat 'loop'"
    );
}

#[cfg(unix)]
#[test]
fn walk_symlink_cycles_terminate() {
    let dir = fixture();
    let root = dir.path();
    std::os::unix::fs::symlink("..", root.join("a").join("up")).unwrap();
    let follow = WalkOptions {
        follow_symlinks: true,
        ..opts(root)
    };
    let found = sorted("**/y.txt", &follow);
    assert!(found.contains(&"a/b/y.txt".to_string()));
    assert!(found.len() < 20, "{found:?}");
}

#[test]
fn walk_errors() {
    let dir = fixture();
    let missing = dir.path().join("nope").to_string_lossy().into_owned();
    let missing_opts = WalkOptions {
        cwd: missing.clone(),
        ..WalkOptions::default()
    };
    let err = walk("*", &missing_opts).unwrap_err();
    assert_eq!(err.code, Some("ENOENT"));
    assert_eq!(err.syscall, "open");
    assert_eq!(err.path, missing);
    #[cfg(target_os = "linux")]
    assert_eq!(err.errno, Some(-2));
    assert!(err.is("ENOENT"));
    assert_eq!(
        err.to_string(),
        format!("ENOENT: no such file or directory, open '{missing}'")
    );

    let file_opts = WalkOptions {
        cwd: dir.path().join("top").to_string_lossy().into_owned(),
        ..WalkOptions::default()
    };
    let err = walk("*", &file_opts).unwrap_err();
    assert_eq!((err.code, err.syscall), (Some("ENOTDIR"), "open"));

    let long_opts = WalkOptions {
        cwd: "x".repeat(MAX_PATH_BYTES + 1),
        ..WalkOptions::default()
    };
    let err = walk("*", &long_opts).unwrap_err();
    assert_eq!(err.code, None);
    assert_eq!(
        err.message,
        format!("globWalkSync: invalid `cwd`, longer than {MAX_PATH_BYTES} bytes")
    );
}

#[cfg(unix)]
#[test]
fn walk_unreadable_directory() {
    use std::os::unix::fs::PermissionsExt;
    let dir = fixture();
    let na = dir.path().join("na");
    fs::create_dir(&na).unwrap();
    write(dir.path(), "na/f");
    fs::set_permissions(&na, fs::Permissions::from_mode(0o000)).unwrap();
    let readable = fs::read_dir(&na).is_ok(); // running as root
    let o = opts(dir.path());
    let deep = walk("na/*", &o);
    let shallow = walk("*", &o);
    fs::set_permissions(&na, fs::Permissions::from_mode(0o755)).unwrap();
    if readable {
        return;
    }
    let err = deep.unwrap_err();
    assert_eq!(
        (err.code, err.syscall, err.path.as_str()),
        (Some("EACCES"), "open", "na")
    );
    assert_eq!(err.message, "EACCES: permission denied, open 'na'");
    assert_eq!(shallow.unwrap(), ["top"]);
}

/// Differential harness driven by experiments/issue-27/rust-glob-diff.mjs:
/// reads JSON lines from `$GLOB_DIFF_IN` and writes one result line per
/// case to `$GLOB_DIFF_OUT`.
#[test]
#[ignore = "driven by experiments/issue-27/rust-glob-diff.mjs"]
fn glob_diff_harness() {
    use serde_json::{json, Value};
    let (Ok(input), Ok(output)) = (
        std::env::var("GLOB_DIFF_IN"),
        std::env::var("GLOB_DIFF_OUT"),
    ) else {
        return;
    };
    if let Ok(cwd) = std::env::var("GLOB_DIFF_CWD") {
        std::env::set_current_dir(cwd).unwrap();
    }
    let text = fs::read_to_string(input).unwrap();
    let mut out = String::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let case: Value = serde_json::from_str(line).unwrap();
        let s = |k: &str| case[k].as_str().unwrap_or_default().to_string();
        let b = |k: &str| case[k].as_bool().unwrap_or_default();
        let result = match case["t"].as_str() {
            Some("m") => {
                let r = match_bytes(s("p").as_bytes(), s("s").as_bytes());
                json!({ "m": r.matches, "n": r.negated })
            }
            Some("h") => json!({ "h": has_glob_syntax(&s("p")) }),
            _ => {
                let o = WalkOptions {
                    cwd: s("cwd"),
                    dot: b("dot"),
                    absolute: b("absolute"),
                    follow_symlinks: b("followSymlinks"),
                    error_on_broken_symlinks: b("throwErrorOnBrokenSymlink"),
                    only_files: b("onlyFiles"),
                };
                match walk(&s("p"), &o) {
                    Ok(paths) => json!({ "ok": paths }),
                    Err(e) => json!({ "err": {
                        "code": e.code,
                        "syscall": e.code.map(|_| e.syscall),
                        "path": e.code.map(|_| e.path.clone()),
                        "errno": e.errno,
                        "message": e.message,
                    }}),
                }
            }
        };
        out.push_str(&result.to_string());
        out.push('\n');
    }
    fs::write(output, out).unwrap();
}
