// Finite, portable process fixture for the Execa compatibility tests.
use std::io::{Read, Write};
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str).unwrap_or("") {
        "argv" => print!("{:?}", &args[1..]),
        "input" => {
            let mut data = Vec::new();
            std::io::stdin().read_to_end(&mut data).unwrap();
            std::io::stdout().write_all(&data).unwrap();
        }
        "duplex" => {
            // A watchdog bounds the pre-fix deadlock even when both pipes fill.
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_secs(3));
                std::process::exit(90);
            });
            std::io::stdout().write_all(&vec![b'x'; 262_144]).unwrap();
            let mut data = Vec::new();
            std::io::stdin().read_to_end(&mut data).unwrap();
            println!("{}", data.len());
        }
        "output" => {
            print!("{}", args.get(1).map(String::as_str).unwrap_or("hello\n"));
            eprint!("{}", args.get(2).map(String::as_str).unwrap_or(""));
        }
        "exit" => std::process::exit(args[1].parse().unwrap()),
        "env" => print!("{}", std::env::var(&args[1]).unwrap_or_default()),
        "cwd" => print!("{}", std::env::current_dir().unwrap().display()),
        "delayed" => {
            println!("started");
            std::io::stdout().flush().unwrap();
            std::thread::sleep(Duration::from_millis(700));
            println!("finished");
        }
        "wait" => std::thread::sleep(Duration::from_secs(5)),
        _ => std::process::exit(91),
    }
}
