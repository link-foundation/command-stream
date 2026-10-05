//! Parallel execution of commands that sleep (issue #22).
//!
//! Timing alone is a weak signal on a loaded CI machine, so each test asserts
//! three independent things:
//!   1. every command completed successfully (and produced its output),
//!   2. the execution windows of the commands overlap, which is what "parallel"
//!      actually means,
//!   3. the wall clock stayed well below the sequential total.

use command_stream::{run, CommandResult};
use std::time::{Duration, Instant};

/// A sleep long enough that process startup noise cannot hide it, short enough
/// to keep the suite fast.
const SLEEP: Duration = Duration::from_millis(500);

/// Timers are allowed to fire slightly early (timer resolution, rounding in the
/// sleep implementation), so the per-command lower bound gets a small slack.
const TIMER_SLACK: Duration = Duration::from_millis(50);

/// The wall clock of a parallel run is compared against the sequential total.
/// 75% leaves room for startup overhead while still failing loudly if the
/// commands were serialized.
const SEQUENTIAL_FRACTION: f64 = 0.75;

/// One completed command plus the window it occupied.
struct TimedRun {
    result: CommandResult,
    started: Instant,
    finished: Instant,
}

/// Run a command, recording when it started and when it finished.
async fn timed(command: String) -> TimedRun {
    let started = Instant::now();
    let result = run(command).await.expect("command failed to run");

    TimedRun {
        result,
        started,
        finished: Instant::now(),
    }
}

/// Format a sleep duration the way `sleep(1)` expects it.
fn seconds(duration: Duration) -> String {
    format!("{:.3}", duration.as_secs_f64())
}

/// Assert that every pair of runs was in flight at the same moment.
fn assert_overlapping(runs: &[&TimedRun]) {
    for (first_index, first) in runs.iter().enumerate() {
        for (offset, second) in runs[first_index + 1..].iter().enumerate() {
            // Half-open windows overlap when each one starts before the other
            // ends.
            assert!(
                first.started < second.finished && second.started < first.finished,
                "commands {} and {} did not overlap",
                first_index,
                first_index + 1 + offset
            );
        }
    }
}

/// Assert that a run slept at least as long as it was asked to.
fn assert_slept(run: &TimedRun, expected: Duration) {
    let elapsed = run.finished - run.started;
    assert!(
        elapsed + TIMER_SLACK >= expected,
        "command finished after {:?}, expected at least {:?}",
        elapsed,
        expected
    );
}

/// Assert that the whole batch finished well below the sequential total.
fn assert_faster_than_sequential(elapsed: Duration, sequential: Duration) {
    let budget = sequential.mul_f64(SEQUENTIAL_FRACTION);
    assert!(
        elapsed < budget,
        "batch took {:?}, which is not below the {:?} parallel budget (sequential total {:?})",
        elapsed,
        budget,
        sequential
    );
}

#[tokio::test]
async fn two_sleeping_commands_run_at_the_same_time() {
    let batch_started = Instant::now();
    let (first, second) = tokio::join!(
        timed(format!("sleep {}", seconds(SLEEP))),
        timed(format!("sleep {}", seconds(SLEEP))),
    );
    let elapsed = batch_started.elapsed();

    for run in [&first, &second] {
        assert!(run.result.is_success());
        assert_slept(run, SLEEP);
    }
    assert_overlapping(&[&first, &second]);
    assert_faster_than_sequential(elapsed, 2 * SLEEP);
}

#[tokio::test]
async fn three_sleeping_commands_run_at_the_same_time() {
    let batch_started = Instant::now();
    let (first, second, third) = tokio::join!(
        timed(format!("sleep {}", seconds(SLEEP))),
        timed(format!("sleep {}", seconds(SLEEP))),
        timed(format!("sleep {}", seconds(SLEEP))),
    );
    let elapsed = batch_started.elapsed();

    for run in [&first, &second, &third] {
        assert!(run.result.is_success());
        assert_slept(run, SLEEP);
    }
    assert_overlapping(&[&first, &second, &third]);
    assert_faster_than_sequential(elapsed, 3 * SLEEP);
}

#[tokio::test]
async fn mixed_durations_finish_in_the_time_of_the_longest_one() {
    let durations = [
        Duration::from_millis(200),
        Duration::from_millis(500),
        Duration::from_millis(300),
    ];

    let batch_started = Instant::now();
    let (first, second, third) = tokio::join!(
        timed(format!("sleep {}", seconds(durations[0]))),
        timed(format!("sleep {}", seconds(durations[1]))),
        timed(format!("sleep {}", seconds(durations[2]))),
    );
    let elapsed = batch_started.elapsed();

    for (run, duration) in [&first, &second, &third].iter().zip(durations) {
        assert!(run.result.is_success());
        assert_slept(run, duration);
    }
    assert_overlapping(&[&first, &second, &third]);
    assert_faster_than_sequential(elapsed, durations.iter().sum());
}

/// Absolute path so the built-in `sleep` is bypassed and real child processes
/// are spawned instead, covering the process path rather than the virtual one.
#[cfg(unix)]
#[tokio::test]
async fn real_sleep_processes_run_in_parallel() {
    let batch_started = Instant::now();
    let (first, second, third) = tokio::join!(
        timed(format!("/bin/sleep {}", seconds(SLEEP))),
        timed(format!("/bin/sleep {}", seconds(SLEEP))),
        timed(format!("/bin/sleep {}", seconds(SLEEP))),
    );
    let elapsed = batch_started.elapsed();

    for run in [&first, &second, &third] {
        assert!(run.result.is_success());
        assert_slept(run, SLEEP);
    }
    assert_overlapping(&[&first, &second, &third]);
    assert_faster_than_sequential(elapsed, 3 * SLEEP);
}

#[cfg(unix)]
#[tokio::test]
async fn output_of_commands_that_sleep_between_writes_is_kept() {
    let script = |id: u32| {
        format!(
            "sh -c 'echo \"start {id}\"; sleep {}; echo \"end {id}\"'",
            seconds(SLEEP)
        )
    };

    let batch_started = Instant::now();
    let (first, second, third) = tokio::join!(timed(script(1)), timed(script(2)), timed(script(3)));
    let elapsed = batch_started.elapsed();

    for (index, run) in [&first, &second, &third].iter().enumerate() {
        let id = index + 1;
        assert!(run.result.is_success());
        assert_eq!(
            run.result.stdout.trim().lines().collect::<Vec<_>>(),
            vec![format!("start {id}"), format!("end {id}")]
        );
        assert_slept(run, SLEEP);
    }
    assert_overlapping(&[&first, &second, &third]);
    assert_faster_than_sequential(elapsed, 3 * SLEEP);
}

#[cfg(unix)]
#[tokio::test]
async fn each_parallel_command_keeps_its_own_environment() {
    let script = |id: u32| {
        format!(
            "sh -c 'VALUE=\"value {id}\"; sleep {}; echo \"$VALUE\"'",
            seconds(SLEEP)
        )
    };

    let (first, second, third) = tokio::join!(timed(script(1)), timed(script(2)), timed(script(3)));

    for (index, run) in [&first, &second, &third].iter().enumerate() {
        assert!(run.result.is_success());
        assert_eq!(run.result.stdout.trim(), format!("value {}", index + 1));
    }
    assert_overlapping(&[&first, &second, &third]);
}
