use super::*;
use crate::bun_shell::builtin::{BuiltinIn, BuiltinKind, BuiltinOut};
use crate::bun_shell::builtins;
use crate::bun_shell::env::{EnvMap, ShellExecEnv};
use std::path::Path;

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Run `cp args` in `cwd` (the builtin is constructed directly: on POSIX
/// `from_argv0` only knows `cp` with the experimental env var set).
async fn run(cwd: &str, args: &[&str]) -> Out {
    let mut shell = ShellExecEnv::new(EnvMap::new(), cwd);
    let mut b = Builtin {
        kind: BuiltinKind::Cp,
        args: args.iter().map(|s| s.to_string()).collect(),
        shell: &mut shell,
        stdin: BuiltinIn::Ignore,
        stdout: BuiltinOut::Buf(Which::Stdout),
        stderr: BuiltinOut::Buf(Which::Stderr),
    };
    let code = builtins::run(&mut b).await;
    drop(b);
    Out {
        code,
        stdout: String::from_utf8_lossy(&shell.buffered_stdout.take()).into_owned(),
        stderr: String::from_utf8_lossy(&shell.buffered_stderr.take()).into_owned(),
    }
}

async fn check(cwd: &str, args: &[&str], stdout: &str, stderr: &str, code: i32) {
    let o = run(cwd, args).await;
    assert_eq!(
        (o.stdout.as_str(), o.stderr.as_str(), o.code),
        (stdout, stderr, code),
        "{args:?}"
    );
}

/// A temp dir with the given files (parents created).
fn tree(files: &[(&str, &str)]) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    for (name, contents) in files {
        let p = dir.path().join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, contents).unwrap();
    }
    let cwd = dir.path().to_string_lossy().into_owned();
    (dir, cwd)
}

/// The upstream uutils fixture.
fn uutils() -> (tempfile::TempDir, String) {
    tree(&[
        ("hello_world.txt", "Hello, World!"),
        ("existing_file.txt", "Cogito ergo sum."),
        ("how_are_you.txt", "How are you?"),
        ("hello_dir/hello.txt", ""),
        ("hello_dir_with_file/hello_world.txt", "Hello, World!"),
    ])
}

fn read(cwd: &str, p: &str) -> String {
    fs::read_to_string(Path::new(cwd).join(p)).unwrap()
}

fn exists(cwd: &str, p: &str) -> bool {
    Path::new(cwd).join(p).exists()
}

