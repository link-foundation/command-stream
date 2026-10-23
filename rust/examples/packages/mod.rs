//! Ten installable typed packages matching the JavaScript example catalog.
use command_stream::command_packages::{argv_handler, HandlerFuture};
use command_stream::commands::{CommandContext, StreamChunk};
use command_stream::{CommandPackage, CommandResult, PackageHandler};
use std::collections::HashMap;
use std::sync::Arc;

fn handler<F, Fut>(function: F) -> PackageHandler
where
    F: Fn(CommandContext) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = CommandResult> + Send + 'static,
{
    Arc::new(move |context| Box::pin(function(context)) as HandlerFuture)
}

fn package(name: &str, commands: Vec<(&str, PackageHandler)>) -> CommandPackage {
    CommandPackage {
        name: format!("command-stream-example/{name}"),
        version: "1.0.0".into(),
        commands: commands
            .into_iter()
            .map(|(name, handler)| (name.into(), handler))
            .collect(),
    }
}

async fn emit(context: CommandContext, chunks: Vec<String>) -> CommandResult {
    let mut captured = String::new();
    for chunk in chunks {
        if context.is_cancelled() {
            return CommandResult::error_with_code("Command cancelled", 130);
        }
        if let Some(tx) = &context.output_tx {
            if tx.send(StreamChunk::Stdout(chunk)).await.is_err() {
                return CommandResult::error_with_code("Output consumer closed", 130);
            }
        } else {
            captured.push_str(&chunk);
        }
    }
    CommandResult::success(captured)
}

pub fn all() -> Vec<CommandPackage> {
    vec![
        package(
            "git-tools",
            vec![
                (
                    "git-summary",
                    argv_handler("git", vec!["status".into(), "--short".into()]),
                ),
                (
                    "git-recent",
                    argv_handler("git", vec!["log".into(), "-5".into(), "--oneline".into()]),
                ),
            ],
        ),
        package(
            "deploy",
            vec![(
                "deploy-plan",
                handler(|context| async move {
                    let environment = context
                        .args
                        .first()
                        .map(String::as_str)
                        .unwrap_or("staging");
                    let revision = context.args.get(1).map(String::as_str).unwrap_or("HEAD");
                    let chunks = vec![
                        format!("Validate {revision}\n"),
                        format!("Build artifact for {environment}\n"),
                        "Deploy after approval\n".into(),
                    ];
                    emit(context, chunks).await
                }),
            )],
        ),
        package(
            "files",
            vec![(
                "file-count",
                handler(|context| async move {
                    let path = context
                        .get_cwd()
                        .join(context.args.first().map(String::as_str).unwrap_or("."));
                    let result = async {
                        let mut directory = tokio::fs::read_dir(path).await?;
                        let mut count = 0;
                        while directory.next_entry().await?.is_some() {
                            count += 1;
                        }
                        Ok::<_, std::io::Error>(count)
                    }
                    .await;
                    match result {
                        Ok(count) => CommandResult::success(format!("{count}\n")),
                        Err(error) => CommandResult::error(error.to_string()),
                    }
                }),
            )],
        ),
        package(
            "json",
            vec![(
                "json-pretty",
                handler(|context| async move {
                    let input = context
                        .stdin
                        .as_deref()
                        .filter(|value| !value.is_empty())
                        .or_else(|| context.args.first().map(String::as_str))
                        .unwrap_or("{}");
                    match serde_json::from_str::<serde_json::Value>(input) {
                        Ok(value) => CommandResult::success(format!(
                            "{}\n",
                            serde_json::to_string_pretty(&value).unwrap()
                        )),
                        Err(error) => CommandResult::error(error.to_string()),
                    }
                }),
            )],
        ),
        package(
            "text",
            vec![(
                "upper",
                handler(|context| async move {
                    CommandResult::success(
                        context
                            .stdin
                            .unwrap_or_else(|| context.args.join(" "))
                            .to_uppercase(),
                    )
                }),
            )],
        ),
        package(
            "http",
            vec![(
                "http-get",
                argv_handler(
                    "curl",
                    vec![
                        "--fail-with-body".into(),
                        "--silent".into(),
                        "--show-error".into(),
                        "--url".into(),
                    ],
                ),
            )],
        ),
        package(
            "logs",
            vec![(
                "log-records",
                handler(|context| async move {
                    let chunks = context.args.iter().map(|message| format!("{}\n", serde_json::json!({"level":if message.contains("ERROR") {"error"} else {"info"},"message":message}))).collect();
                    emit(context, chunks).await
                }),
            )],
        ),
        package(
            "time",
            vec![(
                "timestamp",
                handler(|_| async {
                    CommandResult::success(format!(
                        "{}\n",
                        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                    ))
                }),
            )],
        ),
        package(
            "env",
            vec![(
                "env-value",
                handler(|context| async move {
                    let name = context.args.first().map(String::as_str).unwrap_or("");
                    let value = match context.env {
                        Some(env) => env.get(name).cloned(),
                        None => std::env::var(name).ok(),
                    };
                    CommandResult::new(
                        format!("{}\n", value.as_deref().unwrap_or("")),
                        "",
                        if value.is_some() { 0 } else { 1 },
                    )
                }),
            )],
        ),
        package(
            "math",
            vec![(
                "add",
                handler(|context| async move {
                    let values = context
                        .args
                        .iter()
                        .map(|value| {
                            if value.trim().is_empty() {
                                Ok(0.0)
                            } else {
                                value.parse::<f64>()
                            }
                        })
                        .collect::<Result<Vec<_>, _>>();
                    match values {
                        Ok(values) if values.iter().all(|value| value.is_finite()) => {
                            CommandResult::success(format!("{}\n", values.iter().sum::<f64>()))
                        }
                        _ => CommandResult::error("Expected finite numbers"),
                    }
                }),
            )],
        ),
    ]
}

pub fn install_all(environment: &mut command_stream::CommandEnvironment) -> Result<(), String> {
    for package in all() {
        environment.install(package)?;
    }
    Ok(())
}

pub fn environment(values: &[(&str, &str)]) -> HashMap<String, String> {
    values
        .iter()
        .map(|(key, value)| ((*key).into(), (*value).into()))
        .collect()
}
