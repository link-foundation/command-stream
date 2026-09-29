//! Port of the zx core unit tests (`test/core.test.js`: `$`, options,
//! `cd()`, `within()`, `kill()` and the shell presets) for
//! `command_stream::zx`. Process-level features (pipes, kill, timeouts,
//! output accessors) live in `zx_process.rs`.

// Shell-backed tests are unix-only; on Windows their helpers go unused.
#![cfg_attr(not(unix), allow(unused))]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use command_stream::zx;
use command_stream::zx::shell::{BASH_PREFIX, POWERSHELL_POSTFIX};
use command_stream::zx::{
    cd, configure, current_options, kill, quote, quote_powershell, sleep, use_bash, use_powershell,
    use_pwsh, within, within_sync, Options, PreferLocal, ProcessOutput, Shell,
};

/// Unwrap either side of a command result.
fn settled(result: Result<ProcessOutput, ProcessOutput>) -> ProcessOutput {
    result.unwrap_or_else(|e| e)
}

fn basename(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn scratch_dir(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("zx-rs-{tag}-{}", std::process::id()))
}

// zx:test/core.test.js:55:5:registration
#[test]
fn resolve_env_overrides_known_opts() {
    let mut opts = Options::builtin();
    opts.verbose = false;
    opts.resolve_env(
        "ZX_",
        [("ZX_VERBOSE", "true"), ("ZX_PREFER_LOCAL", "/foo/bar/")],
    );
    assert!(opts.verbose);
    assert_eq!(
        opts.prefer_local,
        PreferLocal::Dirs(vec![PathBuf::from("/foo/bar/")])
    );
}

// zx:test/core.test.js:64:5:registration
#[test]
fn resolve_env_ignores_unknown() {
    let mut opts = Options::builtin();
    opts.resolve_env("ZX_", [("ZX_INPUT", "input"), ("ZX_FOO", "test")]);
    assert_eq!(opts.input, None);
    let defaults = Options::builtin();
    assert_eq!(opts.prefix, defaults.prefix);
    assert_eq!(opts.shell, defaults.shell);
}

// zx:test/core.test.js:75:5:registration
#[cfg(unix)]
#[tokio::test]
async fn dollar_is_a_regular_function() {
    let sh = Shell::new();
    let foo = zx!(sh.clone(), "echo foo").await.unwrap();
    assert_eq!(foo.stdout, "foo\n");
    let bar = sh.command("echo bar").await.unwrap();
    assert_eq!(bar.stdout, "bar\n");
}

// zx:test/core.test.js:83:5:registration
#[cfg(unix)]
#[tokio::test]
async fn only_stdout_is_used_during_command_substitution() {
    let sh = Shell::new().quiet(true);
    let hello = zx!(sh.clone(), "echo Error >&2; echo Hello").await.unwrap();
    let len = zx!(sh, "echo {} | wc -c", &hello).await.unwrap();
    assert_eq!(len.value_of().trim().parse::<usize>().unwrap(), 6);
}

// zx:test/core.test.js:89:5:registration
#[cfg(unix)]
#[tokio::test]
async fn env_vars_works() {
    std::env::set_var("ZX_RS_TEST_FOO", "foo");
    let foo = zx!("echo $ZX_RS_TEST_FOO").await.unwrap();
    std::env::remove_var("ZX_RS_TEST_FOO");
    assert_eq!(foo.stdout, "foo\n");
}

// zx:test/core.test.js:96:5:registration
#[cfg(unix)]
#[tokio::test]
async fn env_vars_are_safe_to_pass() {
    let bar = zx!(
        Shell::new().env_var("ZX_TEST_BAR", "hi; exit 1"),
        "echo $ZX_TEST_BAR"
    )
    .await
    .unwrap();
    assert_eq!(bar.stdout, "hi; exit 1\n");
}

// zx:test/core.test.js:103:5:registration
#[cfg(unix)]
#[tokio::test]
async fn arguments_are_quoted() {
    let bar = "bar\"\";baz!$#^$'&*~*%)({}||\\/";
    let out = zx!("echo {}", bar).await.unwrap();
    assert_eq!(out.stdout.trim(), bar);
}

// zx:test/core.test.js:108:5:registration
#[cfg(unix)]
#[tokio::test]
async fn broken_quoting() {
    let args = vec!["param && echo bar"];
    let out = zx!("echo --foo=$'{}'", args).await.unwrap();
    assert_eq!(out.stdout, "--foo=$param\nbar\n");
}

