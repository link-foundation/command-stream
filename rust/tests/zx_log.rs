//! Port of the zx `test/log.test.ts` suite for `command_stream::zx::log`.

use std::time::Duration;

use command_stream::zx::log::format_cmd_plain;
use command_stream::zx::{format_cmd, LogEntry, Logger};

fn render(entry: &LogEntry, verbose: bool) -> String {
    let mut logger = Logger::new(Vec::new());
    logger.log(entry, verbose).unwrap();
    String::from_utf8(logger.into_output()).unwrap()
}

fn cmd(c: &str) -> LogEntry {
    LogEntry::Cmd { cmd: c.into() }
}

// zx:test/log.test.ts:37:5:registration
#[test]
fn empty_log() {
    assert_eq!(render(&cmd("echo hi"), false), "");
}

// zx:test/log.test.ts:48:5:registration
#[test]
fn cmd_entry() {
    assert_eq!(render(&cmd("echo hi"), true), "$ \x1b[92mecho\x1b[39m hi\n");
}

// zx:test/log.test.ts:59:5:registration
#[test]
fn stdout_entry() {
    let entry = LogEntry::Stdout {
        data: b"foo".to_vec(),
    };
    assert_eq!(render(&entry, true), "foo");
}

// zx:test/log.test.ts:69:5:registration
#[test]
fn cd_entry() {
    let entry = LogEntry::Cd { dir: "/tmp".into() };
    assert_eq!(render(&entry, true), "$ \x1b[92mcd\x1b[39m /tmp\n");
}

// zx:test/log.test.ts:78:5:registration
#[test]
fn fetch_entry() {
    let entry = LogEntry::Fetch {
        url: "https://github.com".into(),
        init: Some("{ method: 'GET' }".into()),
    };
    assert_eq!(
        render(&entry, true),
        "$ \x1b[92mfetch\x1b[39m https://github.com { method: 'GET' }\n"
    );
}

// zx:test/log.test.ts:91:5:registration
#[test]
fn custom_entry() {
    let entry = LogEntry::Custom {
        data: "test".into(),
    };
    assert_eq!(render(&entry, true), "test");
}

// zx:test/log.test.ts:100:5:registration
#[test]
fn retry_entry() {
    let entry = LogEntry::Retry {
        attempt: 1,
        total: Some(3),
        delay: Duration::from_millis(1000),
    };
    assert_eq!(
        render(&entry, true),
        "\x1b[41m\x1b[37m FAIL \x1b[39m\x1b[49m Attempt: 1/3; next in 1000ms\n"
    );
}

// zx:test/log.test.ts:116:5:registration
#[test]
fn end_entry() {
    let entry = LogEntry::End {
        exit_code: None,
        signal: None,
        duration: Duration::ZERO,
    };
    assert_eq!(render(&entry, true), "");
}

// zx:test/log.test.ts:129:5:registration
#[test]
fn kill_entry() {
    let entry = LogEntry::Kill {
        pid: 1234,
        signal: None,
    };
    assert_eq!(render(&entry, false), "");
    assert_eq!(render(&entry, true), "");
}

// zx:test/log.test.ts:138:5:registration
#[test]
fn custom_formatters() {
    let mut logger = Logger::new(Vec::new()).formatter("cmd", |e| match e {
        LogEntry::Cmd { cmd } => format!("CMD: {cmd}"),
        _ => String::new(),
    });
    logger.log(&cmd("echo hi"), true).unwrap();
    assert_eq!(logger.output().as_slice(), b"CMD: echo hi");
}

