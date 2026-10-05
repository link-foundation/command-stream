use super::{PushFailure, classify_push_failure};
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

pub fn stage_release_metadata(repo: &Path, rust_root: &str) -> Result<(), String> {
    let root = git(repo, &["rev-parse", "--show-toplevel"])?;
    let working_prefix = git(repo, &["rev-parse", "--show-prefix"])?;
    let prefix = if rust_root == "." {
        working_prefix.trim().to_owned()
    } else {
        format!(
            "{}{}/",
            working_prefix.trim(),
            rust_root.strip_prefix("./").unwrap_or(rust_root)
        )
    };
    let modified = git(
        repo,
        &[
            "-C",
            root.trim(),
            "ls-files",
            "--modified",
            "--deleted",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    let staged = git(
        repo,
        &["-C", root.trim(), "diff", "--cached", "--name-only", "-z"],
    )?;
    let files: BTreeSet<&str> = modified
        .split('\0')
        .chain(staged.split('\0'))
        .filter(|file| !file.is_empty())
        .collect();
    for file in &files {
        let Some(relative) = file.strip_prefix(&prefix) else {
            return Err("Release generated changes outside the package metadata allowlist".into());
        };
        let fragment = relative
            .strip_prefix("changelog.d/")
            .is_some_and(|name| name.ends_with(".md") && !name.contains('/'));
        if !fragment
            && !matches!(
                relative,
                "Cargo.toml" | "Cargo.lock" | "CHANGELOG.md" | "benchmarks/Cargo.lock"
            )
        {
            return Err("Release generated changes outside the package metadata allowlist".into());
        }
    }
    if !files.is_empty() {
        let mut args = vec!["-C", root.trim(), "add", "--"];
        args.extend(files);
        git(repo, &args)?;
    }
    Ok(())
}

pub fn push_release(repo: &Path, branch: &str, tag: &str, message: &str) -> Result<(), String> {
    for attempt in 1..=3 {
        match git(repo, &["push", "origin", branch]) {
            Ok(_) => break,
            Err(error) => {
                if classify_push_failure(&error) != PushFailure::LostRace || attempt == 3 {
                    return Err(error);
                }
                eprintln!(
                    "Push lost a race (attempt {}/3); rebasing on origin/{}",
                    attempt, branch
                );
                if let Err(rebase_error) = git(repo, &["pull", "--rebase", "origin", branch]) {
                    let _ = git(repo, &["rebase", "--abort"]);
                    return Err(rebase_error);
                }
            }
        }
    }
    // A retry can replace HEAD. Create the tag only after that commit is pushed,
    // matching the current Rust template, so the tag never names the old commit.
    git(repo, &["tag", "-a", tag, "-m", message])?;
    git(repo, &["push", "origin", tag])?;
    Ok(())
}
