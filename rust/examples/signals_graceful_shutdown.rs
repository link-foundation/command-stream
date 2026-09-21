//! Sending signals to a running command (issue #15).
//!
//! Run it: `cargo run --example signals_graceful_shutdown`
//!
//! The worker below traps SIGTERM and SIGINT the way a real service does: it
//! gets a chance to flush state and release resources before exiting. Each
//! scenario prints whether that cleanup actually ran, which is the difference
//! between a graceful stop and a process that was simply destroyed.
//!
//! `StreamingRunner` is used throughout because it surfaces the child's output
//! while the process is still running, which is what makes the cleanup message
//! visible. `ProcessRunner` takes the same `kill_signal` / `kill_grace_ms`
//! options and has the same `kill()` / `kill_with()` pair, but it pumps output
//! inside `run()`, so a start-then-kill example there would print nothing.
use command_stream::{OutputChunk, StreamingRunner};

/// A stand-in for a service that must clean up before it stops.
const WORKER: &str = r#"
  trap 'echo "[worker] SIGTERM received, flushing state"; exit 0' TERM
  trap 'echo "[worker] SIGINT received, flushing state"; exit 0' INT
  echo "[worker] started"
  while true; do sleep 0.1; done
"#;

/// A worker that refuses to stop, to show the SIGKILL escalation.
const STUBBORN_WORKER: &str = r#"
  trap '' TERM INT
  echo "[worker] started, ignoring TERM and INT"
  while true; do sleep 0.1; done
"#;

/// Stream a command until it produces output, stop it, and report the exit code.
async fn scenario(title: &str, runner: StreamingRunner, explicit_signal: Option<&str>) {
    println!("\n=== {title} ===");
    let mut stream = runner.stream();

    let mut stopped = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => {
                print!("{}", String::from_utf8_lossy(&data));
                // Stop once the worker has installed its traps and said so.
                if !stopped {
                    stopped = true;
                    match explicit_signal {
                        // An explicit per-call override.
                        Some(signal) => stream.kill_with(signal),
                        // The configured kill_signal (SIGTERM unless changed).
                        None => stream.kill(),
                    }
                }
            }
            OutputChunk::Stderr(data) => eprint!("{}", String::from_utf8_lossy(&data)),
            OutputChunk::Exit(code) => println!("exit code: {code}"),
        }
    }
}

#[tokio::main]
async fn main() {
    // 1. The default: SIGTERM, with a grace period so the worker can clean up.
    scenario(
        "Default kill() sends SIGTERM",
        StreamingRunner::new(WORKER),
        None,
    )
    .await;

    // 2. SIGINT is exactly what CTRL+C sends, delivered programmatically.
    scenario(
        "kill_with(\"SIGINT\") - the signal CTRL+C sends",
        StreamingRunner::new(WORKER),
        Some("SIGINT"),
    )
    .await;

    // 3. kill_signal makes SIGINT the default for an argument-less kill().
    scenario(
        "kill_signal option configures the default",
        StreamingRunner::new(WORKER).kill_signal("SIGINT"),
        None,
    )
    .await;

    // 4. A slow shutdown needs a larger window than the 100ms default.
    scenario(
        "kill_grace_ms gives a slow shutdown more room",
        StreamingRunner::new(WORKER).kill_grace_ms(2000),
        None,
    )
    .await;

    // 5. A process that ignores the signal is still guaranteed to terminate:
    //    the grace period expires and SIGKILL follows. No cleanup message
    //    appears here - there was no cleanup to run.
    scenario(
        "SIGKILL escalation stops a process that ignores the signal",
        StreamingRunner::new(STUBBORN_WORKER).kill_grace_ms(200),
        None,
    )
    .await;

    // 6. kill_grace_ms(0) opts out of graceful shutdown entirely. The worker
    //    traps SIGTERM, but is destroyed before the handler can run - so no
    //    cleanup message is printed, even though the exit code is still 143.
    scenario(
        "kill_grace_ms(0) escalates immediately, skipping cleanup",
        StreamingRunner::new(WORKER).kill_grace_ms(0),
        None,
    )
    .await;

    println!("\nExit codes follow the 128 + signal convention:");
    println!("  SIGINT (2) => 130, SIGTERM (15) => 143, SIGKILL (9) => 137");
}
