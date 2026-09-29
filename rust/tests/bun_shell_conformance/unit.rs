//! Unit tests for the corpus helpers, independent of the interpreter. The
//! expected values (including the exact mismatch messages) were produced by
//! running the same inputs through `conformance/bun-shell/corpus.mjs`.

use crate::corpus::*;
use command_stream::bun_shell::ShellValue;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

fn ctx() -> Context {
    make_context(r"C:\t\x", "/usr/bin/node", "/")
}

fn mt(actual: &str, exp: Value) -> Result<(), String> {
    match_text(actual, Some(&exp), &ctx())
}

fn err(actual: &str, exp: Value) -> String {
    mt(actual, exp).expect_err("expected a mismatch")
}

// ---------------------------------------------------------------------------
// Placeholders and TEXT
// ---------------------------------------------------------------------------

#[test]
fn context_uses_forward_slashes_and_subst_replaces_every_placeholder() {
    let c = make_context(r"C:\t\x", r"C:\node\node.exe", r"\");
    assert_eq!(c.temp_dir, "C:/t/x");
    assert_eq!(c.node, "C:/node/node.exe");
    assert_eq!(
        subst("{{TEMP}}/a {{TEMP}}/b {{NODE}} x{{SEP}}y {{OTHER}}", &c),
        r"C:/t/x/a C:/t/x/b C:/node/node.exe x\y {{OTHER}}"
    );
    assert_eq!(subst("{{TEMP_NATIVE}}{{SEP}}a/b", &c), r"C:\t\x\a/b");
    assert_eq!(subst("{{TEMP_NATIVE_JSON}}", &c), r"C:\\t\\x");
    assert_eq!(subst_regex("^{{TEMP}}.+$", &c), r"^C:/t/x.+$");
    let dotted = make_context(r"C:\t.x", "node", r"\");
    assert_eq!(subst_regex("{{TEMP_NATIVE}}", &dotted), r"C:\\t\.x");
    assert_eq!(subst("{{TEMP_NATIVE}}", &ctx()), "C:/t/x");
}

#[test]
fn by_platform_picks_exact_platform_then_family_then_default() {
    let map = json!({"win32": "w", "posix": "p", "default": "d"});
    assert_eq!(for_platform(&map, "win32"), Ok(&json!("w")));
    assert_eq!(for_platform(&map, "darwin"), Ok(&json!("p")));
    let map = json!({"linux": "l", "default": "d"});
    assert_eq!(for_platform(&map, "darwin"), Ok(&json!("d")));
    assert_eq!(
        for_platform(&json!({"windows": "w"}), "linux"),
        Err("byPlatform has no entry for linux".to_string())
    );
    let mut c = ctx();
    c.platform = "win32".to_string();
    let exp = json!({"byPlatform": {"windows": {"contains": "C:"}, "posix": "/x"}});
    assert_eq!(match_text("C:/t", Some(&exp), &c), Ok(()));
    c.platform = "linux".to_string();
    assert_eq!(match_text("/x", Some(&exp), &c), Ok(()));
    assert_eq!(
        match_text("C:/t", Some(&exp), &c),
        Err(r#"expected "/x", got "C:/t""#.to_string())
    );
}

#[test]
fn text_expands_generators() {
    let c = ctx();
    assert_eq!(text(&json!("a{{TEMP}}"), &c).unwrap(), "aC:/t/x");
    assert_eq!(
        text(&json!({"repeat": "y\n", "count": 3}), &c).unwrap(),
        "y\ny\ny\n"
    );
    assert_eq!(text(&json!({"repeat": "ab"}), &c).unwrap(), "ab");
    assert_eq!(text(&json!({"repeat": "ab", "count": 0}), &c).unwrap(), "");
    assert_eq!(
        text(
            &json!({"concat": ["a", {"repeat": "b", "count": 2}, {"seq": [1, 3]}]}),
            &c
        )
        .unwrap(),
        "abb1\n2\n3\n"
    );
    assert_eq!(text(&json!({"seq": [-1, 1]}), &c).unwrap(), "-1\n0\n1\n");
    assert_eq!(text(&json!({"seq": [3, 1]}), &c).unwrap(), "");
    assert_eq!(
        text(&json!({"foo": 1}), &c).unwrap_err(),
        r#"invalid text spec: {"foo":1}"#
    );
    assert!(text(&json!(5), &c).is_err());
}

#[test]
fn node_join_normalizes_like_node_path_join() {
    // Like Node's `path.join`: on Windows every `/` becomes `\`.
    let p = |s: &str| s.replace('/', SEP);
    assert_eq!(node_join("/tmp/q", "f.txt"), p("/tmp/q/f.txt"));
    assert_eq!(node_join("/tmp/q", "sub/../f.txt"), p("/tmp/q/f.txt"));
    assert_eq!(node_join("/tmp/q", "d/./e"), p("/tmp/q/d/e"));
    assert_eq!(node_join("/tmp/q", "."), p("/tmp/q"));
    assert_eq!(node_join("/tmp/q", "a/"), p("/tmp/q/a/"));
    assert_eq!(node_join("/tmp/q", "../../../x"), p("/x"));
    assert_eq!(node_join("a", "../.."), "..");
    assert_eq!(node_join("", ""), ".");
    #[cfg(windows)]
    assert_eq!(node_join(r"C:\t", "a/b/../c"), r"C:\t\a\c");
}

// ---------------------------------------------------------------------------
// matchText
// ---------------------------------------------------------------------------

#[test]
fn match_text_exact_and_generators() {
    assert_eq!(match_text("", None, &ctx()), Ok(()));
    assert_eq!(
        match_text("x", None, &ctx()).unwrap_err(),
        r#"expected "", got "x""#
    );
    assert_eq!(mt("a\n", json!("a\n")), Ok(()));
    assert_eq!(err("b", json!("a")), r#"expected "a", got "b""#);
    assert_eq!(mt("yy", json!({"repeat": "y", "count": 2})), Ok(()));
    assert_eq!(mt("C:/t/x/f", json!("{{TEMP}}/f")), Ok(()));
    assert_eq!(mt("1\n2\n3\n", json!({"seq": [1, 3]})), Ok(()));
    assert_eq!(
        mt(
            "abc",
            json!({"concat": ["a", {"repeat": "b", "count": 1}, "c"]})
        ),
        Ok(())
    );
}

#[test]
fn match_text_show_truncates_long_values() {
    let long = "x".repeat(500);
    assert_eq!(
        err(&long, json!("y")),
        format!(r#"expected "y", got "{}...(500 chars)"#, "x".repeat(399))
    );
    // The cut is at 400 units of the JSON literal (quotes and escapes count).
    let fits = "x".repeat(398);
    assert_eq!(show(&fits), format!("\"{fits}\""));
    assert_eq!(
        show(&"x".repeat(399)),
        format!("\"{}...(399 chars)", "x".repeat(399))
    );
    assert_eq!(
        show(&"\n".repeat(300)),
        format!("\"{}\\...(300 chars)", "\\n".repeat(199))
    );
}

#[test]
fn match_text_any_all_one() {
    assert_eq!(mt("anything", json!({"any": true})), Ok(()));
    assert_eq!(
        err("x", json!({"any": false})),
        r#"unknown text expectation {"any":false}"#
    );
    assert_eq!(
        err(
            "hello",
            json!({"allOf": [{"contains": "he"}, {"contains": "zz"}, {"contains": "qq"}]})
        ),
        r#"expected to contain "zz", got "hello""#
    );
    assert_eq!(
        err("hello", json!({"oneOf": ["x", {"contains": "q"}]})),
        r#"none of oneOf matched: expected "x", got "hello" | expected to contain "q", got "hello""#
    );
    assert_eq!(
        mt("hello", json!({"oneOf": ["x", {"contains": "ll"}]})),
        Ok(())
    );
}

#[test]
fn match_text_contains_forms() {
    assert_eq!(mt("hello", json!({"contains": ["he", "lo"]})), Ok(()));
    assert_eq!(
        err("hello", json!({"contains": "he", "notContains": "ll"})),
        r#"expected NOT to contain "ll", got "hello""#
    );
    // `contains` without `notContains` decides alone (other keys are ignored).
    assert_eq!(
        mt("hello", json!({"contains": "he", "regex": "zzz"})),
        Ok(())
    );
    assert_eq!(
        err("hello", json!({"notContains": ["x", "l"]})),
        r#"expected NOT to contain "l", got "hello""#
    );
    assert_eq!(mt("C:/t/x/a", json!({"contains": "{{TEMP}}"})), Ok(()));
}

#[test]
fn match_text_regex_follows_javascript_semantics() {
    assert_eq!(
        err("a\nb", json!({"regex": "a.b"})),
        r#"expected to match /a.b/, got "a\nb""#
    );
    assert_eq!(mt("a\nb", json!({"regex": "a.b", "flags": "s"})), Ok(()));
    assert_eq!(mt("ABC", json!({"regex": "^abc$", "flags": "i"})), Ok(()));
    // Backreferences.
    let backref = json!({"regex": "^(.*) \\1(?:0)\\n$", "flags": "s"});
    assert_eq!(mt("x x0\n", backref.clone()), Ok(()));
    assert_eq!(
        err("x y0\n", backref),
        r#"expected to match /^(.*) \1(?:0)\n$/s, got "x y0\n""#
    );
    // Without the m flag, `$` does not match before a final newline.
    assert_eq!(
        err("a\n", json!({"regex": "^a$"})),
        r#"expected to match /^a$/, got "a\n""#
    );
    // Placeholders are substituted in the pattern, not in the message.
    assert_eq!(
        mt(
            "C:/t/x/file1.txt\n",
            json!({"regex": "^{{TEMP}}/file[0-9]+\\.txt\\n$"})
        ),
        Ok(())
    );
    assert!(err("x", json!({"regex": "("})).starts_with("invalid regex /(/"));
}

#[test]
fn match_text_prefix_suffix_length() {
    assert_eq!(
        mt("abcdef", json!({"startsWith": "ab", "endsWith": "ef"})),
        Ok(())
    );
    assert_eq!(
        err("abcdef", json!({"startsWith": "ab", "endsWith": "x"})),
        r#"expected to end with "x", got "abcdef""#
    );
    assert_eq!(
        err("abcdef", json!({"startsWith": "ab", "length": 5})),
        r#"expected length 5, got 6: "abcdef""#
    );
    assert_eq!(
        err("abc", json!({"startsWith": "x"})),
        r#"expected to start with "x", got "abc""#
    );
    assert_eq!(mt("abc", json!({"endsWith": "c", "length": 3})), Ok(()));
    assert_eq!(
        err("abc", json!({"endsWith": "b"})),
        r#"expected to end with "b", got "abc""#
    );
    assert_eq!(
        mt(
            "ab",
            json!({"startsWith": {"repeat": "a", "count": 1}, "endsWith": {"concat": ["b"]}})
        ),
        Ok(())
    );
    // JavaScript lengths count UTF-16 code units.
    assert_eq!(mt("é😀", json!({"length": 3})), Ok(()));
    assert_eq!(
        err("é😀", json!({"length": 2})),
        r#"expected length 2, got 3: "é😀""#
    );
}

#[test]
fn match_text_lines() {
    assert_eq!(mt("b\n\na\n", json!({"sortedLines": ["a", "b"]})), Ok(()));
    assert_eq!(
        err("b\na\n", json!({"sortedLines": ["a"]})),
        r#"expected sorted lines ["a"], got ["a","b"]"#
    );
    // Sorted by UTF-16 code units like Array.prototype.sort.
    assert_eq!(
        mt(
            "\u{ff61}\n\u{1f600}\n",
            json!({"sortedLines": ["\u{1f600}", "\u{ff61}"]})
        ),
        Ok(())
    );
    assert_eq!(mt("a\n\nb\n", json!({"lineCount": 2})), Ok(()));
    assert_eq!(
        err("a\n", json!({"lineCount": 2})),
        r#"expected 2 lines, got 1: "a\n""#
    );
    assert_eq!(
        err("x", json!({"bogus": 1})),
        r#"unknown text expectation {"bogus":1}"#
    );
}

#[test]
fn match_exit_forms() {
    assert_eq!(match_exit(Some(0), &json!(0)), Ok(()));
    assert_eq!(
        match_exit(Some(1), &json!(0)).unwrap_err(),
        "expected exitCode 0, got 1"
    );
    assert_eq!(
        match_exit(None, &json!(1)).unwrap_err(),
        "expected exitCode 1, got undefined"
    );
    assert_eq!(match_exit(Some(1), &json!({"not": 0})), Ok(()));
    assert_eq!(match_exit(None, &json!({"not": 0})), Ok(()));
    assert_eq!(
        match_exit(Some(0), &json!({"not": 0})).unwrap_err(),
        "expected exitCode != 0, got 0"
    );
    assert_eq!(match_exit(Some(2), &json!({"oneOf": [1, 2]})), Ok(()));
    assert_eq!(
        match_exit(Some(3), &json!({"oneOf": [1, 2]})).unwrap_err(),
        "expected exitCode in [1,2], got 3"
    );
    assert_eq!(match_exit(Some(7), &json!({"any": true})), Ok(()));
    assert_eq!(
        match_exit(Some(7), &json!({"what": 1})).unwrap_err(),
        r#"unknown exitCode expectation {"what":1}"#
    );
}

// ---------------------------------------------------------------------------
// checkExpectations
// ---------------------------------------------------------------------------

fn ok_result(dir: &Path) -> RunResult {
    RunResult {
        temp_dir: dir.to_path_buf(),
        node: "node".into(),
        sep: "/".into(),
        stdout: Some(Vec::new()),
        stderr: Some(Vec::new()),
        exit_code: Some(0),
        ..RunResult::default()
    }
}

fn errored(message: &str) -> RunResult {
    RunResult {
        error: Some(message.into()),
        ..RunResult::default()
    }
}

fn check(expect: Value, result: &RunResult) -> Vec<String> {
    check_expectations(&json!({ "expect": expect }), result)
}

#[test]
fn check_without_error_defaults_to_empty_output_and_exit_zero() {
    let dir = Path::new("/nonexistent");
    assert!(check(json!({}), &ok_result(dir)).is_empty());
    let mut r = ok_result(dir);
    r.stdout = Some(b"x".to_vec());
    r.exit_code = Some(1);
    assert_eq!(
        check(json!({}), &r),
        [
            r#"stdout: expected "", got "x""#,
            "exitCode: expected exitCode 0, got 1"
        ]
    );
    // `exitCode: null` means 0, `error: false` means "no error expected".
    assert!(check(json!({"exitCode": null}), &ok_result(dir)).is_empty());
    assert!(check(json!({"error": false}), &ok_result(dir)).is_empty());
    // Output is decoded as lossy UTF-8.
    r = ok_result(dir);
    r.stdout = Some(vec![0xff, b'a']);
    assert_eq!(
        check(json!({}), &r),
        ["stdout: expected \"\", got \"\u{fffd}a\""]
    );
}

#[test]
fn check_unexpected_error_skips_output_checks() {
    let mut r = errored("boom");
    r.stdout = Some(b"q".to_vec());
    assert_eq!(
        check(json!({"stdout": "x"}), &r),
        ["unexpected error thrown: boom"]
    );
}

#[test]
fn check_expected_errors() {
    let mut r = ok_result(Path::new("/nonexistent"));
    r.stdout = Some(b"o".to_vec());
    r.stderr = Some(b"e".to_vec());
    assert_eq!(
        check(json!({"error": true}), &r),
        [r#"expected an error to be thrown, but none was (exitCode 0, stdout "o", stderr "e")"#]
    );
    assert!(check(json!({"error": true}), &errored("parse")).is_empty());
    assert!(check(json!({"error": "Unexpected"}), &errored("Unexpected EOF")).is_empty());
    assert_eq!(
        check(json!({"error": "Unexpected"}), &errored("bad")),
        [r#"error message: expected to contain "Unexpected", got "bad""#]
    );
    // An Exit error carries the output, checked only where given.
    let mut r = errored("Failed with exit code 1");
    r.exit_code = Some(1);
    r.stdout = Some(b"hi\n".to_vec());
    r.stderr = Some(b"e".to_vec());
    assert!(check(
        json!({"error": {"regex": "^Failed with exit code 1$"}, "exitCode": 1, "stdout": "hi\n"}),
        &r
    )
    .is_empty());
    assert_eq!(
        check(json!({"error": true, "exitCode": 1}), &errored("x")),
        ["exitCode: expected exitCode 1, got undefined"]
    );
    assert_eq!(
        check(json!({"error": true, "stderr": "boom"}), &errored("x")),
        [r#"stderr: expected "boom", got """#]
    );
}

#[test]
fn check_files_and_buffers() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    fs::create_dir(dir.join("d")).unwrap();
    fs::write(dir.join("a.txt"), "hello\n").unwrap();
    let mut r = ok_result(dir);
    r.buffers.insert("b1".into(), b"hi\n\0\0\0".to_vec());
    assert!(check(
        json!({
            "files": {"a.txt": "hello\n", "./d/../a.txt": {"contains": "ell"}},
            "exists": ["a.txt", "d"],
            "absent": ["nope"],
            "types": {"a.txt": "file", "d": "dir"},
            "buffers": {"b1": "hi\n"},
        }),
        &r
    )
    .is_empty());
    assert_eq!(
        check(
            json!({
                "files": {"a.txt": "x", "missing.txt": "x"},
                "exists": ["nope"],
                "absent": ["."],
                "types": {"t": "dir", "d": "file"},
                "buffers": {"b1": "ho\n", "b2": "x"},
            }),
            &r
        ),
        [
            r#"file a.txt: expected "x", got "hello\n""#,
            "file missing.txt: cannot read (ENOENT)",
            "expected nope to exist",
            "expected . to NOT exist",
            "expected d to be a file, got dir",
            "expected t to be a dir, but it does not exist",
            r#"buffer b1: expected "ho\n", got "hi\n""#,
            "buffer b2 missing",
        ]
    );
}

#[cfg(unix)]
#[test]
fn check_types_does_not_follow_symlinks() {
    let tmp = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink("missing", tmp.path().join("l")).unwrap();
    let r = ok_result(tmp.path());
    assert!(check(json!({"types": {"l": "symlink"}, "exists": ["l"]}), &r).is_empty());
    assert_eq!(
        check(json!({"absent": ["l"]}), &r),
        ["expected l to NOT exist"]
    );
}

// ---------------------------------------------------------------------------
// skipReason
// ---------------------------------------------------------------------------

#[test]
fn skip_reason_platforms_languages_requires() {
    let yes = |_: &str| true;
    let sr = |c: Value, platform: &str| skip_reason(&c, platform, "rust", yes);
    assert_eq!(
        sr(json!({"platforms": ["windows"]}), "linux").as_deref(),
        Some("platform linux not in windows")
    );
    assert_eq!(sr(json!({"platforms": ["posix"]}), "darwin"), None);
    assert_eq!(
        sr(json!({"platforms": ["darwin", "windows"]}), "linux").as_deref(),
        Some("platform linux not in darwin,windows")
    );
    assert_eq!(sr(json!({"platforms": ["windows"]}), "win32"), None);
    assert_eq!(
        sr(json!({"platforms": ["posix"]}), "win32").as_deref(),
        Some("platform win32 not in posix")
    );
    assert_eq!(sr(json!({"platforms": ["linux"]}), "linux"), None);
    assert_eq!(
        sr(json!({"languages": ["js"]}), "linux").as_deref(),
        Some("language rust not in js")
    );
    let only_sh = |b: &str| b == "sh";
    assert_eq!(
        skip_reason(
            &json!({"requires": ["node", "mkfifo", "sh"]}),
            "linux",
            "rust",
            only_sh
        )
        .as_deref(),
        Some("requires mkfifo")
    );
    assert_eq!(
        skip_reason(
            &json!({"requires": ["node"]}),
            "linux",
            "rust",
            |_: &str| false
        ),
        None
    );
}

#[test]
fn uses_node_detects_placeholders_and_requires() {
    assert!(uses_node(
        &json!({"template": ["", " -e 1"], "values": [{"string": "{{NODE}}"}]})
    ));
    assert!(uses_node(&json!({"template": ["{{NODE}} -e 1"]})));
    assert!(uses_node(&json!({"template": ["x"], "requires": ["node"]})));
    assert!(!uses_node(
        &json!({"template": ["echo"], "note": "{{NODE}} in a note"})
    ));
}

// ---------------------------------------------------------------------------
// materialize / setupFiles
// ---------------------------------------------------------------------------

#[test]
fn materialize_converts_every_value_kind() {
    let temp = Path::new("/tmp/q");
    let c = make_context("/tmp/q", "/n/node", "/");
    let case = json!({
        "id": "x",
        "template": ["a ", "{{TEMP}} ", " ", " ", " ", " ", " ", " ", ""],
        "values": [
            {"string": {"repeat": "ab", "count": 2}, "repeat": 2},
            {"path": "sub/../f.txt"},
            {"array": [{"number": 1.5}, {"bigint": "53"}, {"raw": "{{NODE}} |"}]},
            {"bool": true},
            {"null": true},
            {"undefined": true},
            {"bytes": "in{{SEP}}put"},
            {"outBuffer": {"id": "b1", "size": 4}},
        ],
        "env": {"P": "{{TEMP}}/bin"},
        "cwd": "d/./e",
    });
    let m = materialize(&case, temp, &c).unwrap();
    assert_eq!(
        m.strings,
        ["a ", "/tmp/q ", " ", " ", " ", " ", " ", " ", ""]
    );
    assert_eq!(m.env, [("P".to_string(), "/tmp/q/bin".to_string())]);
    assert_eq!(m.cwd, PathBuf::from(node_join("/tmp/q", "d/e")));
    assert_eq!(m.values.len(), 8);
    assert!(matches!(&m.values[0], ShellValue::Str(s) if s == "abababab"));
    assert!(matches!(&m.values[1], ShellValue::Str(s) if s == "/tmp/q/f.txt"));
    match &m.values[2] {
        ShellValue::Array(items) => {
            assert!(matches!(items[0], ShellValue::Number(n) if n == 1.5));
            assert!(matches!(&items[1], ShellValue::BigInt(s) if s == "53"));
            assert!(matches!(&items[2], ShellValue::Raw(s) if s == "/n/node |"));
        }
        other => panic!("expected an array, got {other:?}"),
    }
    assert!(matches!(m.values[3], ShellValue::Bool(true)));
    assert!(matches!(m.values[4], ShellValue::Null));
    assert!(matches!(m.values[5], ShellValue::Undefined));
    assert!(matches!(&m.values[6], ShellValue::Bytes(b) if b == b"in/put"));
    match &m.values[7] {
        ShellValue::OutBuffer(b) => {
            assert_eq!(b.contents(), vec![0; 4]);
            assert!(b.ptr_eq(&m.buffers["b1"]));
        }
        other => panic!("expected an outBuffer, got {other:?}"),
    }
    // Without cwd the temp dir is used.
    let m = materialize(&json!({"template": ["x"]}), temp, &c).unwrap();
    assert_eq!(m.cwd, temp);
    assert!(m.env.is_empty() && m.values.is_empty());
}

#[test]
fn materialize_rejects_bad_values() {
    let c = make_context("/t", "node", "/");
    let t = Path::new("/t");
    assert_eq!(
        materialize(&json!({"id": "y", "template": ["a", "b"]}), t, &c).unwrap_err(),
        "case y: values.length (0) must be template.length-1 (1)"
    );
    for kind in ["response", "blob", "jsfile"] {
        let case = json!({"id": "z", "template": ["", ""], "values": [{kind: "body"}]});
        let e = materialize(&case, t, &c).unwrap_err();
        assert!(e.contains("JS-only"), "{e}");
    }
    let case = json!({"id": "z", "template": ["", ""], "values": [{"what": 1}]});
    assert_eq!(
        materialize(&case, t, &c).unwrap_err(),
        r#"unknown value kind: {"what":1}"#
    );
}

#[test]
fn setup_files_creates_dirs_files_modes_and_symlinks() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let c = make_context(&dir.to_string_lossy(), "node", SEP);
    let mut case = json!({
        "dirs": ["empty/nested"],
        "files": {
            "a/b/plain.txt": "at {{TEMP}}",
            "gen.txt": {"repeat": "y\n", "count": 2},
            "cat.txt": {"concat": ["a", "b"]},
            "run.sh": {"content": "#!/bin/sh\n", "mode": "755"},
        },
    });
    if cfg!(unix) {
        case["files"]["link"] = json!({"symlink": "a/b/plain.txt"});
    }
    setup_files(&case, dir, &c).unwrap();
    assert!(dir.join("empty/nested").is_dir());
    assert_eq!(
        fs::read_to_string(dir.join("a/b/plain.txt")).unwrap(),
        format!("at {}", c.temp_dir)
    );
    assert_eq!(fs::read_to_string(dir.join("gen.txt")).unwrap(), "y\ny\n");
    assert_eq!(fs::read_to_string(dir.join("cat.txt")).unwrap(), "ab");
    assert_eq!(
        fs::read_to_string(dir.join("run.sh")).unwrap(),
        "#!/bin/sh\n"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.join("run.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
        assert_eq!(
            fs::read_link(dir.join("link")).unwrap(),
            PathBuf::from("a/b/plain.txt")
        );
    }
}

// ---------------------------------------------------------------------------
// The corpus itself
// ---------------------------------------------------------------------------

/// Every case loads, has a unique id, materializes (unless JS-only), and uses
/// only EXPECT/exitCode forms and regexes that this checker understands.
#[test]
fn corpus_is_well_formed_for_the_rust_checker() {
    let cases = all_cases(&cases_dir()).unwrap();
    assert!(cases.len() > 1000, "only {} cases loaded", cases.len());
    let mut ids = HashSet::new();
    let temp = std::env::temp_dir().join("bunshell-conf-check");
    let c = make_context(&temp.to_string_lossy(), "/usr/bin/node", SEP);
    let unknown = |r: Result<(), String>| {
        r.err().filter(|e| {
            e.starts_with("unknown text expectation")
                || e.starts_with("invalid regex")
                || e.starts_with("unsupported regex flag")
                || e.starts_with("invalid text spec")
        })
    };
    let mut problems = Vec::new();
    for case in &cases {
        let d = &case.data;
        let id = case.id();
        assert!(ids.insert(id.to_string()), "duplicate case id {id}");
        if skip_reason(d, "linux", "rust", |_: &str| true).is_none()
            || skip_reason(d, "win32", "rust", |_: &str| true).is_none()
        {
            if let Err(e) = materialize(d, &temp, &c) {
                problems.push(format!("{id}: {e}"));
            }
        }
        for step in d
            .get("setup")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Err(e) = materialize_template(step, &c, &mut HashMap::new()) {
                problems.push(format!("{id}: setup: {e}"));
            }
        }
        let exp = &d["expect"];
        let mut texts: Vec<(&str, &Value)> = Vec::new();
        for key in ["stdout", "stderr"] {
            if let Some(v) = exp.get(key) {
                texts.push((key, v));
            }
        }
        if let Some(e) = exp.get("error").filter(|e| e.is_object()) {
            texts.push(("error", e));
        }
        for key in ["files", "buffers"] {
            for (_, v) in exp
                .get(key)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
            {
                texts.push((key, v));
            }
        }
        for (key, v) in texts {
            if let Some(e) = unknown(match_text("", Some(v), &c)) {
                problems.push(format!("{id}: {key}: {e}"));
            }
        }
        if let Some(code) = exp.get("exitCode") {
            if let Err(e) = match_exit(Some(0), code) {
                if e.starts_with("unknown") {
                    problems.push(format!("{id}: exitCode: {e}"));
                }
            }
        }
        for (_, kind) in exp
            .get("types")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if !matches!(kind.as_str(), Some("file" | "dir" | "symlink")) {
                problems.push(format!("{id}: unknown type {kind}"));
            }
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The JS-only value kinds only appear in `languages: ["js"]` cases, so the
/// Rust runner can always skip them instead of failing.
#[test]
fn js_only_values_are_marked_js_only() {
    for case in all_cases(&cases_dir()).unwrap() {
        let s = serde_json::to_string(&case.data["values"]).unwrap();
        let js_only = ["\"response\"", "\"blob\"", "\"jsfile\""]
            .iter()
            .any(|k| s.contains(k));
        if js_only {
            assert!(
                skip_reason(&case.data, "linux", "rust", |_: &str| true).is_some(),
                "{} uses a JS-only value but runs for rust",
                case.id()
            );
        }
    }
}
