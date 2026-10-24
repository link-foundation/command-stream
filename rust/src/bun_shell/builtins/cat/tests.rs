use super::*;
use crate::bun_shell::builtin::{BuiltinKind, BuiltinOut};
use crate::bun_shell::builtins;
use crate::bun_shell::env::{EnvMap, ShellExecEnv};
use crate::bun_shell::errno::errno_of;
use crate::bun_shell::io::{Channel, Writer};
use crate::bun_shell::OutBuffer;

struct Out {
    code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl Out {
    fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

/// Run `cat args` in `cwd` (the builtin is constructed directly: on POSIX
/// `from_argv0` only knows `cat` with the experimental env var set).
async fn run_io(cwd: &str, args: &[&str], stdin: BuiltinIn, stdout: BuiltinOut) -> Out {
    let mut shell = ShellExecEnv::new(EnvMap::new(), cwd);
    let mut b = Builtin {
        kind: BuiltinKind::Cat,
        args: args.iter().map(|s| s.to_string()).collect(),
        shell: &mut shell,
        stdin,
        stdout,
        stderr: BuiltinOut::Buf(Which::Stderr),
    };
    let code = builtins::run(&mut b).await;
    drop(b);
    Out {
        code,
        stdout: shell.buffered_stdout.take(),
        stderr: shell.buffered_stderr.take(),
    }
}

async fn run(cwd: &str, args: &[&str]) -> Out {
    run_io(cwd, args, BuiltinIn::Ignore, BuiltinOut::Buf(Which::Stdout)).await
}

fn fixture() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("f.txt"), "hello\n").unwrap();
    std::fs::create_dir(dir.path().join("d")).unwrap();
    let cwd = dir.path().to_string_lossy().into_owned();
    (dir, cwd)
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn parse_opts_cases() {
    assert_eq!(parse_opts(&[]), Parsed::Start(None));
    assert_eq!(parse_opts(&s(&["f"])), Parsed::Start(Some(0)));
    assert_eq!(parse_opts(&s(&[""])), Parsed::Start(Some(0)));
    assert_eq!(parse_opts(&s(&["-"])), Parsed::Illegal(b"-".to_vec()));
    assert_eq!(parse_opts(&s(&["-x", "f"])), Parsed::Illegal(vec![]));
    assert_eq!(parse_opts(&s(&["-xyz"])), Parsed::Illegal(b"yz".to_vec()));
    assert_eq!(parse_opts(&s(&["--", "f"])), Parsed::Illegal(vec![]));
    for ch in "bestuvn".chars() {
        assert_eq!(
            parse_opts(&s(&[&format!("-{ch}")])),
            Parsed::Unsupported(format!("-{ch}"))
        );
    }
    // Only the first byte of the flag is skipped, even inside a character.
    assert_eq!(
        parse_opts(&s(&["-\u{e9}x"])),
        Parsed::Illegal(vec![0xa9, b'x'])
    );
}

#[tokio::test]
async fn option_errors() {
    let (_dir, cwd) = fixture();
    let cases: &[(&[&str], &str)] = &[
        (
            &["-n"],
            "cat: unsupported option, please open a GitHub issue -- -n\n",
        ),
        (&["-x", "f.txt"], "cat: illegal option -- \n"),
        (&["-"], "cat: illegal option -- -\n"),
        (&["--", "f.txt"], "cat: illegal option -- \n"),
        (&["-xyz"], "cat: illegal option -- yz\n"),
    ];
    for (args, stderr) in cases {
        let o = run(&cwd, args).await;
        assert_eq!(
            (o.code, o.stdout(), o.stderr()),
            (1, String::new(), stderr.to_string()),
            "{args:?}"
        );
    }
    // The illegal bytes are written as they are, even when not UTF-8.
    let o = run(&cwd, &["-\u{e9}"]).await;
    assert_eq!(o.stderr, b"cat: illegal option -- \xa9\n");
}

#[tokio::test]
async fn open_errors() {
    let (_dir, cwd) = fixture();
    let o = run(&cwd, &["missing.txt"]).await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (
            1,
            String::new(),
            "cat: missing.txt: No such file or directory\n".to_string()
        )
    );
    let o = run(&cwd, &[""]).await;
    assert_eq!(
        (o.code, o.stderr()),
        (1, "cat: No such file or directory\n".to_string())
    );
    // A failed stderr write ends cat with its errno.
    let ch = Channel::new();
    ch.close_read();
    let mut shell = ShellExecEnv::new(EnvMap::new(), cwd.as_str());
    let mut b = Builtin {
        kind: BuiltinKind::Cat,
        args: s(&["missing.txt"]),
        shell: &mut shell,
        stdin: BuiltinIn::Ignore,
        stdout: BuiltinOut::Buf(Which::Stdout),
        stderr: BuiltinOut::Fd {
            writer: Writer::channel(ch),
            captured: None,
        },
    };
    assert_eq!(builtins::run(&mut b).await, errno_of("EPIPE"));
}

