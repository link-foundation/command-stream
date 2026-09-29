use crate::adapters::EXPECTED_ADAPTERS;
use crate::BenchmarkResult;
use std::path::PathBuf;

pub const SUITE_NAMES: &[&str] = &["performance", "crate-size", "features", "real-world"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub adapters: Option<Vec<String>>,
    pub help: bool,
    pub iterations: usize,
    pub list: bool,
    pub output: PathBuf,
    pub smoke: bool,
    pub suites: Vec<String>,
    pub warmup: usize,
}

pub fn usage() -> &'static str {
    "command-stream Rust benchmark playground

Usage: cargo run --release --manifest-path benchmarks/Cargo.toml -- [options]

  --suite <name[,name]>    Select suites (default: all)
  --adapter <name[,name]>  Select process APIs (default: all)
  --iterations <count>     Measured iterations per timing scenario (default: 30)
  --warmup <count>         Warmup iterations per implementation (default: 5)
  --output <directory>     Report directory (default: benchmarks/results)
  --smoke                  Use tiny deterministic workloads for CI
  --list                   List suites and adapters
  --help                   Show this help
"
}

pub fn parse_arguments(arguments: &[String]) -> BenchmarkResult<Options> {
    let mut options = Options {
        adapters: None,
        help: false,
        iterations: 30,
        list: false,
        output: PathBuf::from("benchmarks/results"),
        smoke: false,
        suites: SUITE_NAMES.iter().map(ToString::to_string).collect(),
        warmup: 5,
    };
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].as_str();
        match flag {
            "--help" => options.help = true,
            "--list" => options.list = true,
            "--smoke" => options.smoke = true,
            "--suite" | "--adapter" | "--iterations" | "--warmup" | "--output" => {
                index += 1;
                let value = arguments
                    .get(index)
                    .ok_or_else(|| format!("{flag} expects a value"))?;
                match flag {
                    "--suite" => options.suites = comma_list(value),
                    "--adapter" => options.adapters = Some(comma_list(value)),
                    "--iterations" => options.iterations = integer(value, flag, 1)?,
                    "--warmup" => options.warmup = integer(value, flag, 0)?,
                    "--output" => options.output = PathBuf::from(value),
                    _ => unreachable!(),
                }
            }
            _ => return Err(format!("unknown argument: {flag}").into()),
        }
        index += 1;
    }

    validate_names("suite", &options.suites, SUITE_NAMES)?;
    if let Some(adapters) = &options.adapters {
        validate_names("adapter", adapters, EXPECTED_ADAPTERS)?;
    }
    Ok(options)
}

fn comma_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect()
}

fn integer(value: &str, flag: &str, minimum: usize) -> BenchmarkResult<usize> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("{flag} expects an integer >= {minimum}"))?;
    if parsed < minimum || parsed.to_string() != value {
        return Err(format!("{flag} expects an integer >= {minimum}").into());
    }
    Ok(parsed)
}

fn validate_names(kind: &str, values: &[String], expected: &[&str]) -> BenchmarkResult<()> {
    let invalid = values
        .iter()
        .find(|value| !expected.contains(&value.as_str()));
    if values.is_empty() || invalid.is_some() {
        return Err(format!(
            "unknown {kind}: {}",
            invalid.map_or("(empty)", String::as_str)
        )
        .into());
    }
    Ok(())
}
