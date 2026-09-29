use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub samples: usize,
    pub mean_ms: f64,
    pub median_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub standard_deviation_ms: f64,
    pub operations_per_second: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    pub rank: usize,
    pub name: String,
    pub median_ms: f64,
    pub relative_to_fastest: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub name: String,
    pub iterations: usize,
    pub warmup: usize,
    pub implementations: BTreeMap<String, Statistics>,
    pub ranking: Vec<Ranking>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub schema_version: u32,
    pub generated_at: String,
    pub environment: Environment,
    pub configuration: Configuration,
    pub suites: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub arch: String,
    pub cpus: Option<usize>,
    pub platform: String,
    pub runtime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub adapters: Vec<AdapterMetadata>,
    pub runner_defaults: RunnerDefaults,
    pub smoke: bool,
    pub suites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterMetadata {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerDefaults {
    pub iterations: usize,
    pub warmup: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedSuite {
    pub kind: String,
    pub name: String,
    pub scenarios: Vec<Scenario>,
}
