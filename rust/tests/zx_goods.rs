//! Port of the zx goods unit tests (`test/goods.test.ts`: sleep, retry,
//! expBackoff, spinner, echo, temp*, which, glob) for `command_stream::zx`.

// Shell-backed tests are unix-only; on Windows their helpers go unused.
#![cfg_attr(not(unix), allow(unused))]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use command_stream::zx;
use command_stream::zx::goods::{echo_line, glob_in, sleep_for, spinner_enabled};
use command_stream::zx::{
    configure, exp_backoff, glob, retry, retry_with_backoff, retry_with_delay, sleep, spinner,
    tempdir, tempfile, which, within,
};

// zx:test/goods.test.ts:97:3:registration
#[test]
fn echo_works() {
    assert_eq!(echo_line(["foo", "bar", "baz"]), "foo bar baz");
    assert_eq!(echo_line(Vec::<String>::new()), "");
    assert!(echo_line([1, 2]).contains('1'));
    zx::echo(["foo"]);
}

// zx:test/goods.test.ts:114:3:registration
#[tokio::test]
async fn sleep_works() {
    let now = Instant::now();
    sleep(Duration::from_millis(100)).await;
    assert!(now.elapsed() >= Duration::from_millis(99));

    let now = Instant::now();
    sleep_for("20ms").await.unwrap();
    assert!(now.elapsed() >= Duration::from_millis(19));
    assert!(sleep_for("20parsecs").await.is_err());
}

// zx:test/goods.test.ts:121:5:registration
#[tokio::test]
async fn retry_works() {
    let count = AtomicUsize::new(0);
    let result: Result<&str, String> = retry(5, || async {
        let n = count.fetch_add(1, Ordering::SeqCst) + 1;
        if n < 5 {
            Err("fail".to_string())
        } else {
            Ok("success")
        }
    })
    .await;
    assert_eq!(result.unwrap(), "success");
    assert_eq!(count.load(Ordering::SeqCst), 5);
}

// zx:test/goods.test.ts:132:5:registration
#[tokio::test]
async fn retry_with_custom_delay_and_limit() {
    let now = Instant::now();
    let count = AtomicUsize::new(0);
    let result: Result<(), String> = retry_with_delay(3, Duration::from_millis(2), || async {
        count.fetch_add(1, Ordering::SeqCst);
        Err("fail".to_string())
    })
    .await;
    assert!(result.unwrap_err().contains("fail"));
    assert!(now.elapsed() >= Duration::from_millis(4));
    assert_eq!(count.load(Ordering::SeqCst), 3);
}

// zx:test/goods.test.ts:147:5:registration
#[tokio::test]
async fn retry_count_is_clamped_to_one_attempt() {
    // zx rejects with `undefined` for a zero count; here the count is clamped
    // so the callback still runs once.
    let count = AtomicUsize::new(0);
    let result: Result<&str, ()> = retry(0, || async {
        count.fetch_add(1, Ordering::SeqCst);
        Ok("ok")
    })
    .await;
    assert_eq!(result, Ok("ok"));
    assert_eq!(count.load(Ordering::SeqCst), 1);

    let failed: Result<(), &str> = retry(0, || async { Err("fail") }).await;
    assert_eq!(failed, Err("fail"));
}

// zx:test/goods.test.ts:164:5:registration
#[tokio::test]
async fn retry_supports_exp_backoff() {
    let count = AtomicUsize::new(0);
    let delays = exp_backoff(Duration::from_millis(10), Duration::from_millis(1));
    let result: Result<&str, &str> = retry_with_backoff(5, delays, || async {
        if count.fetch_add(1, Ordering::SeqCst) < 2 {
            Err("fail")
        } else {
            Ok("success")
        }
    })
    .await;
    assert_eq!(result, Ok("success"));
    assert_eq!(count.load(Ordering::SeqCst), 3);
}

// zx:test/goods.test.ts:173:5:registration
#[cfg(unix)]
#[tokio::test]
async fn retry_integration() {
    let now = Instant::now();
    let err = retry_with_delay(5, Duration::from_millis(50), || {
        zx!("exit 123").quiet().run()
    })
    .await
    .unwrap_err();
    assert_eq!(err.exit_code, Some(123));
    assert!(now.elapsed() >= Duration::from_millis(50 * 4));

    let ok = retry(5, || zx!("exit 0").run()).await.unwrap();
    assert!(ok.ok());
}

// zx:test/goods.test.ts:189:5:registration
#[cfg(unix)]
#[tokio::test]
async fn retry_integration_with_exp_backoff() {
    let now = Instant::now();
    let delays = exp_backoff(Duration::from_secs(60), Duration::from_millis(2));
    let err = retry_with_backoff(5, delays, || zx!("exit 123").quiet().run())
        .await
        .unwrap_err();
    assert_eq!(err.exit_code, Some(123));
    assert!(now.elapsed() >= Duration::from_millis(2 + 4 + 8 + 16));
}

