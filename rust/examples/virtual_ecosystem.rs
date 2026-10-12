mod packages;
use command_stream::command_packages::{Marketplace, SearchOptions};
use command_stream::{commands::CommandContext, CommandEnvironment, CommandResult};

#[tokio::main]
async fn main() -> Result<(), String> {
    let mut environment = CommandEnvironment::new();
    packages::install_all(&mut environment)?;
    environment.create("ecosystem-welcome", |context| async move {
        CommandResult::success(format!("Welcome, {}!\n", context.args.join(" ")))
    })?;
    environment.inherit(
        "ecosystem-greet",
        "ecosystem-welcome",
        vec!["developer".into()],
    )?;
    environment.extend("ecosystem-greet", |context, next| {
        Box::pin(async move {
            let mut result = next(context).await;
            result.stdout = format!("[enhanced] {}", result.stdout).into();
            result
        })
    })?;
    print!(
        "{}",
        environment
            .run("ecosystem-greet", CommandContext::new(vec!["Alice".into()]))
            .await
            .stdout
    );
    environment.create("ecosystem-fruit", |_| async {
        CommandResult::success("apple\nbanana\n")
    })?;
    environment.compose("ecosystem-fruit-list", &["ecosystem-fruit", "upper"])?;
    print!(
        "{}",
        environment
            .run("ecosystem-fruit-list", CommandContext::new(vec![]))
            .await
            .stdout
    );
    let mut context = CommandContext::new(vec!["ENVIRONMENT".into()]);
    context.env = Some(packages::environment(&[("ENVIRONMENT", "development")]));
    print!("{}", environment.run("env-value", context).await.stdout);
    if std::env::args().any(|argument| argument == "--search") {
        for package in Marketplace::search("git", SearchOptions::default()).await? {
            println!("{}@{}", package.name, package.version);
        }
    }
    for package in packages::all() {
        environment.uninstall(&package.name);
    }
    println!("Demo complete");
    Ok(())
}
