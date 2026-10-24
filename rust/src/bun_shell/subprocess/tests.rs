use super::*;

fn quote_cases() -> Vec<(&'static str, &'static str)> {
    vec![
        ("abc", "abc"),
        ("", "\"\""),
        ("a b", "\"a b\""),
        ("a\"b", "\"a\\\"b\""),
        ("a\\\"b", "\"a\\\\\\\"b\""),
        ("tail\\ ", "\"tail\\ \""),
        ("x y\\", "\"x y\\\\\""),
        ("c:\\dir\\x", "c:\\dir\\x"),
        ("\u{85}x", "\u{85}x"),
        ("a\u{a0}b", "\"a\u{a0}b\""),
    ]
}

#[test]
fn windows_quoting() {
    for (arg, want) in quote_cases() {
        assert_eq!(quote_windows_arg(arg), want, "{arg:?}");
    }
    assert!(is_batch_file("C:\\x\\run.CMD"));
    assert!(is_batch_file("a.bat"));
    assert!(!is_batch_file("a.exe"));
    assert_eq!(
        batch_command_line(&["a.bat".into(), "x y".into(), "z".into()]),
        "\"a.bat \"x y\" z\""
    );
}

#[cfg(unix)]
mod unix {
    use super::*;
    use crate::bun_shell::io::{redirect_flags, Channel};
    use std::time::Duration;

    fn env() -> Vec<(String, String)> {
        vec![("PATH".into(), std::env::var("PATH").unwrap_or_default())]
    }

    fn pipe_io() -> ShellIO {
        ShellIO {
            stdin: InKind::Ignore,
            stdout: OutKind::Pipe,
            stderr: OutKind::Pipe,
        }
    }

    struct Run {
        code: i32,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    }

    async fn run(
        args: &[&str],
        io: &ShellIO,
        flags: u8,
        overrides: Overrides,
        dup: Option<Dup>,
    ) -> Run {
        let (out, err) = (SharedBuf::new(), SharedBuf::new());
        let res = run_subprocess(SubprocessOptions {
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: "/",
            env: env(),
            io,
            flags,
            overrides,
            dup,
            buffered_stdout: out.clone(),
            buffered_stderr: err.clone(),
        })
        .await;
        let SubprocessResult::Exited(code) = res else {
            panic!("{res:?}");
        };
        Run {
            code,
            stdout: out.to_vec(),
            stderr: err.to_vec(),
        }
    }

    fn sh(script: &str) -> Vec<&str> {
        vec!["/bin/sh", "-c", script]
    }

    #[tokio::test]
    async fn buffers_output_and_exit_codes() {
        let r = run(
            &sh("echo out; echo err >&2; exit 3"),
            &pipe_io(),
            0,
            Overrides::default(),
            None,
        )
        .await;
        assert_eq!(
            (r.code, &r.stdout[..], &r.stderr[..]),
            (3, &b"out\n"[..], &b"err\n"[..])
        );
        let r = run(&sh("kill -9 $$"), &pipe_io(), 0, Overrides::default(), None).await;
        assert_eq!(r.code, 137);
        // A redirect elsewhere is not captured into the shell buffer.
        let r = run(
            &sh("echo out"),
            &pipe_io(),
            redirect_flags::STDOUT,
            Overrides {
                stdout: Some(OutOverride::File(Arc::new(
                    File::options().write(true).open("/dev/null").unwrap(),
                ))),
                ..Default::default()
            },
            None,
        )
        .await;
        assert_eq!((r.code, r.stdout.len()), (0, 0));
    }