// zx:test/core.test.js:114:5:registration
#[cfg(unix)]
#[tokio::test]
async fn empty_string_correctly_quoted() {
    assert_eq!(zx!("echo -n {}", "").await.unwrap().to_string(), "");
}

// zx:test/core.test.js:181:5:registration
#[cfg(unix)]
#[tokio::test]
async fn can_create_a_dir_with_a_space_in_the_name() {
    let name = format!("{} foo bar", scratch_dir("space").display());
    let made = zx!("mkdir {}", &name).await;
    let removed = std::fs::remove_dir(&name);
    assert!(made.is_ok());
    assert!(removed.is_ok());
}

// zx:test/core.test.js:192:5:registration
#[cfg(unix)]
#[tokio::test]
async fn pipefail_is_on() {
    let p = settled(zx!(Shell::new().quiet(true), "cat /dev/not_found | sort").await);
    assert_ne!(p.exit_code, Some(0));
}

// zx:test/core.test.js:202:5:registration
#[cfg(unix)]
#[tokio::test]
async fn to_string_is_called_on_arguments() {
    let foo = 0;
    assert_eq!(zx!("echo {}", foo).await.unwrap().stdout, "0\n");
}

// zx:test/core.test.js:208:5:registration
#[cfg(unix)]
#[tokio::test]
async fn can_use_array_as_an_argument() {
    let sh = Shell::new().prefix("").postfix("");
    let p1 = zx!(sh.clone(), "echo {}", vec!["-n", "foo"]);
    assert_eq!(p1.cmd(), "echo -n foo");
    assert_eq!(p1.await.unwrap().to_string(), "foo");

    let p2 = zx!(sh, "echo {}", vec!["1", "", "*", "2"]);
    assert_eq!(p2.cmd(), "echo 1 $'' $'*' 2");
    assert_eq!(p2.await.unwrap().to_string(), "1  * 2\n");
}

// zx:test/core.test.js:219:5:registration
#[cfg(unix)]
#[tokio::test]
async fn requires_shell_to_be_specified() {
    let err = within(async {
        configure(|o| o.shell = None);
        zx!("echo foo").await.unwrap_err()
    })
    .await;
    assert!(err.message().contains("shell"));
}

// zx:test/core.test.js:226:5:registration
#[cfg(unix)]
#[tokio::test]
async fn malformed_cmd_error() {
    let err = Shell::new().cmd(&["echo ", ""], &[]).await.unwrap_err();
    assert!(err.message().to_lowercase().contains("malformed"));

    let o = Shell::new()
        .nothrow(true)
        .cmd(&["a", "b", "c"], &[])
        .await
        .unwrap();
    assert!(!o.ok());
    assert!(o
        .error
        .unwrap()
        .message
        .to_lowercase()
        .contains("malformed"));
}

// zx:test/core.test.js:242:5:registration
#[cfg(unix)]
#[tokio::test]
async fn snapshots_works() {
    let out = within(async {
        configure(|o| o.prefix.push_str("echo success;"));
        let p = zx!(":");
        configure(|o| o.prefix.push_str("echo fail;"));
        p.await.unwrap()
    })
    .await;
    assert_eq!(out.stdout, "success\n");
    assert!(!out.stdout.contains("fail"));
}

// zx:test/core.test.js:253:5:registration
#[cfg(unix)]
#[tokio::test]
async fn dollar_thrown_as_error() {
    let err = zx!(Shell::new().quiet(true), "wtf").await.unwrap_err();
    assert!(err.exit_code.unwrap() > 0);
    assert!(err.to_string().contains("command not found"));
    assert!(err.value_of().contains("command not found"));
    assert!(err.stderr.contains("wtf: command not found"));
    assert!(err.message().contains("Command not found"));
}

// zx:test/core.test.js:267:5:registration
#[cfg(unix)]
#[tokio::test]
async fn provides_clear_error_when_cwd_does_not_exist() {
    let err = within(async {
        configure(|o| o.cwd = Some(PathBuf::from("/path/that/does/not/exist")));
        zx!("echo hello").await.unwrap_err()
    })
    .await;
    assert!(err
        .message()
        .contains("The working directory '/path/that/does/not/exist' does not exist"));
}

