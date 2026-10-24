//! Exact-argv construction for [`ProcessRunner`] (issue #230).

use std::ffi::OsString;

use crate::stream_process::StreamingCommand;
use crate::{ProcessRunner, RunOptions};

impl ProcessRunner {
    /// Create a runner that executes `program` with exactly `args`, without a
    /// shell.
    ///
    /// Nothing is parsed, expanded or quoted, and built-in virtual commands
    /// are never used, so `from_argv("echo", ["$HOME"])` prints `$HOME`. Every
    /// other option behaves as with [`ProcessRunner::new`], including
    /// [`StdinOption::Pipe`](crate::StdinOption::Pipe) with
    /// [`write_stdin`](Self::write_stdin) and [`close_stdin`](Self::close_stdin).
    /// [`command`](Self::command) reports the argv as a shell-quoted string.
    ///
    /// ```
    /// use command_stream::{ProcessRunner, RunOptions, StdinOption};
    ///
    /// # #[tokio::main]
    /// # async fn main() -> command_stream::Result<()> {
    /// let mut runner = ProcessRunner::from_argv(
    ///     "cat",
    ///     Vec::<String>::new(),
    ///     RunOptions { stdin: StdinOption::Pipe, mirror: false, ..Default::default() },
    /// );
    /// runner.start().await?;
    /// runner.write_stdin(b"{\"type\":\"user\"}\n").await?;
    /// runner.close_stdin().await?;
    /// let result = runner.run().await?;
    /// assert_eq!(result.stdout, "{\"type\":\"user\"}\n");
    /// # Ok(())
    /// # }
    /// ```
    pub fn from_argv<P, I, S>(program: P, args: I, options: RunOptions) -> Self
    where
        P: Into<OsString>,
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        let program = program.into();
        let args: Vec<OsString> = args.into_iter().map(Into::into).collect();
        let display = std::iter::once(&program)
            .chain(&args)
            .map(|part| crate::quote::quote(&part.to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");
        let mut runner = Self::new(display, options);
        runner.argv = Some(StreamingCommand::Argv { program, args });
        runner
    }
}