#[tokio::test]
async fn file_operands() {
    let (_dir, cwd) = fixture();
    let abs = format!("{cwd}/f.txt");
    for args in [&["f.txt"][..], &[abs.as_str()][..]] {
        let o = run(&cwd, args).await;
        if cfg!(target_os = "linux") {
            // Bun's epoll registration of a regular file fails with EPERM.
            assert_eq!(
                (o.code, o.stdout(), o.stderr()),
                (1, String::new(), String::new())
            );
        } else {
            assert_eq!(
                (o.code, o.stdout(), o.stderr()),
                (0, "hello\n".into(), String::new())
            );
        }
    }
    // Cat stops at the first failure.
    let o = run(&cwd, &["f.txt", "missing"]).await;
    if cfg!(target_os = "linux") {
        assert_eq!(
            (o.code, o.stdout(), o.stderr()),
            (1, String::new(), String::new())
        );
    } else {
        assert_eq!(
            (o.code, o.stdout(), o.stderr()),
            (
                1,
                "hello\n".into(),
                "cat: missing: No such file or directory\n".into()
            )
        );
    }
    // A directory: EPERM on Linux, the read's EISDIR elsewhere.
    let o = run(&cwd, &["d"]).await;
    let want = if cfg!(target_os = "linux") {
        1
    } else {
        errno_of("EISDIR")
    };
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (want, String::new(), String::new())
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_unpollable_devices() {
    let o = run("/", &["/dev/null"]).await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (1, String::new(), String::new())
    );
    let o = run("/", &["/dev/zero"]).await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (1, String::new(), String::new())
    );
    // `cat < file` fails the same way.
    let (_dir, cwd) = fixture();
    let reader = Reader::file(File::open(format!("{cwd}/f.txt")).unwrap());
    let o = run_io(
        &cwd,
        &[],
        BuiltinIn::Fd(reader),
        BuiltinOut::Buf(Which::Stdout),
    )
    .await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (1, String::new(), String::new())
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn linux_write_error_is_the_exit_code() {
    // `echo hi | cat > /dev/full`.
    let full = OpenOptions::new().write(true).open("/dev/full").unwrap();
    let ch = Channel::new();
    ch.write(b"hi\n".to_vec()).await.unwrap();
    ch.close();
    let stdout = BuiltinOut::Fd {
        writer: Writer::file(full),
        captured: None,
    };
    let o = run_io("/", &[], BuiltinIn::Fd(Reader::channel(ch)), stdout).await;
    assert_eq!((o.code, o.stderr()), (errno_of("ENOSPC"), String::new()));
}

#[cfg(not(target_os = "linux"))]
#[tokio::test]
async fn stdin_file_is_copied() {
    let (_dir, cwd) = fixture();
    let reader = Reader::file(File::open(format!("{cwd}/f.txt")).unwrap());
    let o = run_io(
        &cwd,
        &[],
        BuiltinIn::Fd(reader),
        BuiltinOut::Buf(Which::Stdout),
    )
    .await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (0, "hello\n".into(), String::new())
    );
}