// zx:test/core.test.js:284:5:registration
#[cfg(unix)]
#[tokio::test]
async fn exit_code_does_not_throw() {
    let sh = Shell::new().cwd(env!("CARGO_MANIFEST_DIR")).nothrow(true);
    let miss = zx!(sh.clone(), "grep qwerty-zx-rs Cargo.toml")
        .await
        .unwrap();
    assert_ne!(miss.exit_code, Some(0));
    let hit = zx!(sh, "[[ -f Cargo.toml ]]").await.unwrap();
    assert_eq!(hit.exit_code, Some(0));
}

// zx:test/core.test.js:289:5:registration
#[cfg(unix)]
#[test]
fn run_sync_provides_synchronous_api() {
    let o1 = zx!("echo foo").run_sync().unwrap();
    let o2 = zx!(Shell::new().nothrow(true), "echo foo")
        .run_sync()
        .unwrap();
    assert_eq!(o1.stdout, "foo\n");
    assert_eq!(o2.stdout, "foo\n");
}

// zx:test/core.test.js:313:7:registration
#[cfg(unix)]
#[tokio::test]
async fn provides_presets() {
    let s1 = Shell::new().nothrow(true);
    assert_eq!(zx!(s1.clone(), "exit 1").await.unwrap().exit_code, Some(1));
    let s2 = s1.clone().quiet(true);
    assert_eq!(zx!(s2, "exit 2").run_sync().unwrap().exit_code, Some(2));
    let s3 = Shell::new().quiet(true).nothrow(true);
    assert_eq!(zx!(s3, "exit 3").run_sync().unwrap().exit_code, Some(3));
    assert_eq!(zx!(s1, "exit 4").run_sync().unwrap().exit_code, Some(4));
}

// zx:test/core.test.js:327:7:registration
#[cfg(unix)]
#[tokio::test]
async fn handles_nothrow_option() {
    let o1 = zx!(Shell::new().nothrow(true), "exit 1").await.unwrap();
    assert!(!o1.ok());
    assert_eq!(o1.exit_code, Some(1));
    assert!(o1.message().contains("exit code: 1"));

    // A spawn failure (zx: a throwing `spawn`) also resolves under nothrow.
    let broken = Shell::new().nothrow(true).shell("/zx-rs/no/such/shell");
    let o2 = zx!(broken, "echo foo").await.unwrap();
    assert!(!o2.ok());
    assert_eq!(o2.exit_code, None);
    assert!(o2.error.is_some());
}

// zx:test/core.test.js:346:7:registration
#[cfg(unix)]
#[tokio::test]
async fn handles_input_option() {
    let p1 = zx!(Shell::new().input("foo"), "cat").await.unwrap();
    let p3 = zx!(Shell::new().input(b"baz".to_vec()), "cat")
        .await
        .unwrap();
    let p4 = zx!("printf baz").pipe(zx!("cat")).await.unwrap();
    let p5 = zx!(Shell::new().input(p3.stdout.clone()), "cat")
        .await
        .unwrap();
    assert_eq!(p1.stdout, "foo");
    assert_eq!(p3.stdout, "baz");
    assert_eq!(p4.stdout, "baz");
    assert_eq!(p5.stdout, "baz");
}

// zx:test/core.test.js:360:7:registration
#[cfg(unix)]
#[tokio::test]
async fn handles_timeout_and_timeout_signal() {
    let sh = Shell::new()
        .timeout(Duration::from_millis(10))
        .timeout_signal("SIGKILL");
    let err = zx!(sh, "sleep 999").await.unwrap_err();
    assert_eq!(err.exit_code, None);
    assert_eq!(err.signal.as_deref(), Some("SIGKILL"));
}

// zx:test/core.test.js:375:7:registration
#[cfg(unix)]
#[tokio::test]
async fn env_option() {
    let env = HashMap::from([("ZX_TEST_BAZ".to_string(), "baz".to_string())]);
    let baz = zx!(Shell::new().env(env), "echo $ZX_TEST_BAZ")
        .await
        .unwrap();
    assert_eq!(baz.stdout, "baz\n");
}

