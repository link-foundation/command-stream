#!/usr/bin/env rust-script
//! Reject semantic package version changes in every pull request, including
//! release-named branches. Missing Git refs or malformed manifests fail closed.
//! ```cargo
//! [dependencies]
//! toml = "1.1.8"
//! ```
use std::env;
use std::path::Path;
use std::process::{Command, exit};

fn git(args: &[&str]) -> Result<String, String> {
    let result = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim().to_string())
}

fn version_at(reference: &str, manifest: &str) -> Result<String, String> {
    let content = git(&["show", &format!("{}:{}", reference, manifest)])?;
    let parsed: toml::Value = toml::from_str(&content).map_err(|e| e.to_string())?;
    parsed
        .get("package")
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "Missing [package].version".to_string())
}

fn check() -> Result<(), String> {
    let base = env::var("GITHUB_BASE_SHA")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            format!(
                "origin/{}",
                env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".into())
            )
        });
    let head = env::var("GITHUB_HEAD_SHA").unwrap_or_else(|_| "HEAD".into());
    let ancestor = git(&["merge-base", &base, &head])?;
    let root = env::var("RUST_ROOT")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            if Path::new("Cargo.toml").exists() {
                ".".into()
            } else {
                "rust".into()
            }
        });
    let prefix = git(&["rev-parse", "--show-prefix"])?;
    let manifest = if root == "." {
        format!("{}Cargo.toml", prefix)
    } else {
        format!("{}{}/Cargo.toml", prefix, root)
    };
    if version_at(&ancestor, &manifest)? != version_at(&head, &manifest)? {
        return Err(
            "Manual version changes are prohibited; add a changelog fragment instead".into(),
        );
    }
    Ok(())
}

fn main() {
    if env::var("GITHUB_EVENT_NAME").unwrap_or_default() != "pull_request" {
        println!("Version guard runs on pull requests");
        return;
    }
    match check() {
        Ok(()) => println!("No manual package version changes detected"),
        Err(error) => {
            eprintln!("::error::Version validation failed: {}", error);
            exit(1);
        }
    }
}
