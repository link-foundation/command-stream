//! Interactive Rust evaluation and Cargo development watching.
mod child;
pub mod cli;
mod repl;
mod watch;
pub use repl::{start_repl, ReplOptions, RustRepl};
pub use watch::{dev, DevController, DevEvent, DevOptions};
