//! Virtual command implementations
//!
//! This module contains implementations of shell commands that run in-process
//! without spawning external processes. These provide faster execution and
//! consistent behavior across platforms.

mod cat;
mod cd;
mod echo;
mod pwd;
mod sleep;
mod r#true;
mod r#false;
mod mkdir;
mod rm;
mod touch;
mod ls;
mod cp;
mod mv;
mod basename;
mod dirname;
mod env;
mod exit;
mod which;
mod yes;
mod seq;
mod test;

pub use cat::cat;
pub use cd::cd;
pub use echo::echo;
pub use pwd::pwd;
pub use sleep::sleep;
pub use r#true::r#true;
pub use r#false::r#false;
pub use mkdir::mkdir;
pub use rm::rm;
pub use touch::touch;
pub use ls::ls;
pub use cp::cp;
pub use mv::mv;
pub use basename::basename;
pub use dirname::dirname;
pub use env::env;
pub use exit::exit;
pub use which::which;
pub use yes::yes;
pub use seq::seq;
pub use test::test;

use crate::utils::CommandResult;
use std::collections::HashMap;
use std::path::Path;
use tokio::sync::mpsc;

/// Context for virtual command execution
#[derive(Debug)]
pub struct CommandContext {
    /// Command arguments (excluding the command name)
    pub args: Vec<String>,
    /// Standard input content
    pub stdin: Option<String>,
    /// Current working directory
    pub cwd: Option<std::path::PathBuf>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// Channel to send streaming output
    pub output_tx: Option<mpsc::Sender<StreamChunk>>,
    /// Cancellation check function
    pub is_cancelled: Option<Box<dyn Fn() -> bool + Send + Sync>>,
}

/// A chunk of streaming output
#[derive(Debug, Clone)]
pub enum StreamChunk {
    Stdout(String),
    Stderr(String),
}

impl CommandContext {
    /// Create a new command context with arguments
    pub fn new(args: Vec<String>) -> Self {
        CommandContext {
            args,
            stdin: None,
            cwd: None,
            env: None,
            output_tx: None,
            is_cancelled: None,
        }
    }

    /// Check if the command has been cancelled
    pub fn is_cancelled(&self) -> bool {
        self.is_cancelled
            .as_ref()
            .map(|f| f())
            .unwrap_or(false)
    }

    /// Get the current working directory
    pub fn get_cwd(&self) -> std::path::PathBuf {
        self.cwd.clone().unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"))
        })
    }
}

/// Type for virtual command handler functions
pub type VirtualCommandHandler = fn(CommandContext) -> std::pin::Pin<Box<dyn std::future::Future<Output = CommandResult> + Send>>;

/// Registry of virtual commands
pub struct VirtualCommandRegistry {
    commands: HashMap<String, VirtualCommandHandler>,
}

impl Default for VirtualCommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtualCommandRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        VirtualCommandRegistry {
            commands: HashMap::new(),
        }
    }

    /// Create a registry with all built-in commands registered
    pub fn with_builtins() -> Self {
        let mut registry = Self::new();
        registry.register_builtins();
        registry
    }

    /// Register a virtual command
    pub fn register(&mut self, name: &str, handler: VirtualCommandHandler) {
        self.commands.insert(name.to_string(), handler);
    }

    /// Unregister a virtual command
    pub fn unregister(&mut self, name: &str) -> bool {
        self.commands.remove(name).is_some()
    }

    /// Get a virtual command handler
    pub fn get(&self, name: &str) -> Option<&VirtualCommandHandler> {
        self.commands.get(name)
    }

    /// Check if a command is registered
    pub fn contains(&self, name: &str) -> bool {
        self.commands.contains_key(name)
    }

    /// List all registered command names
    pub fn list(&self) -> Vec<&str> {
        self.commands.keys().map(|s| s.as_str()).collect()
    }

    /// Register all built-in commands
    pub fn register_builtins(&mut self) {
        // Note: These are placeholder registrations - actual async handlers
        // would need proper wrapper functions
        // The actual commands are available as standalone functions
    }
}

/// Global virtual commands enabled flag
static VIRTUAL_COMMANDS_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

/// Enable virtual commands
pub fn enable_virtual_commands() {
    VIRTUAL_COMMANDS_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Disable virtual commands
pub fn disable_virtual_commands() {
    VIRTUAL_COMMANDS_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Check if virtual commands are enabled
pub fn are_virtual_commands_enabled() -> bool {
    VIRTUAL_COMMANDS_ENABLED.load(std::sync::atomic::Ordering::SeqCst)
}
