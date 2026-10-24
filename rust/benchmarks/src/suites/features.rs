use crate::BenchmarkResult;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

const COMPETITORS: &[(&str, &str)] = &[
    ("rust-std-process", "std::process"),
    ("tokio-process", "Tokio process"),
    ("async-process", "async-process"),
    ("duct", "duct"),
    ("subprocess", "subprocess"),
    ("xshell", "xshell"),
];

pub fn run(rust_directory: &Path) -> BenchmarkResult<Value> {
    let corpus = rust_directory.join("tests/competitor_dispositions.jsonl");
    let mut snapshot_date = None;
    let mut commits = BTreeMap::new();
    let mut ported: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut missing: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for (index, line) in fs::read_to_string(&corpus)?.lines().enumerate() {
        let record: Value = serde_json::from_str(line).map_err(|error| {
            format!("{}:{}: invalid JSON: {error}", corpus.display(), index + 1)
        })?;
        match record["record"].as_str() {
            Some("manifest") => snapshot_date = record["snapshotDate"].as_str().map(str::to_string),
            Some("source") => {
                if let (Some(id), Some(commit)) = (record["id"].as_str(), record["commit"].as_str())
                {
                    commits.insert(id.to_string(), commit.to_string());
                }
            }
            Some("unit") => {
                let Some(source) = record["source"].as_str() else {
                    continue;
                };
                let Some(id) = record["disposition"]["id"].as_str() else {
                    continue;
                };
                match record["disposition"]["kind"].as_str() {
                    Some("ported") => {
                        ported
                            .entry(source.to_string())
                            .or_default()
                            .insert(id.to_string());
                    }
                    Some("missing") => {
                        missing
                            .entry(source.to_string())
                            .or_default()
                            .insert(id.to_string());
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let competitors = COMPETITORS
        .iter()
        .map(|(id, name)| {
            let supported_cases = ported.get(*id).cloned().unwrap_or_default();
            let missing_features = missing.get(*id).cloned().unwrap_or_default();
            let supported = supported_cases.len();
            let gaps = missing_features.len();
            let total = supported + gaps;
            json!({
                "id": id,
                "name": name,
                "upstreamCommit": commits.get(*id),
                "supported": supported,
                "gaps": gaps,
                "coveragePercent": if total == 0 { 100.0 } else { supported as f64 / total as f64 * 100.0 },
                "supportedCases": supported_cases,
                "missingFeatures": missing_features,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "kind": "features",
        "name": "Feature completeness",
        "snapshotDate": snapshot_date.ok_or("competitor corpus is missing its manifest")?,
        "methodology": "Counts executable command-stream behavior cases and explicit gaps mapped to immutable upstream Rust process-library tests.",
        "competitors": competitors,
    }))
}
