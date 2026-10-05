//! Execa-style exact-argument process execution with a separate options store.
//!
//! Unlike the native shell API, these commands execute a file directly and
//! reject failures by default. Output stays as bytes; `text()` and line helpers
//! provide decoded views. JavaScript-specific IPC and transforms belong to the
//! JavaScript `command-stream/execa` entry point.
//!
//! ```no_run
//! # async fn example() -> Result<(), command_stream::execa::ExecaError> {
//! let result = command_stream::execa("git", ["status", "--short"]).await?;
//! println!("{}", result.text());
//! # Ok(())
//! # }
//! ```

mod command;
mod options;
mod process;
mod result;

pub use command::{Execa, ExecaCommand};
pub use options::{CancelSignal, Cancellation, Options};
pub use process::Subprocess;
pub use result::{ExecaError, ExecaOutcome, ExecaResult};
use std::ffi::OsString;

pub fn execa<P, I, S>(file: P, args: I) -> ExecaCommand
where
    P: Into<OsString>,
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    Execa::default().command(file, args)
}

pub fn execa_sync<P, I, S>(file: P, args: I) -> ExecaOutcome
where
    P: Into<OsString>,
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    execa(file, args).sync()
}

pub fn execa_node<P, I, S>(file: P, args: I) -> ExecaCommand
where
    P: Into<OsString>,
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    Execa::default().node(file, args)
}

pub fn execa_compat(options: Options) -> Execa {
    Execa::new(options)
}
