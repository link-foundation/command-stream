use super::{CancelSignal, ExecaError, ExecaOutcome, ExecaResult, Options, Subprocess};
use std::ffi::OsString;
use std::future::{Future, IntoFuture};
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

/// A reusable command factory with private default options.
#[derive(Debug, Clone, Default)]
pub struct Execa {
    options: Options,
}

impl Execa {
    pub fn new(options: Options) -> Self {
        Self { options }
    }

    pub fn options(&self) -> &Options {
        &self.options
    }

    pub fn command<P, I, S>(&self, file: P, args: I) -> ExecaCommand
    where
        P: Into<OsString>,
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        ExecaCommand {
            file: file.into(),
            args: args.into_iter().map(Into::into).collect(),
            options: self.options.clone(),
        }
    }

    /// Run a Node.js file. Node's JavaScript IPC helpers are not emulated.
    pub fn node<P, I, S>(&self, file: P, args: I) -> ExecaCommand
    where
        P: Into<OsString>,
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        let mut node_args = self.options.node_options.clone();
        node_args.push(file.into());
        node_args.extend(args.into_iter().map(Into::into));
        self.command(self.options.node_exec_path.clone(), node_args)
    }
}

/// An exact-argv command. Await it directly or call `spawn()` to stream output.
#[derive(Debug, Clone)]
pub struct ExecaCommand {
    pub(crate) file: OsString,
    pub(crate) args: Vec<OsString>,
    pub(crate) options: Options,
}

macro_rules! setter {
    ($name:ident, $field:ident, $ty:ty) => {
        pub fn $name(mut self, value: $ty) -> Self {
            self.options.$field = value;
            self
        }
    };
}

impl ExecaCommand {
    pub fn with_options(mut self, options: Options) -> Self {
        self.options = options;
        self
    }

    setter!(reject, reject, bool);
    setter!(all, all, bool);
    setter!(buffer, buffer, bool);
    setter!(strip_final_newline, strip_final_newline, bool);
    setter!(max_buffer, max_buffer, usize);

    pub fn input(mut self, input: impl Into<Vec<u8>>) -> Self {
        self.options.input = Some(input.into());
        self
    }

    pub fn cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.options.cwd = Some(cwd.into());
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.options.timeout = Some(timeout);
        self
    }

    pub fn cancel_signal(mut self, signal: CancelSignal) -> Self {
        self.options.cancel_signal = Some(signal);
        self
    }

    pub fn spawn(self) -> Subprocess {
        Subprocess::new(self)
    }

    pub async fn run(self) -> ExecaOutcome {
        self.spawn().wait().await
    }

    /// Run outside a Tokio runtime. Async callers should await the command.
    pub fn sync(self) -> ExecaOutcome {
        let failure = |cause: String| ExecaError {
            result: Box::new(ExecaResult {
                failed: true,
                cause: Some(cause),
                ..ExecaResult::default()
            }),
        };
        if tokio::runtime::Handle::try_current().is_ok() {
            return Err(failure(
                "sync cannot run inside Tokio; await the command instead".into(),
            ));
        }
        let runtime = tokio::runtime::Runtime::new().map_err(|error| failure(error.to_string()))?;
        runtime.block_on(self.run())
    }

    /// Pass captured stdout as exact input to the next command. This convenience
    /// is buffered; use the native Pipeline API for a streaming Rust pipeline.
    pub async fn pipe(self, mut destination: ExecaCommand) -> ExecaOutcome {
        // This buffered convenience needs source bytes even when the caller
        // disabled retaining its ordinary result output.
        let source = self.buffer(true).strip_final_newline(false).run().await?;
        destination.options.input = Some(source.stdout);
        destination.run().await
    }
}

impl IntoFuture for ExecaCommand {
    type Output = ExecaOutcome;
    type IntoFuture = Pin<Box<dyn Future<Output = Self::Output> + Send>>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(self.run())
    }
}
