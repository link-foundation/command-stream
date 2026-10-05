use command_stream_benchmarks::adapters::Adapter;
use command_stream_benchmarks::cli::parse_arguments;
use command_stream_benchmarks::model::{Configuration, Environment, Report, RunnerDefaults};
use command_stream_benchmarks::regression::{compare_reports, comparison_markdown};
use command_stream_benchmarks::report::{escape_html, write_reports};
use command_stream_benchmarks::runner::{summarize_samples, BenchmarkCase, BenchmarkRunner};
use command_stream_benchmarks::suites::features;
use serde_json::json;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[test]
fn parses_and_validates_cli_options() {
    let options = parse_arguments(&[
        "--suite".to_string(),
        "performance,features".to_string(),
        "--adapter".to_string(),
        "command-stream,xshell".to_string(),
        "--iterations".to_string(),
        "7".to_string(),
        "--warmup".to_string(),
        "0".to_string(),
        "--smoke".to_string(),
    ])
    .expect("valid benchmark options");
    assert_eq!(options.suites, ["performance", "features"]);
    assert_eq!(
        options.adapters.as_deref(),
        Some(["command-stream".to_string(), "xshell".to_string()].as_slice())
    );
    assert_eq!(options.iterations, 7);
    assert_eq!(options.warmup, 0);
    assert!(options.smoke);

    assert!(parse_arguments(&["--iterations".to_string(), "0".to_string()]).is_err());
    assert!(parse_arguments(&["--suite".to_string(), "unknown".to_string()]).is_err());
}

#[test]
fn calculates_stable_statistics() {
    let statistics = summarize_samples(&[4.0, 1.0, 3.0, 2.0]);
    assert_eq!(statistics.samples, 4);
    assert_eq!(statistics.mean_ms, 2.5);
    assert_eq!(statistics.median_ms, 2.5);
    assert_eq!(statistics.min_ms, 1.0);
    assert_eq!(statistics.max_ms, 4.0);
    assert_eq!(statistics.p95_ms, 4.0);
}

#[tokio::test]
async fn runner_executes_warmups_and_measured_iterations() {
    let calls = Arc::new(AtomicUsize::new(0));
    let operation_calls = Arc::clone(&calls);
    let scenario = BenchmarkRunner::new(3, 2)
        .expect("runner")
        .compare(
            "counter",
            vec![BenchmarkCase::new("implementation", move || {
                operation_calls.fetch_add(1, Ordering::Relaxed);
                async { Ok(()) }
            })],
            None,
        )
        .await
        .expect("benchmark succeeds");
    assert_eq!(calls.load(Ordering::Relaxed), 5);
    assert_eq!(scenario.implementations["implementation"].samples, 3);
    assert_eq!(scenario.ranking[0].rank, 1);
}

#[tokio::test]
async fn every_adapter_executes_and_captures_a_process() {
    let test_executable = std::env::current_exe().expect("absolute test executable path");
    for adapter in Adapter::all() {
        let result = adapter
            .run(&test_executable, &["--help".to_string()])
            .await
            .unwrap_or_else(|error| panic!("{} failed: {error}", adapter.name()));
        assert_eq!(result.exit_code, 0, "{} exit code", adapter.name());
        assert!(
            result.stdout.starts_with(b"Usage: "),
            "{} output: {:?}",
            adapter.name(),
            result.stdout
        );
    }
}

#[test]
fn feature_suite_is_derived_from_the_checked_in_corpus() {
    let rust_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Rust directory");
    let suite = features::run(rust_directory).expect("feature suite");
    assert_eq!(suite["kind"], "features");
    assert_eq!(suite["snapshotDate"], "2026-09-13");
    assert_eq!(suite["competitors"].as_array().map(Vec::len), Some(6));
    assert!(suite["competitors"]
        .as_array()
        .expect("competitors")
        .iter()
        .all(|entry| entry["upstreamCommit"]
            .as_str()
            .is_some_and(|value| value.len() == 40)));
}

#[test]
fn report_writer_escapes_html_and_emits_machine_readable_json() {
    let directory = tempfile::tempdir().expect("temporary report directory");
    let report = report_with_median("2026-09-15T00:00:00Z", 10.0);
    let paths = write_reports(&report, directory.path()).expect("reports");
    let decoded: Report =
        serde_json::from_str(&std::fs::read_to_string(paths.json).expect("JSON report contents"))
            .expect("valid JSON report");
    assert_eq!(decoded.schema_version, 1);
    let html = std::fs::read_to_string(paths.html).expect("HTML report contents");
    assert!(html.contains("command-stream Rust benchmark report"));
    assert_eq!(escape_html("<&\"'"), "&lt;&amp;&quot;&#39;");
}

#[test]
fn regression_comparison_classifies_material_changes() {
    let baseline = report_with_median("baseline", 10.0);
    let current = report_with_median("current", 13.0);
    let comparison = compare_reports(&baseline, &current, 15.0, 1.0);
    assert_eq!(comparison.summary.compared, 1);
    assert_eq!(comparison.summary.regressions, 1);
    assert_eq!(comparison.comparisons[0].delta_percent, Some(30.0));
    assert!(comparison_markdown(&comparison).contains("| regression |"));
}

fn report_with_median(generated_at: &str, median_ms: f64) -> Report {
    Report {
        schema_version: 1,
        generated_at: generated_at.to_string(),
        environment: Environment {
            arch: "test".to_string(),
            cpus: Some(1),
            platform: "test".to_string(),
            runtime: "rustc test".to_string(),
        },
        configuration: Configuration {
            adapters: Vec::new(),
            runner_defaults: RunnerDefaults {
                iterations: 1,
                warmup: 0,
            },
            smoke: true,
            suites: vec!["performance".to_string()],
        },
        suites: vec![json!({
            "kind": "performance",
            "name": "Performance",
            "scenarios": [{
                "name": "spawn",
                "implementations": {
                    "command-stream": { "medianMs": median_ms }
                },
                "ranking": []
            }]
        })],
    }
}
