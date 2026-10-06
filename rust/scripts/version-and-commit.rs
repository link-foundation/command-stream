#!/usr/bin/env rust-script
//! Bump version in Cargo.toml and commit changes
//! Used by the CI/CD pipeline for releases
//!
//! IMPORTANT: This script checks crates.io (the source of truth for Rust packages),
//! NOT git tags. This is critical because:
//! - Git tags can exist without the package being published
//! - GitHub releases create tags but don't publish to crates.io
//! - Only crates.io publication means users can actually install the package
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml and changelog.d/ in repository root
//! - Multi-language: Cargo.toml and changelog.d/ in rust/ subfolder
//!
//! Usage: rust-script scripts/version-and-commit.rs --bump-type <major|minor|patch> [--description <desc>] [--rust-root <path>] [--tag-prefix <prefix>] [--release-label <label>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1.13.1"
//! chrono = "0.4.45"
//! ureq = "3.4.2"
//! serde = { version = "1.0.229", features = ["derive"] }
//! serde_json = "1.0.151"
//! ```

// `rust-script --test` builds this file as a test harness, where `main` is not
// the entry point. Everything reachable only from `main` -- most of the file --
// is therefore unreferenced, and the pipeline's RUSTFLAGS=-Dwarnings turns that
// into a build failure. The imports below were already gated on `not(test)` for
// the same reason. The real, non-test build still denies dead code.
#![cfg_attr(test, allow(dead_code))]

#[cfg(not(test))]
use chrono::Utc;
use regex::Regex;
#[cfg(not(test))]
use serde::Deserialize;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(not(test))]
use std::process::exit;

#[path = "rust-paths.rs"]
mod rust_paths;

#[path = "release-git.rs"]
mod release_git;

const REPOSITORY_RULE_PATTERNS: &[&str] = &[
    "gh006",
    "gh013",
    "repository rule violations",
    "changes must be made through a pull request",
    "protected branch",
    "push declined",
];

const NON_FAST_FORWARD_PATTERNS: &[&str] =
    &["non-fast-forward", "fetch first", "updates were rejected"];

#[derive(Debug, PartialEq, Eq)]
enum PushFailure {
    /// A repository ruleset refuses the push; retrying cannot fix policy.
    RepositoryRules,
    /// The remote branch moved; rebase onto it and try again.
    LostRace,
    /// Anything else: report the real error instead of masking it.
    Other,
}

fn classify_push_failure(raw_output: &str) -> PushFailure {
    let haystack = raw_output.to_lowercase();
    // Rules first: a ruleset rejection also contains the word "rejected".
    if REPOSITORY_RULE_PATTERNS
        .iter()
        .any(|pattern| haystack.contains(pattern))
    {
        return PushFailure::RepositoryRules;
    }
    if NON_FAST_FORWARD_PATTERNS
        .iter()
        .any(|pattern| haystack.contains(pattern))
    {
        return PushFailure::LostRace;
    }
    PushFailure::Other
}

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "./changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn get_changelog_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./CHANGELOG.md".to_string()
    } else {
        format!("{}/CHANGELOG.md", rust_root)
    }
}

fn set_output(key: &str, value: &str) {
    if let Ok(output_file) = env::var("GITHUB_OUTPUT") {
        if let Err(e) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&output_file)
            .and_then(|mut f| writeln!(f, "{}={}", key, value))
        {
            eprintln!("Warning: Could not write to GITHUB_OUTPUT: {}", e);
        }
    }
    println!("Output: {}={}", key, value);
}

fn exec(command: &str, args: &[&str]) -> Result<String, String> {
    match Command::new(command).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Command failed: {}", stderr))
            }
        }
        Err(e) => Err(format!("Failed to execute: {}", e)),
    }
}