// zx:test/core.test.js:382:7:registration
#[cfg(unix)]
#[tokio::test]
async fn prefer_local_preserves_env() {
    let path = std::env::var("PATH").unwrap_or_default();
    let env = HashMap::from([("PATH".to_string(), path)]);
    let cwd = std::env::current_dir().unwrap();
    let cases = [
        (
            Shell::new().prefer_local(true),
            format!("{0}/node_modules/.bin:{0}:", cwd.display()),
        ),
        (
            Shell::new().prefer_local_dirs(vec!["/foo".into()]),
            "/foo/node_modules/.bin:/foo:".to_string(),
        ),
        (
            Shell::new().prefer_local_dirs(vec!["/bar".into(), "/baz".into()]),
            "/bar/node_modules/.bin:/bar:/baz/node_modules/.bin:/baz".to_string(),
        ),
    ];
    for (sh, expected) in cases {
        let out = zx!(sh.env(env.clone()), "echo $PATH").await.unwrap();
        assert!(
            out.stdout.contains(&expected),
            "{} !~ {expected}",
            out.stdout
        );
    }
}

// zx:test/core.test.js:637:5:registration
#[cfg(unix)]
#[tokio::test]
async fn resolves_with_process_output() {
    let o: ProcessOutput = zx!("echo foo").await.unwrap();
    assert!(o.ok());
}

// zx:test/core.test.js:642:5:registration
#[test]
fn cmd_returns_cmd_to_exec() {
    let foo = "#bar";
    let baz = 1;
    let p = zx!(Shell::new().use_bash(), "echo {} --t {}", foo, baz);
    assert_eq!(p.cmd(), "echo $'#bar' --t 1");
    let prefix = if zx::which("bash").is_some() {
        BASH_PREFIX
    } else {
        ""
    };
    assert_eq!(p.full_cmd(), format!("{prefix}echo $'#bar' --t 1"));
}

// zx:test/core.test.js:650:5:registration
#[cfg(unix)]
#[tokio::test]
async fn stdin_works() {
    let out = zx!("read; printf $REPLY").input("bar\n").await.unwrap();
    assert_eq!(out.stdout, "bar");
}

// zx:test/core.test.js:1578:5:registration
#[cfg(unix)]
#[tokio::test]
async fn cd_works_with_relative_paths() {
    let root = scratch_dir("cd-test");
    std::fs::create_dir_all(root.join("one/two")).unwrap();
    let process_cwd = std::env::current_dir().unwrap();
    let results = within(async {
        cd(root.join("one/two")).unwrap();
        let p1 = zx!("pwd");
        assert!(current_options().cwd.unwrap().ends_with("two"));
        cd("..").unwrap();
        let p2 = zx!("pwd");
        assert!(current_options().cwd.unwrap().ends_with("one"));
        cd("..").unwrap();
        let p3 = zx!("pwd");
        assert_eq!(basename(current_options().cwd.unwrap()), basename(&root));
        let (o1, o2, o3) = tokio::join!(p1.run(), p2.run(), p3.run());
        [o1, o2, o3].map(|o| basename(o.unwrap().stdout.trim()))
    })
    .await;
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(std::env::current_dir().unwrap(), process_cwd);
    assert_eq!(results, ["two".to_string(), "one".into(), basename(&root)]);
}

// zx:test/core.test.js:1609:5:registration
#[cfg(unix)]
#[tokio::test]
async fn cd_does_not_affect_parallel_contexts() {
    let root = scratch_dir("cd-parallel");
    std::fs::create_dir_all(root.join("one/two")).unwrap();
    let cwd = current_options().cwd;
    let a = within(async {
        cd(root.join("one")).unwrap();
        sleep(Duration::from_millis(7)).await;
        current_options().cwd.unwrap().ends_with("one")
    });
    let b = within(async {
        sleep(Duration::from_millis(3)).await;
        current_options().cwd == cwd
    });
    let c = within(async {
        sleep(Duration::from_millis(5)).await;
        configure(|o| o.cwd = Some(root.join("one/two")));
        let out = zx!("pwd").await.unwrap();
        out.stdout.trim().ends_with("/one/two")
    });
    let (a, b, c) = tokio::join!(a, b, c);
    std::fs::remove_dir_all(&root).unwrap();
    assert!(a && b && c);
    assert_eq!(current_options().cwd, cwd);
}

// zx:test/core.test.js:1648:5:registration
#[test]
fn cd_fails_on_entering_not_existing_dir() {
    assert!(within_sync(|| cd("/tmp/abra-kadabra-zx-rs")).is_err());
}

// zx:test/core.test.js:1652:5:registration
#[cfg(unix)]
#[tokio::test]
async fn cd_accepts_process_output() {
    let (tmp, cwd) = within(async {
        let tmp = zx!("mktemp -d").await.unwrap();
        cd(&tmp).unwrap();
        (tmp, current_options().cwd.unwrap())
    })
    .await;
    let dir = tmp.to_string().trim_end().to_string();
    assert_eq!(basename(&cwd), basename(&dir));
    std::fs::remove_dir(&dir).unwrap();
}

