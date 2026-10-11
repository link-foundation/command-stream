//! The small builtins: `echo`, `exit`, `true`, `false`, `pwd`, `cd`,
//! `export`, `basename`, `dirname`, `yes`, `seq` and `which`.
//!
//! Ported from Bun's `src/runtime/shell/builtin/{echo,exit,pwd,cd,export,
//! basename,dirname,yes,seq,which}.rs` (MIT, Copyright (c) Oven-sh / Jarred
//! Sumner) by way of the `SMALL_BUILTINS` in `js/src/bun-shell/builtin.mjs`.

use crate::bun_shell::builtin::{self, Builtin, BuiltinOut};
use crate::bun_shell::errno::errno_message;
use crate::bun_shell::io::Which;

/// Bun's `trim_subsequent_leading_chars`: collapse a run of trailing `ch`
/// to a single one.
fn trim_subsequent_leading_chars(s: &str, ch: u8) -> &str {
    let b = s.as_bytes();
    if b.is_empty() {
        return s;
    }
    let mut end = b.len() - 1;
    let mut endend = b.len();
    while end > 0 && b[end] == ch {
        endend = end + 1;
        end -= 1;
    }
    &s[..endend]
}

/// Append `input` with `echo -e` escapes; returns true on `\c`.
fn append_with_escapes(out: &mut Vec<u8>, input: &[u8]) -> bool {
    let mut i = 0;
    while i < input.len() {
        if input[i] != b'\\' || i + 1 >= input.len() {
            out.push(input[i]);
            i += 1;
            continue;
        }
        let c = input[i + 1];
        let simple = match c {
            b'\\' => Some(b'\\'),
            b'a' => Some(0x07),
            b'b' => Some(0x08),
            b'e' | b'E' => Some(0x1b),
            b'f' => Some(0x0c),
            b'n' => Some(b'\n'),
            b'r' => Some(b'\r'),
            b't' => Some(b'\t'),
            b'v' => Some(0x0b),
            _ => None,
        };
        if let Some(byte) = simple {
            out.push(byte);
            i += 2;
        } else if c == b'c' {
            return true;
        } else if c == b'0' {
            i += 2;
            let mut val: u32 = 0;
            let mut digits = 0;
            while digits < 3 && i < input.len() && (b'0'..=b'7').contains(&input[i]) {
                val = (val * 8 + u32::from(input[i] - b'0')) & 0xff;
                i += 1;
                digits += 1;
            }
            out.push(val as u8);
        } else if c == b'x' {
            i += 2;
            let mut n = 0;
            let mut val: u32 = 0;
            while n < 2 && i < input.len() {
                let Some(d) = (input[i] as char).to_digit(16) else {
                    break;
                };
                val = val * 16 + d;
                i += 1;
                n += 1;
            }
            if n > 0 {
                out.push(val as u8);
            } else {
                out.extend_from_slice(b"\\x");
            }
        } else {
            out.extend_from_slice(&[b'\\', c]);
            i += 2;
        }
    }
    false
}

pub(super) async fn echo(b: &mut Builtin<'_>) -> i32 {
    let mut no_newline = false;
    let mut escapes = false;
    let mut start = 0;
    for flag in &b.args {
        let rest = flag.get(1..).unwrap_or("");
        if flag.len() < 2
            || !flag.starts_with('-')
            || !rest.bytes().all(|c| matches!(c, b'n' | b'e' | b'E'))
        {
            break;
        }
        for c in rest.bytes() {
            if c == b'n' {
                no_newline = true;
            } else {
                escapes = c == b'e';
            }
        }
        start += 1;
    }
    let mut out = Vec::new();
    let mut has_trailing_newline = false;
    let mut stop = false;
    let n = b.args.len();
    for (i, arg) in b.args.iter().enumerate().skip(start) {
        let is_last = i == n - 1;
        if escapes {
            stop = append_with_escapes(&mut out, arg.as_bytes());
        } else if is_last {
            has_trailing_newline = arg.ends_with('\n');
            out.extend_from_slice(trim_subsequent_leading_chars(arg, b'\n').as_bytes());
        } else {
            out.extend_from_slice(arg.as_bytes());
        }
        if stop {
            break;
        }
        if !is_last {
            out.push(b' ');
        }
    }
    if !stop && !has_trailing_newline && !no_newline {
        out.push(b'\n');
    }
    match b.write(Which::Stdout, out).await {
        Err(e) if b.needs_io(Which::Stdout) => e.errno,
        _ => 0,
    }
}

pub(super) async fn exit(b: &mut Builtin<'_>) -> i32 {
    match b.args.len() {
        0 => return 0,
        1 => {}
        _ => return b.write_failing_error("exit: too many arguments\n", 1).await,
    }
    let arg = b.args[0].as_str();
    let digits = arg.strip_prefix('+').unwrap_or(arg);
    if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
        return b
            .write_failing_error("exit: numeric argument required\n", 1)
            .await;
    }
    // Leading zeros do not count against the u64 limit (JS `BigInt`).
    let significant = digits.trim_start_matches('0');
    match significant.parse::<u128>() {
        Ok(n) if significant.len() <= 20 && n <= u128::from(u64::MAX) => (n % 256) as i32,
        _ if significant.is_empty() => 0,
        _ => {
            b.write_failing_error("exit: numeric argument required\n", 1)
                .await
        }
    }
}