fn abs(cwd: &str, p: &str) -> String {
    node_path::join(&[cwd, p])
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

const USAGE: &str = "usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n";

#[test]
fn parse_opts_cases() {
    let o = Opts::default();
    let r = Opts {
        recursive: true,
        ..o
    };
    let v = Opts { verbose: true, ..o };
    assert_eq!(parse_opts(&s(&["a", "b"])), Parsed::Rest(o, 0));
    assert_eq!(parse_opts(&s(&["", "b"])), Parsed::Rest(o, 0));
    assert_eq!(parse_opts(&s(&["-R", "a", "b"])), Parsed::Rest(r, 1));
    assert_eq!(parse_opts(&s(&["-Rv", "a", "b"])), Parsed::Rest(r, 1));
    assert_eq!(parse_opts(&s(&["-vR", "a", "b"])), Parsed::Rest(v, 1));
    assert_eq!(parse_opts(&s(&["-n", "a", "b"])), Parsed::Rest(o, 1));
    assert_eq!(parse_opts(&s(&[])), Parsed::Usage);
    assert_eq!(parse_opts(&s(&["-nR"])), Parsed::Usage);
    assert_eq!(parse_opts(&s(&["-"])), Parsed::Illegal("-".into()));
    assert_eq!(parse_opts(&s(&["-rx", "a"])), Parsed::Illegal("rx".into()));
    assert_eq!(
        parse_opts(&s(&["-\u{e9}", "a"])),
        Parsed::Illegal("\u{e9}".into())
    );
    for ch in ["f", "H", "i", "L", "P"] {
        assert_eq!(
            parse_opts(&s(&[&format!("-{ch}x"), "a"])),
            Parsed::Unsupported(format!("-{ch}"))
        );
    }
    assert_eq!(
        parse_opts(&s(&["-p", "a"])),
        Parsed::Unsupported("-P".into())
    );
}

#[tokio::test]
async fn option_errors() {
    let (_dir, cwd) = tree(&[]);
    for args in [&[][..], &["a"], &["-nR"], &["-R", "a"]] {
        check(&cwd, args, "", USAGE, 1).await;
    }
    check(&cwd, &["-x", "a", "b"], "", "cp: illegal option -- x\n", 1).await;
    check(&cwd, &["-Z", "a", "b"], "", "cp: illegal option -- Z\n", 1).await;
    check(&cwd, &["-r", "d", "e"], "", "cp: illegal option -- r\n", 1).await;
    check(&cwd, &["-", "a"], "", "cp: illegal option -- -\n", 1).await;
    let unsupported = "cp: unsupported option, please open a GitHub issue -- ";
    check(
        &cwd,
        &["-p", "a", "b"],
        "",
        &format!("{unsupported}-P\n"),
        1,
    )
    .await;
    check(
        &cwd,
        &["-f", "a", "b"],
        "",
        &format!("{unsupported}-f\n"),
        1,
    )
    .await;
}

#[tokio::test]
async fn file_errors() {
    let (_dir, cwd) = tree(&[("f.txt", "hi\n"), ("d/x", "x")]);
    let enoent = |p: &str| format!("cp: No such file or directory: {}\n", abs(&cwd, p));
    check(&cwd, &["-Rv", "a", "b"], "", &enoent("a"), 1).await;
    check(&cwd, &["nope", "x"], "", &enoent("nope"), 1).await;
    check(
        &cwd,
        &["f.txt", "f.txt"],
        "",
        "cp: f.txt and f.txt are identical (not copied)\n",
        1,
    )
    .await;
    check(
        &cwd,
        &["f.txt", "nodir/"],
        "",
        "cp: nodir/ is not a directory\n",
        1,
    )
    .await;
    assert!(!exists(&cwd, "nodir"));
    check(
        &cwd,
        &["d/x", "f.txt", "nodir"],
        "",
        "cp: nodir is not a directory\ncp: nodir is not a directory\n",
        1,
    )
    .await;
    check(
        &cwd,
        &["-v", "f.txt", "d", "f.txt"],
        "",
        "cp: f.txt and f.txt are identical (not copied)\ncp: d is a directory (not copied)\n",
        1,
    )
    .await;
    check(
        &cwd,
        &["-R", "d", "nod1", "nod2"],
        "",
        &format!("cp: directory nod2 does not exist\n{}", enoent("nod1")),
        1,
    )
    .await;
}

#[tokio::test]
async fn file_to_file() {
    let (_dir, cwd) = tree(&[
        ("lmao.txt", "contents\n"),
        ("lmao2.txt", "old contents that are longer\n"),
    ]);
    let want = format!("{} -> {}\n", abs(&cwd, "lmao.txt"), abs(&cwd, "lmao3.txt"));
    check(&cwd, &["-v", "lmao.txt", "lmao3.txt"], &want, "", 0).await;
    assert_eq!(read(&cwd, "lmao3.txt"), "contents\n");
    // An existing file is replaced (and truncated).
    let want = format!("{} -> {}\n", abs(&cwd, "lmao.txt"), abs(&cwd, "lmao2.txt"));
    check(&cwd, &["-v", "lmao.txt", "lmao2.txt"], &want, "", 0).await;
    assert_eq!(read(&cwd, "lmao2.txt"), "contents\n");
    // Absolute operands.
    let (src, dst) = (abs(&cwd, "lmao.txt"), abs(&cwd, "abs.txt"));
    check(&cwd, &[&src, &dst], "", "", 0).await;
    assert_eq!(read(&cwd, "abs.txt"), "contents\n");
}

#[tokio::test]
async fn files_to_dir() {
    let (_dir, cwd) = tree(&[("lmao.txt", "1"), ("lmao2.txt", "2"), ("lmao3/.keep", "")]);
    let line = |f: &str| {
        format!(
            "{} -> {}\n",
            abs(&cwd, f),
            node_path::join(&[&abs(&cwd, "lmao3"), f])
        )
    };
    check(&cwd, &["-v", "lmao.txt", "lmao3"], &line("lmao.txt"), "", 0).await;
    let want = format!("{}{}", line("lmao.txt"), line("lmao2.txt"));
    check(
        &cwd,
        &["-v", "lmao.txt", "lmao2.txt", "lmao3"],
        &want,
        "",
        0,
    )
    .await;
    assert_eq!(read(&cwd, "lmao3/lmao.txt"), "1");
    assert_eq!(read(&cwd, "lmao3/lmao2.txt"), "2");

    // The same file many times into a directory.
    let (_dir, cwd) = tree(&[("hello.txt", "hi!\n"), ("somedir/.keep", "")]);
    let mut args = vec!["hello.txt"; 50];
    args.push("somedir");
    check(&cwd, &args, "", "", 0).await;
    assert_eq!(read(&cwd, "somedir/hello.txt"), "hi!\n");
}

#[tokio::test]
async fn dirs_without_recursive() {
    let (_dir, cwd) = tree(&[("lmao/.keep", ""), ("lmao2/.keep", "")]);
    let o = run(&cwd, &["-v", "lmao", "lmao2", "lmao3"]).await;
    let mut lines: Vec<&str> = o.stderr.lines().collect();
    lines.sort();
    assert_eq!(
        lines,
        [
            "cp: lmao is a directory (not copied)",
            "cp: lmao2 is a directory (not copied)"
        ]
    );
    assert_eq!((o.code, o.stdout.as_str()), (1, ""));
    assert!(!exists(&cwd, "lmao3"));
}

#[tokio::test]
async fn uutils_cases() {
    let (_dir, cwd) = uutils();
    check(
        &cwd,
        &["hello_world.txt", "copy_of_hello_world.txt"],
        "",
        "",
        0,
    )
    .await;
    assert_eq!(read(&cwd, "copy_of_hello_world.txt"), "Hello, World!");

    let (_dir, cwd) = uutils();
    check(&cwd, &["hello_world.txt", "existing_file.txt"], "", "", 0).await;
    assert_eq!(read(&cwd, "existing_file.txt"), "Hello, World!");

    let (_dir, cwd) = uutils();
    check(
        &cwd,
        &["hello_world.txt", "hello_world.txt", "hello_dir/"],
        "",
        "",
        0,
    )
    .await;
    assert_eq!(read(&cwd, "hello_dir/hello_world.txt"), "Hello, World!");

    let (_dir, cwd) = uutils();
    fs::write(Path::new(&cwd).join("a"), "").unwrap();
    check(
        &cwd,
        &["a", "a"],
        "",
        "cp: a and a are identical (not copied)\n",
        1,
    )
    .await;

    let (_dir, cwd) = uutils();
    let args = ["hello_world.txt", "hello_world.txt", "existing_file.txt"];
    let msg = "cp: existing_file.txt is not a directory\n";
    check(&cwd, &args, "", &msg.repeat(2), 1).await;
    assert_eq!(read(&cwd, "existing_file.txt"), "Cogito ergo sum.");

    let (_dir, cwd) = uutils();
    let msg = "cp: hello_dir/ is a directory (not copied)\n";
    check(&cwd, &["hello_dir/", "copy_of_hello_world.txt"], "", msg, 1).await;
    assert!(!exists(&cwd, "copy_of_hello_world.txt"));

    let (_dir, cwd) = uutils();
    check(
        &cwd,
        &["hello_world.txt", "how_are_you.txt", "hello_dir/"],
        "",
        "",
        0,
    )
    .await;
    assert_eq!(read(&cwd, "hello_dir/hello_world.txt"), "Hello, World!");
    assert_eq!(read(&cwd, "hello_dir/how_are_you.txt"), "How are you?");

    let (_dir, cwd) = uutils();
    check(
        &cwd,
        &["-R", "hello_dir_with_file/", "hello_dir_new"],
        "",
        "",
        0,
    )
    .await;
    assert_eq!(read(&cwd, "hello_dir_new/hello_world.txt"), "Hello, World!");
}

#[tokio::test]
async fn recursive() {
    let (_dir, cwd) = tree(&[("d/x", "x"), ("d/sub/y", "y")]);
    check(&cwd, &["-R", "d", "e"], "", "", 0).await;
    assert_eq!(
        (read(&cwd, "e/x"), read(&cwd, "e/sub/y")),
        ("x".into(), "y".into())
    );
    // Into an existing directory: `e/d`.
    check(&cwd, &["-R", "d", "e"], "", "", 0).await;
    assert_eq!(read(&cwd, "e/d/sub/y"), "y");
    // A file into a missing path: the parents are created.
    check(&cwd, &["-R", "d/x", "zz/qq"], "", "", 0).await;
    assert_eq!(read(&cwd, "zz/qq"), "x");

    // -v (not `-Rv`, which is just -R): directories first, then files.
    let o = run(&cwd, &["-R", "-v", "d", "e2"]).await;
    assert_eq!((o.code, o.stderr.as_str()), (0, ""));
    let (d, e) = (abs(&cwd, "d"), abs(&cwd, "e2"));
    let lines: Vec<&str> = o.stdout.lines().collect();
    let dirs = [format!("{d} -> {e}"), format!("{d}/sub -> {e}/sub")];
    assert_eq!(lines[..2], dirs);
    let mut files = lines[2..].to_vec();
    files.sort();
    assert_eq!(
        files,
        [format!("{d}/sub/y -> {e}/sub/y"), format!("{d}/x -> {e}/x")]
    );
    let o = run(&cwd, &["-Rv", "d", "e3"]).await;
    assert_eq!((o.code, o.stdout.as_str(), o.stderr.as_str()), (0, "", ""));
}

#[cfg(unix)]
#[tokio::test]
async fn unix_specifics() {
    use std::os::unix::fs::PermissionsExt;

    let (_dir, cwd) = tree(&[("f.txt", "hi\n"), ("d/x", "x")]);
    // A directory into a file.
    let msg = format!("cp: Not a directory: {}/d\n", abs(&cwd, "f.txt"));
    check(&cwd, &["-R", "d", "f.txt"], "", &msg, 1).await;

    // The mode is copied.
    let f = Path::new(&cwd).join("f.txt");
    fs::set_permissions(&f, fs::Permissions::from_mode(0o640)).unwrap();
    check(&cwd, &["f.txt", "g.txt"], "", "", 0).await;
    let mode = fs::metadata(Path::new(&cwd).join("g.txt"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o7777, 0o640);

    // Symlinks are recreated with absolute targets.
    std::os::unix::fs::symlink("f.txt", Path::new(&cwd).join("link")).unwrap();
    std::os::unix::fs::symlink("../f.txt", Path::new(&cwd).join("d/dlink")).unwrap();
    check(&cwd, &["link", "copy"], "", "", 0).await;
    let target = fs::read_link(Path::new(&cwd).join("copy")).unwrap();
    assert_eq!(target.to_string_lossy(), abs(&cwd, "f.txt"));
    check(&cwd, &["-R", "d", "e"], "", "", 0).await;
    let target = fs::read_link(Path::new(&cwd).join("e/dlink")).unwrap();
    assert_eq!(target.to_string_lossy(), abs(&cwd, "f.txt"));
    // Recreating an existing link: EEXIST is ignored.
    check(&cwd, &["link", "copy"], "", "", 0).await;

    // Other non-regular files are not supported.
    nix::unistd::mkfifo(&Path::new(&cwd).join("fifo"), nix::sys::stat::Mode::S_IRWXU).unwrap();
    check(
        &cwd,
        &["fifo", "copy2"],
        "",
        "cp: Operation not supported\n",
        1,
    )
    .await;
}

#[cfg(windows)]
#[tokio::test]
async fn windows_backslash_target() {
    let (_dir, cwd) = tree(&[("f.txt", "hi\n")]);
    check(
        &cwd,
        &["f.txt", "nodir\\"],
        "",
        "cp: nodir\\ is not a directory\n",
        1,
    )
    .await;
    check(&cwd, &["-R", "f.txt", "a\\b\\c"], "", "", 0).await;
    assert_eq!(read(&cwd, "a/b/c"), "hi\n");
}

#[test]
fn mkdir_recursive_cases() {
    let (_dir, cwd) = tree(&[("file", "")]);
    let deep = abs(&cwd, "a/b/c");
    assert_eq!(mkdir_recursive(&deep), Ok(()));
    assert!(is_directory(&deep));
    // Existing directories are fine, with or without a trailing separator.
    assert_eq!(mkdir_recursive(&deep), Ok(()));
    assert_eq!(mkdir_recursive(&format!("{}/", abs(&cwd, "a/b"))), Ok(()));
    let file = abs(&cwd, "file");
    assert_eq!(mkdir_recursive(&file).unwrap_err().path, file);
    assert_eq!(mkdir_recursive("").unwrap_err().code, "ENOENT");
}

#[test]
fn copy_single_file_errors() {
    let (_dir, cwd) = tree(&[]);
    let err = copy_single_file(&abs(&cwd, "nope"), &abs(&cwd, "x")).unwrap_err();
    assert_eq!((err.code, err.path), ("ENOENT", abs(&cwd, "nope")));
    let err = cp_async(
        &cwd,
        &abs(&cwd, "x"),
        false,
        &mut Log {
            verbose: false,
            out: String::new(),
        },
    )
    .unwrap_err();
    assert_eq!(
        (err.code, err.path, err.syscall),
        ("EISDIR", cwd.clone(), "copyfile")
    );
}
