#!/usr/bin/env rust-script
//! Check if a changelog fragment was added in the current PR
//!
//! This script validates that a changelog fragment is added in the PR diff,
//! not just checking if any fragments exist in the directory. This prevents
//! the check from incorrectly passing when there are leftover fragments
//! from previous PRs that haven't been released yet.
//!
//! Usage: rust-script scripts/check-changelog-fragment.rs
//!
//! Environment variables (set by GitHub Actions):
//!   - GITHUB_BASE_REF: Base branch name for PR (e.g., "main")
//!
//! Exit codes:
//!   - 0: Check passed (fragment added or no source changes)
//!   - 1: Check failed (source changes without changelog fragment)
//!
//! ```cargo
//! [dependencies]
//! regex = "1.13.1"
//! ```

use regex::Regex;
use std::env;
use std::path::Path;
use std::process::{exit, Command};

fn exec(command: &str, args: &[&str]) -> String {
    match Command::new(command).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                eprintln!("Error executing {} {:?}", command, args);
                eprintln!("{}", String::from_utf8_lossy(&output.stderr));
                exit(1)
            }
        }
        Err(e) => {
            eprintln!("Failed to execute {} {:?}: {}", command, args, e);
            exit(1)
        }
    }
}

fn get_rust_root() -> String {
    if let Ok(root) = env::var("RUST_ROOT") {
        if !root.is_empty() {
            return root;
        }
    }

    if Path::new("./Cargo.toml").exists() {
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        return "rust".to_string();
    }

    ".".to_string()
}

fn get_changed_files() -> Vec<String> {
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());
    eprintln!("Comparing against origin/{}...HEAD", base_ref);

    let output = exec(
        "git",
        &[
            "diff",
            "--name-only",
            &format!("origin/{}...HEAD", base_ref),
        ],
    );

    if output.is_empty() {
        return Vec::new();
    }

    output
        .lines()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

fn is_source_file(file_path: &str, rust_root: &str) -> bool {
    let prefix = if rust_root == "." {
        String::new()
    } else {
        format!("{}/", rust_root)
    };

    let source_patterns = [
        Regex::new(&format!(r"^{}src/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}tests/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}scripts/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}Cargo\.toml$", regex::escape(&prefix))).unwrap(),
    ];

    source_patterns
        .iter()
        .any(|pattern| pattern.is_match(file_path))
}

