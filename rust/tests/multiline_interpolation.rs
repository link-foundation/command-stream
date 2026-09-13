//! Multiline interpolation regression coverage (issue #37).
//!
//! Interpolated values must remain literal data across quoting, redirection,
//! nested programs, and shell metacharacters. The differential tests compare
//! that behavior with a quoted variable in `/bin/sh`.
#![cfg(unix)]

use command_stream::{cmd, quote_for_context, QuoteContext};
use std::path::Path;
use std::process::Command;

const COMPLEX_CONTENT: &str = r####"# Test Repository

This is a test repository with `backticks` and "quotes".

## Code Example
```javascript
const message = "Hello, World!";
console.log(`Message: ${message}`);
```

## Special Characters
- Single quotes: 'test'
- Double quotes: "test"
- Backticks: `test`
- Dollar signs: $100
- Backslashes: C:\Windows\System32"####;

fn sh_output(script: &str, value: &str) -> (i32, String) {
    let output = Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .env("V", value)
        .output()
        .expect("failed to run /bin/sh");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).expect("failed to read redirected output")
}

#[tokio::test]
async fn echo_and_printf_preserve_the_full_issue_payload() {
    let echoed = cmd!("echo \"{}\"", COMPLEX_CONTENT).await.unwrap();
    let no_newline = cmd!("echo -n {}", COMPLEX_CONTENT).await.unwrap();
    let printed = cmd!("printf '%s' {}", COMPLEX_CONTENT).await.unwrap();

    assert!(echoed.is_success(), "stderr: {}", echoed.stderr);
    assert_eq!(echoed.stdout, format!("{COMPLEX_CONTENT}\n"));
    assert_eq!(no_newline.stdout, COMPLEX_CONTENT);
    assert_eq!(printed.stdout, COMPLEX_CONTENT);
}

#[tokio::test]
async fn redirection_and_append_preserve_content_at_a_path_with_spaces() {
    let dir = tempfile::Builder::new()
        .prefix("multiline content ")
        .tempdir()
        .unwrap();
    let target = dir.path().join("generated README.md");
    let target_string = target.to_str().unwrap();

    let write = cmd!("printf '%s' {} > {}", COMPLEX_CONTENT, target_string)
        .await
        .unwrap();
    let append = cmd!(
        "printf '%s' {} >> {}",
        "\nAPPENDED `$HOME` \\tail",
        target_string
    )
    .await
    .unwrap();

    assert!(write.is_success(), "stderr: {}", write.stderr);
    assert!(append.is_success(), "stderr: {}", append.stderr);
    assert_eq!(
        read(&target),
        format!("{COMPLEX_CONTENT}\nAPPENDED `$HOME` \\tail")
    );
}

#[tokio::test]
async fn the_reported_echo_redirection_form_writes_literal_data() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("echo output.md");
    let target_string = target.to_str().unwrap();

    let result = cmd!("echo \"{}\" > {}", COMPLEX_CONTENT, target_string)
        .await
        .unwrap();

    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(read(&target), format!("{COMPLEX_CONTENT}\n"));
}

#[tokio::test]
async fn a_multiline_nested_shell_program_remains_one_argument() {
    let script = "printf '%s' 'line one\nline two `$HOME` \\tail'";
    let result = cmd!("/bin/sh -c {}", script).await.unwrap();

    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(result.stdout, "line one\nline two `$HOME` \\tail");
}

#[tokio::test]
async fn multiline_shell_syntax_cannot_run_an_injected_command() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("injected");
    let value = format!(
        "first line\n\"; touch {}; echo \"\n$(touch {})\n`touch {}`",
        marker.display(),
        marker.display(),
        marker.display()
    );
    let result = cmd!("printf '%s' {}", value).await.unwrap();

    assert!(result.is_success(), "stderr: {}", result.stderr);
    assert_eq!(result.stdout, value);
    assert!(!marker.exists(), "the interpolated command syntax ran");
}

#[tokio::test]
async fn multiline_values_match_a_quoted_sh_variable() {
    for (template, reference) in [
        ("echo {}", "echo \"$V\""),
        ("echo -n {}", "echo -n \"$V\""),
        ("printf '%s' {}", "printf '%s' \"$V\""),
    ] {
        let command = template.replace(
            "{}",
            &quote_for_context(COMPLEX_CONTENT, QuoteContext::Unquoted),
        );
        let expected = sh_output(reference, COMPLEX_CONTENT);
        let actual = sh_output(&command, "");

        assert_eq!(actual, expected, "parity mismatch for {template:?}");
    }
}
