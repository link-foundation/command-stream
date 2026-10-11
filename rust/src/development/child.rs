use crate::signal::{send_signal_to_process, Delivery, DEFAULT_KILL_GRACE_MS};
use std::io;
use tokio::process::{Child, Command};

pub(super) struct ManagedChild {
    pub child: Child,
    pid: Option<u32>,
}

impl ManagedChild {
    pub fn spawn(command: &mut Command, interactive: bool) -> io::Result<Self> {
        command.kill_on_drop(true);
        #[cfg(unix)]
        if !interactive {
            command.process_group(0);
        }
        let child = command.spawn()?;
        let pid = if interactive { None } else { child.id() };
        Ok(Self { child, pid })
    }

    pub async fn stop(&mut self) -> io::Result<()> {
        if let Some(pid) = self.pid.take() {
            send_signal_to_process(pid, "SIGTERM", Delivery::ProcessAndGroup);
            let _ = tokio::time::timeout(
                std::time::Duration::from_millis(DEFAULT_KILL_GRACE_MS),
                self.child.wait(),
            )
            .await;
            // Stop descendants even when the leader already exited.
            send_signal_to_process(pid, "SIGKILL", Delivery::ProcessAndGroup);
        }
        let _ = self.child.start_kill();
        self.child.wait().await?;
        Ok(())
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            send_signal_to_process(pid, "SIGKILL", Delivery::ProcessAndGroup);
        }
    }
}
