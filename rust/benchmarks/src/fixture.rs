use crate::BenchmarkResult;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};

pub fn run_fixture(arguments: &[String]) -> BenchmarkResult<Option<i32>> {
    if arguments.first().map(String::as_str) != Some("__fixture") {
        return Ok(None);
    }
    let mode = arguments.get(1).ok_or("benchmark fixture expects a mode")?;
    let values = &arguments[2..];
    let code = match mode.as_str() {
        "echo" => {
            print!("{}", serde_json::to_string(values)?);
            0
        }
        "emit" => {
            let bytes = parse_usize(values.first(), "emit bytes")?;
            std::io::stdout().write_all(&vec![b'x'; bytes])?;
            0
        }
        "fail" => {
            let code = parse_i32(values.first(), "failure exit code")?;
            eprint!("intentional benchmark failure");
            code
        }
        "stdin-count" => {
            let mut input = Vec::new();
            std::io::stdin().read_to_end(&mut input)?;
            print!("{}", input.len());
            0
        }
        "package-version" => {
            let manifest = required_path(values.first(), "manifest path")?;
            print!("{}", package_version(&manifest)?);
            0
        }
        "source-digest" => {
            let directory = required_path(values.first(), "source directory")?;
            print!("{:016x}", directory_digest(&directory)?);
            0
        }
        "log-summary" => {
            let log = required_path(values.first(), "log path")?;
            print!("{}", log_summary(&log)?);
            0
        }
        "file-digest" => {
            let directory = required_path(values.first(), "files directory")?;
            let (files, digest) = files_digest(&directory)?;
            print!("{files}:{digest:016x}");
            0
        }
        "http-get" => {
            let url = values.first().ok_or("http-get expects a URL")?;
            print!("{}", http_get(url)?);
            0
        }
        _ => return Err(format!("unknown benchmark fixture mode: {mode}").into()),
    };
    Ok(Some(code))
}

fn parse_usize(value: Option<&String>, label: &str) -> BenchmarkResult<usize> {
    Ok(value.ok_or_else(|| format!("missing {label}"))?.parse()?)
}

fn parse_i32(value: Option<&String>, label: &str) -> BenchmarkResult<i32> {
    Ok(value.ok_or_else(|| format!("missing {label}"))?.parse()?)
}

fn required_path(value: Option<&String>, label: &str) -> BenchmarkResult<PathBuf> {
    Ok(PathBuf::from(
        value.ok_or_else(|| format!("missing {label}"))?,
    ))
}

fn package_version(manifest: &Path) -> BenchmarkResult<String> {
    let source = fs::read_to_string(manifest)?;
    source
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("version = \"")
                .and_then(|value| value.strip_suffix('"'))
                .map(str::to_string)
        })
        .ok_or_else(|| format!("no package version in {}", manifest.display()).into())
}

fn directory_digest(directory: &Path) -> BenchmarkResult<u64> {
    let mut paths = Vec::new();
    collect_files(directory, &mut paths)?;
    paths.sort();
    let mut digest = FNV_OFFSET;
    for path in paths {
        digest = fnv_update(digest, path.to_string_lossy().as_bytes());
        digest = fnv_update(digest, &fs::read(path)?);
    }
    Ok(digest)
}

fn files_digest(directory: &Path) -> BenchmarkResult<(usize, u64)> {
    let mut paths = Vec::new();
    collect_files(directory, &mut paths)?;
    paths.sort();
    let mut digest = FNV_OFFSET;
    for path in &paths {
        digest = fnv_update(digest, &fs::read(path)?);
    }
    Ok((paths.len(), digest))
}

fn collect_files(directory: &Path, output: &mut Vec<PathBuf>) -> BenchmarkResult<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            collect_files(&entry.path(), output)?;
        } else if entry.file_type()?.is_file() {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn log_summary(path: &Path) -> BenchmarkResult<String> {
    let mut counts = BTreeMap::new();
    let contents = fs::read_to_string(path)?;
    for line in contents.lines() {
        let level = line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| format!("invalid log line: {line}"))?;
        *counts.entry(level.to_string()).or_insert(0_u32) += 1;
    }
    Ok(serde_json::to_string(&counts)?)
}

fn http_get(url: &str) -> BenchmarkResult<String> {
    let authority_and_path = url
        .strip_prefix("http://")
        .ok_or("fixture only supports http:// URLs")?;
    let (authority, path) = authority_and_path
        .split_once('/')
        .map_or((authority_and_path, "/".to_string()), |(host, path)| {
            (host, format!("/{path}"))
        });
    let mut stream = TcpStream::connect(authority)?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("invalid HTTP response")?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("missing HTTP status")?;
    Ok(format!("{status}:{body}"))
}

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn fnv_update(mut digest: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        digest ^= u64::from(*byte);
        digest = digest.wrapping_mul(FNV_PRIME);
    }
    digest
}

pub fn create_real_world_data(root: &Path) -> BenchmarkResult<(PathBuf, PathBuf)> {
    let files = root.join("files");
    fs::create_dir(&files)?;
    for index in 0..12 {
        fs::write(
            files.join(format!("{index:02}.txt")),
            format!("file-{index}\n"),
        )?;
    }
    let log = root.join("application.log");
    let levels = ["INFO", "INFO", "WARN", "INFO", "ERROR"];
    let mut output = File::create(&log)?;
    for index in 0..1_000 {
        writeln!(
            output,
            "2026-01-01T00:00:{:02}Z {} event-{index}",
            index % 60,
            levels[index % levels.len()]
        )?;
    }
    Ok((files, log))
}
