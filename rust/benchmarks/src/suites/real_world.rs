use crate::adapters::{benchmark_executable, fixture_arguments, Adapter, Execution};
use crate::fixture::create_real_world_data;
use crate::model::TimedSuite;
use crate::runner::{BenchmarkCase, BenchmarkRunner};
use crate::BenchmarkResult;
use futures::future::join_all;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

fn adapter_cases<F, Fut>(adapters: &[Adapter], operation: F) -> Vec<BenchmarkCase>
where
    F: Fn(Adapter) -> Fut + Clone + 'static,
    Fut: std::future::Future<Output = Result<(), String>> + 'static,
{
    adapters
        .iter()
        .map(|adapter| {
            let adapter = *adapter;
            let operation = operation.clone();
            BenchmarkCase::new(adapter.name(), move || operation(adapter))
        })
        .collect()
}

pub async fn run(
    runner: &BenchmarkRunner,
    adapters: &[Adapter],
    smoke: bool,
    rust_directory: &Path,
) -> BenchmarkResult<TimedSuite> {
    let executable = benchmark_executable()?;
    let data = tempfile::tempdir()?;
    let (files, log) = create_real_world_data(data.path())?;
    let server = LocalServer::start()?;
    let overrides = smoke.then_some((1, 0));
    let mut scenarios = Vec::new();

    let manifest = rust_directory.join("Cargo.toml");
    let source = rust_directory.join("src");
    let workflow_executable = executable.clone();
    scenarios.push(
        runner
            .compare(
                "CI/CD validation workflow (two steps)",
                adapter_cases(adapters, move |adapter| {
                    let executable = workflow_executable.clone();
                    let manifest = manifest.clone();
                    let source = source.clone();
                    async move {
                        let operations = [
                            fixture_arguments(
                                "package-version",
                                &[manifest.to_string_lossy().into_owned()],
                            ),
                            fixture_arguments(
                                "source-digest",
                                &[source.to_string_lossy().into_owned()],
                            ),
                        ]
                        .into_iter()
                        .map(|arguments| {
                            let executable = executable.clone();
                            async move { adapter.run(executable, &arguments).await }
                        });
                        let results = join_all(operations).await;
                        for result in results {
                            let result = result.map_err(|error| error.to_string())?;
                            if result.exit_code != 0 || result.stdout.is_empty() {
                                return Err(format!("unexpected workflow result: {result:?}"));
                            }
                        }
                        Ok(())
                    }
                }),
                overrides,
            )
            .await?,
    );

    let log_executable = executable.clone();
    scenarios.push(
        runner
            .compare(
                "Log processing (1,000 records)",
                single_process_cases(adapters, log_executable, "log-summary", log, |result| {
                    result.exit_code == 0
                        && result.stdout == br#"{"ERROR":200,"INFO":600,"WARN":200}"#
                }),
                overrides,
            )
            .await?,
    );
    let files_executable = executable.clone();
    scenarios.push(
        runner
            .compare(
                "File operations (12 files)",
                single_process_cases(adapters, files_executable, "file-digest", files, |result| {
                    result.exit_code == 0 && result.stdout.starts_with(b"12:")
                }),
                overrides,
            )
            .await?,
    );
    scenarios.push(
        runner
            .compare(
                "Local network command handling",
                single_process_cases(
                    adapters,
                    executable,
                    "http-get",
                    PathBuf::from(server.url()),
                    |result| result.exit_code == 0 && result.stdout == b"200:benchmark-ok",
                ),
                overrides,
            )
            .await?,
    );

    Ok(TimedSuite {
        kind: "real-world".to_string(),
        name: "Real-world workloads".to_string(),
        scenarios,
    })
}

fn single_process_cases<F>(
    adapters: &[Adapter],
    executable: PathBuf,
    mode: &'static str,
    value: PathBuf,
    validate: F,
) -> Vec<BenchmarkCase>
where
    F: Fn(&Execution) -> bool + Clone + 'static,
{
    adapter_cases(adapters, move |adapter| {
        let executable = executable.clone();
        let value = value.clone();
        let validate = validate.clone();
        async move {
            let arguments = fixture_arguments(mode, &[value.to_string_lossy().into_owned()]);
            let result = adapter
                .run(executable, &arguments)
                .await
                .map_err(|error| error.to_string())?;
            validate(&result)
                .then_some(())
                .ok_or_else(|| format!("unexpected process result: {result:?}"))
        }
    })
}

struct LocalServer {
    address: SocketAddr,
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl LocalServer {
    fn start() -> BenchmarkResult<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        listener.set_nonblocking(true)?;
        let running = Arc::new(AtomicBool::new(true));
        let thread_running = Arc::clone(&running);
        let thread = thread::spawn(move || {
            while thread_running.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => respond(&mut stream),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            address,
            running,
            thread: Some(thread),
        })
    }

    fn url(&self) -> String {
        format!("http://{}/health", self.address)
    }
}

impl Drop for LocalServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        let _ = TcpStream::connect(self.address);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn respond(stream: &mut TcpStream) {
    let mut request = [0_u8; 1_024];
    let _ = stream.read(&mut request);
    let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 12\r\nConnection: close\r\n\r\nbenchmark-ok";
    let _ = stream.write_all(response);
}
