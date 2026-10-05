//! Port of the zx `test/util.test.js` suite for `command_stream::zx::util`.

use std::collections::HashSet;
use std::time::Duration;

use command_stream::zx::util::{
    build_cmd, duration_from_millis, parse_bool, parse_duration, prefer_local_bin, quote,
    quote_powershell, random_id, split_template, to_camel_case, zx_arg, PATH_DELIMITER,
};
use command_stream::zx::ZxArg;

const ALLOWED: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/.-+@:=,%";

// zx:test/util.test.js:35:3:registration
#[test]
fn random_id_is_lowercase_alphanumeric_and_unique() {
    let id = random_id();
    assert!(!id.is_empty());
    assert!(id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    let ids: HashSet<String> = (0..1000).map(|_| random_id()).collect();
    assert_eq!(ids.len(), 1000);
}

// zx:test/util.test.js:70:3:registration
#[test]
fn quote_bash() {
    assert_eq!(quote("string"), "string");
    assert_eq!(quote(""), "$''");
    assert_eq!(quote("'\x0c\n\r\t\x0b\0"), "$'\\'\\f\\n\\r\\t\\v\\0'");
    assert_eq!(quote(ALLOWED), ALLOWED);
}

// zx:test/util.test.js:80:3:registration
#[test]
fn quote_powershell_values() {
    assert_eq!(quote_powershell("string"), "string");
    assert_eq!(quote_powershell("'"), "''''");
    assert_eq!(quote_powershell(""), "''");
    assert_eq!(quote_powershell(ALLOWED), ALLOWED);
}

// zx:test/util.test.js:90:3:registration
#[test]
fn duration_parsing_works() {
    assert_eq!(duration_from_millis(0.0).unwrap(), Duration::ZERO);
    assert_eq!(
        duration_from_millis(1000.0).unwrap(),
        Duration::from_millis(1000)
    );
    assert_eq!(parse_duration("100").unwrap(), Duration::from_millis(100));
    assert_eq!(parse_duration("2s").unwrap(), Duration::from_millis(2000));
    assert_eq!(parse_duration("500ms").unwrap(), Duration::from_millis(500));
    assert_eq!(
        parse_duration("2m").unwrap(),
        Duration::from_millis(120_000)
    );
    assert!(parse_duration("f2ms").is_err());
    assert!(parse_duration("2mss").is_err());
    assert!(duration_from_millis(f64::NAN).is_err());
    assert!(duration_from_millis(-1.0).is_err());
}

// zx:test/util.test.js:103:6:registration
#[test]
fn multiline_pieces_are_kept_verbatim() {
    let cmd = build_cmd(
        quote,
        &[" a ", "b    c    d", " e"],
        &[zx_arg("x"), zx_arg("y")],
    )
    .unwrap();
    assert_eq!(cmd, " a xb    c    dy e");
}

// zx:test/util.test.js:103:6:registration
#[test]
fn build_cmd_rejects_mismatched_pieces_and_expands_lists() {
    assert!(build_cmd(quote, &["echo ", ""], &[]).is_err());
    let many = ZxArg::Many(vec!["a b".into(), "c".into()]);
    assert_eq!(
        build_cmd(quote, &["echo ", ""], &[many]).unwrap(),
        "echo $'a b' c"
    );
    assert_eq!(split_template("echo {} {{}} {}"), ["echo ", " {} ", ""]);
}

// zx:test/util.test.js:110:3:registration
#[test]
fn prefer_local_bin_prepends_local_dirs() {
    let cwd = std::env::current_dir().unwrap();
    let path = ["/usr/bin", "/bin", "/usr/local/bin"].join(PATH_DELIMITER);
    let expected = [
        cwd.join("node_modules")
            .join(".bin")
            .to_string_lossy()
            .into_owned(),
        cwd.to_string_lossy().into_owned(),
        path.clone(),
    ]
    .join(PATH_DELIMITER);
    assert_eq!(prefer_local_bin(Some(&path), &[&cwd]), expected);
}

// zx:test/util.test.js:121:3:registration
#[test]
fn to_camel_case_values() {
    assert_eq!(to_camel_case("VERBOSE"), "verbose");
    assert_eq!(to_camel_case("PREFER_LOCAL"), "preferLocal");
    assert_eq!(to_camel_case("SOME_MORE_BIG_STR"), "someMoreBigStr");
    assert_eq!(to_camel_case("kebab-input-str"), "kebabInputStr");
}

// zx:test/util.test.js:128:3:registration
#[test]
fn parse_bool_values() {
    assert_eq!(parse_bool("true"), Some(true));
    assert_eq!(parse_bool("false"), Some(false));
    assert_eq!(parse_bool("other"), None);
}
