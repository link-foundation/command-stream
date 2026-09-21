//! Executable Rust examples for the generated cross-language feature guide.
//!
//! Each `feature:*` region is extracted into the matching documentation page.
//! The binary executes one region at a time so CI verifies every example:
//! `cargo run --example language_features -- await-result`.

use command_stream::commands::{CommandContext, VirtualCommandRegistry};
use command_stream::{
    cmd, create, exec, run, run_sync, set_shell_option, unset_shell_option, AnsiUtils,
    CommandResult, EventData, EventType, OutputChunk, Pipeline, ProcessRunner, RunOptions,
    StdinOption, StreamEmitter, StreamingRunner,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::error::Error;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const PARITY_START: &str = "<<<PARITY_JSON";
const PARITY_END: &str = "PARITY_JSON>>>";

#[derive(Serialize)]
struct Observation {
    label: &'static str,
    value: Value,
}

type ExampleResult = Result<Vec<Observation>, Box<dyn Error>>;

fn observation(label: &'static str, value: impl Serialize) -> Observation {
    Observation {
        label,
        value: serde_json::to_value(value).expect("example observations are serializable"),
    }
}

fn quiet_options() -> RunOptions {
    RunOptions {
        mirror: false,
        ..RunOptions::default()
    }
}

async fn quiet(command: &str) -> command_stream::Result<CommandResult> {
    exec(command, quiet_options()).await
}

// feature:await-result
async fn await_result() -> ExampleResult {
    let result = quiet("echo hello").await?;
    Ok(vec![
        observation("stdout", result.stdout),
        observation("stderr", result.stderr),
        observation("exit code", result.code),
    ])
}
// endfeature:await-result

// feature:result-text
async fn result_text() -> ExampleResult {
    let result = quiet("echo hello").await?;
    Ok(vec![observation("text output", result.stdout)])
}
// endfeature:result-text

// feature:sync-execution
async fn sync_execution() -> ExampleResult {
    let result = tokio::task::spawn_blocking(|| run_sync("echo synchronous")).await??;
    Ok(vec![observation("stdout", result.stdout)])
}
// endfeature:sync-execution

// feature:exit-codes
async fn exit_codes() -> ExampleResult {
    let result = quiet("false").await?;
    let checked = result.clone().error_for_status().unwrap_err();
    Ok(vec![
        observation("result code", result.code),
        observation("checked error code", checked.code()),
    ])
}
// endfeature:exit-codes

// feature:options
async fn options() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let mut env = HashMap::new();
    env.insert(
        "COMMAND_STREAM_DEMO".to_string(),
        "from-options".to_string(),
    );
    let result = exec(
        "cat",
        RunOptions {
            mirror: false,
            cwd: Some(directory.path().to_path_buf()),
            env: Some(env),
            stdin: StdinOption::Content("from-stdin\n".to_string()),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![observation("stdin and cwd options", result.stdout)])
}
// endfeature:options

// feature:function-api
async fn function_api() -> ExampleResult {
    let simple = run("echo run").await?;
    let configured = exec("echo exec", quiet_options()).await?;
    let mut runner = create("echo create", quiet_options());
    let created = runner.run().await?;
    Ok(vec![observation(
        "run, exec and create",
        [
            simple.stdout.trim(),
            configured.stdout.trim(),
            created.stdout.trim(),
        ],
    )])
}
// endfeature:function-api

// feature:cancellation
async fn cancellation() -> ExampleResult {
    let mut stream = StreamingRunner::new("sleep 30").stream();
    let started = stream.wait_for_pid().await.is_some();
    stream.kill();
    let mut exit_code = 0;
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            exit_code = code;
        }
    }
    Ok(vec![
        observation("process started", started),
        observation("cancelled exit is non-zero", exit_code != 0),
    ])
}
// endfeature:cancellation

// feature:async-iteration
async fn async_iteration() -> ExampleResult {
    let mut stream = StreamingRunner::new("printf 'one\\ntwo\\n'").stream();
    let mut stdout = Vec::new();
    let mut exit_code = None;
    while let Some(chunk) = stream.next().await {
        match chunk {
            OutputChunk::Stdout(data) => stdout.extend(data),
            OutputChunk::Stderr(_) => {}
            OutputChunk::Exit(code) => exit_code = Some(code),
        }
    }
    Ok(vec![
        observation("collected chunks", String::from_utf8(stdout)?),
        observation("exit code", exit_code),
    ])
}
// endfeature:async-iteration

