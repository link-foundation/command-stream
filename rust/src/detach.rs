//! Fire-and-forget spawning (issue #232).
//!
//! [`crate::StreamingRunner::detach`] and [`crate::ProcessRunner::spawn_detached`]
//! start a command that outlives the caller and hand back its pid:
//!
//! * stdin, stdout and stderr are the null device, so nothing ties the child
//!   to the caller's pipes or terminal;
//! * on Unix the child leads a new process group (`process_group(0)`), so a
//!   CTRL+C or a group-wide signal aimed at the caller does not reach it; on
//!   Windows it is created with `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`;
//! * there is no `kill_on_drop`: nothing the caller drops stops the child.
//!
//! A background thread waits for the child, so it is reaped instead of being
//! left as a zombie while the caller keeps running. If the caller exits first
//! the child is reparented and keeps running.

use std::path::Path;
use std::process::Stdio;

use crate::stream_process::{ChildEnv, StreamingCommand};
use crate::trace::trace_lazy;
use crate::Result;

/// `CREATE_NEW_PROCESS_GROUP`: the child does not receive the caller's CTRL+C.
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
/// `DETACHED_PROCESS`: the child does not inherit the caller's console.
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// Spawn `command` detached from the caller and return its pid.
pub(crate) fn spawn_detached(
    command: &StreamingCommand,
    cwd: Option<&Path>,
    env: &ChildEnv,
) -> Result<Option<u32>> {
    let mut cmd = command.command(env.vars.as_ref()).into_std();
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    env.apply(&mut cmd);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }

    let mut child = cmd.spawn()?;
    let pid = child.id();
    trace_lazy("detach", || format!("Spawned detached child | pid={pid}"));
    // Reap the child when it exits. If the thread cannot be started the child
    // still runs; it is merely left unreaped until the caller exits.
    let _ = std::thread::Builder::new()
        .name("command-stream-detached".to_string())
        .spawn(move || {
            let _ = child.wait();
        });
    Ok(Some(pid))
}

impl crate::ProcessRunner {
    /// Start the command detached from the caller and return its pid, without
    /// waiting for it (issue #232).
    ///
    /// The command runs through the platform shell with the runner's `cwd`,
    /// `env`, [`env_remove`](crate::RunOptions::env_remove) and `prefer_local`
    /// options, with null stdio, in a process group of its own and without
    /// `kill_on_drop`, so it keeps running after the runner is dropped or the
    /// caller exits. Built-in virtual commands are not used, since they run
    /// inside the caller. The runner itself is left unstarted.
    ///
    /// ```no_run
    /// use command_stream::{ProcessRunner, RunOptions};
    ///
    /// let runner = ProcessRunner::new("sleep 60 && touch done", RunOptions::default());
    /// let pid = runner.spawn_detached()?;
    /// println!("started in the background as pid {pid:?}");
    /// # Ok::<(), command_stream::Error>(())
    /// ```
    pub fn spawn_detached(&self) -> Result<Option<u32>> {
        let options = self.options();
        let runner = match &self.argv {
            Some(argv) => crate::StreamingRunner::with_command(argv.clone()),
            None => crate::StreamingRunner::new(self.command()),
        };
        let mut runner = runner
            .prefer_local(options.prefer_local.clone())
            .env_remove_all(options.env_remove.iter().cloned());
        if let Some(cwd) = crate::resolve_spawn_cwd(options.cwd.as_ref()) {
            runner = runner.cwd(cwd);
        }
        if let Some(env) = &options.env {
            runner = runner.env(env.clone());
        }
        runner.detach()
    }
}
