//! Paths with spaces (and other shell metacharacters) must reach the command
//! as exactly one literal argument, like `"$path"` in a POSIX shell.
//!
//! Mirrors `js/tests/paths-with-spaces.test.mjs` (issue #41).
//!
//! Unix only: the assertions compare against `/bin/sh`, whose quoting rules
//! differ from `cmd.exe`. The platform-independent part of the behaviour is
//! covered by the unit tests in `src/quote.rs`.
#![cfg(unix)]

use command_stream::cmd;
use command_stream::quote::quote;

/// Tricky path values, each of which must survive interpolation unchanged.
const VALUES: &[&str] = &[
    "/Users/john/My Documents/report.txt",
    "/tmp/two  spaces/file.txt",
    "  /tmp/leading and trailing  ",
    "/tmp/it's a dir/file.txt",
    "/tmp/say \"hi\"/file.txt",
    "'/tmp/pre single quoted/file.txt'",
    "\"/tmp/pre double quoted/file.txt\"",
    "/tmp/$HOME dir/file.txt",
    "/tmp/back`tick`/file.txt",
    "/tmp/semi;colon/file.txt",
    "/tmp/pipe|and&amp/file.txt",
    "/tmp/star*glob?/file.txt",
    "/tmp/paren(s)/file.txt",
    "C:\\Program Files\\App\\app.exe",
    "/tmp/new\nline/file.txt",
];

fn sh_stdout(script: &str, value: Option<&str>) -> String {
    let mut command = std::process::Command::new("/bin/sh");
    command.arg("-c").arg(script);
    if let Some(value) = value {
        command.env("V", value);
    }
    let output = command.output().expect("failed to run /bin/sh");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// `printf` instead of `echo`: /bin/sh may be dash, whose `echo` expands
/// backslash escapes and would corrupt Windows-style paths.
const SCRIPTS: &[(&str, &str)] = &[
    ("printf '%s\\n' {}", "printf '%s\\n' \"$V\""),
    ("printf '%s\\n' {} tail", "printf '%s\\n' \"$V\" tail"),
    ("printf '[%s]\\n' {}", "printf '[%s]\\n' \"$V\""),
];

#[test]
fn interpolated_values_match_a_quoted_sh_variable() {
    for value in VALUES {
        for (template, reference) in SCRIPTS {
            let built = template.replace("{}", &quote(value));
            assert_eq!(
                sh_stdout(&built, None),
                sh_stdout(reference, Some(value)),
                "value {value:?} in script {template:?} built as {built:?}"
            );
        }
    }
}

#[tokio::test]
async fn a_path_with_spaces_stays_one_argument() {
    let dir = tempfile::Builder::new()
        .prefix("my documents ")
        .tempdir()
        .unwrap();
    let file = dir.path().join("annual report 2026.txt");
    std::fs::write(&file, "hello content\n").unwrap();
    let file = file.to_str().unwrap();

    let result = cmd!("cat {}", file).await.unwrap();
    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(result.stdout, "hello content\n");
}

#[tokio::test]
async fn copying_between_directories_with_spaces_works() {
    let dir = tempfile::Builder::new()
        .prefix("my documents ")
        .tempdir()
        .unwrap();
    let source = dir.path().join("source file.txt");
    let target = dir.path().join("target file.txt");
    std::fs::write(&source, "copy me\n").unwrap();

    let result = cmd!(
        "cp {} {}",
        source.to_str().unwrap(),
        target.to_str().unwrap()
    )
    .await
    .unwrap();
    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "copy me\n");
}

#[tokio::test]
async fn a_pre_quoted_path_is_not_reinterpreted_as_shell_syntax() {
    // The quotes are part of the value, so the file is not found - exactly
    // what `cat "'$path'"` does in sh.
    let dir = tempfile::Builder::new()
        .prefix("my documents ")
        .tempdir()
        .unwrap();
    let file = dir.path().join("report.txt");
    std::fs::write(&file, "hello\n").unwrap();
    let pre_quoted = format!("'{}'", file.to_str().unwrap());

    let result = cmd!("cat {}", pre_quoted).await.unwrap();
    assert!(!result.is_success());
    assert!(result.stdout.is_empty(), "stdout: {}", result.stdout);
}

#[tokio::test]
async fn an_interpolated_value_cannot_start_a_second_command() {
    let dir = tempfile::Builder::new()
        .prefix("injection ")
        .tempdir()
        .unwrap();
    let marker = dir.path().join("pwned");
    // The value that made the old pre-quoted heuristic injectable.
    let evil = format!("' ; touch {} ; '", marker.to_str().unwrap());

    let result = cmd!("printf '%s\\n' {}", evil).await.unwrap();
    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(result.stdout, format!("{evil}\n"));
    assert!(!marker.exists(), "the injected command ran");
}
