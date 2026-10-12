//! Typed command packages, middleware and reloadable exact-argv manifests.
use crate::commands::{CommandContext, StreamChunk, VirtualCommandRegistry};
use crate::{CommandBuilder, CommandResult, OutputChunk, StreamingRunner};
use serde::Deserialize;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::mpsc;

mod marketplace;
mod watch;
pub use marketplace::{Marketplace, PackageMetadata, SearchOptions};
pub use watch::{watch_package, PackageWatcher};

pub type HandlerFuture = Pin<Box<dyn Future<Output = CommandResult> + Send>>;
pub type PackageHandler = Arc<dyn Fn(CommandContext) -> HandlerFuture + Send + Sync>;

/// Build a streaming, cancellable handler from literal executable arguments.
pub fn argv_handler(file: impl Into<String>, args: Vec<String>) -> PackageHandler {
    let file = file.into();
    Arc::new(move |context| Box::pin(run_manifest(file.clone(), args.clone(), context)))
}

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
                let handler = argv_handler(specification.file, specification.args);
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

async fn run_manifest(
    file: String,
    mut args: Vec<String>,
    context: CommandContext,
) -> CommandResult {
    if context.is_cancelled() {
        return CommandResult::error_with_code("Command cancelled", 130);
    }
    let cancelled: Option<Arc<dyn Fn() -> bool + Send + Sync>> =
        context.is_cancelled.map(Arc::from);
    args.extend(context.args);
    let mut runner =
        StreamingRunner::from_argv(file, args).stdin(context.stdin.unwrap_or_default());
    if let Some(cwd) = context.cwd {
        runner = runner.cwd(cwd);
    }
    if let Some(env) = context.env {
        runner = runner.env(env);
    }
    let mut stream = runner.stream();
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code = 0;
    let mut stopped = false;
    let mut stdout_decoder = Decoder::default();
    let mut stderr_decoder = Decoder::default();
    loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            () = wait_cancel(&cancelled), if !stopped && cancelled.is_some() => {
                stream.kill();
                stopped = true;
                continue;
            }
        };
        let Some(chunk) = chunk else {
            break;
        };
        let output = match chunk {
            OutputChunk::Stdout(data) => {
                if context.output_tx.is_none() {
                    stdout.extend(&data);
                }
                let text = stdout_decoder.push(&data);
                if text.is_empty() {
                    None
                } else {
                    Some(StreamChunk::Stdout(text))
                }
            }
            OutputChunk::Stderr(data) => {
                if context.output_tx.is_none() {
                    stderr.extend(&data);
                }
                let text = stderr_decoder.push(&data);
                if text.is_empty() {
                    None
                } else {
                    Some(StreamChunk::Stderr(text))
                }
            }
            OutputChunk::Exit(status) => {
                code = status;
                None
            }
        };
        if let (Some(tx), Some(chunk)) = (&context.output_tx, output) {
            if send_chunk(tx, chunk, &cancelled).await.is_err() {
                stream.kill();
                return CommandResult::error_with_code(
                    "Command cancelled or output consumer closed",
                    130,
                );
            }
        }
    }
    if let Some(tx) = &context.output_tx {
        for chunk in [
            StreamChunk::Stdout(stdout_decoder.finish()),
            StreamChunk::Stderr(stderr_decoder.finish()),
        ] {
            let empty = match &chunk {
                StreamChunk::Stdout(text) | StreamChunk::Stderr(text) => text.is_empty(),
            };
            if !empty && send_chunk(tx, chunk, &cancelled).await.is_err() {
                return CommandResult::error_with_code(
                    "Command cancelled or output consumer closed",
                    130,
                );
            }
        }
    }
    CommandResult::new(
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
        code,
    )
}