#[tokio::test]
async fn piped_stdin() {
    // `echo hi | cat`.
    let ch = Channel::new();
    ch.write(b"hi\n".to_vec()).await.unwrap();
    ch.close();
    let o = run_io(
        "/",
        &[],
        BuiltinIn::Fd(Reader::channel(ch)),
        BuiltinOut::Buf(Which::Stdout),
    )
    .await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (0, "hi\n".into(), String::new())
    );

    // A 1MB pipe, written while cat reads it.
    let data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 251) as u8).collect();
    let ch = Channel::new();
    let writer = {
        let ch = ch.clone();
        let data = data.clone();
        async move {
            for chunk in data.chunks(10_000) {
                ch.write(chunk.to_vec()).await.unwrap();
            }
            ch.close();
        }
    };
    let reader = BuiltinIn::Fd(Reader::channel(ch));
    let ((), o) = tokio::join!(
        writer,
        run_io("/", &[], reader, BuiltinOut::Buf(Which::Stdout))
    );
    assert_eq!(o.code, 0);
    assert!(o.stdout == data, "1MB pipe differs");

    // Writing into a pipe whose reader is gone: EPIPE.
    let out = Channel::new();
    out.close_read();
    let stdout = BuiltinOut::Fd {
        writer: Writer::channel(out),
        captured: None,
    };
    let o = run_io("/", &[], BuiltinIn::Blob(b"x".to_vec()), stdout).await;
    assert_eq!(o.code, errno_of("EPIPE"));
}

#[tokio::test]
async fn buffer_stdin_and_stdout() {
    // `cat < ${blob}` / `cat < ${buffer}` for the corpus sizes.
    for size in [12 * 9000, 4 * 1024 * 1024] {
        let data: Vec<u8> = (0..size).map(|i| (i % 253) as u8).collect();
        for stdin in [
            BuiltinIn::Blob(data.clone()),
            BuiltinIn::ArrayBuf(data.clone()),
        ] {
            let o = run_io("/", &[], stdin, BuiltinOut::Buf(Which::Stdout)).await;
            assert_eq!(o.code, 0);
            assert!(o.stdout == data, "{size} bytes differ");
        }
    }
    // `cat < ${blob} > ${buf}`: truncated to the buffer, still exit 0.
    let buf = OutBuffer::new(5);
    let o = run_io(
        "/",
        &[],
        BuiltinIn::Blob(b"hello world".to_vec()),
        BuiltinOut::array_buf(buf.clone()),
    )
    .await;
    assert_eq!((o.code, o.stderr()), (0, String::new()));
    assert_eq!(buf.contents(), b"hello");
    // `echo hi | cat > ${buf}` with a larger buffer.
    let buf = OutBuffer::new(8);
    let ch = Channel::new();
    ch.write(b"hi\n".to_vec()).await.unwrap();
    ch.close();
    let o = run_io(
        "/",
        &[],
        BuiltinIn::Fd(Reader::channel(ch)),
        BuiltinOut::array_buf(buf.clone()),
    )
    .await;
    assert_eq!(o.code, 0);
    assert_eq!(buf.contents(), b"hi\n\0\0\0\0\0");
    // No stdin at all: nothing written.
    let o = run("/", &[]).await;
    assert_eq!(
        (o.code, o.stdout(), o.stderr()),
        (0, String::new(), String::new())
    );
}

#[tokio::test]
async fn captured_fd_stdout() {
    // `echo hi | cat` with stdout captured through a writer.
    let captured = crate::bun_shell::io::SharedBuf::new();
    let out = Channel::new();
    let stdout = BuiltinOut::Fd {
        writer: Writer::channel(out.clone()),
        captured: Some(captured.clone()),
    };
    let o = run_io("/", &[], BuiltinIn::Blob(b"hi\n".to_vec()), stdout).await;
    assert_eq!(o.code, 0);
    assert_eq!(captured.to_vec(), b"hi\n");
    assert_eq!(out.read().await.unwrap(), b"hi\n");
}
