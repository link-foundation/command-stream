pub mod adapters;
pub mod cli;
pub mod fixture;
pub mod model;
pub mod regression;
pub mod report;
pub mod runner;
pub mod suites;

pub type BenchmarkResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
