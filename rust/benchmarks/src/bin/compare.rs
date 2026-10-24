use command_stream_benchmarks::model::Report;
use command_stream_benchmarks::regression::{compare_reports, comparison_markdown};
use command_stream_benchmarks::BenchmarkResult;
use std::fs;
use std::path::PathBuf;

struct Options {
    baseline: PathBuf,
    current: PathBuf,
    output: PathBuf,
    threshold_percent: f64,
    minimum_absolute_ms: f64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> BenchmarkResult<()> {
    let options = parse_arguments(&std::env::args().skip(1).collect::<Vec<_>>())?;
    let baseline: Report = serde_json::from_str(&fs::read_to_string(&options.baseline)?)?;
    let current: Report = serde_json::from_str(&fs::read_to_string(&options.current)?)?;
    let comparison = compare_reports(
        &baseline,
        &current,
        options.threshold_percent,
        options.minimum_absolute_ms,
    );
    fs::create_dir_all(&options.output)?;
    let json = options.output.join("benchmark-comparison.json");
    let markdown = options.output.join("benchmark-comparison.md");
    fs::write(
        &json,
        format!("{}\n", serde_json::to_string_pretty(&comparison)?),
    )?;
    fs::write(&markdown, comparison_markdown(&comparison))?;
    println!("JSON: {}", json.display());
    println!("Markdown: {}", markdown.display());
    Ok(())
}

fn parse_arguments(arguments: &[String]) -> BenchmarkResult<Options> {
    let mut baseline = None;
    let mut current = None;
    let mut output = PathBuf::from("benchmarks/results/comparison");
    let mut threshold_percent = 15.0;
    let mut minimum_absolute_ms = 2.0;
    let mut index = 0;
    while index < arguments.len() {
        let flag = &arguments[index];
        index += 1;
        let value = arguments
            .get(index)
            .ok_or_else(|| format!("{flag} expects a value"))?;
        match flag.as_str() {
            "--baseline" => baseline = Some(PathBuf::from(value)),
            "--current" => current = Some(PathBuf::from(value)),
            "--output" => output = PathBuf::from(value),
            "--threshold-percent" => threshold_percent = positive_number(value, flag)?,
            "--minimum-absolute-ms" => minimum_absolute_ms = positive_number(value, flag)?,
            _ => return Err(format!("unknown argument: {flag}").into()),
        }
        index += 1;
    }
    Ok(Options {
        baseline: baseline.ok_or("--baseline is required")?,
        current: current.ok_or("--current is required")?,
        output,
        threshold_percent,
        minimum_absolute_ms,
    })
}

fn positive_number(value: &str, flag: &str) -> BenchmarkResult<f64> {
    let parsed = value
        .parse::<f64>()
        .map_err(|_| format!("{flag} expects a non-negative number"))?;
    if !parsed.is_finite() || parsed < 0.0 {
        return Err(format!("{flag} expects a non-negative number").into());
    }
    Ok(parsed)
}