    #[tokio::test]
    async fn stdin_from_bytes_file_and_channel() {
        let r = run(
            &["cat"],
            &pipe_io(),
            redirect_flags::STDIN,
            Overrides {
                stdin: Some(InOverride::Bytes(b"hello bytes".to_vec())),
                ..Default::default()
            },
            None,
        )
        .await;
        assert_eq!(r.stdout, b"hello bytes");

        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("in");
        std::fs::write(&p, "from file").unwrap();
        let io = ShellIO {
            stdin: InKind::Fd(Reader::file(File::open(&p).unwrap())),
            ..pipe_io()
        };
        let r = run(&["cat"], &io, 0, Overrides::default(), None).await;
        assert_eq!(r.stdout, b"from file");

        // A channel reader is pumped into the child.
        let ch = Channel::new();
        let io = ShellIO {
            stdin: InKind::Fd(Reader::channel(ch.clone())),
            ..pipe_io()
        };
        let w = Writer::channel(ch);
        let writer = tokio::spawn(async move {
            for i in 0..3 {
                w.write(format!("line {i}\n").as_bytes(), None)
                    .await
                    .unwrap();
            }
        });
        let r = run(&["cat"], &io, 0, Overrides::default(), None).await;
        writer.await.unwrap();
        assert_eq!(r.stdout, b"line 0\nline 1\nline 2\n");

        // Empty bytes: stdin is /dev/null.
        let r = run(
            &["cat"],
            &pipe_io(),
            redirect_flags::STDIN,
            Overrides {
                stdin: Some(InOverride::Bytes(Vec::new())),
                ..Default::default()
            },
            None,
        )
        .await;
        assert_eq!((r.code, r.stdout.len()), (0, 0));
    }

    #[tokio::test]
    async fn two_process_pipeline_through_channel() {
        let ch = Channel::new();
        let first = ShellIO {
            stdin: InKind::Ignore,
            stdout: OutKind::fd(Writer::channel(ch.clone()), None),
            stderr: OutKind::Pipe,
        };
        let second = ShellIO {
            stdin: InKind::Fd(Reader::channel(ch)),
            ..pipe_io()
        };
        let (a, b) = tokio::join!(
            async {
                let r = run(&sh("seq 1 20000"), &first, 0, Overrides::default(), None).await;
                drop(first);
                r
            },
            run(&["wc", "-l"], &second, 0, Overrides::default(), None)
        );
        assert_eq!(a.code, 0);
        assert_eq!(String::from_utf8_lossy(&b.stdout).trim(), "20000");
    }

    #[tokio::test]
    async fn sigpipe_when_reader_goes_away() {
        let ch = Channel::new();
        let io = ShellIO {
            stdin: InKind::Ignore,
            stdout: OutKind::fd(Writer::channel(ch.clone()), None),
            stderr: OutKind::Pipe,
        };
        let reader = Reader::channel(ch);
        let consumer = async move {
            let first = reader.read_chunk().await.unwrap();
            drop(reader);
            first
        };
        let (r, first) = tokio::join!(run(&["yes"], &io, 0, Overrides::default(), None), consumer);
        assert!(first.unwrap().starts_with(b"y\n"));
        assert_eq!(r.code, 141);
    }