fn exec_check(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

struct Version {
    major: u32,
    minor: u32,
    patch: u32,
    #[allow(dead_code)]
    pre_release: Option<String>,
}

impl Version {
    fn parse(content: &str) -> Option<Version> {
        let re = Regex::new(r#"(?m)^version\s*=\s*"(\d+)\.(\d+)\.(\d+)(?:-([^"]+))?""#).ok()?;
        let caps = re.captures(content)?;
        Some(Version {
            major: caps.get(1)?.as_str().parse().ok()?,
            minor: caps.get(2)?.as_str().parse().ok()?,
            patch: caps.get(3)?.as_str().parse().ok()?,
            pre_release: caps.get(4).map(|m| m.as_str().to_string()),
        })
    }

    fn bump(&self, bump_type: &str) -> String {
        match bump_type {
            "major" => format!("{}.0.0", self.major + 1),
            "minor" => format!("{}.{}.0", self.major, self.minor + 1),
            _ => format!("{}.{}.{}", self.major, self.minor, self.patch + 1),
        }
    }
}

fn update_cargo_toml(cargo_toml_path: &str, new_version: &str) -> Result<(), String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^(version\s*=\s*")[^"]+(")"#).unwrap();
    let new_content = re.replace(&content, format!("${{1}}{}${{2}}", new_version).as_str());

    fs::write(cargo_toml_path, new_content.as_ref())
        .map_err(|e| format!("Failed to write {}: {}", cargo_toml_path, e))?;

    println!("Updated {} to version {}", cargo_toml_path, new_version);
    Ok(())
}

fn update_cargo_lock(
    cargo_lock_path: &Path,
    crate_name: &str,
    new_version: &str,
) -> Result<bool, String> {
    if !cargo_lock_path.exists() {
        println!(
            "No Cargo.lock at {} (skipping lock-file version sync)",
            cargo_lock_path.display()
        );
        return Ok(false);
    }

    let path_str = cargo_lock_path.to_string_lossy();
    let content = fs::read_to_string(cargo_lock_path)
        .map_err(|e| format!("Failed to read {}: {}", path_str, e))?;

    let pattern = format!(
        r#"(?m)(\[\[package\]\]\s*\nname\s*=\s*"{}"\s*\nversion\s*=\s*")[^"]+(")"#,
        regex::escape(crate_name),
    );
    let re =
        Regex::new(&pattern).map_err(|e| format!("Failed to build Cargo.lock regex: {}", e))?;

    if !re.is_match(&content) {
        println!(
            "Warning: Could not find [[package]] entry for `{}` in {} (lock file left untouched)",
            crate_name, path_str
        );
        return Ok(false);
    }

    let new_content = re.replace(&content, format!("${{1}}{}${{2}}", new_version).as_str());

    if new_content == content {
        println!("Cargo.lock already at version {}", new_version);
        return Ok(false);
    }

    fs::write(cargo_lock_path, new_content.as_ref())
        .map_err(|e| format!("Failed to write {}: {}", path_str, e))?;

    println!("Updated {} to version {}", path_str, new_version);
    Ok(true)
}

/// The benchmarks crate depends on this package by path and CI checks it with
/// `--locked`, so a release must bump the package version in its lock file too.
fn get_benchmarks_cargo_lock_path(rust_root: &str) -> PathBuf {
    Path::new(rust_root).join("benchmarks").join("Cargo.lock")
}

/// Sync the package version in every given lock file, returning the paths of
/// the lock files that were changed and therefore need to be staged.
fn update_cargo_locks(
    cargo_lock_paths: &[&Path],
    crate_name: &str,
    new_version: &str,
) -> Result<Vec<String>, String> {
    let mut updated = Vec::new();
    for cargo_lock_path in cargo_lock_paths {
        if update_cargo_lock(cargo_lock_path, crate_name, new_version)? {
            updated.push(cargo_lock_path.to_string_lossy().to_string());
        }
    }
    Ok(updated)
}

#[cfg(not(test))]
#[derive(Deserialize)]
struct CratesIoCrate {
    versions: Option<Vec<CratesIoVersionEntry>>,
}

#[cfg(not(test))]
#[derive(Deserialize)]
struct CratesIoVersionEntry {
    num: String,
    yanked: bool,
}

fn get_crate_name(cargo_toml_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^name\s*=\s*"([^"]+)""#).unwrap();

    if let Some(caps) = re.captures(&content) {
        Ok(caps.get(1).unwrap().as_str().to_string())
    } else {
        Err(format!("Could not find name in {}", cargo_toml_path))
    }
}

fn check_tag_exists(tag_prefix: &str, version: &str) -> bool {
    exec_check("git", &["rev-parse", &format!("{}{}", tag_prefix, version)])
}

#[cfg(not(test))]
fn check_version_on_crates_io(crate_name: &str, version: &str) -> bool {
    let url = format!("https://crates.io/api/v1/crates/{}/{}", crate_name, version);
    match ureq::get(&url)
        .header("User-Agent", "rust-script-version-and-commit")
        .call()
    {
        Ok(response) => response.status() == 200,
        Err(ureq::Error::StatusCode(404)) => false,
        Err(error) => {
            eprintln!("::error::crates.io availability is unknown: {}", error);
            exit(1);
        }
    }
}

