//! Reading the process id of a started command (issue #18).
//!
//! Run it: `cargo run --example process_pid_access`
//!
//! [`ProcessRunner::pid`] is the id of the operating system process behind a
//! command. It is recorded when the process is spawned, so it stays readable
//! after the command finishes - unlike the child handle, which `run()` consumes
//! in order to await it. The scenarios below cover when it becomes available,
//! what it actually names, and what it is useful for.
//!
//! The inspection commands (`ps`, `pgrep`) make this a POSIX-only example; the
//! `pid` accessors themselves work everywhere.
use command_stream::{OutputChunk, ProcessRunner, RunOptions, StreamingRunner};

/// `sleep` is a built-in of this library (see scenario 3), so the real
/// executable is spelled out whenever an actual process is needed.
const SLEEP: &str = "/bin/sleep";

/// Mirroring is off so the scenario output stays readable.
fn quiet() -> RunOptions {
    RunOptions {
        mirror: false,
        capture: true,
        ..Default::default()
    }
}

/// Ask `ps` a single question about one process.
fn ps(format: &str, pid: u32) -> String {
    let output = std::process::Command::new("ps")
        .args(["-o", format, "-p", &pid.to_string()])
        .output()
        .expect("ps is available");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// The ids of a process's direct children, if it has any.
fn children(pid: u32) -> Vec<String> {
    let output = std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
        .expect("pgrep is available");
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// Whether a process still exists. `ps` reports failure when it does not.
fn is_alive(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string()])
        .output()
        .expect("ps is available")
        .status
        .success()
}

#[tokio::main]
async fn main() -> command_stream::Result<()> {
    // 1. The id appears when the process is spawned, which `start()` is what
    //    waits for. Before that there is nothing to identify.
    println!("=== 1. Before, during and after the command ===");
    let mut worker = ProcessRunner::new(format!("{SLEEP} 5"), quiet());
    println!("before start:  {:?}", worker.pid()); // None - nothing spawned yet

    worker.start().await?;
    println!("while running: {:?}", worker.pid());

    worker.kill()?;
    let _ = worker.run().await;

    // The reason to record the id at spawn time: `run()` took the child handle
    // in order to await it, so the id could no longer be recovered from it.
    println!("after exit:    {:?}", worker.pid());

    // 2. A plain run needs no ceremony - the id is there once the result is.
    println!("\n=== 2. After a plain run ===");
    let mut done = ProcessRunner::new("sh -c 'echo done'", quiet());
    done.run().await?;
    println!("pid: {:?}", done.pid());

    // 3. Built-in commands run inside this process, so there is no separate
    //    process to identify and the id stays None. `echo` and `sleep` are two
    //    of them, which is why the real `sleep` is used above.
    println!("\n=== 3. Built-in commands have no process id ===");
    let mut builtin = ProcessRunner::new("echo hello", quiet());
    builtin.run().await?;
    println!("built-in echo:      {:?}", builtin.pid());

    let mut external = ProcessRunner::new("/bin/echo hello", quiet());
    external.run().await?;
    println!("/bin/echo instead:  {:?}", external.pid());

    // 4. What the id names. A command string is handed to a shell, so the id
    //    names the process that shell put there: usually the shell itself, with
    //    the command as its child, but some shells (macOS `/bin/sh`) replace
    //    themselves with a single simple command instead. Either way it leads
    //    its own process group, which is how kill() reaches the whole tree.
    println!("\n=== 4. What the id names ===");
    let mut shell_run = ProcessRunner::new(format!("{SLEEP} 30"), quiet());
    shell_run.start().await?;
    let shell_pid = shell_run.pid().expect("a spawned command has a pid");

    println!("pid {shell_pid} is: {}", ps("args=", shell_pid));
    println!(
        "its process group:  {} (same as the pid)",
        ps("pgid=", shell_pid)
    );
    let shell_children = children(shell_pid);
    for child in &shell_children {
        let child_pid: u32 = child.parse().expect("pgrep prints ids");
        println!("  child {child_pid}: {}", ps("args=", child_pid));
    }
    if shell_children.is_empty() {
        println!("  no children - this shell replaced itself with the command");
    }

    // kill() signals the whole group, which is how it reaches the command
    // running underneath the shell.
    shell_run.kill()?;
    let _ = shell_run.run().await;

    // 5. Streaming spawns its child inside a background task, so the id is not
    //    known the moment `stream()` returns. `wait_for_pid()` waits for the
    //    spawn; `pid()` reads whatever is known right now, without waiting.
    println!("\n=== 5. Streaming commands ===");
    let mut stream = StreamingRunner::new(format!("{SLEEP} 30")).stream();
    println!("immediately after stream(): {:?}", stream.pid());

    let streamed_pid = stream.wait_for_pid().await.expect("the child was spawned");
    println!("after wait_for_pid():       {streamed_pid}");
    println!("which is: {}", ps("args=", streamed_pid));

    stream.kill();
    while let Some(chunk) = stream.next().await {
        if let OutputChunk::Exit(code) = chunk {
            println!("exit code: {code}");
        }
    }

    // 6. A practical use: asking whether the command is still alive.
    println!("\n=== 6. Checking whether the command is still running ===");
    let mut short_lived = ProcessRunner::new(format!("{SLEEP} 0.3"), quiet());
    short_lived.start().await?;
    let short_pid = short_lived.pid().expect("a spawned command has a pid");
    println!("running:  {}", is_alive(short_pid));
    short_lived.run().await?;
    println!("finished: {}", is_alive(short_pid));

    Ok(())
}