pub(super) async fn pwd(b: &mut Builtin<'_>) -> i32 {
    if !b.args.is_empty() {
        return b.write_failing_error("pwd: too many arguments\n", 1).await;
    }
    let line = format!("{}\n", b.shell.cwd);
    match b.write(Which::Stdout, line).await {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

pub(super) async fn cd(b: &mut Builtin<'_>) -> i32 {
    let (target, res) = if b.args.len() > 1 {
        let msg = b.fmt_err("too many arguments\n");
        return b.write_failing_error(msg, 1).await;
    } else if b.args.is_empty() {
        let home = b.shell.get_homedir();
        if home.is_empty() {
            let msg = b.fmt_err("HOME not set\n");
            return b.write_failing_error(msg, 1).await;
        }
        let res = b.shell.change_cwd(&home, false);
        (home, res)
    } else if b.args[0] == "-" {
        let prev = b.shell.prev_cwd.clone();
        (prev, b.shell.change_prev_cwd())
    } else {
        let target = b.args[0].clone();
        let res = b.shell.change_cwd(&target, false);
        (target, res)
    };
    let Err(e) = res else {
        return 0;
    };
    let msg = match e.code {
        "ENOTDIR" | "ENOENT" => format!("not a directory: {target}\n"),
        "ENAMETOOLONG" => "file name too long\n".to_string(),
        code => format!("{}: {target}\n", errno_message(code).unwrap_or(code)),
    };
    let msg = b.fmt_err(&msg);
    b.write_failing_error(msg, 1).await
}

pub(super) async fn export(b: &mut Builtin<'_>) -> i32 {
    if b.args.is_empty() {
        let mut entries: Vec<(&str, &str)> = b.shell.export_env.iter().collect();
        entries.sort_by(|a, c| a.0.as_bytes().cmp(c.0.as_bytes()));
        let out: String = entries.iter().map(|(k, v)| format!("{k}={v}\n")).collect();
        return match b.write(Which::Stdout, out).await {
            Ok(()) => 0,
            Err(_) => 1,
        };
    }
    for arg in &b.args {
        if arg.is_empty() {
            continue;
        }
        match arg.split_once('=') {
            Some((k, v)) => b.shell.export_env.set(k, v),
            None => b.shell.export_env.set(arg.as_str(), ""),
        }
    }
    0
}

/// Bun's `resolve_path::basename` (either separator).
pub(crate) fn basename_any(p: &str) -> &str {
    let b = p.as_bytes();
    if b.is_empty() {
        return "";
    }
    let is_sep = |c: u8| c == b'/' || c == b'\\';
    let mut end = b.len() - 1;
    while is_sep(b[end]) {
        if end == 0 {
            return "/";
        }
        end -= 1;
    }
    let mut start = end;
    while !is_sep(b[start]) {
        if start == 0 {
            return &p[..=end];
        }
        start -= 1;
    }
    &p[start + 1..=end]
}

/// Bun's `resolve_path::dirname::<Posix>` (`""` when there is no `/`).
pub(crate) fn dirname_posix(p: &str) -> &str {
    match p.rfind('/') {
        None => "",
        Some(0) => "/",
        Some(sep) if sep == p.len() - 1 => dirname_posix(&p[..sep]),
        Some(sep) => &p[..sep],
    }
}

async fn path_builtin(b: &mut Builtin<'_>, f: fn(&str) -> &str) -> i32 {
    if b.args.is_empty() {
        let usage = b.kind.usage();
        return b.write_failing_error(usage, 1).await;
    }
    let out: String = b.args.iter().map(|a| format!("{}\n", f(a))).collect();
    match b.write(Which::Stdout, out).await {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

pub(super) async fn basename(b: &mut Builtin<'_>) -> i32 {
    path_builtin(b, basename_any).await
}

pub(super) async fn dirname(b: &mut Builtin<'_>) -> i32 {
    path_builtin(b, |p| match dirname_posix(p) {
        "" => ".",
        d => d,
    })
    .await
}

pub(super) async fn yes(b: &mut Builtin<'_>) -> i32 {
    let line = if b.args.is_empty() {
        "y\n".to_string()
    } else {
        format!("{}\n", b.args.join(" "))
    };
    let target = if line.len() > 4096 { line.len() } else { 8192 };
    let chunk = line.repeat((target / line.len()).max(1)).into_bytes();
    if b.needs_io(Which::Stdout) {
        loop {
            if b.write(Which::Stdout, &chunk).await.is_err() {
                return 1;
            }
        }
    }
    loop {
        for _ in 0..4 {
            if let Err(e) = b.write_no_io(Which::Stdout, &chunk) {
                let msg = b.fmt_err(&format!("{}\n", e.code));
                return b.write_failing_error(msg, 1).await;
            }
        }
        tokio::task::yield_now().await;
    }
}

/// Whether `s` matches `^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$`
/// (the finite part of Rust's float grammar).
fn is_decimal_literal(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let digits = |i: &mut usize| {
        let s = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        *i - s
    };
    let int = digits(&mut i);
    let frac = if i < b.len() && b[i] == b'.' {
        i += 1;
        digits(&mut i)
    } else {
        0
    };
    if int == 0 && frac == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        if digits(&mut i) == 0 {
            return false;
        }
    }
    i == b.len()
}

/// Rust's `f32::from_str`, restricted to finite decimal literals (what Bun's
/// `seq` accepts).
pub(crate) fn parse_f32(s: &str) -> Option<f32> {
    if !is_decimal_literal(s) {
        return None;
    }
    s.parse::<f32>().ok().filter(|x| x.is_finite())
}

/// Rust's `Display` for `f32` (what Bun's `seq` prints).
pub(crate) fn format_f32(x: f32) -> String {
    x.to_string()
}

pub(super) async fn seq(b: &mut Builtin<'_>) -> i32 {
    let usage = b.kind.usage();
    if b.args.is_empty() {
        return b.write_failing_error(usage, 1).await;
    }
    let mut separator = "\n".to_string();
    let mut terminator = String::new();
    let mut idx = 0;
    let args = b.args.clone();
    while idx < args.len() {
        let arg = args[idx].as_str();
        if arg == "-s" || arg == "--separator" {
            idx += 1;
            if idx >= args.len() {
                return b
                    .write_failing_error("seq: option requires an argument -- s\n", 1)
                    .await;
            }
            separator = args[idx].clone();
            idx += 1;
        } else if arg.starts_with("-s") && arg.len() > 2 {
            separator = arg[2..].to_string();
            idx += 1;
        } else if arg == "-t" || arg == "--terminator" {
            idx += 1;
            if idx >= args.len() {
                return b
                    .write_failing_error("seq: option requires an argument -- t\n", 1)
                    .await;
            }
            terminator = args[idx].clone();
            idx += 1;
        } else if arg.starts_with("-t") && arg.len() > 2 {
            terminator = arg[2..].to_string();
            idx += 1;
        } else if arg == "-w" || arg == "--fixed-width" {
            idx += 1;
        } else {
            break;
        }
    }
    if idx >= args.len() {
        return b.write_failing_error(usage, 1).await;
    }
    let mut nums = Vec::with_capacity(3);
    for arg in args[idx..].iter().take(3) {
        match parse_f32(arg) {
            Some(n) => nums.push(n),
            None => return b.write_failing_error("seq: invalid argument\n", 1).await,
        }
    }
    let mut start: f32 = 1.0;
    let mut end = nums[0];
    let mut incr: f32 = if start > end { -1.0 } else { 1.0 };
    if nums.len() >= 2 {
        start = nums[0];
        end = nums[1];
        if start < end {
            incr = 1.0;
        } else if start > end {
            incr = -1.0;
        }
    }
    if nums.len() == 3 {
        (start, incr, end) = (nums[0], nums[1], nums[2]);
        if incr == 0.0 {
            return b.write_failing_error("seq: zero increment\n", 1).await;
        }
        if start > end && incr > 0.0 {
            return b
                .write_failing_error("seq: needs negative decrement\n", 1)
                .await;
        }
        if start < end && incr < 0.0 {
            return b
                .write_failing_error("seq: needs positive increment\n", 1)
                .await;
        }
    }
    let mut out = String::new();
    let mut current = start;
    while if incr > 0.0 {
        current <= end
    } else {
        current >= end
    } {
        out.push_str(&format_f32(current));
        out.push_str(&separator);
        let next = current + incr;
        if next == current {
            break;
        }
        current = next;
    }
    out.push_str(&terminator);
    match b.write(Which::Stdout, out).await {
        Err(_) if b.needs_io(Which::Stdout) => 1,
        _ => 0,
    }
}

pub(super) async fn which(b: &mut Builtin<'_>) -> i32 {
    if b.args.is_empty() {
        let _ = b.write(Which::Stdout, "\n").await;
        return 1;
    }
    let path_env = b.shell.export_env.get("PATH").unwrap_or("").to_string();
    let io = matches!(b.stdout, BuiltinOut::Fd { .. });
    let mut had_not_found = false;
    for arg in b.args.clone() {
        let line = match builtin::which(&path_env, &b.shell.cwd, &arg) {
            Some(resolved) => format!("{resolved}\n"),
            None => {
                had_not_found = true;
                if io {
                    format!("{arg} not found\n")
                } else {
                    b.fmt_err(&format!("{arg} not found\n"))
                }
            }
        };
        if let Err(e) = b.write(Which::Stdout, line).await {
            if io {
                return e.errno;
            }
        }
    }
    i32::from(had_not_found)
}

#[cfg(test)]
mod tests;
