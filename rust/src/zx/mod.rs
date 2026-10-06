//! A zx-compatible API (modelled on google/zx 8.x) for writing shell scripts
//! in Rust.
//!
//! The core pieces mirror zx:
//!
//! - [`Shell`] is the `$`: a command factory carrying [`Options`] (cwd, env,
//!   shell, prefix, verbose, quiet, nothrow, timeout, ...). The [`zx!`](crate::zx!)
//!   macro interpolates arguments with zx quoting (`$'...'` for bash).
//! - [`ProcessPromise`] is a configured command; `.await` (or
//!   [`run`](ProcessPromise::run)) yields `Ok(ProcessOutput)` on success and
//!   `Err(ProcessOutput)` on failure unless `nothrow` is set.
//! - [`ProcessOutput`] holds stdout, stderr, stdall, the exit code, signal and
//!   duration, and formats zx-style error messages.
//! - [`within`], [`configure`] and [`cd`] provide scoped settings, and the
//!   goods ([`sleep`], [`retry`], [`spinner`], [`tempdir`], [`parse_argv`], ...)
//!   cover the script helpers.
//!
//! ```no_run
//! use command_stream::zx;
//! use command_stream::zx::Shell;
//!
//! # async fn demo() -> Result<(), zx::ProcessOutput> {
//! let name = "hello world";
//! let out = zx!("echo {}", name).await?;
//! assert_eq!(out.stdout, "hello world\n");
//!
//! let failed = zx!(Shell::new().nothrow(true), "exit 3").await?;
//! assert_eq!(failed.exit_code, Some(3));
//! # Ok(())
//! # }
//! ```

pub mod argv;
pub mod dotenv;
pub mod error;
pub mod goods;
pub mod kill;
pub mod log;
pub mod md;
pub mod output;
pub mod process;
pub mod shell;
pub mod util;

pub use argv::{minimist, parse_argv, ArgvOptions, Booleans};
pub use error::ZxError;
pub use goods::{
    echo, exp_backoff, glob, retry, retry_with_backoff, retry_with_delay, sleep, spinner, tempdir,
    tempfile, which,
};
pub use kill::kill;
pub use log::{format_cmd, LogEntry, Logger};
pub use md::transform_markdown;
pub use output::{ErrorInfo, ProcessOutput};
pub use process::{PipeFrom, ProcessPromise, RunningProcess, ZxResult};
pub use shell::{
    cd, configure, current_options, use_bash, use_powershell, use_pwsh, within, within_sync,
    Options, PreferLocal, Shell,
};
pub use util::{parse_duration, quote, quote_powershell, IntoZxArg, ZxArg};

/// Build a [`ProcessPromise`](crate::zx::ProcessPromise) from a format string
/// whose `{}` placeholders are replaced by quoted arguments (`{{}}` is a
/// literal `{}`).
///
/// - `zx!("echo {}", arg)` uses [`Shell::new()`](crate::zx::Shell::new), i.e.
///   the options of the current scope;
/// - `zx!(shell, "echo {}", arg)` uses the given [`Shell`](crate::zx::Shell).
///
/// Arguments may be anything implementing
/// [`IntoZxArg`](crate::zx::IntoZxArg): strings, numbers, paths, vectors
/// (expanded into several quoted words) and `ProcessOutput`s (their stdout
/// without the trailing newline).
#[macro_export]
macro_rules! zx {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::zx!($crate::zx::Shell::new(), $fmt $(, $arg)*)
    };
    ($sh:expr, $fmt:literal $(, $arg:expr)* $(,)?) => {
        $sh.cmd(
            &$crate::zx::util::split_template($fmt),
            &[$($crate::zx::IntoZxArg::into_zx_arg($arg)),*],
        )
    };
}
