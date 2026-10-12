mod packages;
use command_stream::commands::{CommandContext, StreamChunk};
use command_stream::{CommandEnvironment, CommandResult};

#[tokio::main]
async fn main() -> Result<(), String> {
    let mut environment = CommandEnvironment::new();
    packages::install_all(&mut environment)?;
    environment.create("ecosystem-validate-env", |context| async move {
        let value = context
            .env
            .as_ref()
            .and_then(|env| env.get("ENVIRONMENT"))
            .map(String::as_str)
            .unwrap_or("");
        if ["development", "staging", "production"].contains(&value) {
            CommandResult::success(format!("Validated {value}\n"))
        } else {
            CommandResult::error(format!("Invalid environment: {value}"))
        }
    })?;
    let validate = environment.get("ecosystem-validate-env").unwrap();
    environment.extend("deploy-plan", move |mut context, next| {
        let validate = validate.clone();
        Box::pin(async move {
            let value = context.args.first().map(String::as_str).unwrap_or("");
            let mut check = CommandContext::new(vec![]);
            check.env = Some(packages::environment(&[("ENVIRONMENT", value)]));
            let validation = validate(check).await;
            if validation.code != 0 {
                return validation;
            }
            let tx = context.output_tx.clone().unwrap();
            if tx
                .send(StreamChunk::Stdout(validation.stdout.to_string()))
                .await
                .is_err()
            {
                return CommandResult::error("Consumer closed");
            }
            // Streaming handlers and audit middleware share the bounded output channel.
            context.output_tx = Some(tx.clone());
            let result = next(context).await;
            if result.code == 0 {
                let _ = tx
                    .send(StreamChunk::Stdout(
                        "Audit: deployment plan prepared\n".into(),
                    ))
                    .await;
            }
            result
        })
    })?;
    environment.inherit(
        "ecosystem-production-plan",
        "deploy-plan",
        vec!["production".into()],
    )?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let mut context = CommandContext::new(vec!["release-1".into()]);
    context.output_tx = Some(tx);
    let task =
        tokio::spawn(async move { environment.run("ecosystem-production-plan", context).await });
    while let Some(chunk) = rx.recv().await {
        match chunk {
            StreamChunk::Stdout(value) => print!("{value}"),
            StreamChunk::Stderr(value) => eprint!("{value}"),
        }
    }
    let result = task.await.map_err(|error| error.to_string())?;
    if result.code != 0 {
        return Err(result.stderr.to_string());
    }
    println!("Demo complete");
    Ok(())
}
