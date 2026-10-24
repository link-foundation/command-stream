use super::{dev, start_repl, DevEvent, DevOptions, ReplOptions};
use std::io::{self, IsTerminal};
use std::path::Path;

/// Handle development commands while preserving ordinary shell CLI arguments.
pub async fn cli(args: &[String]) -> io::Result<Option<i32>> {
    match args.first().map(String::as_str) {
        Some("--help" | "-h") => {
            println!("Usage: command-stream <command> [args...]\n  repl [--crate PATH] [--disable-readline]    Rust REPL (requires Evcxr)\n  dev Cargo.toml [watch-glob ...] [--repl]    Restart Cargo on changes\n  fy input.sh output.mjs                     Translate a shell script");
            Ok(Some(0))
        }
        Some("repl") => {
            let mut options = ReplOptions {
                disable_readline: !io::stdin().is_terminal(),
                ..Default::default()
            };
            let mut arguments = args[1..].iter();
            while let Some(argument) = arguments.next() {
                match argument.as_str() {
                    "--crate" => {
                        options.crate_path = Some(arguments.next().ok_or_else(usage)?.into())
                    }
                    "--disable-readline" => options.disable_readline = true,
                    _ => return Err(usage()),
                }
            }
            let piped = options.disable_readline;
            let mut repl = start_repl(options)?;
            loop {
                tokio::select! {
                    result = repl.wait() => return Ok(Some(result?.code().unwrap_or(1))),
                    signal = tokio::signal::ctrl_c() => {
                        signal?;
                        if piped { repl.close().await?; return Ok(Some(0)); }
                    },
                    result = terminated() => { result?; repl.close().await?; return Ok(Some(0)); },
                }
            }
        }
        Some("dev") => {
            let manifest = Path::new(args.get(1).ok_or_else(usage)?).canonicalize()?;
            if !manifest.is_file() {
                return Err(usage());
            }
            let cwd = manifest.parent().ok_or_else(usage)?.to_path_buf();
            let watch = args[2..]
                .iter()
                .filter(|argument| argument.as_str() != "--repl")
                .cloned()
                .collect::<Vec<_>>();
            let mut options = DevOptions {
                cwd: cwd.clone(),
                command: vec![
                    "cargo".into(),
                    "run".into(),
                    "--manifest-path".into(),
                    manifest.to_string_lossy().into_owned(),
                ],
                ..Default::default()
            };
            if !watch.is_empty() {
                options.watch = watch;
            }
            let mut repl = if args.iter().any(|argument| argument == "--repl") {
                Some(start_repl(ReplOptions {
                    disable_readline: !io::stdin().is_terminal(),
                    ..Default::default()
                })?)
            } else {
                None
            };
            println!(
                "command-stream Development Mode\nWatching patterns: {}",
                options.watch.join(", ")
            );
            let mut controller = dev(options).await?;
            loop {
                tokio::select! {
                    result = tokio::signal::ctrl_c() => { result?; break; }
                    result = terminated() => { result?; break; }
                    event = controller.next_event() => match event {
                        Some(DevEvent::Error(message)) => eprintln!("Development: {message}"),
                        Some(DevEvent::Restarted { .. }) => {},
                        None => break,
                    },
                    _ = async { repl.as_mut().unwrap().wait().await }, if repl.is_some() => break,
                }
            }
            if let Some(mut repl) = repl {
                repl.close().await?;
            }
            controller.close().await?;
            Ok(Some(0))
        }
        _ => Ok(None),
    }
}

fn usage() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "Usage: command-stream repl [--crate PATH] [--disable-readline] | dev Cargo.toml [watch-glob ...] [--repl]")
}

async fn terminated() -> io::Result<()> {
    #[cfg(unix)]
    {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?
            .recv()
            .await;
        Ok(())
    }
    #[cfg(not(unix))]
    std::future::pending().await
}