#[cfg(not(test))]
fn get_max_published_version(crate_name: &str) -> Option<(u32, u32, u32)> {
    let url = format!("https://crates.io/api/v1/crates/{}", crate_name);
    match ureq::get(&url)
        .header("User-Agent", "rust-script-version-and-commit")
        .call()
    {
        Ok(mut response) => {
            if response.status() == 200 {
                if let Ok(body) = response.body_mut().read_to_string() {
                    if let Ok(data) = serde_json::from_str::<CratesIoCrate>(&body) {
                        if let Some(versions) = data.versions {
                            let mut max: Option<(u32, u32, u32)> = None;
                            for v in &versions {
                                if v.yanked {
                                    continue;
                                }
                                let base = match v.num.split('-').next() {
                                    Some(b) => b,
                                    None => continue,
                                };
                                let parts: Vec<&str> = base.split('.').collect();
                                if parts.len() == 3 {
                                    if let (Ok(a), Ok(b), Ok(c)) = (
                                        parts[0].parse::<u32>(),
                                        parts[1].parse::<u32>(),
                                        parts[2].parse::<u32>(),
                                    ) {
                                        let tuple = (a, b, c);
                                        if max.map_or(true, |m| tuple > m) {
                                            max = Some(tuple);
                                        }
                                    }
                                }
                            }
                            return max;
                        }
                    }
                }
            }
            eprintln!("::error::Invalid crates.io package metadata; refusing to guess a version");
            exit(1)
        }
        Err(ureq::Error::StatusCode(404)) => None,
        Err(error) => {
            eprintln!("::error::crates.io versions are unknown: {}", error);
            exit(1);
        }
    }
}

#[cfg(not(test))]
fn ensure_version_exceeds_published(
    version_str: &str,
    crate_name: &str,
    tag_prefix: &str,
    max_published: Option<(u32, u32, u32)>,
) -> String {
    let parts: Vec<&str> = version_str
        .split('-')
        .next()
        .unwrap_or(version_str)
        .split('.')
        .collect();
    if parts.len() != 3 {
        return version_str.to_string();
    }

    let mut major: u32 = parts[0].parse().unwrap_or(0);
    let mut minor: u32 = parts[1].parse().unwrap_or(0);
    let mut patch: u32 = parts[2].parse().unwrap_or(0);

    if let Some((pub_major, pub_minor, pub_patch)) = max_published {
        if (major, minor, patch) <= (pub_major, pub_minor, pub_patch) {
            println!(
                "Version {}.{}.{} is not greater than max published {}.{}.{}, adjusting to {}.{}.{}",
                major,
                minor,
                patch,
                pub_major,
                pub_minor,
                pub_patch,
                pub_major,
                pub_minor,
                pub_patch + 1
            );
            major = pub_major;
            minor = pub_minor;
            patch = pub_patch + 1;
        }
    }

    let mut candidate = format!("{}.{}.{}", major, minor, patch);
    let mut safety_counter = 0;
    while (check_tag_exists(tag_prefix, &candidate)
        || check_version_on_crates_io(crate_name, &candidate))
        && safety_counter < 100
    {
        println!(
            "Version {} already has a git tag or is published on crates.io, bumping patch",
            candidate
        );
        patch += 1;
        candidate = format!("{}.{}.{}", major, minor, patch);
        safety_counter += 1;
    }

    if safety_counter >= 100 {
        eprintln!("Error: Could not find an unpublished version after 100 attempts");
        exit(1);
    }

    candidate
}

fn strip_frontmatter(content: &str) -> String {
    let re = Regex::new(r"(?s)^---\s*\n.*?\n---\s*\n(.*)$").unwrap();
    if let Some(caps) = re.captures(content) {
        caps.get(1).unwrap().as_str().trim().to_string()
    } else {
        content.trim().to_string()
    }
}

