//! Global state management for command-stream
//!
//! This module handles signal handlers, process tracking, and cleanup,
//! similar to the JavaScript $.state.mjs module.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::trace::trace_lazy;

/// Shell settings for controlling execution behavior
#[derive(Debug, Clone, Default)]
pub struct ShellSettings {
    /// Exit immediately if a command exits with non-zero status (set -e)
    pub errexit: bool,
    /// Print commands as they are executed (set -v)
    pub verbose: bool,
    /// Print trace of commands (set -x)
    pub xtrace: bool,
    /// Return value of a pipeline is the status of the last command to exit with non-zero (set -o pipefail)
    pub pipefail: bool,
    /// Treat unset variables as an error (set -u)
    pub nounset: bool,
    /// Disable filename globbing (set -f)
    pub noglob: bool,
    /// Export all variables (set -a)
    pub allexport: bool,
}

impl ShellSettings {
    /// Create new shell settings with defaults
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset all settings to their defaults
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Set a shell option by name
    ///
    /// Supports both short flags (e, v, x, u, f, a) and long names
    pub fn set(&mut self, option: &str, value: bool) {
        match option {
            "e" | "errexit" => self.errexit = value,
            "v" | "verbose" => self.verbose = value,
            "x" | "xtrace" => self.xtrace = value,
            "u" | "nounset" => self.nounset = value,
            "f" | "noglob" => self.noglob = value,
            "a" | "allexport" => self.allexport = value,
            "o pipefail" | "pipefail" => self.pipefail = value,
            _ => {
                trace_lazy("ShellSettings", || {
                    format!("Unknown shell option: {}", option)
                });
            }
        }
    }

    /// Enable a shell option
    pub fn enable(&mut self, option: &str) {
        self.set(option, true);
    }

    /// Disable a shell option
    pub fn disable(&mut self, option: &str) {
        self.set(option, false);
    }
}

/// Global state for the command-stream library
pub struct GlobalState {
    /// Current shell settings
    shell_settings: RwLock<ShellSettings>,
    /// Set of active process runner IDs
    active_runners: RwLock<HashSet<u64>>,
    /// Counter for generating runner IDs
    next_runner_id: std::sync::atomic::AtomicU64,
    /// Whether signal handlers are installed
    signal_handlers_installed: AtomicBool,
    /// Whether virtual commands are enabled
    virtual_commands_enabled: AtomicBool,
    /// Initial working directory
    initial_cwd: RwLock<Option<std::path::PathBuf>>,
}

impl Default for GlobalState {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalState {
    /// Create a new global state
    pub fn new() -> Self {
        let initial_cwd = std::env::current_dir().ok();

        GlobalState {
            shell_settings: RwLock::new(ShellSettings::new()),
            active_runners: RwLock::new(HashSet::new()),
            next_runner_id: std::sync::atomic::AtomicU64::new(1),
            signal_handlers_installed: AtomicBool::new(false),
            virtual_commands_enabled: AtomicBool::new(true),
            initial_cwd: RwLock::new(initial_cwd),
        }
    }

    /// Get the current shell settings
    pub async fn get_shell_settings(&self) -> ShellSettings {
        self.shell_settings.read().await.clone()
    }

    /// Set shell settings
    pub async fn set_shell_settings(&self, settings: ShellSettings) {
        *self.shell_settings.write().await = settings;
    }

    /// Modify shell settings with a closure
    pub async fn with_shell_settings<F>(&self, f: F)
    where
        F: FnOnce(&mut ShellSettings),
    {
        let mut settings = self.shell_settings.write().await;
        f(&mut settings);
    }

    /// Enable a shell option
    pub async fn enable_shell_option(&self, option: &str) {
        self.shell_settings.write().await.enable(option);
    }

    /// Disable a shell option
    pub async fn disable_shell_option(&self, option: &str) {
        self.shell_settings.write().await.disable(option);
    }

    /// Register a new active runner and return its ID
    pub async fn register_runner(&self) -> u64 {
        let id = self
            .next_runner_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.active_runners.write().await.insert(id);

        trace_lazy("GlobalState", || {
            format!("Registered runner {}", id)
        });

        id
    }

    /// Unregister an active runner
    pub async fn unregister_runner(&self, id: u64) {
        self.active_runners.write().await.remove(&id);

        trace_lazy("GlobalState", || {
            format!("Unregistered runner {}", id)
        });
    }

    /// Get the count of active runners
    pub async fn active_runner_count(&self) -> usize {
        self.active_runners.read().await.len()
    }

