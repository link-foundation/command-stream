//! Stopping a [`ProcessRunner`]: an explicit kill, or the
//! [`RunOptions::timeout`](crate::RunOptions::timeout) deadline (issue #227).

use std::future::Future;
use std::time::Duration;
use tokio::time::Instant;

use crate::{signal, utils, ProcessRunner, Result};

impl ProcessRunner {
    /// Stop the process using the configured kill signal
    /// ([`RunOptions::kill_signal`](crate::RunOptions::kill_signal), default `SIGTERM`).
    ///
    /// Mirrors the JavaScript `kill()` with no argument.
    pub fn kill(&mut self) -> Result<()> {
        let signal = self.options.kill_signal.clone();
        self.kill_with(&signal)
    }

    /// Stop the process using an explicit signal, overriding
    /// [`RunOptions::kill_signal`](crate::RunOptions::kill_signal) for this call.
    ///
    /// Mirrors the JavaScript `kill(signal)`. The signal is delivered to the
    /// child and its process group, so grandchildren behind a `sh -c` wrapper
    /// are stopped too - except for a child sharing the caller's terminal,
    /// which stays in the caller's group so CTRL+C keeps reaching it. The child
    /// then has [`RunOptions::kill_grace_ms`](crate::RunOptions::kill_grace_ms) to run its own handler before
    /// `SIGKILL` follows, so a process that ignores the signal still
    /// terminates.
    ///
    /// ```no_run
    /// use command_stream::{ProcessRunner, RunOptions};
    ///
    /// # #[tokio::main]
    /// # async fn main() -> command_stream::Result<()> {
    /// let mut runner = ProcessRunner::new("sleep 30", RunOptions::default());
    /// runner.start().await?;
    /// runner.kill_with("SIGINT")?; // the CTRL+C signal
    /// # Ok(())
    /// # }
    /// ```
    pub fn kill_with(&mut self, signal: &str) -> Result<()> {
        self.cancelled = true;
        utils::trace_lazy("ProcessRunner", || format!("kill | signal={signal}"));

        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };

        // Windows stops the tree before the parent exits, while its descendants
        // can still be found. Direct-child termination is the fallback.
        // The `#[cfg(unix)]` block below is stripped on Windows, which leaves
        // this one as the function's tail expression - hence no `return`.
        #[cfg(not(unix))]
        {
            if let Some(pid) = child.id() {
                signal::send_signal_to_process(pid, signal, signal::Delivery::ProcessAndGroup);
            }
            child.start_kill()?;
            utils::trace_lazy("ProcessRunner", || {
                "Direct-child termination requested".to_string()
            });
            Ok(())
        }

        // Without a pid the process never spawned (or was already reaped);
        // fall back to the forceful stop so `kill()` still terminates it.
        #[cfg(unix)]
        {
            let Some(pid) = child.id() else {
                child.start_kill()?;
                return Ok(());
            };

            // `SIGKILL` cannot be handled, so there is nothing to wait for.
            //
            // A zero grace period means the child is given no opportunity to
            // handle the signal either, so the requested signal is not
            // delivered at all. Anything done between it and `SIGKILL` - even a
            // single syscall - is a window the child can be scheduled in, which
            // made "no grace" a race the child occasionally won rather than a
            // guarantee. The reported exit code still comes from the signal
            // that was requested.
            let grace = self.options.kill_grace_ms;
            let delivery = if self.own_process_group {
                signal::Delivery::ProcessAndGroup
            } else {
                signal::Delivery::ProcessOnly
            };
            if grace == 0 || signal == "SIGKILL" {
                signal::send_signal_to_process(pid, "SIGKILL", delivery);
                let _ = child.start_kill();
                return Ok(());
            }

            signal::send_signal_to_process(pid, signal, delivery);

            // Otherwise escalate in the background so the child keeps its grace
            // period without blocking the caller, which may not be inside an
            // await point.
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(grace)).await;
                // Best effort: if the child already exited on the first signal
                // this delivery simply fails, and the pid has not been reused
                // because the `Child` handle above has not reaped it yet. That
                // unreaped leader is also what keeps the group id alive, so the
                // group delivery still reaches a grandchild that outlived it.
                signal::send_signal_to_process(pid, "SIGKILL", delivery);
            });

            Ok(())
        }
    }

    /// Whether the [`RunOptions::timeout`](crate::RunOptions::timeout) elapsed
    /// and stopped the command.
    ///
    /// Mirrors the JavaScript `result.timedOut`. An explicit kill, or a
    /// command finishing on its own, leaves it `false`.
    pub fn timed_out(&self) -> bool {
        self.timed_out
    }

    /// How a timed-out child is stopped: the configured signal, delivered the
    /// way [`kill_with`](Self::kill_with) would deliver it.
    pub(crate) fn stop_plan(&self) -> StopPlan {
        #[cfg(unix)]
        let delivery = if self.own_process_group {
            signal::Delivery::ProcessAndGroup
        } else {
            signal::Delivery::ProcessOnly
        };
        #[cfg(not(unix))]
        let delivery = signal::Delivery::ProcessAndGroup;
        StopPlan {
            pid: self.pid,
            signal: self.options.kill_signal.clone(),
            grace_ms: self.options.kill_grace_ms,
            delivery,
        }
    }
}

/// How to stop a child whose deadline has passed.
pub(crate) struct StopPlan {
    pid: Option<u32>,
    signal: String,
    grace_ms: u64,
    delivery: signal::Delivery,
}

impl StopPlan {
    fn send(&self, signal: &str) {
        if let Some(pid) = self.pid {
            signal::send_signal_to_process(pid, signal, self.delivery);
        }
    }
}

/// Await `work` - draining and reaping the child - but stop the child if
/// `deadline` passes first.
///
/// Returns the work's output, or `None` when the child and its pipes did not
/// let go even after `SIGKILL` and the exit-pump grace period, and whether the
/// deadline fired. The signals are sent while `work` still holds the unreaped
/// child, so its pid and process group cannot have been reused.
pub(crate) async fn bounded<T>(
    work: impl Future<Output = T>,
    deadline: Option<Instant>,
    plan: StopPlan,
) -> (Option<T>, bool) {
    tokio::pin!(work);
    let Some(deadline) = deadline else {
        return (Some(work.await), false);
    };
    tokio::select! {
        output = &mut work => return (Some(output), false),
        () = tokio::time::sleep_until(deadline) => {}
    }
    utils::trace_lazy("ProcessRunner", || {
        format!(
            "Timeout elapsed | pid={:?} signal={}",
            plan.pid, plan.signal
        )
    });
    // As in `kill_with`, no grace means `SIGKILL` alone.
    if cfg!(unix) && plan.grace_ms > 0 && plan.signal != "SIGKILL" {
        plan.send(&plan.signal);
        let grace = Duration::from_millis(plan.grace_ms);
        if let Ok(output) = tokio::time::timeout(grace, &mut work).await {
            return (Some(output), true);
        }
    }
    plan.send("SIGKILL");
    let pump = Duration::from_millis(crate::stream::DEFAULT_EXIT_PUMP_GRACE_MS);
    (tokio::time::timeout(pump, &mut work).await.ok(), true)
}
