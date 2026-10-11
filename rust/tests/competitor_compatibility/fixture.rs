use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::process;
use std::thread;
use std::time::Duration;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() {
    let mut args = env::args().skip(1);
    let mode = args.next().expect("fixture mode");
    match mode.as_str() {
        "argv" => {
            for value in args {
                println!("{}", hex(value.as_bytes()));
            }
        }
        "cwd" => print!("{}", env::current_dir().unwrap().display()),
        "env" => {
            for key in args {
                println!("{}", hex(env::var(&key).unwrap_or_default().as_bytes()));
            }
        }
        "output" => {
            let stdout = args.next().unwrap_or_default();
            let stderr = args.next().unwrap_or_default();
            io::stdout().write_all(stdout.as_bytes()).unwrap();
            io::stderr().write_all(stderr.as_bytes()).unwrap();
        }
        "large" => {
            let size: usize = args.next().unwrap().parse().unwrap();
            io::stdout().write_all(&vec![b'x'; size]).unwrap();
        }
        "stdin" => {
            let mut input = Vec::new();
            io::stdin().read_to_end(&mut input).unwrap();
            print!("{}", hex(&input));
        }
        "exit" => process::exit(args.next().unwrap().parse().unwrap()),
        "delayed" => {
            let first = args.next().unwrap();
            let delay_ms: u64 = args.next().unwrap().parse().unwrap();
            let second = args.next().unwrap();
            print!("{first}");
            io::stdout().flush().unwrap();
            thread::sleep(Duration::from_millis(delay_ms));
            print!("{second}");
        }
        "touch" => fs::write(args.next().unwrap(), b"spawned").unwrap(),
        "prefix" => {
            let prefix = args.next().unwrap();
            let mut input = String::new();
            io::stdin().read_to_string(&mut input).unwrap();
            print!("{prefix}{input}");
        }
        other => panic!("unknown fixture mode: {other}"),
    }
}
