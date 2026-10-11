//! Typed command packages, middleware and reloadable exact-argv manifests.
use crate::commands::{CommandContext, VirtualCommandRegistry};
use crate::{CommandBuilder, CommandResult, StdinOption};
use serde::Deserialize;
use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

pub type HandlerFuture = Pin<Box<dyn Future<Output = CommandResult> + Send>>;
pub type PackageHandler = Arc<dyn Fn(CommandContext) -> HandlerFuture + Send + Sync>;

#[derive(Clone)]
pub struct CommandPackage {
    pub name: String,
    pub version: String,
    pub commands: HashMap<String, PackageHandler>,
}

#[derive(Deserialize)]
struct Manifest {
    name: String,
    version: String,
    commands: HashMap<String, Specification>,
}
#[derive(Deserialize)]
struct Specification {
    file: String,
    #[serde(default)]
    args: Vec<String>,
}

impl CommandPackage {
    /// Loading a JSON manifest can be repeated after a file edit, without unsafe dynamic linking.
    pub async fn load(path: impl AsRef<Path>) -> std::io::Result<Self> {
        let manifest: Manifest = serde_json::from_str(&tokio::fs::read_to_string(path).await?)?;
        let commands = manifest
            .commands
            .into_iter()
            .map(|(name, specification)| {
                let command = CommandBuilder::new(specification.file).args(specification.args);
                let handler: PackageHandler = Arc::new(move |context| {
                    let mut command = command
                        .clone()
                        .args(context.args)
                        .stdin(StdinOption::Content(context.stdin.unwrap_or_default()));
                    if let Some(cwd) = context.cwd {
                        command = command.cwd(cwd);
                    }
                    if let Some(env) = context.env {
                        for (key, value) in env {
                            command = command.env(key, value);
                        }
                    }
                    Box::pin(async move {
                        command.run().await.unwrap_or_else(|error| {
                            CommandResult::error_with_code(error.to_string(), 1)
                        })
                    })
                });
                (name, handler)
            })
            .collect();
        Ok(Self {
            name: manifest.name,
            version: manifest.version,
            commands,
        })
    }
}

#[derive(Default)]
pub struct CommandEnvironment {
    commands: HashMap<String, PackageHandler>,
    owners: HashMap<String, String>,
}

impl CommandEnvironment {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn create<F, Fut>(&mut self, name: &str, handler: F) -> Result<(), String>
    where
        F: Fn(CommandContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = CommandResult> + Send + 'static,
    {
        validate(name)?;
        self.owners.remove(name);
        self.commands.insert(
            name.into(),
            Arc::new(move |context| Box::pin(handler(context))),
        );
        Ok(())
    }
    pub fn list(&self) -> Vec<String> {
        let mut names = self.commands.keys().cloned().collect::<Vec<_>>();
        names.sort();
        names
    }
    pub fn get(&self, name: &str) -> Option<PackageHandler> {
        self.commands.get(name).cloned().or_else(|| {
            let handler = *VirtualCommandRegistry::with_builtins().get(name)?;
            Some(Arc::new(handler) as PackageHandler)
        })
    }
    pub async fn run(&self, name: &str, context: CommandContext) -> CommandResult {
        match self.get(name) {
            Some(handler) => handler(context).await,
            None => CommandResult::error_with_code(format!("Unknown command: {name}"), 127),
        }
    }
    pub fn extend<F>(&mut self, name: &str, middleware: F) -> Result<(), String>
    where
        F: Fn(CommandContext, PackageHandler) -> HandlerFuture + Send + Sync + 'static,
    {
        let parent = self
            .get(name)
            .ok_or_else(|| format!("Unknown command: {name}"))?;
        self.commands.insert(
            name.into(),
            Arc::new(move |context| middleware(context, parent.clone())),
        );
        Ok(())
    }
    pub fn inherit(&mut self, name: &str, parent: &str, args: Vec<String>) -> Result<(), String> {
        let handler = self
            .get(parent)
            .ok_or_else(|| format!("Unknown command: {parent}"))?;
        self.create(name, move |mut context| {
            let mut prefix = args.clone();
            prefix.extend(context.args);
            context.args = prefix;
            handler(context)
        })
    }
    pub fn compose(&mut self, name: &str, names: &[&str]) -> Result<(), String> {
        if names.is_empty() {
            return Err("Composition requires commands".into());
        }
        let handlers = names
            .iter()
            .map(|name| {
                self.get(name)
                    .ok_or_else(|| format!("Unknown command: {name}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.create(name, move |context| {
            let handlers = handlers.clone();
            Box::pin(async move {
                let mut result = CommandResult::success(context.stdin.unwrap_or_default());
                for handler in handlers {
                    let next = CommandContext {
                        args: context.args.clone(),
                        stdin: Some(result.stdout.to_string()),
                        cwd: context.cwd.clone(),
                        env: context.env.clone(),
                        output_tx: context.output_tx.clone(),
                        is_cancelled: None,
                    };
                    result = handler(next).await;
                    if result.code != 0 {
                        break;
                    }
                }
                result
            })
        })
    }
    /// Validate all commands before replacing a package, including when hot reloading.
    pub fn install(&mut self, package: CommandPackage) -> Result<(), String> {
        if package.commands.is_empty() {
            return Err("Empty command package".into());
        }
        for name in package.commands.keys() {
            validate(name)?;
            if self.commands.contains_key(name) && self.owners.get(name) != Some(&package.name) {
                return Err(format!("Command already registered: {name}"));
            }
        }
        self.uninstall(&package.name);
        for (name, handler) in package.commands {
            self.owners.insert(name.clone(), package.name.clone());
            self.commands.insert(name, handler);
        }
        Ok(())
    }
    pub fn uninstall(&mut self, package: &str) {
        let names = self
            .owners
            .iter()
            .filter(|(_, owner)| owner.as_str() == package)
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();
        for name in names {
            self.owners.remove(&name);
            self.commands.remove(&name);
        }
    }
}

fn validate(name: &str) -> Result<(), String> {
    if name.is_empty()
        || !name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_:.-".contains(c))
    {
        return Err(format!("Invalid command: {name}"));
    }
    Ok(())
}