// feature:events
async fn events() -> ExampleResult {
    let emitter = StreamEmitter::new();
    let count = Arc::new(AtomicUsize::new(0));
    let listener_count = Arc::clone(&count);
    emitter
        .on(EventType::Stdout, move |_| {
            listener_count.fetch_add(1, Ordering::SeqCst);
        })
        .await;
    emitter
        .emit(EventType::Stdout, EventData::String("hello".to_string()))
        .await;
    Ok(vec![observation(
        "stdout events",
        count.load(Ordering::SeqCst),
    )])
}
// endfeature:events

// feature:stdin-streaming
async fn stdin_streaming() -> ExampleResult {
    let mut runner = ProcessRunner::new(
        "cat",
        RunOptions {
            mirror: false,
            stdin: StdinOption::Pipe,
            ..RunOptions::default()
        },
    );
    runner.start().await?;
    runner.write_stdin("first line\n").await?;
    runner.write_stdin("second line\n").await?;
    runner.close_stdin().await?;
    let result = runner.run().await?;
    Ok(vec![observation("what cat echoed back", result.stdout)])
}
// endfeature:stdin-streaming

// feature:buffers-strings
async fn buffers_strings() -> ExampleResult {
    let result = quiet("printf bytes").await?;
    Ok(vec![
        observation("string", &result.stdout),
        observation("bytes", result.stdout.as_bytes()),
    ])
}
// endfeature:buffers-strings

// feature:mirror-capture
async fn mirror_capture() -> ExampleResult {
    let captured = quiet("echo captured").await?;
    let uncaptured = exec(
        "true",
        RunOptions {
            mirror: false,
            capture: false,
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![
        observation("captured output", captured.stdout),
        observation("capture can be disabled", uncaptured.stdout.is_empty()),
    ])
}
// endfeature:mirror-capture

// feature:builtin-catalog
async fn builtin_catalog() -> ExampleResult {
    let registry = VirtualCommandRegistry::with_builtins();
    let mut commands = registry.list();
    commands.sort_unstable();
    Ok(vec![
        observation("available built-ins", &commands),
        observation("number of built-ins", commands.len()),
    ])
}
// endfeature:builtin-catalog

// feature:builtin-filesystem
async fn builtin_filesystem() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let options = RunOptions {
        mirror: false,
        cwd: Some(directory.path().to_path_buf()),
        ..RunOptions::default()
    };
    exec("mkdir demo", options.clone()).await?;
    exec("touch demo/file.txt", options.clone()).await?;
    let listed = exec("ls demo", options.clone()).await?;
    exec("rm -r demo", options).await?;
    Ok(vec![observation("created and listed", listed.stdout)])
}
// endfeature:builtin-filesystem

// feature:builtin-text
async fn builtin_text() -> ExampleResult {
    let sequence = quiet("seq 1 3").await?;
    let basename = quiet("basename /tmp/example.txt").await?;
    Ok(vec![
        observation("sequence", sequence.stdout),
        observation("basename", basename.stdout),
    ])
}
// endfeature:builtin-text

// feature:builtin-environment
async fn builtin_environment() -> ExampleResult {
    let mut env = HashMap::new();
    env.insert("COMMAND_STREAM_DEMO".to_string(), "visible".to_string());
    let result = exec(
        "env",
        RunOptions {
            mirror: false,
            env: Some(env),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![observation(
        "configured environment visible",
        result.stdout.contains("COMMAND_STREAM_DEMO=visible"),
    )])
}
// endfeature:builtin-environment

fn greet_handler(
    context: CommandContext,
) -> Pin<Box<dyn std::future::Future<Output = CommandResult> + Send>> {
    Box::pin(async move { CommandResult::success(format!("Hello, {}!\n", context.args.join(" "))) })
}

// feature:virtual-commands
async fn virtual_commands() -> ExampleResult {
    let mut registry = VirtualCommandRegistry::new();
    registry.register("greet", greet_handler);
    let handler = registry.get("greet").expect("registered handler");
    let result = handler(CommandContext::new(vec!["Rust".to_string()])).await;
    let removed = registry.unregister("greet");
    Ok(vec![
        observation("custom command output", result.stdout),
        observation("unregistered again", removed),
    ])
}
// endfeature:virtual-commands

// feature:virtual-context
async fn virtual_context() -> ExampleResult {
    let mut context = CommandContext::new(vec!["one".to_string(), "two".to_string()]);
    context.stdin = Some("piped\n".to_string());
    context.cwd = Some(std::env::temp_dir());
    context.env = Some(HashMap::from([("DEMO".to_string(), "value".to_string())]));
    Ok(vec![observation(
        "handler context",
        json!({
            "args": context.args,
            "stdin": context.stdin,
            "has_cwd": context.cwd.is_some(),
            "env_value": context.env.and_then(|env| env.get("DEMO").cloned()),
        }),
    )])
}
// endfeature:virtual-context

fn streaming_handler(
    context: CommandContext,
) -> Pin<Box<dyn std::future::Future<Output = CommandResult> + Send>> {
    Box::pin(async move {
        if let Some(output) = context.output_tx {
            let _ = output
                .send(command_stream::StreamChunk::Stdout("one\n".to_string()))
                .await;
            let _ = output
                .send(command_stream::StreamChunk::Stdout("two\n".to_string()))
                .await;
        }
        CommandResult::success("one\ntwo\n")
    })
}

// feature:virtual-streaming
async fn virtual_streaming() -> ExampleResult {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
    let mut context = CommandContext::new(Vec::new());
    context.output_tx = Some(sender);
    let result = streaming_handler(context).await;
    let mut chunks = Vec::new();
    while let Ok(chunk) = receiver.try_recv() {
        if let command_stream::StreamChunk::Stdout(text) = chunk {
            chunks.push(text);
        }
    }
    Ok(vec![
        observation("chunks", chunks),
        observation("collected output", result.stdout),
    ])
}
// endfeature:virtual-streaming

// feature:pipelines
async fn pipelines() -> ExampleResult {
    let result = Pipeline::new()
        .add("printf 'hello\\nworld\\n'")
        .add("grep world")
        .mirror_output(false)
        .run()
        .await?;
    Ok(vec![observation("pipeline output", result.stdout)])
}
// endfeature:pipelines

// feature:redirection
async fn redirection() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    let file = directory.path().join("output.txt");
    let result = exec(
        "echo redirected > output.txt",
        RunOptions {
            mirror: false,
            cwd: Some(directory.path().to_path_buf()),
            ..RunOptions::default()
        },
    )
    .await?;
    Ok(vec![
        observation("exit code", result.code),
        observation("file contents", std::fs::read_to_string(file)?),
    ])
}
// endfeature:redirection

