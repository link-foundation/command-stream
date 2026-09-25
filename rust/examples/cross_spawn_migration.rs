//! Exact-argument buffered and live output with the Rust API.

use command_stream::{OutputChunk, StreamingRunner};
use std::io::Write;
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--emit-delayed") {
        println!("first");
        std::io::stdout().flush()?;
        std::thread::sleep(Duration::from_millis(40));
        println!("second");
        return Ok(());
    }

    let executable = std::env::current_exe()?;
    let buffered =
        StreamingRunner::from_argv(&executable, ["--emit-delayed"]).collect_blocking()?;
    assert_eq!(buffered.stdout, "first\nsecond\n");

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let mut chunks = StreamingRunner::from_argv(&executable, ["--emit-delayed"]).stream();
        let mut saw_output_before_exit = false;
        let mut exited = false;
        while let Some(chunk) = chunks.next().await {
            match chunk {
                OutputChunk::Stdout(bytes) if !exited && !bytes.is_empty() => {
                    saw_output_before_exit = true;
                }
                OutputChunk::Exit(0) => exited = true,
                OutputChunk::Exit(code) => panic!("child exited with {code}"),
                _ => {}
            }
        }
        assert!(saw_output_before_exit && exited);
    });

    println!("Streaming output arrived before process exit; blocking output was collected.");
    Ok(())
}
