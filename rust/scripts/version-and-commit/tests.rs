use super::{
    classify_push_failure, get_benchmarks_cargo_lock_path, update_cargo_lock, update_cargo_locks,
    PushFailure,
};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("version-and-commit-{name}-{nanos}"));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn cargo_lock_update_scopes_to_named_package_entry() {
    let repo = temp_dir("lock-update");
    let cargo_lock = repo.join("Cargo.lock");
    fs::write(
        &cargo_lock,
        r#"[[package]]
name = "example-sum-package-name-helper"
version = "9.9.9"

[[package]]
name = "example-sum-package-name"
version = "0.13.0"
dependencies = [
 "clap",
]

[[package]]
name = "regex"
version = "1.12.3"
"#,
    )
    .unwrap();

    assert!(update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());

    let updated = fs::read_to_string(&cargo_lock).unwrap();
    assert!(updated.contains("name = \"example-sum-package-name\"\nversion = \"0.14.0\""));
    assert!(updated.contains("name = \"example-sum-package-name-helper\"\nversion = \"9.9.9\""));
    assert!(updated.contains("name = \"regex\"\nversion = \"1.12.3\""));
}

#[test]
fn cargo_lock_update_is_idempotent_when_version_already_matches() {
    let repo = temp_dir("lock-idempotent");
    let cargo_lock = repo.join("Cargo.lock");
    let content = r#"[[package]]
name = "example-sum-package-name"
version = "0.14.0"
"#;
    fs::write(&cargo_lock, content).unwrap();

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert_eq!(fs::read_to_string(&cargo_lock).unwrap(), content);
}

#[test]
fn cargo_lock_update_returns_false_when_lock_file_is_absent() {
    let repo = temp_dir("lock-absent");
    let cargo_lock = repo.join("Cargo.lock");

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert!(!cargo_lock.exists());
}

#[test]
fn cargo_lock_update_returns_false_when_package_entry_is_absent() {
    let repo = temp_dir("lock-entry-absent");
    let cargo_lock = repo.join("Cargo.lock");
    let content = r#"[[package]]
name = "regex"
version = "1.12.3"
"#;
    fs::write(&cargo_lock, content).unwrap();

    assert!(!update_cargo_lock(&cargo_lock, "example-sum-package-name", "0.14.0").unwrap());
    assert_eq!(fs::read_to_string(&cargo_lock).unwrap(), content);
}

/// Regression test: the rust-v1.1.0 release bumped rust/Cargo.lock but not
/// rust/benchmarks/Cargo.lock, so `cargo clippy --locked` in the benchmark
/// workflow failed with "cannot update the lock file ... --locked".
#[test]
fn cargo_locks_update_includes_benchmarks_lock_file() {
    let rust_root = temp_dir("locks-benchmarks");
    let rust_root_str = rust_root.to_string_lossy().to_string();
    let benchmarks_lock = get_benchmarks_cargo_lock_path(&rust_root_str);
    assert_eq!(
        benchmarks_lock,
        rust_root.join("benchmarks").join("Cargo.lock")
    );

    let cargo_lock = rust_root.join("Cargo.lock");
    fs::create_dir_all(benchmarks_lock.parent().unwrap()).unwrap();
    let content = r#"[[package]]
name = "example-sum-package-name"
version = "0.13.0"
"#;
    fs::write(&cargo_lock, content).unwrap();
    fs::write(&benchmarks_lock, content).unwrap();

    let updated = update_cargo_locks(
        &[cargo_lock.as_path(), benchmarks_lock.as_path()],
        "example-sum-package-name",
        "0.14.0",
    )
    .unwrap();

    assert_eq!(
        updated,
        vec![
            cargo_lock.to_string_lossy().to_string(),
            benchmarks_lock.to_string_lossy().to_string(),
        ]
    );
    for lock in [&cargo_lock, &benchmarks_lock] {
        assert!(fs::read_to_string(lock)
            .unwrap()
            .contains("name = \"example-sum-package-name\"\nversion = \"0.14.0\""));
    }
}