// feature:sequences
async fn sequences() -> ExampleResult {
    let result = quiet("false || echo fallback; echo next").await?;
    Ok(vec![observation("sequence output", result.stdout)])
}
// endfeature:sequences

// feature:interpolation
async fn interpolation() -> ExampleResult {
    let value = "hello from Rust";
    let result = cmd!("echo {}", value).await?;
    Ok(vec![observation("macro interpolation", result.stdout)])
}
// endfeature:interpolation

// feature:shell-settings
async fn shell_settings() -> ExampleResult {
    set_shell_option("pipefail").await;
    let with_pipefail = Pipeline::new().add("false").add("true").run().await?;
    unset_shell_option("pipefail").await;
    let without_pipefail = Pipeline::new().add("false").add("true").run().await?;
    Ok(vec![
        observation("with pipefail", with_pipefail.code),
        observation("without pipefail", without_pipefail.code),
    ])
}
// endfeature:shell-settings

// feature:ansi-utils
async fn ansi_utils() -> ExampleResult {
    Ok(vec![observation(
        "stripped output",
        AnsiUtils::strip_all("\u{1b}[31mred\u{1b}[0m"),
    )])
}
// endfeature:ansi-utils

async fn execute(id: &str) -> ExampleResult {
    match id {
        "await-result" => await_result().await,
        "result-text" => result_text().await,
        "sync-execution" => sync_execution().await,
        "exit-codes" => exit_codes().await,
        "options" => options().await,
        "function-api" => function_api().await,
        "cancellation" => cancellation().await,
        "async-iteration" => async_iteration().await,
        "events" => events().await,
        "stdin-streaming" => stdin_streaming().await,
        "buffers-strings" => buffers_strings().await,
        "mirror-capture" => mirror_capture().await,
        "builtin-catalog" => builtin_catalog().await,
        "builtin-filesystem" => builtin_filesystem().await,
        "builtin-text" => builtin_text().await,
        "builtin-environment" => builtin_environment().await,
        "virtual-commands" => virtual_commands().await,
        "virtual-context" => virtual_context().await,
        "virtual-streaming" => virtual_streaming().await,
        "pipelines" => pipelines().await,
        "redirection" => redirection().await,
        "sequences" => sequences().await,
        "interpolation" => interpolation().await,
        "shell-settings" => shell_settings().await,
        "ansi-utils" => ansi_utils().await,
        _ => Err(format!("unknown feature: {id}").into()),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let id = std::env::args().nth(1).ok_or("pass a feature id")?;
    let observations = execute(&id).await?;

    println!("# {id} — Rust");
    for item in &observations {
        println!("{}: {}", item.label, item.value);
    }
    println!("{PARITY_START}");
    println!(
        "{}",
        serde_json::to_string(&json!({
            "id": id,
            "language": "rust",
            "observations": observations,
            "failure": Value::Null,
        }))?
    );
    println!("{PARITY_END}");
    Ok(())
}
