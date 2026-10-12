// Finite inherited-pipe fixture for rust/tests/cancelled_output.rs.
use std::io::Write;
use std::process::Command;
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args[1] == "holder" {
        std::io::stdout().write_all(b"held stdout").unwrap();
        std::io::stdout().flush().unwrap();
        std::io::stderr().write_all(b"held stderr").unwrap();
        std::io::stderr().flush().unwrap();
        std::fs::write(&args[2], std::process::id().to_string()).unwrap();
        std::thread::sleep(Duration::from_secs(2));
    } else {
        let mut holder = Command::new(std::env::current_exe().unwrap());
        holder.args(["holder", &args[1]]);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            holder.process_group(0);
        }
        holder.spawn().unwrap();
        std::thread::sleep(Duration::from_secs(4));
    }
}
