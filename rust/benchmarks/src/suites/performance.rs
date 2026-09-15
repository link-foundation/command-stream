use crate::adapters::{benchmark_executable, fixture_arguments, Adapter, Execution};
use crate::model::TimedSuite;
use crate::runner::{BenchmarkCase, BenchmarkRunner};
use crate::BenchmarkResult;
use futures::future::join_all;
use std::path::Path;

fn adapter_cases<F>(
    adapters: &[Adapter],
    executable: &Path,
    arguments: &[String],
    validate: F,
) -> Vec<BenchmarkCase>
where
    F: Fn(&Execution) -> bool + Clone + 'static,
{
    adapters
        .iter()
        .map(|adapter| {
            let adapter = *adapter;
            let executable = executable.to_path_buf();
            let arguments = arguments.to_vec();
            let validate = validate.clone();
            BenchmarkCase::new(adapter.name(), move || {
                let executable = executable.clone();
                let arguments = arguments.clone();
                let validate = validate.clone();
                async move {
                    let result = adapter
                        .run(executable, &arguments)
                        .await
                        .map_err(|error| error.to_string())?;
                    validate(&result)
                        .then_some(())
                        .ok_or_else(|| format!("unexpected process result: {result:?}"))
                }
            })
        })
        .collect()
}

fn concurrent_cases(adapters: &[Adapter], executable: &Path, jobs: usize) -> Vec<BenchmarkCase> {
    adapters
        .iter()
        .map(|adapter| {
            let adapter = *adapter;
            let executable = executable.to_path_buf();
            BenchmarkCase::new(adapter.name(), move || {
                let executable = executable.clone();
                async move {
                    let operations = (0..jobs).map(|index| {
                        let arguments = fixture_arguments("echo", &[index.to_string()]);
                        let executable = executable.clone();
                        async move { adapter.run(executable, &arguments).await }
                    });
                    let results = join_all(operations).await;
                    for (index, result) in results.into_iter().enumerate() {
                        let result = result.map_err(|error| error.to_string())?;
                        let expected = serde_json::to_vec(&vec![index.to_string()])
                            .map_err(|error| error.to_string())?;
                        if result.exit_code != 0 || result.stdout != expected {
                            return Err(format!("unexpected concurrent result: {result:?}"));
                        }
                    }
                    Ok(())
                }
            })
        })
        .collect()
}

pub async fn run(
    runner: &BenchmarkRunner,
    adapters: &[Adapter],
    smoke: bool,
) -> BenchmarkResult<TimedSuite> {
    let executable = benchmark_executable()?;
    let output_bytes = if smoke { 64 * 1_024 } else { 1_024 * 1_024 };
    let jobs = if smoke { 2 } else { 8 };
    let overrides = smoke.then_some((2, 1));
    let mut scenarios = Vec::new();

    scenarios.push(
        runner
            .compare(
                "Process spawn latency",
                adapter_cases(
                    adapters,
                    &executable,
                    &fixture_arguments("echo", &["benchmark".to_string()]),
                    |result| result.exit_code == 0 && result.stdout == br#"["benchmark"]"#,
                ),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                format!("Buffered stdout throughput ({output_bytes} bytes)"),
                adapter_cases(
                    adapters,
                    &executable,
                    &fixture_arguments("emit", &[output_bytes.to_string()]),
                    move |result| result.exit_code == 0 && result.stdout.len() == output_bytes,
                ),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                format!("Concurrent execution ({jobs} processes)"),
                concurrent_cases(adapters, &executable, jobs),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                "Non-zero exit handling",
                adapter_cases(
                    adapters,
                    &executable,
                    &fixture_arguments("fail", &["17".to_string()]),
                    |result| {
                        result.exit_code == 17 && result.stderr == b"intentional benchmark failure"
                    },
                ),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                format!("command-stream output modes ({output_bytes} bytes)"),
                output_mode_cases(&executable, output_bytes),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                format!("command-stream pipeline throughput ({output_bytes} bytes)"),
                pipeline_cases(&executable, output_bytes),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                "command-stream built-in vs system process",
                built_in_cases(&executable),
                overrides,
            )
            .await?,
    );

    Ok(TimedSuite {
        kind: "performance".to_string(),
        name: "Performance".to_string(),
        scenarios,
    })
}

