//! Integration tests for the `$fy` translator.
//!
//! The golden fixture in `fixtures/fy/` is shared with the JavaScript suite
//! (`js/tests/fy-tool.test.mjs`), so both implementations are pinned to the
//! same bytes and cannot drift apart.

use std::path::PathBuf;

use command_stream::fy::{translate_shell_to_mjs, TranslateOptions};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/fy")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {path:?}: {error}"))
}

#[test]
fn reproduces_the_shared_golden_fixture() {
    let translation = translate_shell_to_mjs(&fixture("sample.sh"), &TranslateOptions::default());

    assert_eq!(translation.diagnostics, Vec::<String>::new());
    assert_eq!(translation.code, fixture("sample.mjs"));
}

#[test]
fn translates_every_construct_of_the_fixture_structurally() {
    let translation = translate_shell_to_mjs(&fixture("sample.sh"), &TranslateOptions::default());
    let code = translation.code;

    for expected in [
        "import { $, shell } from 'command-stream';",
        "const args = process.argv.slice(2);",
        "async function deploy(...args) {",
        "for (const env of [`staging`, `prod`]) {",
        "switch (`${TARGET}`) {",
        "process.exit(0);",
    ] {
        assert!(code.contains(expected), "missing {expected:?} in:\n{code}");
    }
}