/// A fragment is a `.md` file directly in `<rust_root>/changelog.d/`: the only
/// files the release reads (`collect_fragments` in version-and-commit.rs and
/// collect-changelog.rs). Anything else -- a root `changelog.d/`, a
/// subdirectory -- used to pass this check and then be silently left out of
/// the release (issue #216).
fn is_changelog_fragment(file_path: &str, rust_root: &str) -> bool {
    let changelog_dir = if rust_root == "." {
        "changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    };

    let path = Path::new(file_path);
    path.parent() == Some(Path::new(&changelog_dir))
        && path.extension().is_some_and(|ext| ext == "md")
        && path.file_name().is_some_and(|name| name != "README.md")
}

/// The `bump:` value of a fragment's frontmatter must be one get-bump-type.rs
/// understands; a typo such as `bump: majr` was silently released as the
/// default patch bump (issue #216). A missing `bump:` keeps the default.
fn invalid_bump(content: &str) -> Option<String> {
    let frontmatter = Regex::new(r"(?s)^---\s*\n(.*?)\n---").unwrap();
    let bump = Regex::new(r"(?m)^\s*bump\s*:\s*(.+?)\s*$").unwrap();
    let value = bump
        .captures(frontmatter.captures(content)?.get(1)?.as_str())?
        .get(1)?
        .as_str()
        .to_string();
    (!matches!(value.as_str(), "patch" | "minor" | "major")).then_some(value)
}

fn main() {
    println!("Checking for changelog fragment in PR diff...\n");

    let rust_root = get_rust_root();
    if rust_root != "." {
        println!(
            "Detected multi-language repository (Rust root: {})",
            rust_root
        );
    }

    let changed_files = get_changed_files();

    if changed_files.is_empty() {
        println!("No changed files found");
        exit(0);
    }

    println!("Changed files:");
    for file in &changed_files {
        println!("  {}", file);
    }
    println!();

    // Count source files changed
    let source_changes: Vec<&String> = changed_files
        .iter()
        .filter(|f| is_source_file(f, &rust_root))
        .collect();
    let source_changed_count = source_changes.len();

    println!("Source files changed: {}", source_changed_count);
    if source_changed_count > 0 {
        for file in &source_changes {
            println!("  {}", file);
        }
    }
    println!();

    // Count changelog fragments added in this PR
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());
    let added = exec(
        "git",
        &[
            "diff",
            "--name-only",
            "--diff-filter=A",
            &format!("origin/{}...HEAD", base_ref),
        ],
    );
    let added_files: Vec<String> = added.lines().map(String::from).collect();
    let fragments_added: Vec<&String> = added_files
        .iter()
        .filter(|f| is_changelog_fragment(f, &rust_root))
        .collect();
    let fragment_added_count = fragments_added.len();

    println!("Changelog fragments added: {}", fragment_added_count);
    if fragment_added_count > 0 {
        for file in &fragments_added {
            println!("  {}", file);
        }
    }
    println!();

    let misplaced: Vec<&String> = added_files
        .iter()
        .filter(|f| f.contains("changelog.d/") && f.ends_with(".md"))
        .filter(|f| !f.ends_with("/README.md") && !is_changelog_fragment(f, &rust_root))
        .collect();
    for file in &misplaced {
        eprintln!(
            "::warning file={file}::Not a changelog fragment: the release only reads .md files directly in {rust_root}/changelog.d/"
        );
    }

    let mut invalid = false;
    for file in &fragments_added {
        let content = std::fs::read_to_string(file.as_str()).unwrap_or_default();
        if let Some(value) = invalid_bump(&content) {
            eprintln!("::error file={file}::Invalid bump '{value}': use patch, minor or major");
            invalid = true;
        }
    }
    if invalid {
        exit(1);
    }

    // Check if source files changed but no fragment was added
    if source_changed_count > 0 && fragment_added_count == 0 {
        eprintln!(
            "::error::No changelog fragment found in this PR. Please add a changelog entry in {rust_root}/changelog.d/"
        );
        eprintln!();
        eprintln!("To create a changelog fragment:");
        eprintln!("  Create a new .md file in changelog.d/ with your changes");
        eprintln!();
        eprintln!("See changelog.d/README.md for more information.");
        exit(1);
    }

    println!(
        "Changelog check passed (source files changed: {}, fragments added: {})",
        source_changed_count, fragment_added_count
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_top_level_fragments_in_the_rust_root_count() {
        assert!(is_changelog_fragment(
            "rust/changelog.d/20261007_fix.md",
            "rust"
        ));
        assert!(is_changelog_fragment("changelog.d/20261007_fix.md", "."));
        // The release never reads these, so they must not satisfy the check.
        assert!(!is_changelog_fragment(
            "changelog.d/20261007_fix.md",
            "rust"
        ));
        assert!(!is_changelog_fragment(
            "rust/changelog.d/old/20261007_fix.md",
            "rust"
        ));
        assert!(!is_changelog_fragment("rust/changelog.d/README.md", "rust"));
        assert!(!is_changelog_fragment("rust/changelog.d/notes.txt", "rust"));
        assert!(!is_changelog_fragment(
            "js/changelog.d/20261007_fix.md",
            "rust"
        ));
    }

    #[test]
    fn rejects_a_misspelled_bump() {
        assert_eq!(
            invalid_bump("---\nbump: majr\n---\n\n### Fixed\n"),
            Some("majr".into())
        );
        assert_eq!(invalid_bump("---\nbump: minor\n---\n\n### Added\n"), None);
        assert_eq!(invalid_bump("### Fixed\n- no frontmatter\n"), None);
        // `bump:` outside the frontmatter is prose, not a setting.
        assert_eq!(invalid_bump("---\ntitle: x\n---\n\nbump: sideways\n"), None);
    }
}
