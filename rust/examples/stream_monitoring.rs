//! Finite native log monitor with live metrics and size/deadline alert batches.
use command_stream::StreamingRunner;
use std::{io::Write, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--emit-logs") {
        for index in 1..=8 {
            let level = if index % 4 == 0 { "ERROR" } else { "INFO" };
            println!("{level} request {index} {}ms", 100 + index * 20);
            std::io::stdout().flush()?;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        return Ok(());
    }
    let executable = std::env::current_exe()?;
    let stats = StreamingRunner::from_argv(&executable, ["--emit-logs"])
        .stream()
        .lines()
        .analyze(
            |line| line.starts_with("ERROR"),
            |line| {
                line.split_whitespace()
                    .last()?
                    .trim_end_matches("ms")
                    .parse()
                    .ok()
            },
            |stats| println!("requests={} error_rate={}", stats.count, stats.error_rate),
        )
        .await;
    println!("Final mean response: {}ms", stats.response_mean);
    StreamingRunner::from_argv(&executable, ["--emit-logs"])
        .stream()
        .lines()
        .filter(|line| line.starts_with("ERROR"))
        .map(|line| format!("alert: {line}"))
        .batch_with_timeout(10, Duration::from_millis(50))
        .for_each(|batch| async move {
            println!("Send alerts: {batch:?}");
        })
        .await;
    Ok(())
}
