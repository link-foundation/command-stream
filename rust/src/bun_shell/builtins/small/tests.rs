use super::*;
use crate::bun_shell::builtin::{BuiltinIn, BuiltinKind};
use crate::bun_shell::builtins;
use crate::bun_shell::env::{EnvMap, ShellExecEnv};
use crate::bun_shell::io::{Channel, Reader, Writer};
use crate::bun_shell::OutBuffer;

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

async fn run_in(shell: &mut ShellExecEnv, argv: &[&str], stdout: Option<BuiltinOut>) -> Out {
    let kind = BuiltinKind::from_argv0(argv[0]).expect("builtin");
    let mut b = Builtin {
        kind,
        args: argv[1..].iter().map(|s| s.to_string()).collect(),
        shell,
        stdin: BuiltinIn::Ignore,
        stdout: stdout.unwrap_or(BuiltinOut::Buf(Which::Stdout)),
        stderr: BuiltinOut::Buf(Which::Stderr),
    };
    let code = builtins::run(&mut b).await;
    Out {
        code,
        stdout: String::from_utf8_lossy(&shell.buffered_stdout.take()).into_owned(),
        stderr: String::from_utf8_lossy(&shell.buffered_stderr.take()).into_owned(),
    }
}

async fn run(argv: &[&str]) -> Out {
    run_in(&mut ShellExecEnv::new(EnvMap::new(), "/"), argv, None).await
}

async fn check(argv: &[&str], stdout: &str, stderr: &str, code: i32) {
    let o = run(argv).await;
    assert_eq!(
        (o.stdout.as_str(), o.stderr.as_str(), o.code),
        (stdout, stderr, code),
        "{argv:?}"
    );
}

#[tokio::test]
async fn echo_cases() {
    check(&["echo"], "\n", "", 0).await;
    check(&["echo", "hello", "world"], "hello world\n", "", 0).await;
    check(&["echo", ""], "\n", "", 0).await;
    check(&["echo", "-n"], "", "", 0).await;
    check(&["echo", "-n", "hello", "world"], "hello world", "", 0).await;
    check(&["echo", "-n", "-n", "hello"], "hello", "", 0).await;
    check(&["echo", "-x"], "-x\n", "", 0).await;
    check(&["echo", "-abc"], "-abc\n", "", 0).await;
    check(&["echo", "--invalid"], "--invalid\n", "", 0).await;
    check(&["echo", "--", "-n", "hello"], "-- -n hello\n", "", 0).await;
    check(&["echo", "\\n"], "\\n\n", "", 0).await;
    check(&["echo", "\n\n"], "\n\n", "", 0).await;
    check(&["echo", "\n\n\n"], "\n\n", "", 0).await;
    check(&["echo", "a\n\n"], "a\n", "", 0).await;
    check(
        &["echo", "-e", "a\\tb\\x41\\0101\\x\\q\\"],
        "a\tbAA\\x\\q\\\n",
        "",
        0,
    )
    .await;
    check(&["echo", "-e", "a\\cb", "c"], "a", "", 0).await;
    check(&["echo", "-eE", "a\\tb"], "a\\tb\n", "", 0).await;
    check(&["echo", "-ne", "x\\e"], "x\x1b", "", 0).await;
}

#[tokio::test]
async fn exit_true_false() {
    check(&["exit"], "", "", 0).await;
    check(&["exit", "0"], "", "", 0).await;
    check(&["exit", "11"], "", "", 11).await;
    check(&["exit", "+3"], "", "", 3).await;
    check(&["exit", "62757836"], "", "", 204).await;
    check(&["exit", "18446744073709551615"], "", "", 255).await;
    check(&["exit", "0018446744073709551615"], "", "", 255).await;
    let numeric = "exit: numeric argument required\n";
    check(&["exit", "18446744073709551616"], "", numeric, 1).await;
    check(
        &["exit", "99999999999999999999999999999999999999999"],
        "",
        numeric,
        1,
    )
    .await;
    check(&["exit", "abc"], "", numeric, 1).await;
    check(&["exit", "-1"], "", numeric, 1).await;
    check(&["exit", "3", "5"], "", "exit: too many arguments\n", 1).await;
    check(&["true", "x"], "", "", 0).await;
    check(&["false"], "", "", 1).await;
}

