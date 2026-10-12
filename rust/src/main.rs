//! command-stream CLI
//!
//! A simple CLI wrapper for the command-stream library.

use command_stream::{fy, run};
use std::env;
use std::io::Write;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if let Some(code) = command_stream::development::cli::cli(&args).await? {
        std::process::exit(code);
    }

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

    if args[0] == "fy" {
        if args.len() != 3 {
            return Err("Usage: command-stream fy input.sh output.mjs".into());
        }
        let source = tokio::fs::read_to_string(&args[1]).await?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o755);
        }
        let mut file = options.open(&args[2])?;
        file.write_all(fy(&source).as_bytes())?;
        return Ok(());
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