#[test]
fn cargo_locks_update_skips_missing_benchmarks_lock_file() {
    let rust_root = temp_dir("locks-no-benchmarks");
    let rust_root_str = rust_root.to_string_lossy().to_string();
    let benchmarks_lock = get_benchmarks_cargo_lock_path(&rust_root_str);
    let cargo_lock = rust_root.join("Cargo.lock");
    fs::write(
        &cargo_lock,
        "[[package]]\nname = \"example-sum-package-name\"\nversion = \"0.13.0\"\n",
    )
    .unwrap();

    let updated = update_cargo_locks(
        &[cargo_lock.as_path(), benchmarks_lock.as_path()],
        "example-sum-package-name",
        "0.14.0",
    )
    .unwrap();

    assert_eq!(updated, vec![cargo_lock.to_string_lossy().to_string()]);
    assert!(!benchmarks_lock.exists());
}

/// Regression test for issue #164: the Rust release job failed with
/// "cannot rebase: Your index contains uncommitted changes." because the
/// script staged the version bump (`git add`) and only afterwards ran
/// `git rebase origin/main`. `git rebase` refuses to run with a dirty
/// index, so the release must rebase onto the remote BEFORE staging.
///
/// This test reproduces both orderings against a real temporary repository
/// and asserts the buggy order fails while the fixed order succeeds.
#[test]
fn rebase_must_run_before_staging_the_version_bump() {
    let repo = temp_dir("rebase-order");
    let git = |args: &[&str]| -> std::process::Output {
        Command::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .expect("failed to run git")
    };

    // Some CI images default to `master`; force the initial branch to main.
    git(&["init", "-q", "."]);
    git(&["checkout", "-q", "-b", "main"]);
    git(&["config", "user.email", "ci@example.com"]);
    git(&["config", "user.name", "ci"]);

    // Commit A: the state the release job checks out.
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.0\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    git(&["commit", "-qm", "A: initial"]);

    // Commit B on a parallel ref simulates origin/main advancing while the
    // release job was running (e.g. a concurrent release pushed to main).
    git(&["checkout", "-q", "-b", "upstream"]);
    fs::write(repo.join("remote.txt"), "remote change\n").unwrap();
    git(&["add", "remote.txt"]);
    git(&["commit", "-qm", "B: remote advanced"]);
    git(&["checkout", "-q", "main"]);

    // BUGGY ORDER: stage the bump first, then rebase -> git rejects the
    // dirty index. This is exactly what broke the release job.
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.1\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    let buggy = git(&["rebase", "upstream"]);
    assert!(
        !buggy.status.success(),
        "rebase unexpectedly succeeded with a dirty index"
    );
    let buggy_err = String::from_utf8_lossy(&buggy.stderr);
    assert!(
        buggy_err.contains("cannot rebase") || buggy_err.contains("uncommitted changes"),
        "unexpected rebase error: {buggy_err}"
    );

    // Reset back to a clean tree at commit A.
    let _ = git(&["rebase", "--abort"]);
    git(&["reset", "-q", "--hard", "HEAD"]);

    // FIXED ORDER: rebase while the tree is clean, THEN stage and commit.
    let fixed = git(&["rebase", "upstream"]);
    assert!(
        fixed.status.success(),
        "rebase with a clean tree failed: {}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    fs::write(repo.join("Cargo.toml"), "version = \"0.1.1\"\n").unwrap();
    git(&["add", "Cargo.toml"]);
    let commit = git(&["commit", "-qm", "chore: release 0.1.1"]);
    assert!(
        commit.status.success(),
        "commit after clean rebase failed: {}",
        String::from_utf8_lossy(&commit.stderr)
    );

    // The bump rides on top of the upstream commit, proving no work was lost.
    let log = git(&["log", "--oneline"]);
    let log_out = String::from_utf8_lossy(&log.stdout);
    assert!(log_out.contains("release 0.1.1"));
    assert!(log_out.contains("B: remote advanced"));
}

#[test]
fn repository_rules_are_not_retried_as_a_lost_race() {
    assert_eq!(
        classify_push_failure("GH013 repository rule violations [rejected] (fetch first)"),
        PushFailure::RepositoryRules
    );
    assert_eq!(
        classify_push_failure("updates were rejected (fetch first)"),
        PushFailure::LostRace
    );
    assert_eq!(
        classify_push_failure("authentication failed"),
        PushFailure::Other
    );
}