fn output_mode_cases(executable: &Path, bytes: usize) -> Vec<BenchmarkCase> {
    let buffered_executable = executable.to_path_buf();
    let streamed_executable = executable.to_path_buf();
    vec![
        BenchmarkCase::new("buffered", move || {
            let executable = buffered_executable.clone();
            async move {
                let arguments = fixture_arguments("emit", &[bytes.to_string()]);
                let result = command_stream::StreamingRunner::from_argv(executable, arguments)
                    .collect()
                    .await
                    .map_err(|error| error.to_string())?;
                (result.code == 0 && result.stdout.len() == bytes)
                    .then_some(())
                    .ok_or_else(|| "buffered output was incomplete".to_string())
            }
        }),
        BenchmarkCase::new("streaming", move || {
            let executable = streamed_executable.clone();
            async move {
                let arguments = fixture_arguments("emit", &[bytes.to_string()]);
                let mut stream =
                    command_stream::StreamingRunner::from_argv(executable, arguments).stream();
                let mut received = 0;
                let mut exit_code = None;
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        command_stream::OutputChunk::Stdout(value) => received += value.len(),
                        command_stream::OutputChunk::Exit(value) => exit_code = Some(value),
                        command_stream::OutputChunk::Stderr(_) => {}
                    }
                }
                (received == bytes && exit_code == Some(0))
                    .then_some(())
                    .ok_or_else(|| "streamed output was incomplete".to_string())
            }
        }),
    ]
}

fn pipeline_cases(executable: &Path, bytes: usize) -> Vec<BenchmarkCase> {
    let pipeline_executable = executable.to_path_buf();
    let manual_executable = executable.to_path_buf();
    vec![
        BenchmarkCase::new("Pipeline API", move || {
            let executable = pipeline_executable.clone();
            async move {
                let source = command_line(
                    &executable,
                    &fixture_arguments("emit", &[bytes.to_string()]),
                );
                let destination = command_line(&executable, &fixture_arguments("stdin-count", &[]));
                let result = command_stream::Pipeline::new()
                    .add(source)
                    .add(destination)
                    .mirror_output(false)
                    .run()
                    .await
                    .map_err(|error| error.to_string())?;
                (result.code == 0 && result.stdout == bytes.to_string())
                    .then_some(())
                    .ok_or_else(|| format!("unexpected pipeline result: {result:?}"))
            }
        }),
        BenchmarkCase::new("manual two-step", move || {
            let executable = manual_executable.clone();
            async move {
                let source = command_stream::StreamingRunner::from_argv(
                    executable.clone(),
                    fixture_arguments("emit", &[bytes.to_string()]),
                )
                .collect()
                .await
                .map_err(|error| error.to_string())?;
                let destination = command_stream::StreamingRunner::from_argv(
                    executable,
                    fixture_arguments("stdin-count", &[]),
                )
                .stdin(source.stdout)
                .collect()
                .await
                .map_err(|error| error.to_string())?;
                (destination.code == 0 && destination.stdout == bytes.to_string())
                    .then_some(())
                    .ok_or_else(|| format!("unexpected manual result: {destination:?}"))
            }
        }),
    ]
}

fn built_in_cases(executable: &Path) -> Vec<BenchmarkCase> {
    let executable = executable.to_path_buf();
    vec![
        BenchmarkCase::new("built-in echo", || async {
            let result = command_stream::commands::echo(command_stream::CommandContext::new(vec![
                "benchmark".to_string(),
            ]))
            .await;
            (result.code == 0 && result.stdout == "benchmark\n")
                .then_some(())
                .ok_or_else(|| "unexpected built-in echo output".to_string())
        }),
        BenchmarkCase::new("spawned workload", move || {
            let executable = executable.clone();
            async move {
                let result = command_stream::StreamingRunner::from_argv(
                    executable,
                    fixture_arguments("echo", &["benchmark".to_string()]),
                )
                .collect()
                .await
                .map_err(|error| error.to_string())?;
                (result.code == 0 && result.stdout == r#"["benchmark"]"#)
                    .then_some(())
                    .ok_or_else(|| "unexpected spawned echo output".to_string())
            }
        }),
    ]
}

fn command_line(executable: &Path, arguments: &[String]) -> String {
    std::iter::once(shell_quote(&executable.to_string_lossy()))
        .chain(arguments.iter().map(|argument| shell_quote(argument)))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    command_stream::quote(value)
}

#[cfg(windows)]
fn shell_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}
