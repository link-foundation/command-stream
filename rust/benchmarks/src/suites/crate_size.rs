use crate::BenchmarkResult;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const CRATES: &[(&str, &str)] = &[
    ("command-stream", "command-stream"),
    ("tokio", "Tokio process"),
    ("async-process", "async-process"),
    ("duct", "duct"),
    ("subprocess", "subprocess"),
    ("xshell", "xshell"),
];

pub fn run(benchmark_directory: &Path) -> BenchmarkResult<Value> {
    let manifest = benchmark_directory.join("Cargo.toml");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let output = Command::new(cargo)
        .args([
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--manifest-path",
        ])
        .arg(&manifest)
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    let metadata: Value = serde_json::from_slice(&output.stdout)?;
    let packages = metadata["packages"]
        .as_array()
        .ok_or("cargo metadata did not return packages")?;
    let package_by_id = packages
        .iter()
        .filter_map(|package| Some((package["id"].as_str()?.to_string(), package)))
        .collect::<BTreeMap<_, _>>();
    let nodes = metadata["resolve"]["nodes"]
        .as_array()
        .ok_or("cargo metadata did not return a resolved graph")?;
    let dependencies = nodes
        .iter()
        .filter_map(|node| {
            let id = node["id"].as_str()?.to_string();
            let deps = node["deps"]
                .as_array()?
                .iter()
                .filter_map(|dependency| dependency["pkg"].as_str().map(str::to_string))
                .collect::<Vec<_>>();
            Some((id, deps))
        })
        .collect::<BTreeMap<_, _>>();
    let benchmark_id = packages
        .iter()
        .find(|package| package["name"] == "command-stream-benchmarks")
        .and_then(|package| package["id"].as_str())
        .ok_or("cargo metadata is missing the benchmark package")?;
    let direct_ids = dependencies
        .get(benchmark_id)
        .ok_or("cargo metadata is missing benchmark dependencies")?;

    let mut results = Vec::new();
    for (crate_name, display_name) in CRATES {
        let id = direct_ids
            .iter()
            .find(|id| {
                package_by_id
                    .get(*id)
                    .is_some_and(|package| package["name"] == *crate_name)
            })
            .ok_or_else(|| format!("benchmark dependency {crate_name} was not resolved"))?;
        let package = package_by_id
            .get(id)
            .ok_or_else(|| format!("metadata is missing package {id}"))?;
        let root = package_root(package)?;
        let source_bytes = directory_size(&root, *crate_name == "command-stream")?;
        let closure_ids = dependency_closure(id, &dependencies);
        let dependency_closure_bytes = closure_ids.iter().try_fold(0_u64, |total, id| {
            let package = package_by_id
                .get(id)
                .ok_or_else(|| format!("metadata is missing package {id}"))?;
            let package_name = package["name"].as_str().unwrap_or_default();
            let size = directory_size(&package_root(package)?, package_name == "command-stream")?;
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(total + size)
        })?;
        results.push(json!({
            "name": display_name,
            "crate": crate_name,
            "version": package["version"],
            "sourceBytes": source_bytes,
            "dependencyClosureBytes": dependency_closure_bytes,
            "dependencyCount": closure_ids.len().saturating_sub(1),
        }));
    }
    results.push(json!({
        "name": "std::process",
        "crate": null,
        "version": "built into Rust",
        "sourceBytes": 0,
        "dependencyClosureBytes": 0,
        "dependencyCount": 0,
    }));

    Ok(json!({
        "kind": "crate-size",
        "name": "Crate source footprint",
        "methodology": "Bytes in each resolved crate source tree and its unique transitive Cargo dependency closure. Build artifacts, VCS metadata, and this benchmark package are excluded.",
        "crates": results,
    }))
}

fn package_root(package: &Value) -> BenchmarkResult<PathBuf> {
    let manifest = package["manifest_path"]
        .as_str()
        .ok_or("package metadata is missing manifest_path")?;
    Path::new(manifest)
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("invalid manifest path: {manifest}").into())
}

fn dependency_closure(
    root: &str,
    dependencies: &BTreeMap<String, Vec<String>>,
) -> BTreeSet<String> {
    let mut pending = vec![root.to_string()];
    let mut visited = BTreeSet::new();
    while let Some(id) = pending.pop() {
        if visited.insert(id.clone()) {
            pending.extend(dependencies.get(&id).into_iter().flatten().cloned());
        }
    }
    visited
}

fn directory_size(directory: &Path, exclude_benchmarks: bool) -> BenchmarkResult<u64> {
    let mut bytes = 0;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        if matches!(name.to_str(), Some(".git" | "target"))
            || (exclude_benchmarks && name == "benchmarks")
        {
            continue;
        }
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            bytes += directory_size(&entry.path(), false)?;
        } else if file_type.is_file() || file_type.is_symlink() {
            bytes += entry.metadata()?.len();
        }
    }
    Ok(bytes)
}
