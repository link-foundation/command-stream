//! Port of the zx dotenv tests (`test/goods.test.ts`, `dotenv` section) and
//! the envapi vectors used by the JS port, for `command_stream::zx::dotenv`.

use std::collections::BTreeMap;

use command_stream::zx::dotenv::{config, load, load_safe, parse, stringify};
use command_stream::zx::tempfile;

fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

// zx:test/goods.test.ts:369:5:registration
#[test]
fn parse_simple_and_multiline() {
    assert!(parse("").is_empty());
    assert_eq!(
        parse("ENV=v1\nENV2=v2\n\n\n  ENV3  =    v3   \nexport ENV4=v4"),
        map(&[
            ("ENV", "v1"),
            ("ENV2", "v2"),
            ("ENV3", "v3"),
            ("ENV4", "v4")
        ])
    );
    let multiline = "SIMPLE=xyz123
# comment ###
NON_INTERPOLATED='raw text without variable interpolation' 
MULTILINE = \"\"\"
long text here, # not-comment
e.g. a private SSH key
\"\"\"
ENV=v1\nENV2=v2\n\n\n\t\t  ENV3  =    v3   \n   export ENV4=v4
ENV5=v5 # comment
";
    assert_eq!(
        parse(multiline),
        map(&[
            ("SIMPLE", "xyz123"),
            (
                "NON_INTERPOLATED",
                "raw text without variable interpolation"
            ),
            (
                "MULTILINE",
                "long text here, # not-comment\ne.g. a private SSH key"
            ),
            ("ENV", "v1"),
            ("ENV2", "v2"),
            ("ENV3", "v3"),
            ("ENV4", "v4"),
            ("ENV5", "v5"),
        ])
    );
}

// zx:test/goods.test.ts:369:5:registration (envapi quoting vectors)
#[test]
fn parse_keeps_quoted_content_raw() {
    let text = [
        "A=\"double # not comment\"",
        "B='single'",
        "C=`back tick`",
        "D=\"multi",
        "line\"",
        "E=",
        "F=a#b",
        "G=\"\"\"inline triple\"\"\"",
    ]
    .join("\r\n");
    assert_eq!(
        parse(&text),
        map(&[
            ("A", "double # not comment"),
            ("B", "single"),
            ("C", "back tick"),
            ("D", "multi\nline"),
            ("E", ""),
            ("F", "a#b"),
            ("G", "inline triple"),
        ])
    );
}

// zx:test/goods.test.ts:369:5:registration (envapi stringify round-trip)
#[test]
fn stringify_round_trips_through_parse() {
    let env = map(&[
        ("PLAIN", "value"),
        ("SPACES", "with spaces"),
        ("HASH", "#hash"),
        ("SINGLE", "it's"),
        ("DOUBLE", "say \"hi\""),
        ("ALL", "`a` \"b\" 'c'"),
        ("MULTI", "line1\nline2\n"),
        ("LEADING", "  padded  "),
        ("EMPTY", ""),
        ("BACKSLASH", "back\\slash 'q'"),
    ]);
    let text = stringify(&env);
    assert!(text.lines().any(|l| l == "PLAIN=value"));
    assert_eq!(parse(&text), env);
}

// zx:test/goods.test.ts:408:7:registration
#[test]
fn load_merges_files_with_earlier_precedence() {
    let file1 = tempfile(Some(".env.1"), Some(b"ENV1=value1\nENV2=value2")).unwrap();
    let file2 = tempfile(Some(".env.2"), Some(b"ENV2=value222\nENV3=value3")).unwrap();
    let env = load(&[&file1, &file2]).unwrap();
    assert_eq!(env["ENV1"], "value1");
    assert_eq!(env["ENV2"], "value2");
    assert_eq!(env["ENV3"], "value3");
}

// zx:test/goods.test.ts:415:7:registration
#[test]
fn load_fails_on_missing_file() {
    let err = load(&["./.env.definitely-missing"]).unwrap_err();
    // ENOENT and Windows' ERROR_FILE_NOT_FOUND are both 2; the text differs.
    assert!(err.message().contains("(os error 2)"), "{}", err.message());
}

// zx:test/goods.test.ts:432:7:registration
#[test]
fn load_safe_skips_missing_files() {
    let file1 = tempfile(Some(".env.1"), Some(b"ENV1=value1\nENV2=value2")).unwrap();
    let env = load_safe(&[file1.as_path(), ".env.notexists".as_ref()]);
    assert_eq!(env, map(&[("ENV1", "value1"), ("ENV2", "value2")]));
}

// zx:test/goods.test.ts:440:7:registration
#[test]
fn config_overlays_process_env_without_mutating_it() {
    let key = "CS_ZX_DOTENV_CONFIG_ONLY_IN_FILE";
    let file = tempfile(
        Some(".env.1"),
        Some(format!("{key}=value1\nPATH=nope").as_bytes()),
    )
    .unwrap();
    let env = config(&[&file]);
    assert_eq!(env[key], "value1");
    // Windows spells it `Path`: env names are case-insensitive there.
    let path: Vec<&str> = env
        .iter()
        .filter(|(k, _)| {
            if cfg!(windows) {
                k.eq_ignore_ascii_case("PATH")
            } else {
                *k == "PATH"
            }
        })
        .map(|(_, v)| v.as_str())
        .collect();
    assert_eq!(path.len(), 1, "one PATH entry: {path:?}");
    assert_ne!(path[0], "nope", "process env wins over the file");
    assert!(std::env::var_os(key).is_none());
}
