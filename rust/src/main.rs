//! command-stream CLI
//!
//! A simple CLI wrapper for the command-stream library.

use command_stream::{run, RunOptions, ProcessRunner};
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.is_empty() {
        eprintln!("Usage: command-stream <command> [args...]");
        eprintln!();
        eprintln!("Execute shell commands with streaming support.");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  command-stream echo hello world");
        eprintln!("  command-stream ls -la");
        eprintln!("  command-stream 'echo hello && echo world'");
        std::process::exit(1);
    }

    let command = args.join(" ");

    let result = run(command).await?;

    // Print any output that wasn't mirrored
    if !result.stdout.is_empty() && !result.stdout.ends_with('\n') {
        println!("{}", result.stdout);
    }
    if !result.stderr.is_empty() {
        eprint!("{}", result.stderr);
    }

    std::process::exit(result.code);
}
