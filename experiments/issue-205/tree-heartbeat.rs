// Portable, finite process-tree fixture. Compiled by rust/tests/process_tree.rs.
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let heartbeat = std::path::Path::new(&args[2]);
    let deadline = Instant::now() + Duration::from_secs(10);
    if args[1] == "child" {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(heartbeat)
            .unwrap();
        while Instant::now() < deadline {
            file.write_all(b"x").unwrap();
            file.flush().unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
    } else {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("child")
            .arg(heartbeat)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(heartbeat.with_extension("pid"), child.id().to_string()).unwrap();
        while !heartbeat.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        println!("ready");
        std::io::stdout().flush().unwrap();
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