    #[tokio::test]
    async fn dup_shares_one_pipe() {
        let script = "for i in 1 2 3 4 5; do echo o$i; echo e$i >&2; done";
        let r = run(
            &sh(script),
            &pipe_io(),
            redirect_flags::DUPLICATE_OUT | redirect_flags::STDOUT,
            Overrides::default(),
            Some(Dup::StderrToStdout),
        )
        .await;
        assert_eq!(
            String::from_utf8(r.stdout).unwrap(),
            "o1\ne1\no2\ne2\no3\ne3\no4\ne4\no5\ne5\n"
        );
        assert!(r.stderr.is_empty());
        let r = run(
            &sh("echo o; echo e >&2"),
            &pipe_io(),
            redirect_flags::DUPLICATE_OUT | redirect_flags::STDERR,
            Overrides::default(),
            Some(Dup::StdoutToStderr),
        )
        .await;
        assert_eq!((&r.stdout[..], &r.stderr[..]), (&b""[..], &b"o\ne\n"[..]));

        // 2>&1 into a file: both go to the file.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("both");
        let f = Arc::new(File::create(&p).unwrap());
        let r = run(
            &sh("echo o; echo e >&2"),
            &pipe_io(),
            redirect_flags::DUPLICATE_OUT | redirect_flags::STDOUT,
            Overrides {
                stdout: Some(OutOverride::File(f)),
                ..Default::default()
            },
            Some(Dup::StderrToStdout),
        )
        .await;
        assert_eq!(r.code, 0);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "o\ne\n");
    }

    #[tokio::test]
    async fn out_buffer_truncates_and_tee_captures() {
        let buf = OutBuffer::new(5);
        let r = run(
            &sh("echo 0123456789"),
            &pipe_io(),
            redirect_flags::STDOUT,
            Overrides {
                stdout: Some(OutOverride::Buffer(buf.clone())),
                ..Default::default()
            },
            None,
        )
        .await;
        assert_eq!(
            (r.code, buf.contents(), r.stdout.len()),
            (0, b"01234".to_vec(), 0)
        );

        // Tee: the writer gets the bytes, `captured` a copy.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("tee");
        let cap = SharedBuf::new();
        let io = ShellIO {
            stdin: InKind::Ignore,
            stdout: OutKind::fd(Writer::file(File::create(&p).unwrap()), Some(cap.clone())),
            stderr: OutKind::Ignore,
        };
        let r = run(
            &sh("echo teed; echo hidden >&2"),
            &io,
            0,
            Overrides::default(),
            None,
        )
        .await;
        drop(io);
        assert_eq!(r.code, 0);
        assert_eq!(cap.to_vec(), b"teed\n");
        assert_eq!(std::fs::read(&p).unwrap(), b"teed\n");

        // A failing tee reports its errno as the exit code.
        let ch = Channel::new();
        drop(Reader::channel(ch.clone()));
        let cap = SharedBuf::new();
        let io = ShellIO {
            stdin: InKind::Ignore,
            stdout: OutKind::fd(Writer::channel(ch), Some(cap.clone())),
            stderr: OutKind::Ignore,
        };
        let r = run(&sh("echo x"), &io, 0, Overrides::default(), None).await;
        assert_eq!(r.code, crate::bun_shell::errno::errno_of("EPIPE"));
        assert_eq!(cap.to_vec(), b"x\n");
    }

    #[tokio::test]
    async fn spawn_errors() {
        let res = run_subprocess(SubprocessOptions {
            args: vec!["/definitely/not/here".into()],
            cwd: "/",
            env: env(),
            io: &pipe_io(),
            flags: 0,
            overrides: Overrides::default(),
            dup: None,
            buffered_stdout: SharedBuf::new(),
            buffered_stderr: SharedBuf::new(),
        })
        .await;
        let SubprocessResult::SpawnError(e) = res else {
            panic!("{res:?}");
        };
        assert_eq!(e.code, "ENOENT");
        assert_eq!(
            e.display(),
            "bun: No such file or directory: /definitely/not/here"
        );
    }

    #[tokio::test]
    async fn does_not_wait_for_stdin_consumer() {
        // `true` never reads its stdin; the pump must not keep us waiting.
        let ch = Channel::new();
        let io = ShellIO {
            stdin: InKind::Fd(Reader::channel(ch.clone())),
            ..pipe_io()
        };
        let r = tokio::time::timeout(
            Duration::from_secs(10),
            run(&["true"], &io, 0, Overrides::default(), None),
        )
        .await
        .expect("finished");
        assert_eq!(r.code, 0);
        drop(ch);
    }

    #[tokio::test]
    async fn threaded_pipe_reader() {
        let (r, mut w) = io::pipe().unwrap();
        let mut pr = PipeReader::threaded(r).unwrap();
        use std::io::Write;
        w.write_all(b"abc").unwrap();
        drop(w);
        assert_eq!(pr.next().await.unwrap(), b"abc");
        assert_eq!(pr.next().await, None);
    }
}
