//! Macros for ergonomic command execution
//!
//! This module provides the `cmd!` macro which offers a similar experience
//! to JavaScript's `$` tagged template literal for shell command execution.
//!
//! ## Usage
//!
//! ```rust,no_run
//! use command_stream::cmd;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Simple command
//!     let result = cmd!("echo hello world").await?;
//!
//!     // With interpolation (values are automatically quoted for safety)
//!     let name = "John Doe";
//!     let result = cmd!("echo Hello, {}", name).await?;
//!
//!     // Multiple arguments
//!     let file = "test.txt";
//!     let dir = "/tmp";
//!     let result = cmd!("cp {} {}", file, dir).await?;
//!
//!     Ok(())
//! }
//! ```

/// Build a shell command with interpolated values safely quoted
///
/// This function is used internally by the `cmd!` macro to build
/// shell commands with properly quoted interpolated values.
pub fn build_shell_command(parts: &[&str], values: &[&str]) -> String {
    let mut result = String::new();

    for (i, part) in parts.iter().enumerate() {
        result.push_str(part);
        if i < values.len() {
            result.push_str(&crate::quote::quote(values[i]));
        }
    }

    result
}

/// Helper function to create a ProcessRunner from a command string
pub fn create_runner(command: String) -> crate::ProcessRunner {
    crate::ProcessRunner::new(command, crate::RunOptions {
        mirror: true,
        capture: true,
        ..Default::default()
    })
}

/// Helper function to create a ProcessRunner with custom options
pub fn create_runner_with_options(command: String, options: crate::RunOptions) -> crate::ProcessRunner {
    crate::ProcessRunner::new(command, options)
}

/// The `cmd!` macro for ergonomic shell command execution
///
/// This macro provides a similar experience to JavaScript's `$` tagged template literal.
/// Values interpolated into the command are automatically quoted for shell safety.
///
/// # Examples
///
/// ```rust,no_run
/// use command_stream::cmd;
///
/// # async fn example() -> Result<(), command_stream::Error> {
/// // Simple command (returns a future that can be awaited)
/// let result = cmd!("echo hello").await?;
///
/// // With string interpolation
/// let name = "world";
/// let result = cmd!("echo hello {}", name).await?;
///
/// // With multiple values
/// let src = "source.txt";
/// let dst = "dest.txt";
/// let result = cmd!("cp {} {}", src, dst).await?;
///
/// // Values with special characters are automatically quoted
/// let filename = "file with spaces.txt";
/// let result = cmd!("cat {}", filename).await?; // Safely handles spaces
/// # Ok(())
/// # }
/// ```
///
/// # Safety
///
/// All interpolated values are automatically quoted using shell-safe quoting,
/// preventing command injection attacks.
#[macro_export]
macro_rules! cmd {
    // No interpolation - just a plain command string
    ($cmd:expr) => {{
        async {
            $crate::run($cmd).await
        }
    }};

    // With format-style interpolation
    ($fmt:expr, $($arg:expr),+ $(,)?) => {{
        // Build command with quoted values
        let mut result = String::new();
        let values: Vec<String> = vec![$(format!("{}", $arg)),+];
        let values_ref: Vec<&str> = values.iter().map(|s| s.as_str()).collect();
        let fmt_parts: Vec<&str> = $fmt.split("{}").collect();
        for (i, part) in fmt_parts.iter().enumerate() {
            result.push_str(part);
            if i < values_ref.len() {
                result.push_str(&$crate::quote::quote(values_ref[i]));
            }
        }

        async move {
            $crate::run(result).await
        }
    }};
}

/// The `sh!` macro - alias for `cmd!`
///
/// This is an alternative name for `cmd!` that some users may find
/// more intuitive for shell command execution.
#[macro_export]
macro_rules! sh {
    ($($args:tt)*) => {
        $crate::cmd!($($args)*)
    };
}
