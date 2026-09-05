//! Trace/logging utilities for command-stream
//!
//! This module provides verbose logging functionality that can be controlled
//! via environment variables for debugging and development purposes.

use std::env;

/// Check if tracing is enabled via environment variables
///
/// Tracing can be controlled via:
/// - COMMAND_STREAM_TRACE=true/false (explicit control)
/// - COMMAND_STREAM_VERBOSE=true (enables tracing unless TRACE=false)
pub fn is_trace_enabled() -> bool {
    let trace_env = env::var("COMMAND_STREAM_TRACE").ok();
    let verbose_env = env::var("COMMAND_STREAM_VERBOSE")
        .map(|v| v == "true")
        .unwrap_or(false);

    match trace_env.as_deref() {
        Some("false") => false,
        Some("true") => true,
        _ => verbose_env,
    }
}

/// Trace function for verbose logging
///
/// Outputs trace messages to stderr when tracing is enabled.
/// Messages are prefixed with timestamp and category.
///
/// # Examples
///
/// ```
/// use command_stream::trace::trace;
///
/// trace("ProcessRunner", "Starting command execution");
/// ```
pub fn trace(category: &str, message: &str) {
    if !is_trace_enabled() {
        return;
    }

    let timestamp = chrono::Utc::now().to_rfc3339();
    eprintln!("[TRACE {}] [{}] {}", timestamp, category, message);
}

/// Trace function with lazy message evaluation
///
/// Only evaluates the message function if tracing is enabled.
/// This is useful for expensive message formatting that should
/// be avoided when tracing is disabled.
///
/// # Examples
///
/// ```
/// use command_stream::trace::trace_lazy;
///
/// trace_lazy("ProcessRunner", || {
///     format!("Expensive computation result: {}", 42)
/// });
/// ```
pub fn trace_lazy<F>(category: &str, message_fn: F)
where
    F: FnOnce() -> String,
{
    if !is_trace_enabled() {
        return;
    }

    trace(category, &message_fn());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    // Use a mutex to serialize tests that modify environment variables
    // This prevents race conditions when tests run in parallel
    static ENV_MUTEX: Mutex<()> = Mutex::new(());

    /// Helper to save and restore environment variables during tests
    struct EnvGuard {
        trace_value: Option<String>,
        verbose_value: Option<String>,
    }

    impl EnvGuard {
        fn new() -> Self {
            EnvGuard {
                trace_value: env::var("COMMAND_STREAM_TRACE").ok(),
                verbose_value: env::var("COMMAND_STREAM_VERBOSE").ok(),
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            // Restore original values
            match &self.trace_value {
                Some(v) => env::set_var("COMMAND_STREAM_TRACE", v),
                None => env::remove_var("COMMAND_STREAM_TRACE"),
            }
            match &self.verbose_value {
                Some(v) => env::set_var("COMMAND_STREAM_VERBOSE", v),
                None => env::remove_var("COMMAND_STREAM_VERBOSE"),
            }
        }
    }

    #[test]
    fn test_trace_disabled_by_default() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let _guard = EnvGuard::new();

        // Clear env vars to test default behavior
        env::remove_var("COMMAND_STREAM_TRACE");
        env::remove_var("COMMAND_STREAM_VERBOSE");
        assert!(!is_trace_enabled());
    }

    #[test]
    fn test_trace_enabled_by_verbose() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let _guard = EnvGuard::new();

        env::remove_var("COMMAND_STREAM_TRACE");
        env::set_var("COMMAND_STREAM_VERBOSE", "true");
        assert!(is_trace_enabled());
    }

    #[test]
    fn test_trace_explicit_true() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let _guard = EnvGuard::new();

        env::remove_var("COMMAND_STREAM_VERBOSE");
        env::set_var("COMMAND_STREAM_TRACE", "true");
        assert!(is_trace_enabled());
    }

    #[test]
    fn test_trace_explicit_false_overrides_verbose() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let _guard = EnvGuard::new();

        env::set_var("COMMAND_STREAM_TRACE", "false");
        env::set_var("COMMAND_STREAM_VERBOSE", "true");
        assert!(!is_trace_enabled());
    }
}