#[tokio::test]
async fn seq_cases() {
    let usage = BuiltinKind::Seq.usage();
    check(&["seq"], "", usage, 1).await;
    check(&["seq", "-w"], "", usage, 1).await;
    check(&["seq", "--fixed-width"], "", usage, 1).await;
    check(&["seq", "-s", ","], "", usage, 1).await;
    check(&["seq", "-w", "-s", ",", "-t", "."], "", usage, 1).await;
    check(
        &["seq", "-s"],
        "",
        "seq: option requires an argument -- s\n",
        1,
    )
    .await;
    check(
        &["seq", "-t"],
        "",
        "seq: option requires an argument -- t\n",
        1,
    )
    .await;
    check(&["seq", "0", "5"], "0\n1\n2\n3\n4\n5\n", "", 0).await;
    check(&["seq", "5", "0"], "5\n4\n3\n2\n1\n0\n", "", 0).await;
    check(&["seq", "-s,", "0", "5"], "0,1,2,3,4,5,", "", 0).await;
    check(
        &["seq", "--separator", ",", "0", "5"],
        "0,1,2,3,4,5,",
        "",
        0,
    )
    .await;
    check(&["seq", "-t,", "0", "5"], "0\n1\n2\n3\n4\n5\n,", "", 0).await;
    check(
        &["seq", "--terminator", ",", "0", "5"],
        "0\n1\n2\n3\n4\n5\n,",
        "",
        0,
    )
    .await;
    check(&["seq", "-s.", "-t,", "0", "5"], "0.1.2.3.4.5.,", "", 0).await;
    check(&["seq", "0"], "1\n0\n", "", 0).await;
    check(&["seq", "1"], "1\n", "", 0).await;
    check(&["seq", "2"], "1\n2\n", "", 0).await;
    check(&["seq", "8", "8"], "8\n", "", 0).await;
    check(&["seq", "ab"], "", "seq: invalid argument\n", 1).await;
    check(&["seq", "4", "ab"], "", "seq: invalid argument\n", 1).await;
    check(&["seq", "4", "7", "ba"], "", "seq: invalid argument\n", 1).await;
    check(&["seq", "inf"], "", "seq: invalid argument\n", 1).await;
    check(&["seq", "1e39"], "", "seq: invalid argument\n", 1).await;
    check(&["seq", "4", "0", "7"], "", "seq: zero increment\n", 1).await;
    check(
        &["seq", "4", "-2", "7"],
        "",
        "seq: needs positive increment\n",
        1,
    )
    .await;
    check(
        &["seq", "7", "2", "4"],
        "",
        "seq: needs negative decrement\n",
        1,
    )
    .await;
    check(&["seq", "16777216", "16777218"], "16777216\n", "", 0).await;
    check(&["seq", "1", "0.00000001", "2"], "1\n", "", 0).await;
    check(&["seq", "0", ".25", "1"], "0\n0.25\n0.5\n0.75\n1\n", "", 0).await;
    // 1.3f32 < 1.2f32 + 0.1f32 (1.3000001).
    check(&["seq", "1", "0.1", "1.3"], "1\n1.1\n1.2\n", "", 0).await;
    check(
        &["seq", "1", "0.1", "1.31"],
        "1\n1.1\n1.2\n1.3000001\n",
        "",
        0,
    )
    .await;
    assert_eq!(format_f32(-0.0), "-0");
    assert_eq!(format_f32(1e20), "100000000000000000000");
    assert_eq!(format_f32(1.5e-7), "0.00000015");
    assert_eq!(parse_f32("5."), Some(5.0));
    assert_eq!(parse_f32("."), None);
    assert_eq!(parse_f32("1e"), None);
    assert_eq!(parse_f32("+.5E+1"), Some(5.0));
}

