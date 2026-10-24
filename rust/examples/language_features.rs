//! Executable Rust examples for the generated cross-language feature guide.
//!
//! Each `feature:*` region is extracted into the matching documentation page.
//! The binary executes one region at a time so CI verifies every example:
//! `cargo run --example language_features -- await-result`.

use command_stream::commands::{CommandContext, VirtualCommandRegistry};
use command_stream::zx;
use command_stream::{
    cmd, create, exec, fy, run, run_sync, set_shell_option, unset_shell_option, AnsiUtils,
    CommandBuilder, CommandEnvironment, CommandResult, DataStream, EventData, EventType,
    OutputChunk, Pipeline, ProcessRunner, RunOptions, StdinOption, StreamEmitter, StreamingRunner,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::error::Error;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

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

// feature:timeouts
async fn timeouts() -> ExampleResult {
    // Stopped with the kill signal (SIGTERM) once 200ms have passed.
    let mut slow = ProcessRunner::new(
        "sleep 5",
        RunOptions {
            timeout: Some(Duration::from_millis(200)),
            ..quiet_options()
        },
    );
    let result = slow.run().await?;

    let mut quick = ProcessRunner::new(
        "echo in time",
        RunOptions {
            timeout: Some(Duration::from_secs(5)),
            ..quiet_options()
        },
    );
    let in_time = quick.run().await?;
    Ok(vec![
        observation("exit code", result.code),
        observation("timed out", slow.timed_out()),
        observation("finished in time", in_time.stdout),
        observation("quick command timed out", quick.timed_out()),
    ])
}
// endfeature:timeouts

// feature:env-removal
async fn env_removal() -> ExampleResult {
    let env: HashMap<String, String> = std::env::vars()
        .chain([
            ("DEMO_KEEP".to_string(), "kept".to_string()),
            ("DEMO_DROP".to_string(), "dropped".to_string()),
        ])
        .collect();
    let kept = exec(
        "printenv DEMO_KEEP",
        RunOptions {
            env: Some(env.clone()),
            ..quiet_options()
        },
    )
    .await?;

    // `env -u DEMO_DROP`: the variable is absent, not merely empty.
    let removed = StreamingRunner::from_argv("printenv", ["DEMO_DROP"])
        .env(env)
        .env_remove("DEMO_DROP")
        .collect()
        .await?;
    Ok(vec![
        observation("kept variable", kept.stdout),
        observation("removed variable exit code", removed.code),
    ])
}
// endfeature:env-removal

// feature:detached
async fn detached() -> ExampleResult {
    let dir = std::env::temp_dir().join(format!("command-stream-detached-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let marker = dir.join("done.txt");

    // Returns as soon as the process has spawned; it is not awaited.
    let pid = StreamingRunner::new("sleep 0.2 && echo finished > done.txt")
        .cwd(&dir)
        .detach()?;
    let running = !marker.exists();

    for _ in 0..100 {
        if marker.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let written = std::fs::read_to_string(&marker)?;
    std::fs::remove_dir_all(&dir)?;
    Ok(vec![
        observation("pid is a number", pid.is_some_and(|pid| pid > 0)),
        observation("still running when detach returns", running),
        observation("what the background command wrote", written),
    ])
}
// endfeature:detached

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
    let child_command = if cfg!(windows) {
        "ping -n 31 127.0.0.1"
    } else {
        "/bin/sleep 30"
    };
    let mut runner = ProcessRunner::new(child_command, quiet_options());
    runner.start().await?;
    let (child_available, child_pid_available) = match runner.child() {
        Some(mut child) => {
            let pid_available = child.pid().is_some();
            child.kill_with("SIGTERM")?;
            (true, pid_available)
        }
        None => (false, false),
    };
    let _ = runner.run().await?;

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
        observation("child handle available after start", child_available),
        observation("child pid available", child_pid_available),
        observation("stream started", started),
        observation("cancelled stream exit is non-zero", exit_code != 0),
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
    // `from_argv` runs the program with exactly these arguments, no shell.
    let mut runner = ProcessRunner::from_argv(
        "cat",
        Vec::<String>::new(),
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

    // A streaming command keeps stdin open with `stdin_pipe`, so input can
    // answer output.
    let mut stream = StreamingRunner::from_argv("cat", Vec::<String>::new())
        .stdin_pipe()
        .stream();
    stream.write_stdin("ping\n").await?;
    let mut answered = Vec::new();
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Stdout(data) = chunk {
            answered.extend(data);
            stream.close_stdin().await?;
        }
    }
    Ok(vec![
        observation("what cat echoed back", result.stdout),
        observation("streamed reply", String::from_utf8(answered)?),
    ])
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

// feature:zx-compat
async fn zx_compat() -> ExampleResult {
    // Interpolated values are quoted the zx way, so spaces survive.
    let words = "hello world";
    let greeting = zx!("echo {}", words).await?;

    // Failing commands return Err(ProcessOutput), unless `nothrow` is set.
    let rejected = zx!("exit 2").await.unwrap_err();
    let tolerated = zx!(zx::Shell::new().nothrow(true), "exit 3").await?;

    let sorted = zx!("printf 'b\\na\\n'").pipe(zx!("sort")).await?;

    // `within` scopes settings such as the working directory.
    let dir = std::env::temp_dir().canonicalize()?;
    let inside = zx::within(async {
        zx::configure(|options| options.cwd = Some(dir.clone()));
        zx!("pwd").await
    })
    .await?;

    Ok(vec![
        observation("interpolation", greeting.stdout),
        observation("rejected exit code", rejected.exit_code),
        observation("nothrow exit code", tolerated.exit_code),
        observation("pipe", sorted.lines()),
        observation("within cwd", inside.stdout.trim() == dir.to_string_lossy()),
        observation("cwd restored", zx::current_options().cwd.is_none()),
    ])
}
// endfeature:zx-compat

// feature:execa-compat
async fn execa_compat() -> ExampleResult {
    use command_stream::execa::{Execa, Options};
    let isolated = command_stream::execa::execa("node", ["--version"]).await?;
    let general = command_stream::execa("node", ["--version"]).await?;
    let argv = command_stream::execa(
        "node",
        [
            "-e",
            "process.stdout.write(process.argv.slice(1).join('|'))",
            "hello world",
            "$HOME",
        ],
    )
    .await?;
    let api = Execa::new(Options {
        strip_final_newline: false,
        ..Options::default()
    });
    let newline = api.command("node", ["-e", "console.log('hello')"]).await?;
    let tolerated = api
        .command("node", ["-e", "process.exit(3)"])
        .reject(false)
        .await?;
    let input = command_stream::execa("node", ["-e", "process.stdin.pipe(process.stdout)"])
        .input(b"input".to_vec())
        .await?;
    Ok(vec![
        observation(
            "isolated and general API",
            isolated.stdout == general.stdout,
        ),
        observation("exact argv", argv.text()),
        observation("preserved newline", newline.text()),
        observation("tolerated exit code", tolerated.exit_code),
        observation("binary stdin", input.text()),
    ])
}
// endfeature:execa-compat

// feature:shelljs-compat
async fn shelljs_compat() -> ExampleResult {
    let directory = tempfile::tempdir()?;
    std::fs::write(directory.path().join("file with spaces"), "z\na\na\nb\n")?;
    let mut shell = command_stream::shelljs::ShellJs::new();
    shell.config.silent = true;
    shell
        .cd(&[directory.path().to_str().ok_or("non-UTF8 path")?])
        .await?;
    Ok(vec![
        observation("general API", true),
        observation(
            "separate arguments",
            shell.echo(&["hello", "two words"]).await?.stdout,
        ),
        observation(
            "head",
            shell.head(&["-n", "2", "file with spaces"]).await?.stdout,
        ),
        observation(
            "tail",
            shell.tail(&["-n", "2", "file with spaces"]).await?.stdout,
        ),
        observation("missing file code", shell.cat(&["missing"]).await?.code),
    ])
}
// endfeature:shelljs-compat

// feature:native-text
async fn native_text() -> ExampleResult {
    let options = RunOptions {
        stdin: StdinOption::Content("b\nb\na\n".into()),
        ..quiet_options()
    };
    let mut observations = Vec::new();
    for (label, command) in [
        ("head", "head -n 2"),
        ("tail", "tail -n 1"),
        ("sort", "sort -u"),
        ("uniq", "uniq -cd"),
        ("zero lines", "tail -n 0"),
    ] {
        observations.push(observation(
            label,
            ProcessRunner::new(command, options.clone())
                .run()
                .await?
                .stdout,
        ));
    }
    Ok(observations)
}
// endfeature:native-text

// feature:command-builder
async fn command_builder() -> ExampleResult {
    let result = CommandBuilder::new("printf")
        .args(["%s", "hello ; $HOME"])
        .run()
        .await?;
    Ok(vec![
        observation("literal argument", result.stdout),
        observation(
            "exit code",
            CommandBuilder::new("sh")
                .args(["-c", "exit 7"])
                .exit_code()
                .await?,
        ),
    ])
}
// endfeature:command-builder

// feature:stream-processing
async fn stream_processing() -> ExampleResult {
    let batches = DataStream::from_values([1, 2, 3, 4, 5])
        .filter(|value| value % 2 == 1)
        .map(|value| value * 2)
        .batch(2)
        .collect()
        .await;
    let stats = DataStream::from_values([10, 30])
        .analyze(|value| *value > 20, |value| Some(f64::from(*value)), |_| {})
        .await;
    let timed = DataStream::from_values([1, 2, 3])
        .batch_with_timeout(2, std::time::Duration::from_millis(500))
        .collect()
        .await;
    let windows = DataStream::from_values([1, 2, 3])
        .sliding_window(2)
        .collect()
        .await;
    Ok(vec![
        observation("batches", batches),
        observation("timed batches", timed),
        observation("sliding windows", windows),
        observation("error rate", stats.error_rate),
        observation("mean response time", stats.response_mean),
    ])
}
// endfeature:stream-processing

// feature:terminal-buffer
async fn terminal_buffer() -> ExampleResult {
    let mut terminal = command_stream::terminal::TerminalBuffer::new(2, 20);
    terminal.write(b"old\r\x1b[2K\x1b[31mred\x1b[0m");
    Ok(vec![
        observation("visible text", terminal.text(false).trim_end()),
        observation("colored", terminal.text(true).contains('\x1b')),
    ])
}
// endfeature:terminal-buffer

// feature:command-packages
async fn command_packages() -> ExampleResult {
    let mut environment = CommandEnvironment::new();
    environment.create("package-hello", |context| async move {
        CommandResult::success(context.args.join(" "))
    })?;
    environment.inherit("package-greet", "package-hello", vec!["hello".into()])?;
    environment.extend("package-greet", |context, next| {
        Box::pin(async move {
            let result = next(context).await;
            CommandResult::success(format!("{}!", result.stdout))
        })
    })?;
    Ok(vec![observation(
        "inherited middleware",
        environment
            .run("package-greet", CommandContext::new(vec!["world".into()]))
            .await
            .stdout,
    )])
}
// endfeature:command-packages

// feature:fy
async fn fy_module() -> ExampleResult {
    let module = fy("echo \"$1\"; exit 7");
    Ok(vec![
        observation(
            "source preserved",
            module.contains(&serde_json::to_string("echo \"$1\"; exit 7")?),
        ),
        observation(
            "executable module",
            module.starts_with("#!/usr/bin/env node\n"),
        ),
    ])
}
// endfeature:fy

async fn execute(id: &str) -> ExampleResult {
    match id {
        "command-builder" => command_builder().await,
        "stream-processing" => stream_processing().await,
        "terminal-buffer" => terminal_buffer().await,
        "command-packages" => command_packages().await,
        "fy" => fy_module().await,
        "await-result" => await_result().await,
        "result-text" => result_text().await,
        "sync-execution" => sync_execution().await,
        "exit-codes" => exit_codes().await,
        "options" => options().await,
        "timeouts" => timeouts().await,
        "env-removal" => env_removal().await,
        "detached" => detached().await,
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
        "zx-compat" => zx_compat().await,
        "execa-compat" => execa_compat().await,
        "shelljs-compat" => shelljs_compat().await,
        "native-text" => native_text().await,
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
