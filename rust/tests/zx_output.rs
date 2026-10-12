//! Port of the zx `ProcessOutput` unit tests (`test/core.test.js`,
//! `describe('ProcessOutput')`) for `command_stream::zx::ProcessOutput`.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use command_stream::zx::error::{format_error_message, format_exit_message};
use command_stream::zx::{ErrorInfo, ProcessOutput};

fn plain(stdall: &str) -> ProcessOutput {
    ProcessOutput::new(None, None, "", "", stdall)
}

// zx:test/core.test.js:1455:5:registration
#[test]
fn getters() {
    let mut o = ProcessOutput::new(Some(-1), Some("SIGTERM"), "", "", "foo\n")
        .with_duration(Duration::from_millis(20));
    o.error = Some(ErrorInfo::new("msg"));
    assert_eq!(o.stdout, "");
    assert_eq!(o.stderr, "");
    assert_eq!(o.stdall, "foo\n");
    assert_eq!(o.signal.as_deref(), Some("SIGTERM"));
    assert_eq!(o.exit_code, Some(-1));
    assert_eq!(o.duration, Duration::from_millis(20));
    assert!(!o.ok());
    assert_eq!(
        o.message(),
        "msg\n    errno: undefined (Unknown error)\n    code: undefined\n    at "
    );

    let o1 =
        ProcessOutput::new(Some(-1), None, "", "", "error in stdout").with_from("file.js(12:34)");
    assert_eq!(
        o1.message(),
        "\n    at file.js(12:34)\n    exit code: -1\n    details: \nerror in stdout"
    );
}

// zx:test/core.test.js:1486:5:registration
#[test]
fn to_primitive_is_trimmed_output() {
    let o = ProcessOutput::new(Some(-1), Some("SIGTERM"), "", "", "foo\n");
    assert_eq!(o.value_of(), "foo");
    assert!(o.value_of().parse::<f64>().is_err());
}

// zx:test/core.test.js:1493:5:registration
#[test]
fn to_string_is_stdall() {
    assert_eq!(plain("foo\n").to_string(), "foo\n");
    let mixed = ProcessOutput::new(Some(0), None, "out\n", "err\n", "out\nerr\n");
    assert_eq!(format!("{mixed}"), "out\nerr\n");
}

// zx:test/core.test.js:1498:5:registration
#[test]
fn value_of() {
    assert_eq!(plain("foo\n").value_of(), "foo");
}

// zx:test/core.test.js:1504:5:registration
#[test]
fn json() {
    let parsed: HashMap<String, String> = plain("{\"key\":\"value\"}").json().unwrap();
    assert_eq!(parsed["key"], "value");
    assert!(plain("not json").json::<serde_json::Value>().is_err());
}

// zx:test/core.test.js:1509:5:registration
#[test]
fn text() {
    let o = plain("foo\n");
    assert_eq!(o.text(), "foo\n");
    assert_eq!(o.text_hex(), "666f6f0a");
}

// zx:test/core.test.js:1515:5:registration
#[test]
fn lines() {
    assert_eq!(plain("foo\nbar\r\nbaz\n").lines(), ["foo", "bar", "baz"]);
    let o2 = plain("foo\0bar\0baz\0");
    assert_eq!(o2.lines(), ["foo\0bar\0baz\0"]);
    assert_eq!(o2.lines_with("\0"), ["foo", "bar", "baz"]);
    assert!(plain("").lines().is_empty());
}

// zx:test/core.test.js:1524:5:registration
#[test]
fn buffer() {
    assert_eq!(plain("foo\n").buffer(), b"foo\n");
}

// zx:test/core.test.js:1539:5:registration
#[test]
fn iterator() {
    let o = plain("foo\nbar\nbaz");
    let mut lines = Vec::new();
    for line in &o {
        lines.push(line);
    }
    assert_eq!(lines, ["foo", "bar", "baz"]);
    assert_eq!(o.lines(), ["foo", "bar", "baz"]);
    assert_eq!((&o).into_iter().collect::<Vec<_>>(), ["foo", "bar", "baz"]);
}

// zx:test/core.test.js:1556:7:registration
#[test]
fn static_exit_message() {
    assert!(format_exit_message(Some(2), None, "", "", "").contains("Misuse of shell builtins"));
    let o = ProcessOutput::new(Some(2), None, "", "", "");
    assert!(o.message().contains("Misuse of shell builtins"));
    assert_eq!(o.exit_code_info(), Some("Misuse of shell builtins"));
}

// zx:test/core.test.js:1563:7:registration
#[test]
fn static_error_message() {
    assert!(format_error_message("", Some(-2), None, "").contains("No such file or directory"));
    assert!(format_error_message("", Some(-1_000_000_000), None, "").contains("Unknown error"));
    assert!(format_error_message("", None, None, "").contains("Unknown error"));
    let io = std::io::Error::from_raw_os_error(2);
    let o = ProcessOutput::from_error(ErrorInfo::from_io(&io), "cmd");
    assert!(o.message().contains("No such file or directory"));
    assert!(o.message().contains("code: ENOENT"));
    assert!(!o.ok());
}

// zx:test/core.test.js:1652:5:registration (ProcessOutput as a path)
#[test]
fn as_path() {
    let o = plain("/tmp/some dir\n");
    let p: &Path = o.as_ref();
    assert_eq!(p, Path::new("/tmp/some dir"));
}
