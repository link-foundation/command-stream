//! Run with `cargo run --example development` from rust/.
use command_stream::{dev, DevEvent, DevOptions};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let mut controller = dev(DevOptions {
        watch: vec!["examples/**/*.rs".into(), "src/**/*.rs".into()],
        command: vec![
            "cargo".into(),
            "run".into(),
            "--example".into(),
            "language_features".into(),
            "--".into(),
            "command-builder".into(),
        ],
        ..Default::default()
    })
    .await?;
    loop {
        tokio::select! {
            signal = tokio::signal::ctrl_c() => { signal?; break; }
            event = controller.next_event() => match event {
                Some(DevEvent::Restarted { files, pid }) => println!("Restarted {pid:?}: {files:?}"),
                Some(DevEvent::Error(error)) => eprintln!("{error}"),
                None => break,
            }
        }
    }
    controller.close().await
}