#[cfg(not(test))]
fn collect_changelog(changelog_dir: &str, changelog_file: &str, version: &str) {
    let dir_path = Path::new(changelog_dir);
    if !dir_path.exists() {
        return;
    }

    let mut files: Vec<_> = match fs::read_dir(dir_path) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map_or(false, |ext| ext == "md")
                    && p.file_name().map_or(false, |name| name != "README.md")
            })
            .collect(),
        Err(_) => return,
    };

    if files.is_empty() {
        return;
    }

    files.sort();

    let fragments: Vec<String> = files
        .iter()
        .filter_map(|f| fs::read_to_string(f).ok())
        .map(|c| strip_frontmatter(&c))
        .filter(|c| !c.is_empty())
        .collect();

    if fragments.is_empty() {
        return;
    }

    let date_str = Utc::now().format("%Y-%m-%d").to_string();
    let new_entry = format!(
        "\n## [{}] - {}\n\n{}\n",
        version,
        date_str,
        fragments.join("\n\n")
    );

    if Path::new(changelog_file).exists() {
        let mut content = fs::read_to_string(changelog_file).unwrap_or_default();
        let lines: Vec<&str> = content.lines().collect();
        let mut insert_index = None;

        for (i, line) in lines.iter().enumerate() {
            if line.starts_with("## [") {
                insert_index = Some(i);
                break;
            }
        }

        if let Some(idx) = insert_index {
            let mut new_lines: Vec<String> = lines[..idx].iter().map(|s| s.to_string()).collect();
            new_lines.push(new_entry.clone());
            new_lines.extend(lines[idx..].iter().map(|s| s.to_string()));
            content = new_lines.join("\n");
        } else {
            content.push_str(&new_entry);
        }

        fs::write(changelog_file, content).expect("Failed to write changelog");
    }

    println!("Collected {} changelog fragment(s)", files.len());

    for file in files {
        if let Err(e) = fs::remove_file(&file) {
            eprintln!(
                "Warning: could not remove consumed changelog fragment {}: {}",
                file.display(),
                e
            );
        }
    }
}

#[cfg(test)]
#[path = "version-and-commit/tests.rs"]
mod tests;

