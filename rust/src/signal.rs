//! Signal delivery and the signal exit-code convention.
//!
//! Both runners stop processes the same way, so the signal vocabulary lives in
//! one place instead of being duplicated per runner:
//!
//!   * [`ProcessRunner::kill`](crate::ProcessRunner::kill) /
//!     [`ProcessRunner::kill_with`](crate::ProcessRunner::kill_with)
//!   * [`OutputStream::kill`](crate::OutputStream::kill) /
//!     [`OutputStream::kill_with`](crate::OutputStream::kill_with)
//!
//! The model mirrors the JavaScript implementation:
//!
//!   1. The requested signal is delivered to the child **and** its process
//!      group, so grandchildren spawned by a shell are stopped too. The group
//!      is skipped for a child that shares the caller's terminal, which stays
//!      in the caller's process group by design so that CTRL+C keeps reaching
//!      it.
//!   2. The child is given a grace period ([`DEFAULT_KILL_GRACE_MS`]) to run its
//!      own signal handler and exit on its own terms.
//!   3. If it is still alive when the grace period expires, `SIGKILL` follows,
//!      so a process that ignores the signal still terminates.
//!   4. The reported exit code is the conventional `128 + signal` value
//!      ([`signal_exit_code`]).
//!
//! A grace period of zero collapses steps 1 to 3 into `SIGKILL` alone: any work
//! between the requested signal and the escalation is a window the child can be
//! scheduled in, so delivering it first would make "no grace" a race rather
//! than a guarantee. The exit code still reflects the signal that was asked
//! for.

/// Default signal used to stop a process when no explicit signal is given.
///
/// Mirrors the JavaScript `killSignal` default.
pub const DEFAULT_KILL_SIGNAL: &str = "SIGTERM";

/// Default grace period (in milliseconds) between the requested signal and the
/// forceful `SIGKILL` escalation.
///
/// Mirrors the JavaScript `killGrace` default. It is what makes a graceful
/// shutdown possible: without it the child is killed before its own handler
/// gets to run.
pub const DEFAULT_KILL_GRACE_MS: u64 = 100;

/// Map a signal name to its numeric value.
///
/// Unknown names fall back to `SIGTERM`, matching the JavaScript
/// implementation's behavior for unrecognized signals.
///
/// ```
/// use command_stream::signal::signal_number;
///
/// assert_eq!(signal_number("SIGINT"), 2);
/// assert_eq!(signal_number("SIGKILL"), 9);
/// assert_eq!(signal_number("SIGTERM"), 15);
/// ```
pub fn signal_number(signal: &str) -> i32 {
    match signal {
        "SIGHUP" => 1,
        "SIGINT" => 2,
        "SIGQUIT" => 3,
        "SIGKILL" => 9,
        "SIGUSR1" => 10,
        "SIGUSR2" => 12,
        "SIGTERM" => 15,
        _ => 15,
    }
}

/// The exit code reported for a process stopped with `signal`, following the
/// conventional `128 + signal` mapping used by POSIX shells.
///
/// ```
/// use command_stream::signal::signal_exit_code;
///
/// assert_eq!(signal_exit_code("SIGINT"), 130); // CTRL+C
/// assert_eq!(signal_exit_code("SIGTERM"), 143);
/// assert_eq!(signal_exit_code("SIGKILL"), 137);
/// ```
pub fn signal_exit_code(signal: &str) -> i32 {
    128 + signal_number(signal)
}

/// Who a signal is delivered to.
///
/// Only the runner that spawned the child knows which of these applies, so it
/// is stated rather than discovered: a child spawned with `process_group(0)`
/// leads its own group, and a child left in the caller's group does not.
// Windows has neither signals nor process groups, so the distinction only ever
// narrows to `ProcessAndGroup` there and the other variant is genuinely unused.
#[cfg_attr(not(unix), allow(dead_code))]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Delivery {
    /// The process alone, for a child sharing the caller's process group.
    ProcessOnly,
    /// The process and the group it leads, which is what reaches grandchildren.
    ProcessAndGroup,
}

/// Send a signal to a process and, when it leads one, its process group.
///
/// Delivery to the group (negative pid) is what reaches grandchildren, e.g. the
/// real command behind a `sh -c` wrapper. It must not be attempted for a child
/// left in the caller's group, where `-pid` would name a group we do not own -
/// at best a non-existent one, at worst an unrelated group that reused the
/// number.
///
/// Group leadership is passed in rather than looked up with `getpgid` because
/// the leader is usually dead by the time the group is signalled: the first
/// signal kills the `sh` wrapper, and the escalation follows a grace period
/// later. Linux answers `getpgid` for a zombie, but macOS does not - its
/// `proc_find` skips zombies, so the lookup failed with `ESRCH` and the group,
/// including the still-running grandchild, was never signalled at all.
///
/// Both deliveries are best effort: the process may already have exited, which
/// is not an error for a caller that only wants it stopped.
#[cfg(unix)]
pub(crate) fn send_signal_to_process(pid: u32, signal: &str, delivery: Delivery) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    let sig = match signal {
        "SIGHUP" => Signal::SIGHUP,
        "SIGINT" => Signal::SIGINT,
        "SIGQUIT" => Signal::SIGQUIT,
        "SIGKILL" => Signal::SIGKILL,
        "SIGUSR1" => Signal::SIGUSR1,
        "SIGUSR2" => Signal::SIGUSR2,
        "SIGTERM" => Signal::SIGTERM,
        _ => Signal::SIGTERM,
    };

    // Signal the whole process group (negative pid) first, so grandchildren are
    // reached even if the group leader dies on the signal we send it next.
    if delivery == Delivery::ProcessAndGroup {
        let _ = kill(Pid::from_raw(-(pid as i32)), sig);
    }
    // Signal the process itself.
    let _ = kill(Pid::from_raw(pid as i32), sig);
}

/// On non-Unix platforms there is no signal delivery, and no process groups to
/// deliver to; the forceful `start_kill()` escalation in the caller handles
/// termination.
#[cfg(not(unix))]
pub(crate) fn send_signal_to_process(_pid: u32, _signal: &str, _delivery: Delivery) {}
