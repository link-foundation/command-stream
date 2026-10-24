//! Regression tests for issue #230: an exact-argv streaming command can be
//! written to while it runs, in reaction to its own output.
#![cfg(unix)]

use command_stream::{OutputChunk, StreamingRunner};
use std::time::Duration;

#[tokio::test]
async fn write_stdin_answers_output_while_streaming() {
    // Prints a prompt, waits for one answer per line and echoes it back.
    let script = "for n in 1 2 3; do echo \"ask $n\"; read answer; echo \"got $answer\"; done";
    let mut stream = StreamingRunner::from_argv("/bin/sh", ["-c", script])
        .stdin_pipe()
        .stream();
    let mut stdout = String::new();
    let mut exit = None;
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(10), stream.next())
        .await
        .expect("the child waits for input that was never sent")
    {
        match chunk {
            OutputChunk::Stdout(data) => {
                let text = String::from_utf8(data).unwrap();
                for line in text.lines() {
                    if let Some(n) = line.strip_prefix("ask ") {
                        stream.write_stdin(format!("answer-{n}\n")).await.unwrap();
                    }
                }
                stdout.push_str(&text);
            }
            OutputChunk::Stderr(_) => {}
            OutputChunk::Exit(code) => exit = Some(code),
        }
    }

    assert_eq!(exit, Some(0));
    assert_eq!(
        stdout,
        "ask 1\ngot answer-1\nask 2\ngot answer-2\nask 3\ngot answer-3\n"
    );
}

#[tokio::test]
async fn close_stdin_delivers_end_of_file() {
    let mut stream = StreamingRunner::from_argv("cat", Vec::<String>::new())
        .stdin("first ")
        .stdin_pipe()
        .stream();
    stream.write_stdin(b"second").await.unwrap();
    stream.close_stdin().await.unwrap();
    assert!(stream.write_stdin(b"late").await.is_err());
    // Closing again is a no-op.
    stream.close_stdin().await.unwrap();

    let (stdout, _, code) = tokio::time::timeout(Duration::from_secs(10), stream.collect())
        .await
        .expect("cat never saw end-of-file");
    assert_eq!(code, 0);
    assert_eq!(stdout, b"first second");
}

#[tokio::test]
async fn write_stdin_without_stdin_pipe_is_an_error() {
    let stream = StreamingRunner::from_argv("cat", Vec::<String>::new()).stream();
    let error = stream.write_stdin(b"ignored").await.unwrap_err();
    assert!(error.to_string().contains("stdin_pipe"), "{error}");
    let (_, _, code) = stream.collect().await;
    assert_eq!(code, 0, "cat reads the null device and exits");
}

#[tokio::test]
async fn write_stdin_after_exit_is_an_error() {
    let mut stream = StreamingRunner::from_argv("true", Vec::<String>::new())
        .stdin_pipe()
        .stream();
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            assert_eq!(code, 0);
        }
    }
    assert!(stream.write_stdin(b"late").await.is_err());
    stream.close_stdin().await.unwrap();
}

#[tokio::test]
async fn dropping_the_stream_with_an_open_stdin_stops_the_child() {
    let mut stream = StreamingRunner::from_argv("cat", Vec::<String>::new())
        .stdin_pipe()
        .stream();
    let pid = stream.wait_for_pid().await.unwrap();
    drop(stream);

    let gone = async {
        while nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), None).is_ok() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(5), gone)
        .await
        .expect("the child outlived its dropped stream");
}
