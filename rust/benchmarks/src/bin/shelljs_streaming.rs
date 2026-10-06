//! Bounded buffered-versus-streaming counterpart of the JavaScript ShellJS probe.
use command_stream::{OutputChunk, StreamingRunner};
use std::io::Write;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).as_deref() == Some("--producer") {
        for _ in 0..8 {
            std::io::stdout().write_all(&vec![b'x'; 65536])?;
            std::io::stdout().flush()?;
            std::thread::sleep(Duration::from_millis(5));
        }
        return Ok(());
    }
    let executable = std::env::current_exe()?;
    let mut observations = Vec::new();
    for mode in ["buffered", "streaming"] {
        let started = Instant::now();
        let mut first_byte_ms = None;
        let (received, code) = if mode == "buffered" {
            let result = StreamingRunner::from_argv(&executable, ["--producer"])
                .collect()
                .await?;
            first_byte_ms = Some(started.elapsed().as_secs_f64() * 1000.0);
            (result.stdout.len(), result.code)
        } else {
            let mut stream = StreamingRunner::from_argv(&executable, ["--producer"]).stream();
            let mut received = 0;
            let mut code = None;
            while let Some(chunk) = stream.next().await {
                match chunk {
                    OutputChunk::Stdout(bytes) => {
                        first_byte_ms
                            .get_or_insert_with(|| started.elapsed().as_secs_f64() * 1000.0);
                        received += bytes.len();
                    }
                    OutputChunk::Exit(exit) => code = Some(exit),
                    OutputChunk::Stderr(_) => {}
                }
            }
            (received, code.ok_or("missing exit event")?)
        };
        if received != 8 * 65536 || code != 0 {
            return Err("incomplete benchmark output".into());
        }
        observations.push(serde_json::json!({ "mode": mode, "received": received, "code": code, "firstByteMs": first_byte_ms, "totalMs": started.elapsed().as_secs_f64() * 1000.0 }));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &serde_json::json!({ "platform": std::env::consts::OS, "workload": { "chunks": 8, "bytes": 65536, "delay": 5 }, "observations": observations })
        )?
    );
    Ok(())
}