// zx:test/log.test.ts:154:3:registration
#[test]
fn format_cmd_highlights() {
    let cases = [
        (
            "echo $'hi'",
            "$ \x1b[92mecho\x1b[39m \x1b[93m$\x1b[39m\x1b[93m'hi'\x1b[39m\n",
        ),
        ("echo$foo", "$ \x1b[92mecho\x1b[39m\x1b[93m$\x1b[39mfoo\n"),
        (
            "test --foo=bar p1 p2",
            "$ \x1b[92mtest\x1b[39m --foo\x1b[31m=\x1b[39mbar p1 p2\n",
        ),
        (
            "cmd1 --foo || cmd2",
            "$ \x1b[92mcmd1\x1b[39m --foo \x1b[31m|\x1b[39m\x1b[31m|\x1b[39m\x1b[92m cmd2\x1b[39m\n",
        ),
        (
            "A=B C='D' cmd",
            "$ A\x1b[31m=\x1b[39mB C\x1b[31m=\x1b[39m\x1b[93m'D'\x1b[39m\x1b[92m cmd\x1b[39m\n",
        ),
        (
            "foo-extra --baz = b-a-z --bar = 'b-a-r' -q -u x",
            "$ \x1b[92mfoo-extra\x1b[39m --baz \x1b[31m=\x1b[39m b-a-z --bar \x1b[31m=\x1b[39m \x1b[93m'b-a-r'\x1b[39m -q -u x\n",
        ),
        (
            "while true; do \"$\" done",
            "$ \x1b[96mwhile\x1b[39m true\x1b[31m;\x1b[39m\x1b[96m do\x1b[39m \x1b[93m\"$\"\x1b[39m\x1b[96m done\x1b[39m\n",
        ),
        (
            "echo '\n str\n'",
            "$ \x1b[92mecho\x1b[39m \x1b[93m'\x1b[39m\x1b[0m\x1b[0m\n\x1b[0m> \x1b[0m\x1b[93m str\x1b[39m\x1b[0m\x1b[0m\n\x1b[0m> \x1b[0m\x1b[93m'\x1b[39m\n",
        ),
        (
            "$'\\''",
            "$ \x1b[93m$\x1b[39m\x1b[93m'\\'\x1b[39m\x1b[93m'\x1b[39m\n",
        ),
        (
            "sass-compiler --style=compressed src/static/bootstrap.scss > dist/static/bootstrap-v5.3.3.min.css",
            "$ \x1b[92msass-compiler\x1b[39m --style\x1b[31m=\x1b[39mcompressed src/static/bootstrap.scss \x1b[31m>\x1b[39m\x1b[92m dist/static/bootstrap-v5.3.3.min.css\x1b[39m\n",
        ),
        (
            "echo 1+2 | bc",
            "$ \x1b[92mecho\x1b[39m 1\x1b[31m+\x1b[39m2 \x1b[31m|\x1b[39m\x1b[92m bc\x1b[39m\n",
        ),
        (
            "echo test &>> filepath",
            "$ \x1b[92mecho\x1b[39m test \x1b[31m&\x1b[39m\x1b[31m>\x1b[39m\x1b[31m>\x1b[39m\x1b[92m filepath\x1b[39m\n",
        ),
        (
            "bc < filepath",
            "$ \x1b[92mbc\x1b[39m \x1b[31m<\x1b[39m\x1b[92m filepath\x1b[39m\n",
        ),
        (
            "cat << 'EOF' | tee -a filepath\nline 1\nline 2\nEOF",
            "$ \x1b[92mcat\x1b[39m \x1b[31m<\x1b[39m\x1b[31m<\x1b[39m \x1b[93m'EOF'\x1b[39m \x1b[31m|\x1b[39m\x1b[92m tee\x1b[39m -a filepath\x1b[0m\x1b[0m\n\x1b[0m> \x1b[0mline 1\x1b[0m\x1b[0m\n\x1b[0m> \x1b[0mline 2\x1b[96m\x1b[39m\x1b[0m\x1b[0m\n\x1b[0m> \x1b[0m\x1b[96mEOF\x1b[39m\n",
        ),
    ];
    for (input, expected) in cases {
        assert_eq!(format_cmd(input), expected, "{input:?}");
    }
}

// zx:test/log.test.ts:154:3:registration (uncolored rendering)
#[test]
fn format_cmd_plain_keeps_text() {
    assert_eq!(format_cmd_plain("echo hi\nthere"), "$ echo hi\n> there\n");
}