// zx:test/goods.test.ts:205:3:registration
#[test]
fn exp_backoff_works() {
    let mut g = exp_backoff(Duration::from_secs(10), Duration::from_millis(100));
    let got: Vec<u128> = (0..3).map(|_| g.next().unwrap().as_millis()).collect();
    assert_eq!(got, [100, 200, 400]);

    let capped: Vec<u128> = exp_backoff(Duration::from_millis(300), Duration::from_millis(100))
        .take(4)
        .map(|d| d.as_millis())
        .collect();
    assert_eq!(capped, [100, 200, 300, 300]);

    let defaults: Vec<u128> = zx::goods::exp_backoff_default()
        .take(2)
        .map(|d| d.as_millis())
        .collect();
    assert_eq!(defaults, [100, 200]);
}

// zx:test/goods.test.ts:220:5:registration
#[tokio::test]
async fn spinner_works() {
    let value = spinner("", async {
        sleep(Duration::from_millis(100)).await;
        42
    })
    .await;
    assert_eq!(value, 42);
}

// zx:test/goods.test.ts:260:7:registration
#[tokio::test]
async fn spinner_with_title_disables_verbose_inside() {
    // Like zx, a disabled spinner (CI, no TTY) just runs the future.
    let (inside, outside) = within(async {
        configure(|o| o.verbose = true);
        let inside = spinner("processing", async { zx::current_options().verbose }).await;
        (inside, zx::current_options().verbose)
    })
    .await;
    assert_eq!(inside, !spinner_enabled());
    assert!(outside);
}

// zx:test/goods.test.ts:270:7:registration
#[tokio::test]
async fn spinner_disabled_in_ci_or_without_tty() {
    use std::io::IsTerminal;
    let expected = std::env::var_os("CI").is_none() && std::io::stderr().is_terminal();
    assert_eq!(spinner_enabled(), expected);
    let quiet = within(async {
        configure(|o| o.quiet = true);
        spinner_enabled()
    })
    .await;
    assert!(!quiet);
}

// zx:test/goods.test.ts:280:7:registration
#[tokio::test]
async fn spinner_stops_on_error() {
    let result: Result<(), &str> = spinner("", async {
        sleep(Duration::from_millis(10)).await;
        Err("fail")
    })
    .await;
    assert_eq!(result, Err("fail"));
}

// zx:test/goods.test.ts:452:5:registration
#[test]
fn tempdir_creates_temporary_folders() {
    let dir = tempdir(None).unwrap();
    assert!(dir.is_dir());
    assert!(dir
        .to_string_lossy()
        .contains(&format!("{}zx-", std::path::MAIN_SEPARATOR)));
    let named = tempdir(Some("zx-rs-goods-foo")).unwrap();
    assert!(named.is_dir());
    assert!(named
        .to_string_lossy()
        .ends_with(&format!("{}zx-rs-goods-foo", std::path::MAIN_SEPARATOR)));
    std::fs::remove_dir_all(dir).unwrap();
}

// zx:test/goods.test.ts:458:5:registration
#[test]
fn tempfile_creates_temporary_files() {
    let plain = tempfile(None, None).unwrap();
    assert!(plain.is_file());
    assert!(plain
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("zx-"));

    let named = tempfile(Some("foo.txt"), None).unwrap();
    let parent = named
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy();
    assert!(parent.starts_with("zx-"));
    assert!(named
        .to_string_lossy()
        .ends_with(&format!("{}foo.txt", std::path::MAIN_SEPARATOR)));

    let tf = tempfile(Some("bar.txt"), Some(b"bar")).unwrap();
    assert!(tf
        .to_string_lossy()
        .ends_with(&format!("{}bar.txt", std::path::MAIN_SEPARATOR)));
    assert_eq!(std::fs::read_to_string(&tf).unwrap(), "bar");

    std::fs::remove_file(plain).unwrap();
    std::fs::remove_dir_all(named.parent().unwrap()).unwrap();
    std::fs::remove_dir_all(tf.parent().unwrap()).unwrap();
}

// Rust-only coverage (zx re-exports `which` without a unit test of its own).
#[cfg(unix)]
#[test]
fn which_finds_executables() {
    let sh = which("sh").expect("sh on PATH");
    assert!(sh.is_absolute());
    assert!(which("zx-rs-surely-not-a-binary").is_none());
}

// Rust-only coverage (zx re-exports globby without a unit test of its own).
#[test]
fn glob_expands_patterns() {
    let dir = tempdir(None).unwrap();
    for name in ["b.md", "a.md", "c.txt"] {
        std::fs::write(dir.join(name), "").unwrap();
    }
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    std::fs::write(dir.join("sub/d.md"), "").unwrap();

    let names: Vec<String> = glob_in(&dir, "*.md")
        .unwrap()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["a.md", "b.md"]);

    let deep = glob_in(&dir, "**/*.md").unwrap();
    assert_eq!(deep.len(), 3);

    let absolute = glob(&format!("{}/*.txt", dir.display())).unwrap();
    assert_eq!(absolute, [dir.join("c.txt")]);
    assert!(glob("[").is_err());
    std::fs::remove_dir_all(dir).unwrap();
}
