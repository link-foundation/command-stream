//! command-stream CLI
//!
//! A simple CLI wrapper for the command-stream library.

use command_stream::run;
use std::env;
use std::io::{IsTerminal, Read};

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
        let parsed = command_stream::fy::cli::parse_arguments(&args[1..]);
        let mut ctx = command_stream::commands::CommandContext::new(args[1..].to_vec());
        if parsed.as_ref().is_ok_and(|parsed| {
            !parsed.help && parsed.positional.first().is_none_or(|path| path == "-")
        }) && !std::io::stdin().is_terminal()
        {
            let mut source = String::new();
            std::io::stdin().read_to_string(&mut source)?;
            ctx.stdin = Some(source);
        }
        let result = command_stream::commands::fy(ctx).await;
        print!("{}", result.stdout);
        eprint!("{}", result.stderr);
        std::process::exit(result.code);
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