    /// Check if signal handlers are installed
    pub fn are_signal_handlers_installed(&self) -> bool {
        self.signal_handlers_installed.load(Ordering::SeqCst)
    }

    /// Mark signal handlers as installed
    pub fn set_signal_handlers_installed(&self, installed: bool) {
        self.signal_handlers_installed.store(installed, Ordering::SeqCst);
    }

    /// Check if virtual commands are enabled
    pub fn are_virtual_commands_enabled(&self) -> bool {
        self.virtual_commands_enabled.load(Ordering::SeqCst)
    }

    /// Enable virtual commands
    pub fn enable_virtual_commands(&self) {
        self.virtual_commands_enabled.store(true, Ordering::SeqCst);
        trace_lazy("GlobalState", || "Virtual commands enabled".to_string());
    }

    /// Disable virtual commands
    pub fn disable_virtual_commands(&self) {
        self.virtual_commands_enabled.store(false, Ordering::SeqCst);
        trace_lazy("GlobalState", || "Virtual commands disabled".to_string());
    }

    /// Get the initial working directory
    pub async fn get_initial_cwd(&self) -> Option<std::path::PathBuf> {
        self.initial_cwd.read().await.clone()
    }

    /// Reset global state to defaults
    pub async fn reset(&self) {
        // Reset shell settings
        *self.shell_settings.write().await = ShellSettings::new();

        // Clear active runners
        self.active_runners.write().await.clear();

        // Reset virtual commands flag
        self.virtual_commands_enabled.store(true, Ordering::SeqCst);

        // Don't reset signal handlers installed flag - that's managed separately

        trace_lazy("GlobalState", || "Global state reset completed".to_string());
    }

    /// Restore working directory to initial
    pub async fn restore_cwd(&self) -> std::io::Result<()> {
        if let Some(ref initial) = *self.initial_cwd.read().await {
            if initial.exists() {
                std::env::set_current_dir(initial)?;
            }
        }
        Ok(())
    }
}

/// Global state singleton
static GLOBAL_STATE: std::sync::OnceLock<Arc<GlobalState>> = std::sync::OnceLock::new();

/// Get the global state instance
pub fn global_state() -> Arc<GlobalState> {
    GLOBAL_STATE
        .get_or_init(|| Arc::new(GlobalState::new()))
        .clone()
}

/// Reset the global state (for testing)
pub async fn reset_global_state() {
    global_state().reset().await;
}

/// Get current shell settings
pub async fn get_shell_settings() -> ShellSettings {
    global_state().get_shell_settings().await
}

/// Enable a shell option globally
pub async fn set_shell_option(option: &str) {
    global_state().enable_shell_option(option).await;
}

/// Disable a shell option globally
pub async fn unset_shell_option(option: &str) {
    global_state().disable_shell_option(option).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_settings_default() {
        let settings = ShellSettings::new();
        assert!(!settings.errexit);
        assert!(!settings.verbose);
        assert!(!settings.xtrace);
        assert!(!settings.pipefail);
        assert!(!settings.nounset);
    }

    #[test]
    fn test_shell_settings_set() {
        let mut settings = ShellSettings::new();

        settings.set("e", true);
        assert!(settings.errexit);

        settings.set("errexit", false);
        assert!(!settings.errexit);

        settings.set("o pipefail", true);
        assert!(settings.pipefail);
    }

    #[tokio::test]
    async fn test_global_state_runners() {
        let state = GlobalState::new();

        let id1 = state.register_runner().await;
        let id2 = state.register_runner().await;

        assert_eq!(state.active_runner_count().await, 2);
        assert!(id1 != id2);

        state.unregister_runner(id1).await;
        assert_eq!(state.active_runner_count().await, 1);

        state.unregister_runner(id2).await;
        assert_eq!(state.active_runner_count().await, 0);
    }

    #[tokio::test]
    async fn test_global_state_virtual_commands() {
        let state = GlobalState::new();

        assert!(state.are_virtual_commands_enabled());

        state.disable_virtual_commands();
        assert!(!state.are_virtual_commands_enabled());

        state.enable_virtual_commands();
        assert!(state.are_virtual_commands_enabled());
    }

    #[tokio::test]
    async fn test_global_state_reset() {
        let state = GlobalState::new();

        // Modify state
        state.enable_shell_option("errexit").await;
        state.register_runner().await;
        state.disable_virtual_commands();

        // Reset
        state.reset().await;

        // Verify reset
        let settings = state.get_shell_settings().await;
        assert!(!settings.errexit);
        assert_eq!(state.active_runner_count().await, 0);
        assert!(state.are_virtual_commands_enabled());
    }
}