#[tokio::test]
async fn path_builtins() {
    check(&["basename"], "", "usage: basename string\n", 1).await;
    check(&["dirname"], "", "usage: dirname string\n", 1).await;
    check(
        &[
            "basename",
            "/usr/share/aclocal/pkg.m4",
            "/var/log/bar/file.txt",
        ],
        "pkg.m4\nfile.txt\n",
        "",
        0,
    )
    .await;
    check(
        &["basename", "C:/Documents/Newsletters/Summer2018.pdf"],
        "Summer2018.pdf\n",
        "",
        0,
    )
    .await;
    check(&["basename", "/catalog/"], "catalog\n", "", 0).await;
    check(&["basename", "/"], "/\n", "", 0).await;
    check(&["basename", "a\\b"], "b\n", "", 0).await;
    check(&["basename", "plain"], "plain\n", "", 0).await;
    check(
        &["dirname", "js/bun/shell/commands/dirname.test.ts"],
        "js/bun/shell/commands\n",
        "",
        0,
    )
    .await;
    check(&["dirname", "/catalog/"], "/\n", "", 0).await;
    check(&["dirname", "/catalog"], "/\n", "", 0).await;
    check(&["dirname", "/"], "/\n", "", 0).await;
    check(&["dirname", "file", "a/b//"], ".\na\n", "", 0).await;
}

#[tokio::test]
async fn yes_into_buffers() {
    for (args, size, want) in [
        (vec!["yes"], 10, "y\ny\ny\ny\ny\n".to_string()),
        (vec!["yes", "xy"], 18, "xy\n".repeat(6)),
        (
            vec!["yes", "ab", "cd", "ef"],
            17,
            "ab cd ef\nab cd ef".to_string(),
        ),
        (
            vec!["yes", "hi"],
            131072,
            format!("{}hi", "hi\n".repeat(43690)),
        ),
    ] {
        let buf = OutBuffer::new(size);
        let mut shell = ShellExecEnv::new(EnvMap::new(), "/");
        let o = run_in(&mut shell, &args, Some(BuiltinOut::array_buf(buf.clone()))).await;
        assert_eq!((o.code, o.stderr.as_str()), (1, "yes: ENOSPC\n"));
        assert_eq!(String::from_utf8(buf.contents()).unwrap(), want);
    }
    // Through a pipe: stops once the reader goes away.
    let ch = Channel::new();
    let reader = Reader::channel(ch.clone());
    let out = BuiltinOut::Fd {
        writer: Writer::channel(ch),
        captured: None,
    };
    let task = tokio::spawn(async move {
        let mut shell = ShellExecEnv::new(EnvMap::new(), "/");
        run_in(&mut shell, &["yes"], Some(out)).await.code
    });
    assert!(reader
        .read_chunk()
        .await
        .unwrap()
        .unwrap()
        .starts_with(b"y\ny\n"));
    drop(reader);
    assert_eq!(task.await.unwrap(), 1);
}

#[tokio::test]
async fn echo_to_broken_pipe_returns_errno() {
    let ch = Channel::new();
    drop(Reader::channel(ch.clone()));
    let out = BuiltinOut::Fd {
        writer: Writer::channel(ch),
        captured: None,
    };
    let mut shell = ShellExecEnv::new(EnvMap::new(), "/");
    let o = run_in(&mut shell, &["echo", "hi"], Some(out)).await;
    assert_eq!(o.code, crate::bun_shell::errno::errno_of("EPIPE"));
    // Non-IO outputs never fail echo (a full buffer is not an error).
    let buf = OutBuffer::new(1);
    let o = run_in(
        &mut shell,
        &["echo", "hi"],
        Some(BuiltinOut::array_buf(buf)),
    )
    .await;
    assert_eq!(o.code, 0);
    let buf = OutBuffer::new(0);
    let o = run_in(&mut shell, &["seq", "3"], Some(BuiltinOut::array_buf(buf))).await;
    assert_eq!(o.code, 0);
}

