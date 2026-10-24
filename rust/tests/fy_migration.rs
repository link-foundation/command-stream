use command_stream::fy::{translate_source, SourceOptions};

#[test]
fn preserves_literal_braces_in_custom_module_names() {
    let result = translate_source(
        "import x from \"zx\";",
        &SourceOptions {
            from: "javascript".into(),
            module_name: "./{local}".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(result.code, "import x from \"./{local}/zx\";");
    assert!(result.diagnostics.is_empty());
}

#[test]
fn matches_the_shared_default_shell_program_fixture() {
    let source = include_str!("../../fixtures/fy/sample.sh");
    let expected = include_str!("../../fixtures/fy/sample-program.mjs");
    assert_eq!(
        translate_source(source, &SourceOptions::default())
            .unwrap()
            .code,
        expected
    );
}

#[tokio::test]
async fn virtual_fy_is_a_literal_command_name() {
    let result = command_stream::run("$fy --help").await.unwrap();
    assert_eq!(result.code, 0);
    assert!(result.stdout.contains("Usage:"));
}

#[test]
fn native_cli_migrates_javascript_stdin() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new(env!("CARGO_BIN_EXE_command-stream"))
        .args(["fy", "--from", "zx", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"import { $ } from 'zx';")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "import { $ } from \"command-stream/zx\";"
    );
}

#[test]
fn native_cli_retains_shell_script_basename() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("original.sh");
    std::fs::write(&input, "printf '%s' \"$0\"").unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_command-stream"))
        .arg("fy")
        .arg(input)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("'-c', source, \"original.sh\""));
}

#[test]
fn leaves_locally_bound_require_and_unrelated_modules_intact() {
    let source = "function local(require) { return require(\"zx\"); }\nimport x from \"toString\"; import y from \"__proto__\";";
    let result = translate_source(
        source,
        &SourceOptions {
            from: "javascript".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(result.code, source);
    assert!(result
        .diagnostics
        .join("\n")
        .contains("locally bound require"));
}

#[test]
fn decodes_escaped_specifiers_and_detects_commonjs_filenames() {
    let source = r"const sh = require('shell\x6as');";
    let result = translate_source(
        source,
        &SourceOptions {
            filename: "source.cjs".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(result.code.contains("require(\"command-stream/shelljs\")"));
    assert!(result.code.contains("export default __fyModule.exports"));
}

#[test]
fn migrates_the_shared_competitor_fixture() {
    let options = SourceOptions {
        from: "javascript".into(),
        ..Default::default()
    };
    let translation =
        translate_source(include_str!("../../fixtures/fy/competitors.js"), &options).unwrap();
    assert_eq!(
        translation.code,
        include_str!("../../fixtures/fy/competitors.mjs")
    );
    assert!(translation.diagnostics.is_empty());
}

#[test]
fn migrates_the_shared_commonjs_fixture() {
    let translation = translate_source(
        include_str!("../../fixtures/fy/commonjs.cjs"),
        &SourceOptions {
            filename: "commonjs.cjs".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        translation.code,
        include_str!("../../fixtures/fy/commonjs.mjs")
    );
    assert!(translation.diagnostics.is_empty());
}

#[test]
fn migration_does_not_rewrite_strings_comments_regexes_or_property_calls() {
    let source = "// import x from 'zx'\nconst s = \"require('zx')\";\nconst re = /require('zx')/; obj.require('zx');\nconst t = `${(await import('zx')).VERSION}`;";
    let options = SourceOptions {
        from: "javascript".into(),
        ..Default::default()
    };
    let code = translate_source(source, &options).unwrap().code;
    assert!(code.contains("// import x from 'zx'"));
    assert!(code.contains("/require('zx')/"));
    assert!(code.contains("obj.require('zx')"));
    assert!(code.contains("import(\"command-stream/zx\")"));
}

#[test]
fn shell_programs_load_command_stream_with_use_m_by_default() {
    let result = translate_source(
        "greet() { echo \"$1\"; }; greet hello",
        &SourceOptions::default(),
    )
    .unwrap();
    assert!(result.code.contains("from 'use-m'"));
    assert!(result.code.contains("await use(\"command-stream\")"));
    assert!(result.code.contains("...process.argv.slice(2)"));
    assert!(result.code.contains("process.exitCode = result.code"));
}

#[test]
fn rejects_unknown_languages_and_invalid_javascript() {
    assert!(translate_source(
        "echo hi",
        &SourceOptions {
            from: "unknown".into(),
            ..Default::default()
        }
    )
    .is_err());
    assert!(translate_source(
        "import {",
        &SourceOptions {
            from: "javascript".into(),
            ..Default::default()
        }
    )
    .is_err());
}
