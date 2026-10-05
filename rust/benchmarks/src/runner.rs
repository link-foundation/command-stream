use crate::model::{Ranking, Scenario, Statistics};
use crate::BenchmarkResult;
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

type OperationFuture = Pin<Box<dyn Future<Output = Result<(), String>>>>;
type Operation = Box<dyn Fn() -> OperationFuture>;

pub struct BenchmarkCase {
    pub name: String,
    operation: Operation,
}

impl BenchmarkCase {
    pub fn new<F, Fut>(name: impl Into<String>, operation: F) -> Self
    where
        F: Fn() -> Fut + 'static,
        Fut: Future<Output = Result<(), String>> + 'static,
    {
        Self {
            name: name.into(),
            operation: Box::new(move || Box::pin(operation())),
        }
    }

    async fn execute(&self, scenario: &str, phase: &str) -> BenchmarkResult<()> {
        (self.operation)()
            .await
            .map_err(|error| format!("{scenario}/{} {phase} failed: {error}", self.name).into())
    }
}

#[derive(Debug, Clone, Copy)]
pub struct BenchmarkRunner {
    pub iterations: usize,
    pub warmup: usize,
}

impl BenchmarkRunner {
    pub fn new(iterations: usize, warmup: usize) -> BenchmarkResult<Self> {
        if iterations == 0 {
            return Err("iterations must be greater than zero".into());
        }
        Ok(Self { iterations, warmup })
    }

    pub async fn compare(
        &self,
        name: impl Into<String>,
        cases: Vec<BenchmarkCase>,
        overrides: Option<(usize, usize)>,
    ) -> BenchmarkResult<Scenario> {
        let name = name.into();
        if cases.is_empty() {
            return Err(format!("{name} must include at least one implementation").into());
        }
        let (iterations, warmup) = overrides.unwrap_or((self.iterations, self.warmup));
        if iterations == 0 {
            return Err(format!("{name} iterations must be greater than zero").into());
        }

        for case in &cases {
            for index in 0..warmup {
                case.execute(&name, &format!("warmup {}", index + 1))
                    .await?;
            }
        }

        let mut samples = cases
            .iter()
            .map(|case| (case.name.clone(), Vec::with_capacity(iterations)))
            .collect::<BTreeMap<_, _>>();
        for iteration in 0..iterations {
            let offset = iteration % cases.len();
            for index in 0..cases.len() {
                let case = &cases[(offset + index) % cases.len()];
                let started_at = Instant::now();
                case.execute(&name, &format!("iteration {}", iteration + 1))
                    .await?;
                samples
                    .get_mut(&case.name)
                    .expect("every case has a sample bucket")
                    .push(started_at.elapsed().as_secs_f64() * 1_000.0);
            }
        }

        let implementations = samples
            .into_iter()
            .map(|(implementation, values)| (implementation, summarize_samples(&values)))
            .collect::<BTreeMap<_, _>>();
        let mut ordered = implementations.iter().collect::<Vec<_>>();
        ordered.sort_by(|left, right| left.1.median_ms.total_cmp(&right.1.median_ms));
        let fastest = ordered[0].1.median_ms;
        let ranking = ordered
            .into_iter()
            .enumerate()
            .map(|(index, (implementation, statistics))| Ranking {
                rank: index + 1,
                name: implementation.clone(),
                median_ms: statistics.median_ms,
                relative_to_fastest: (fastest > 0.0).then_some(statistics.median_ms / fastest),
            })
            .collect();

        Ok(Scenario {
            name,
            iterations,
            warmup,
            implementations,
            ranking,
        })
    }
}

pub fn summarize_samples(samples: &[f64]) -> Statistics {
    assert!(
        !samples.is_empty(),
        "at least one timing sample is required"
    );
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mean_ms = samples.iter().sum::<f64>() / samples.len() as f64;
    let middle = sorted.len() / 2;
    let median_ms = if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    };
    let variance = samples
        .iter()
        .map(|sample| (sample - mean_ms).powi(2))
        .sum::<f64>()
        / samples.len() as f64;

    Statistics {
        samples: samples.len(),
        mean_ms,
        median_ms,
        min_ms: sorted[0],
        max_ms: sorted[sorted.len() - 1],
        p95_ms: percentile(&sorted, 0.95),
        p99_ms: percentile(&sorted, 0.99),
        standard_deviation_ms: variance.sqrt(),
        operations_per_second: if mean_ms == 0.0 {
            f64::INFINITY
        } else {
            1_000.0 / mean_ms
        },
    }
}

fn percentile(sorted: &[f64], probability: f64) -> f64 {
    let index = ((probability * sorted.len() as f64).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[index]
}
