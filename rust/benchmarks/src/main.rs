use chrono::Utc;
use command_stream_benchmarks::adapters::{select_adapters, EXPECTED_ADAPTERS};
use command_stream_benchmarks::cli::{parse_arguments, usage, SUITE_NAMES};
use command_stream_benchmarks::fixture::run_fixture;
use command_stream_benchmarks::model::{Configuration, Environment, Report, RunnerDefaults};
use command_stream_benchmarks::report::write_reports;
use command_stream_benchmarks::runner::BenchmarkRunner;
use command_stream_benchmarks::suites::{crate_size, features, performance, real_world};
use command_stream_benchmarks::BenchmarkResult;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> BenchmarkResult<()> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if let Some(code) = run_fixture(&arguments)? {
        std::process::exit(code);
    }
    let options = parse_arguments(&arguments)?;
    if options.help {
        print!("{}", usage());
        return Ok(());
    }
    if options.list {
        println!("Suites: {}", SUITE_NAMES.join(", "));
        println!("Adapters: {}", EXPECTED_ADAPTERS.join(", "));
        return Ok(());
    }

    let needs_adapters = options
        .suites
        .iter()
        .any(|name| matches!(name.as_str(), "performance" | "real-world"));
    let adapters = if needs_adapters {
        select_adapters(options.adapters.as_deref())?
    } else {
        Vec::new()
    };
    let runner = BenchmarkRunner::new(options.iterations, options.warmup)?;
    let benchmark_directory = Path::new(env!("CARGO_MANIFEST_DIR"));
    let rust_directory = benchmark_directory
        .parent()
        .ok_or("benchmark package must be nested under the Rust crate")?;
    let mut suites = Vec::new();
    for suite in &options.suites {
        println!("\nRunning {suite}...");
        let result = match suite.as_str() {
            "performance" => {
                serde_json::to_value(performance::run(&runner, &adapters, options.smoke).await?)?
            }
            "crate-size" => crate_size::run(benchmark_directory)?,
            "features" => features::run(rust_directory)?,
            "real-world" => serde_json::to_value(
                real_world::run(&runner, &adapters, options.smoke, rust_directory).await?,
            )?,
            _ => unreachable!("suite names were validated"),
        };
        print_suite(&result);
        suites.push(result);
    }

    let report = Report {
        schema_version: 1,
        generated_at: Utc::now().to_rfc3339(),
        environment: Environment {
            arch: std::env::consts::ARCH.to_string(),
            cpus: std::thread::available_parallelism().ok().map(usize::from),
            platform: std::env::consts::OS.to_string(),
            runtime: rustc_version(),
        },
        configuration: Configuration {
            adapters: adapters.iter().map(|adapter| adapter.metadata()).collect(),
            runner_defaults: RunnerDefaults {
                iterations: options.iterations,
                warmup: options.warmup,
            },
            smoke: options.smoke,
            suites: options.suites,
        },
        suites,
    };
    let paths = write_reports(&report, &options.output)?;
    println!("\nJSON: {}", paths.json.display());
    println!("HTML: {}", paths.html.display());
    Ok(())
}

fn rustc_version() -> String {
    Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map_or_else(
            || "Rust (unknown version)".to_string(),
            |value| value.trim().to_string(),
        )
}

fn print_suite(suite: &Value) {
    println!("\n## {}", suite["name"].as_str().unwrap_or("Benchmark"));
    if let Some(scenarios) = suite["scenarios"].as_array() {
        for scenario in scenarios {
            println!("\n{}", scenario["name"].as_str().unwrap_or("Scenario"));
            for entry in scenario["ranking"].as_array().into_iter().flatten() {
                println!(
                    "  {}. {:<18} {:>9.2} ms  {:>5.2}x",
                    entry["rank"].as_u64().unwrap_or_default(),
                    entry["name"].as_str().unwrap_or_default(),
                    entry["medianMs"].as_f64().unwrap_or_default(),
                    entry["relativeToFastest"].as_f64().unwrap_or_default(),
                );
            }
        }
    } else if let Some(competitors) = suite["competitors"].as_array() {
        for entry in competitors {
            println!(
                "  {:<18} {} ported / {} known gaps ({:.1}%)",
                entry["name"].as_str().unwrap_or_default(),
                entry["supported"],
                entry["gaps"],
                entry["coveragePercent"].as_f64().unwrap_or_default(),
            );
        }
    } else if let Some(crates) = suite["crates"].as_array() {
        for entry in crates {
            println!(
                "  {:<18} source {:>10} B  closure {:>10} B",
                entry["name"].as_str().unwrap_or_default(),
                entry["sourceBytes"],
                entry["dependencyClosureBytes"],
            );
        }
    }
}