async fn wait_cancel(cancelled: &Option<Arc<dyn Fn() -> bool + Send + Sync>>) {
    if let Some(cancelled) = cancelled {
        loop {
            if cancelled() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
    std::future::pending::<()>().await;
}

async fn send_chunk(
    tx: &mpsc::Sender<StreamChunk>,
    chunk: StreamChunk,
    cancelled: &Option<Arc<dyn Fn() -> bool + Send + Sync>>,
) -> Result<(), ()> {
    tokio::select! {
        result = tx.send(chunk) => result.map_err(|_| ()),
        () = wait_cancel(cancelled) => Err(()),
    }
}

/// Preserve incomplete UTF-8 code points between process byte chunks.
#[derive(Default)]
struct Decoder {
    pending: Vec<u8>,
}
impl Decoder {
    fn push(&mut self, data: &[u8]) -> String {
        self.pending.extend(data);
        let mut text = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            let remaining = &self.pending[consumed..];
            match std::str::from_utf8(remaining) {
                Ok(valid) => {
                    text.push_str(valid);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    text.push_str(
                        std::str::from_utf8(&remaining[..valid]).expect("valid UTF-8 prefix"),
                    );
                    consumed += valid;
                    match error.error_len() {
                        Some(length) => {
                            text.push('\u{fffd}');
                            consumed += length;
                        }
                        None => break,
                    }
                }
            }
        }
        self.pending.drain(..consumed);
        text
    }
    fn finish(&mut self) -> String {
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        text
    }
}

#[derive(Default, Clone, Copy)]
pub struct InstallOptions {
    /// Allow displacement of an existing handler, restored on uninstall.
    pub replace: bool,
}

struct Installed {
    package: CommandPackage,
    previous: HashMap<String, (PackageHandler, Option<String>)>,
}

#[derive(Default)]
pub struct CommandEnvironment {
    commands: HashMap<String, PackageHandler>,
    owners: HashMap<String, String>,
    packages: HashMap<String, Installed>,
    files: HashMap<PathBuf, String>,
}

impl CommandEnvironment {
    pub fn new() -> Self {
        Self::default()
    }
    /// Register a typed handler after validating the complete command name.
    /// Non-string names are rejected by the compiler before registry mutation.
    ///
    /// ```compile_fail
    /// use command_stream::{CommandEnvironment, CommandResult};
    /// let mut environment = CommandEnvironment::new();
    /// environment.create(None, |_| async { CommandResult::success_empty() });
    /// ```
    ///
    /// ```compile_fail
    /// use command_stream::{CommandEnvironment, CommandResult};
    /// let mut environment = CommandEnvironment::new();
    /// environment.create(42, |_| async { CommandResult::success_empty() });
    /// ```
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
    pub fn unregister(&mut self, name: &str) -> bool {
        self.owners.remove(name);
        self.commands.remove(name).is_some()
    }
    pub fn installed(&self, name: &str) -> Option<&CommandPackage> {
        self.packages.get(name).map(|installed| &installed.package)
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
                let cancelled: Option<Arc<dyn Fn() -> bool + Send + Sync>> =
                    context.is_cancelled.map(Arc::from);
                for handler in handlers {
                    let (tx, mut rx) = mpsc::channel(16);
                    let cancelled = cancelled.clone();
                    let next = CommandContext {
                        args: context.args.clone(),
                        stdin: Some(result.stdout.to_string()),
                        cwd: context.cwd.clone(),
                        env: context.env.clone(),
                        output_tx: Some(tx),
                        is_cancelled: cancelled.map(|cancelled| {
                            Box::new(move || cancelled()) as Box<dyn Fn() -> bool + Send + Sync>
                        }),
                    };
                    // Drain streamed stages concurrently, without exposing intermediate
                    // chunks or deadlocking a bounded producer. Composition captures.
                    let collect = async {
                        let mut stdout = String::new();
                        let mut stderr = String::new();
                        while let Some(chunk) = rx.recv().await {
                            match chunk {
                                StreamChunk::Stdout(chunk) => stdout.push_str(&chunk),
                                StreamChunk::Stderr(chunk) => stderr.push_str(&chunk),
                            }
                        }
                        (stdout, stderr)
                    };
                    let (mut next, (stdout, stderr)) = tokio::join!(handler(next), collect);
                    if next.stdout.is_empty() {
                        next.stdout = stdout.into();
                    }
                    if next.stderr.is_empty() {
                        next.stderr = stderr.into();
                    }
                    result = next;
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
        self.install_with_options(package, InstallOptions::default())
    }
    pub fn install_with_options(
        &mut self,
        package: CommandPackage,
        options: InstallOptions,
    ) -> Result<(), String> {
        if package.commands.is_empty() {
            return Err("Empty command package".into());
        }
        for name in package.commands.keys() {
            validate(name)?;
            let owned = self
                .packages
                .get(&package.name)
                .and_then(|installed| installed.package.commands.get(name))
                .zip(self.commands.get(name))
                .is_some_and(|(owned, current)| Arc::ptr_eq(owned, current));
            if self.get(name).is_some() && !owned && !options.replace {
                return Err(format!("Command already registered: {name}"));
            }
        }
        self.remove_package(&package.name);
        let mut previous = HashMap::new();
        for (name, handler) in &package.commands {
            if let Some(displaced) = self.commands.get(name) {
                previous.insert(
                    name.clone(),
                    (displaced.clone(), self.owners.get(name).cloned()),
                );
            }
            self.owners.insert(name.clone(), package.name.clone());
            self.commands.insert(name.clone(), handler.clone());
        }
        crate::trace::trace_lazy("CommandPackages", || {
            format!("Installed {}@{}", package.name, package.version)
        });
        self.packages
            .insert(package.name.clone(), Installed { package, previous });
        Ok(())
    }
    pub fn uninstall(&mut self, package: &str) {
        self.remove_package(package);
        self.files.retain(|_, name| name != package);
    }
    fn remove_package(&mut self, package: &str) {
        if let Some(installed) = self.packages.remove(package) {
            for (name, handler) in installed.package.commands {
                if !self
                    .commands
                    .get(&name)
                    .is_some_and(|current| Arc::ptr_eq(current, &handler))
                {
                    continue;
                }
                self.owners.remove(&name);
                self.commands.remove(&name);
                if let Some((previous, owner)) = installed.previous.get(&name) {
                    self.commands.insert(name.clone(), previous.clone());
                    if let Some(owner) = owner {
                        self.owners.insert(name, owner.clone());
                    }
                }
            }
        }
    }
    /// Canonical file identity makes repeated installation idempotent, including symlinks.
    pub async fn install_file(&mut self, path: impl AsRef<Path>) -> Result<String, String> {
        let file = tokio::fs::canonicalize(path)
            .await
            .map_err(|error| error.to_string())?;
        if let Some(name) = self.files.get(&file) {
            return Ok(name.clone());
        }
        self.reload_file(file).await
    }
    /// Resolve an npm package containing `command-stream.json`. Rust executes
    /// its literal argv commands without evaluating JavaScript. Missing packages
    /// may be installed with npm lifecycle scripts disabled; `install = false`
    /// requires an existing package. Reload and uninstall use the same lifecycle.
    pub async fn install_npm(
        &mut self,
        specifier: &str,
        cwd: impl AsRef<Path>,
        install: bool,
    ) -> Result<String, String> {
        static NAME: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
            regex::Regex::new(r"^(@[a-z0-9._-]+/)?[a-z0-9._-]+(?:@[^\s]+)?$").unwrap()
        });
        if !NAME.is_match(specifier) {
            return Err("Expected an npm package name".into());
        }
        let name = match specifier.rfind('@') {
            Some(index) if index > 0 => &specifier[..index],
            _ => specifier,
        };
        if name
            .split('/')
            .any(|part| part == "." || part == ".." || part == "@..")
        {
            return Err("Invalid npm package name".into());
        }
        let cwd = cwd.as_ref();
        let file = cwd
            .join("node_modules")
            .join(name)
            .join("command-stream.json");
        if !file.exists() && install {
            let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
            let result = CommandBuilder::new(npm)
                .args([
                    "install",
                    "--ignore-scripts",
                    "--no-audit",
                    "--no-fund",
                    "--",
                    specifier,
                ])
                .cwd(cwd)
                .run()
                .await
                .map_err(|error| error.to_string())?;
            if result.code != 0 {
                return Err(format!("Package installation failed: {}", result.stderr));
            }
        }
        self.install_file(file).await
    }
    /// Invalid manifests or collisions leave the installed version intact.
    pub async fn reload_file(&mut self, path: impl AsRef<Path>) -> Result<String, String> {
        let file = tokio::fs::canonicalize(path)
            .await
            .map_err(|error| error.to_string())?;
        let package = CommandPackage::load(&file)
            .await
            .map_err(|error| error.to_string())?;
        if self
            .files
            .iter()
            .any(|(other, name)| other != &file && name == &package.name)
        {
            return Err("Package already installed from another file".into());
        }
        if self
            .files
            .get(&file)
            .is_some_and(|name| name != &package.name)
        {
            return Err("Reload cannot change a package's name".into());
        }
        let name = package.name.clone();
        self.install(package)?;
        self.files.insert(file, name.clone());
        Ok(name)
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