#[tokio::test]
async fn pwd_cd_export() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("file"), "").unwrap();
    let mut env = EnvMap::new();
    env.set(
        if cfg!(windows) { "USERPROFILE" } else { "HOME" },
        root.clone(),
    );
    let mut sh = ShellExecEnv::new(env, root.clone());
    let sub = crate::bun_shell::node_path::join(&[&root, "sub"]);

    let o = run_in(&mut sh, &["pwd"], None).await;
    assert_eq!((o.stdout, o.code), (format!("{root}\n"), 0));
    let o = run_in(&mut sh, &["pwd", "x"], None).await;
    assert_eq!(
        (o.stderr.as_str(), o.code),
        ("pwd: too many arguments\n", 1)
    );

    assert_eq!(run_in(&mut sh, &["cd", "sub"], None).await.code, 0);
    assert_eq!(sh.cwd, sub);
    assert_eq!(run_in(&mut sh, &["cd", "-"], None).await.code, 0);
    assert_eq!(sh.cwd, root);
    assert_eq!(run_in(&mut sh, &["cd", "sub"], None).await.code, 0);
    assert_eq!(run_in(&mut sh, &["cd"], None).await.code, 0);
    assert_eq!(sh.cwd, root);

    for (argv, err) in [
        (vec!["cd", "a", "b"], "cd: too many arguments\n".to_string()),
        (
            vec!["cd", "lskfjlsdkjf"],
            "cd: not a directory: lskfjlsdkjf\n".to_string(),
        ),
        (
            vec!["cd", "file"],
            "cd: not a directory: file\n".to_string(),
        ),
    ] {
        let o = run_in(&mut sh, &argv, None).await;
        assert_eq!((o.stderr, o.code), (err, 1), "{argv:?}");
    }
    let long = "a".repeat(5000);
    let o = run_in(&mut sh, &["cd", &long], None).await;
    assert_eq!(o.stderr, "cd: file name too long\n");
    let mut no_home = ShellExecEnv::new(EnvMap::new(), root.clone());
    let o = run_in(&mut no_home, &["cd"], None).await;
    assert_eq!((o.stderr.as_str(), o.code), ("cd: HOME not set\n", 1));

    let mut sh = ShellExecEnv::new([("b", "2"), ("B", "1")].into_iter().collect(), "/");
    assert_eq!(
        run_in(&mut sh, &["export", "A=x=y", "", "Z"], None)
            .await
            .code,
        0
    );
    assert_eq!(sh.export_env.get("A"), Some("x=y"));
    assert_eq!(sh.export_env.get("Z"), Some(""));
    let o = run_in(&mut sh, &["export"], None).await;
    let want = if cfg!(windows) {
        "A=x=y\nZ=\nb=1\n"
    } else {
        "A=x=y\nB=1\nZ=\nb=2\n"
    };
    assert_eq!(o.stdout, want);
}

#[tokio::test]
async fn which_cases() {
    check(&["which"], "\n", "", 1).await;
    let long = format!("/{}", "a".repeat(4095));
    check(
        &["which", &long],
        &format!("which: {long} not found\n"),
        "",
        1,
    )
    .await;
    // Through a writer the "not found" line has no prefix.
    let cap = crate::bun_shell::io::SharedBuf::new();
    let ch = Channel::new();
    let reader = Reader::channel(ch.clone());
    let out = BuiltinOut::Fd {
        writer: Writer::channel(ch),
        captured: Some(cap.clone()),
    };
    let mut sh = ShellExecEnv::new(EnvMap::new(), "/");
    let o = run_in(&mut sh, &["which", "definitely-not-a-cmd"], Some(out)).await;
    assert_eq!(o.code, 1);
    assert_eq!(cap.to_vec(), b"definitely-not-a-cmd not found\n");
    drop(reader);
}

#[cfg(unix)]
#[tokio::test]
async fn which_finds_path_and_cwd() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();
    for d in ["path-dir", "cwd-dir"] {
        let p = dir.path().join(d).join("tool");
        std::fs::create_dir(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let env: EnvMap = [("PATH", format!("{root}/path-dir"))].into_iter().collect();
    let mut sh = ShellExecEnv::new(env, format!("{root}/cwd-dir"));
    let o = run_in(&mut sh, &["which", "tool", "./tool"], None).await;
    assert_eq!(
        o.stdout,
        format!("{root}/path-dir/tool\n{root}/cwd-dir/tool\n")
    );
    assert_eq!(o.code, 0);
}

#[test]
fn helpers() {
    assert_eq!(trim_subsequent_leading_chars("", b'\n'), "");
    assert_eq!(trim_subsequent_leading_chars("\n", b'\n'), "\n");
    assert_eq!(trim_subsequent_leading_chars("ab\n\n\n", b'\n'), "ab\n");
    assert_eq!(basename_any(""), "");
    assert_eq!(basename_any("//"), "/");
    assert_eq!(basename_any("é/ü/"), "ü");
    assert_eq!(dirname_posix("é/ü"), "é");
}