#[cfg(not(test))]
fn main() {
    let bump_type = match get_arg("bump-type") {
        Some(bt) => bt,
        None => {
            eprintln!(
                "Usage: rust-script scripts/version-and-commit.rs --bump-type <major|minor|patch> [--description <desc>] [--rust-root <path>] [--tag-prefix <prefix>] [--release-label <label>]"
            );
            exit(1);
        }
    };

    if !["major", "minor", "patch"].contains(&bump_type.as_str()) {
        eprintln!(
            "Invalid bump type: {}. Must be major, minor, or patch.",
            bump_type
        );
        exit(1);
    }

    let description = get_arg("description");
    let tag_prefix = get_arg("tag-prefix").unwrap_or_else(|| "v".to_string());
    let release_label = get_arg("release-label");
    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let changelog_dir = get_changelog_dir(&rust_root);
    let changelog_file = get_changelog_path(&rust_root);

    // Configure git
    exec("git", &["config", "user.name", "github-actions[bot]"]).unwrap_or_else(|e| {
        eprintln!("Git configuration failed: {}", e);
        exit(1)
    });
    exec(
        "git",
        &[
            "config",
            "user.email",
            "41898282+github-actions[bot]@users.noreply.github.com",
        ],
    )
    .unwrap_or_else(|e| {
        eprintln!("Git configuration failed: {}", e);
        exit(1)
    });

    // Sync with the latest remote state BEFORE touching any files.
    //
    // This must happen while the working tree is clean: `git rebase` refuses to
    // run with a dirty index ("cannot rebase: Your index contains uncommitted
    // changes"). Rebasing after staging the version bump is what previously
    // broke the release job. Rebasing first also means the version bump is
    // computed from the most recent state of the branch (matches the JS
    // version-and-commit.mjs ordering).
    let current_branch = exec("git", &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|e| {
        eprintln!("Branch detection failed: {}", e);
        exit(1)
    });
    if let Err(e) = exec("git", &["fetch", "origin", &current_branch]) {
        eprintln!(
            "::error::Could not refresh origin/{}: {}",
            current_branch, e
        );
        exit(1);
    } else {
        let local = exec("git", &["rev-parse", "HEAD"]).unwrap_or_else(|e| {
            eprintln!("Local revision lookup failed: {}", e);
            exit(1)
        });
        let remote = exec("git", &["rev-parse", &format!("origin/{}", current_branch)])
            .unwrap_or_else(|e| {
                eprintln!("Remote revision lookup failed: {}", e);
                exit(1)
            });
        if !local.is_empty() && !remote.is_empty() && local != remote {
            println!("Local branch is behind remote, rebasing...");
            if let Err(e) = exec("git", &["rebase", &format!("origin/{}", current_branch)]) {
                eprintln!("Error rebasing onto origin/{}: {}", current_branch, e);
                let _ = exec("git", &["rebase", "--abort"]);
                exit(1);
            }
        }
    }

    // Get current version
    let content = match fs::read_to_string(&package_manifest) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading {}: {}", package_manifest.display(), e);
            exit(1);
        }
    };

    let current = match Version::parse(&content) {
        Some(v) => v,
        None => {
            eprintln!(
                "Error: Could not parse version from {}",
                package_manifest.display()
            );
            exit(1);
        }
    };

    let initial_bump = current.bump(&bump_type);

    let crate_name = match get_crate_name(package_manifest.to_string_lossy().as_ref()) {
        Ok(name) => name,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    let max_published = get_max_published_version(&crate_name);
    if let Some((ma, mi, pa)) = max_published {
        println!("Max published version on crates.io: {}.{}.{}", ma, mi, pa);
    } else {
        println!("No versions published on crates.io yet (or crate not found)");
    }

    println!(
        "Initial bump ({}) from {}.{}.{}: {}",
        bump_type, current.major, current.minor, current.patch, initial_bump
    );

    let new_version =
        ensure_version_exceeds_published(&initial_bump, &crate_name, &tag_prefix, max_published);

    if new_version != initial_bump {
        println!(
            "Adjusted version from {} to {} to exceed published versions",
            initial_bump, new_version
        );
    }

    println!("Final release version: {}", new_version);

    // Update version in Cargo.toml
    if let Err(e) = update_cargo_toml(package_manifest.to_string_lossy().as_ref(), &new_version) {
        eprintln!("Error: {}", e);
        exit(1);
    }

    let cargo_lock_path = rust_paths::get_cargo_lock_path(&rust_root);
    let benchmarks_lock_path = get_benchmarks_cargo_lock_path(&rust_root);
    match update_cargo_locks(
        &[cargo_lock_path.as_path(), benchmarks_lock_path.as_path()],
        &crate_name,
        &new_version,
    ) {
        Ok(updated) => {
            for path in updated {
                println!("Updated lockfile {}", path);
            }
        }
        Err(e) => {
            eprintln!("Error updating Cargo.lock: {}", e);
            exit(1);
        }
    };

    // Collect changelog fragments
    collect_changelog(&changelog_dir, &changelog_file, &new_version);

    // Stage Cargo.toml, Cargo.lock files if changed, CHANGELOG.md, and consumed fragments
    let release_repo = env::current_dir().unwrap_or_else(|e| {
        eprintln!("Working directory lookup failed: {}", e);
        exit(1)
    });
    release_git::stage_release_metadata(&release_repo, &rust_root).unwrap_or_else(|e| {
        eprintln!("Release staging failed: {}", e);
        exit(1)
    });

    // Check if there are changes to commit
    if exec_check("git", &["diff", "--cached", "--quiet"]) {
        println!("No changes to commit");
        set_output("version_committed", "false");
        set_output("new_version", &new_version);
        return;
    }

    // Commit changes
    let label_suffix = release_label
        .as_ref()
        .map(|l| format!(" ({})", l))
        .unwrap_or_default();
    let commit_msg = match &description {
        Some(desc) => format!(
            "chore: release {}{}{}\n\n{}",
            tag_prefix, new_version, label_suffix, desc
        ),
        None => format!(
            "chore: release {}{}{}",
            tag_prefix, new_version, label_suffix
        ),
    };

    if let Err(e) = exec("git", &["commit", "-m", &commit_msg]) {
        eprintln!("Error committing: {}", e);
        exit(1);
    }
    println!("Committed version {}", new_version);

    // Prepare the tag; create it only after all push/rebase retries finish.
    let tag_name = format!("{}{}", tag_prefix, new_version);
    let tag_msg = match &description {
        Some(desc) => format!("Release {}{}\n\n{}", tag_name, label_suffix, desc),
        None => format!("Release {}{}", tag_name, label_suffix),
    };

    if let Err(e) = release_git::push_release(&release_repo, &current_branch, &tag_name, &tag_msg) {
        eprintln!("Error pushing release: {}", e);
        exit(1);
    }
    println!("Pushed changes and tags");

    set_output("version_committed", "true");
    set_output("new_version", &new_version);
}