// zx:test/core.test.js:1665:5:registration
#[tokio::test]
async fn kill_throws_if_pid_is_invalid() {
    for pid in ["", "foo", "100 foo", "100.1", "-1", "null"] {
        let err = kill(pid, None).await.unwrap_err();
        assert!(err.message().contains("Invalid"), "{pid}");
    }
    assert!(kill(100.1, None).await.is_err());
}

// zx:test/core.test.js:1685:5:registration
#[tokio::test]
async fn within_just_works() {
    within(async {
        configure(|o| o.verbose = false);
        within_sync(|| configure(|o| o.verbose = true));
        assert!(!current_options().verbose);

        let inner = within(async {
            configure(|o| o.verbose = true);
            sleep(Duration::from_millis(10)).await;
            current_options().verbose
        });
        let outer = async {
            sleep(Duration::from_millis(5)).await;
            current_options().verbose
        };
        let (inner, outer) = tokio::join!(inner, outer);
        assert!(inner);
        assert!(!outer);
    })
    .await;
}

// zx:test/core.test.js:1710:5:registration
#[cfg(unix)]
#[tokio::test]
async fn within_keeps_the_cwd_ref_for_internal_calls() {
    let pwd = zx!("pwd").await.unwrap();
    let inner = within(async {
        cd("/tmp").unwrap();
        let first = zx!("pwd").await.unwrap();
        sleep(Duration::from_millis(10)).await;
        let second = zx!("pwd").await.unwrap();
        (first.stdout, second.stdout)
    });
    let outer = async { zx!("pwd").await.unwrap() };
    let ((first, second), outer) = tokio::join!(inner, outer);
    let tmp = std::fs::canonicalize("/tmp").unwrap();
    assert_eq!(first.trim(), tmp.display().to_string());
    assert_eq!(second.trim(), tmp.display().to_string());
    assert_eq!(outer.stdout, pwd.stdout);
}

// zx:test/core.test.js:1733:5:registration
#[tokio::test]
async fn within_isolates_nested_context_and_returns_result() {
    within(async {
        configure(|o| o.verbose = false);
        let res = within(async {
            configure(|o| o.verbose = true);
            within(async {
                assert!(current_options().verbose);
                configure(|o| o.verbose = false);
                within(async {
                    assert!(!current_options().verbose);
                    configure(|o| o.verbose = true);
                    "foo"
                })
                .await
            })
            .await
        })
        .await;
        assert!(!current_options().verbose);
        assert_eq!(res, "foo");
    })
    .await;
}

// Upstream stubs `which.sync`; here the preset resolves the real executable
// (`C:\...\pwsh.exe` on Windows), so compare the file stem.
fn assert_powershell(opts: &Options, shell: &str) {
    let stem = |path: &str| {
        std::path::Path::new(path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
    };
    assert_eq!(stem(opts.shell.as_deref().unwrap()), stem(shell));
    assert_eq!(opts.prefix, "");
    assert_eq!(opts.postfix, POWERSHELL_POSTFIX);
    assert_eq!((opts.quote)("it's"), quote_powershell("it's"));
}

// zx:test/core.test.js:1765:5:registration
#[test]
fn use_pwsh_preset() {
    let opts = within_sync(|| {
        use_pwsh();
        current_options()
    });
    assert_powershell(&opts, "pwsh");
    assert_eq!(opts.postfix, "; exit $LastExitCode");
}

// zx:test/core.test.js:1773:5:registration
#[test]
fn use_powershell_preset() {
    let opts = within_sync(|| {
        use_powershell();
        current_options()
    });
    assert_powershell(&opts, "powershell.exe");
}

// zx:test/core.test.js:1781:5:registration
#[cfg(unix)]
#[test]
fn use_bash_preset() {
    let opts = within_sync(|| {
        use_pwsh();
        use_bash();
        current_options()
    });
    if zx::which("bash").is_some() {
        assert!(opts.shell.as_deref().unwrap().ends_with("bash"));
        assert_eq!(opts.prefix, "set -euo pipefail;");
    }
    assert_eq!(opts.postfix, "");
    assert_eq!((opts.quote)("it's"), quote("it's"));
}
