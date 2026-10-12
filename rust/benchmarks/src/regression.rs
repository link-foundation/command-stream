use crate::model::Report;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkComparison {
    pub schema_version: u32,
    pub baseline_generated_at: String,
    pub current_generated_at: String,
    pub threshold_percent: f64,
    pub minimum_absolute_ms: f64,
    pub summary: ComparisonSummary,
    pub comparisons: Vec<ComparisonEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComparisonSummary {
    pub compared: usize,
    pub regressions: usize,
    pub improvements: usize,
    pub stable: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonEntry {
    pub suite: String,
    pub scenario: String,
    pub implementation: String,
    pub baseline_median_ms: f64,
    pub current_median_ms: f64,
    pub delta_ms: f64,
    pub delta_percent: Option<f64>,
    pub status: String,
}

struct TimedEntry {
    key: String,
    suite: String,
    scenario: String,
    implementation: String,
    median_ms: f64,
}

pub fn compare_reports(
    baseline: &Report,
    current: &Report,
    threshold_percent: f64,
    minimum_absolute_ms: f64,
) -> BenchmarkComparison {
    let baseline_entries = timed_entries(baseline);
    let comparisons = timed_entries(current)
        .into_iter()
        .filter_map(|entry| {
            let before = baseline_entries
                .iter()
                .find(|before| before.key == entry.key)?;
            let delta_ms = entry.median_ms - before.median_ms;
            let delta_percent =
                (before.median_ms != 0.0).then_some(delta_ms / before.median_ms * 100.0);
            let status = if delta_ms.abs() < minimum_absolute_ms
                || delta_percent.is_none_or(|delta| delta.abs() < threshold_percent)
            {
                "stable"
            } else if delta_ms > 0.0 {
                "regression"
            } else {
                "improvement"
            };
            Some(ComparisonEntry {
                suite: entry.suite,
                scenario: entry.scenario,
                implementation: entry.implementation,
                baseline_median_ms: before.median_ms,
                current_median_ms: entry.median_ms,
                delta_ms,
                delta_percent,
                status: status.to_string(),
            })
        })
        .collect::<Vec<_>>();
    let summary = ComparisonSummary {
        compared: comparisons.len(),
        regressions: comparisons
            .iter()
            .filter(|entry| entry.status == "regression")
            .count(),
        improvements: comparisons
            .iter()
            .filter(|entry| entry.status == "improvement")
            .count(),
        stable: comparisons
            .iter()
            .filter(|entry| entry.status == "stable")
            .count(),
    };
    BenchmarkComparison {
        schema_version: 1,
        baseline_generated_at: baseline.generated_at.clone(),
        current_generated_at: current.generated_at.clone(),
        threshold_percent,
        minimum_absolute_ms,
        summary,
        comparisons,
    }
}

pub fn comparison_markdown(comparison: &BenchmarkComparison) -> String {
    let mut lines = vec![
        "# Rust benchmark comparison".to_string(),
        String::new(),
        format!(
            "Compared {} measurements: {} possible regressions, {} improvements, and {} stable.",
            comparison.summary.compared,
            comparison.summary.regressions,
            comparison.summary.improvements,
            comparison.summary.stable
        ),
        String::new(),
        "| Status | Suite | Scenario | API | Baseline | Current | Change |".to_string(),
        "| --- | --- | --- | --- | ---: | ---: | ---: |".to_string(),
    ];
    for entry in &comparison.comparisons {
        let percent = entry
            .delta_percent
            .map_or_else(|| "n/a".to_string(), |delta| format!("{delta:.1}%"));
        lines.push(format!(
            "| {} | {} | {} | {} | {:.2} ms | {:.2} ms | {} |",
            entry.status,
            entry.suite,
            entry.scenario,
            entry.implementation,
            entry.baseline_median_ms,
            entry.current_median_ms,
            percent
        ));
    }
    lines.extend([
        String::new(),
        "> Timing classifications are review signals, not a merge gate. Confirm possible regressions with repeated runs on a controlled host.".to_string(),
        String::new(),
    ]);
    lines.join("\n")
}

fn timed_entries(report: &Report) -> Vec<TimedEntry> {
    report
        .suites
        .iter()
        .filter_map(|suite| {
            let suite_name = suite["name"].as_str()?.to_string();
            Some(
                suite["scenarios"]
                    .as_array()?
                    .iter()
                    .flat_map(move |scenario| scenario_entries(&suite_name, scenario)),
            )
        })
        .flatten()
        .collect()
}

fn scenario_entries(suite: &str, scenario: &Value) -> Vec<TimedEntry> {
    let scenario_name = scenario["name"].as_str().unwrap_or_default();
    scenario["implementations"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(implementation, statistics)| {
            Some(TimedEntry {
                key: format!("{suite}\0{scenario_name}\0{implementation}"),
                suite: suite.to_string(),
                scenario: scenario_name.to_string(),
                implementation: implementation.clone(),
                median_ms: statistics["medianMs"].as_f64()?,
            })
        })
        .collect()
}
