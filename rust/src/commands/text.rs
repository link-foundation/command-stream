//! Portable UTF-8 text commands. Input is read a line at a time; head stops
//! early, tail keeps a ring of the last N lines, and uniq keeps one group.
//! Sort necessarily retains the complete input. Output channels are progressive.
use super::{CommandContext, StreamChunk};
use crate::{trace, CommandResult, VirtualUtils};
use std::collections::{HashSet, VecDeque};
use std::io::Cursor;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};

type TextResult<T> = std::result::Result<T, CommandResult>;

struct Options {
    count: usize,
    flags: HashSet<char>,
    files: Vec<String>,
}

fn failure(command: &str, message: impl std::fmt::Display) -> CommandResult {
    CommandResult::error(format!("{command}: {message}\n"))
}

fn cancelled(command: &str, ctx: &CommandContext) -> TextResult<()> {
    if ctx.is_cancelled() {
        Err(CommandResult::error_with_code(
            format!("{command}: cancelled\n"),
            130,
        ))
    } else {
        Ok(())
    }
}

fn parse_count(command: &str, value: Option<&str>) -> TextResult<usize> {
    let value = value.unwrap_or("");
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(failure(
            command,
            format!("invalid number of lines: '{value}'"),
        ));
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|number| *number <= 9_007_199_254_740_991)
        .and_then(|number| usize::try_from(number).ok())
        .ok_or_else(|| failure(command, format!("invalid number of lines: '{value}'")))
}

fn flags(command: &str, value: &str, output: &mut HashSet<char>) -> TextResult<()> {
    let value = match value {
        "--reverse" => "r",
        "--numeric-sort" => "n",
        "--unique" => "u",
        "--count" => "c",
        "--repeated" => "d",
        "--ignore-case" => "i",
        _ => &value[1..],
    };
    let allowed = if command == "sort" { "rnu" } else { "cdui" };
    for flag in value.chars() {
        if !allowed.contains(flag) {
            return Err(failure(command, format!("invalid option '{value}'")));
        }
        output.insert(flag);
    }
    Ok(())
}

fn parse(command: &str, args: &[String]) -> TextResult<Options> {
    let mut result = Options {
        count: 10,
        flags: HashSet::new(),
        files: Vec::new(),
    };
    let mut index = 0;
    let mut options = true;
    while index < args.len() {
        let arg = &args[index];
        if options && arg == "--" {
            options = false;
        } else if options && arg.starts_with('-') && arg != "-" {
            if command == "head" || command == "tail" {
                let value = if arg == "-n" || arg == "--lines" {
                    index += 1;
                    args.get(index).map(String::as_str)
                } else if let Some(value) = arg.strip_prefix("--lines=") {
                    Some(value)
                } else {
                    Some(arg.strip_prefix("-n").unwrap_or(&arg[1..]))
                };
                result.count = parse_count(command, value)?;
            } else {
                flags(command, arg, &mut result.flags)?;
            }
        } else {
            result.files.push(arg.clone());
        }
        index += 1;
    }
    if command == "uniq" && result.files.len() > 2 {
        return Err(failure(command, "extra operand"));
    }
    if result.flags.contains(&'d') && result.flags.contains(&'u') {
        return Err(failure(command, "cannot combine -d and -u"));
    }
    Ok(result)
}

async fn input(
    command: &str,
    file: &str,
    ctx: &CommandContext,
) -> TextResult<Box<dyn AsyncBufRead + Send + Unpin>> {
    cancelled(command, ctx)?;
    trace("VirtualCommand", &format!("{command}: reading {file}"));
    if file == "-" {
        return Ok(Box::new(Cursor::new(
            ctx.stdin.clone().unwrap_or_default().into_bytes(),
        )));
    }
    let path = VirtualUtils::resolve_path(file, Some(&ctx.get_cwd()));
    let handle = tokio::fs::File::open(&path)
        .await
        .map_err(|error| failure(command, format!("{file}: {error}")))?;
    if handle
        .metadata()
        .await
        .map_err(|error| failure(command, error))?
        .is_dir()
    {
        return Err(failure(command, format!("{file}: Is a directory")));
    }
    Ok(Box::new(BufReader::new(handle)))
}

async fn next_line(
    command: &str,
    reader: &mut (dyn AsyncBufRead + Send + Unpin),
    ctx: &CommandContext,
) -> TextResult<Option<String>> {
    cancelled(command, ctx)?;
    let mut line = String::new();
    let count = reader
        .read_line(&mut line)
        .await
        .map_err(|error| failure(command, error))?;
    Ok((count > 0).then_some(line))
}

async fn emit(
    command: &str,
    text: &str,
    ctx: &CommandContext,
    output: &mut String,
) -> TextResult<()> {
    cancelled(command, ctx)?;
    if text.is_empty() {
        return Ok(());
    }
    if let Some(sender) = &ctx.output_tx {
        sender
            .send(StreamChunk::Stdout(text.to_string()))
            .await
            .map_err(|_| CommandResult::error_with_code("output closed", 130))?;
    }
    output.push_str(text);
    Ok(())
}

async fn select(command: &str, ctx: &CommandContext, options: &Options) -> TextResult<String> {
    let files = if options.files.is_empty() {
        vec!["-".to_string()]
    } else {
        options.files.clone()
    };
    let mut output = String::new();
    for (index, file) in files.iter().enumerate() {
        let mut reader = input(command, file, ctx).await?;
        if files.len() > 1 {
            let name = if file == "-" { "standard input" } else { file };
            emit(
                command,
                &format!("{}==> {name} <==\n", if index > 0 { "\n" } else { "" }),
                ctx,
                &mut output,
            )
            .await?;
        }
        if command == "head" {
            for _ in 0..options.count {
                let Some(line) = next_line(command, reader.as_mut(), ctx).await? else {
                    break;
                };
                emit(command, &line, ctx, &mut output).await?;
            }
        } else {
            let mut ring = VecDeque::new();
            while let Some(line) = next_line(command, reader.as_mut(), ctx).await? {
                if options.count > 0 {
                    if ring.len() == options.count {
                        ring.pop_front();
                    }
                    ring.push_back(line);
                }
            }
            for line in ring {
                emit(command, &line, ctx, &mut output).await?;
            }
        }
    }
    Ok(output)
}

fn numeric(line: &str) -> f64 {
    static NUMBER: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))").unwrap()
    });
    let value = NUMBER
        .captures(line)
        .and_then(|matches| matches[1].parse().ok())
        .unwrap_or(0.0);
    // Match JavaScript numeric comparison: signed zero shares the same key.
    if value == 0.0 {
        0.0
    } else {
        value
    }
}

async fn sorted(ctx: &CommandContext, options: &Options) -> TextResult<String> {
    let files = if options.files.is_empty() {
        vec!["-".to_string()]
    } else {
        options.files.clone()
    };
    let mut lines = Vec::new();
    for file in files {
        let mut reader = input("sort", &file, ctx).await?;
        while let Some(line) = next_line("sort", reader.as_mut(), ctx).await? {
            lines.push(line.strip_suffix('\n').unwrap_or(&line).to_string());
        }
    }
    lines.sort_by(|left, right| {
        let numeric_order = if options.flags.contains(&'n') {
            numeric(left).total_cmp(&numeric(right))
        } else {
            std::cmp::Ordering::Equal
        };
        numeric_order.then_with(|| left.cmp(right))
    });
    if options.flags.contains(&'r') {
        lines.reverse();
    }
    let mut output = String::new();
    let mut previous: Option<String> = None;
    for line in lines {
        let duplicate = previous.as_ref().is_some_and(|previous| {
            if options.flags.contains(&'n') {
                numeric(previous) == numeric(&line)
            } else {
                previous == &line
            }
        });
        if !options.flags.contains(&'u') || !duplicate {
            emit("sort", &format!("{line}\n"), ctx, &mut output).await?;
        }
        previous = Some(line);
    }
    Ok(output)
}

fn group(line: &str, count: usize, options: &Options) -> String {
    if (options.flags.contains(&'d') && count == 1) || (options.flags.contains(&'u') && count > 1) {
        return String::new();
    }
    if options.flags.contains(&'c') {
        format!("{count:>7} {line}")
    } else {
        line.to_string()
    }
}

async fn write_group(
    text: &str,
    file: &mut Option<tokio::fs::File>,
    ctx: &CommandContext,
    output: &mut String,
) -> TextResult<()> {
    cancelled("uniq", ctx)?;
    if let Some(file) = file {
        file.write_all(text.as_bytes())
            .await
            .map_err(|error| failure("uniq", error))
    } else {
        emit("uniq", text, ctx, output).await
    }
}

async fn unique(ctx: &CommandContext, options: &Options) -> TextResult<String> {
    let mut reader = input(
        "uniq",
        options.files.first().map(String::as_str).unwrap_or("-"),
        ctx,
    )
    .await?;
    let mut file = match options.files.get(1).filter(|path| path.as_str() != "-") {
        Some(path) => Some(
            tokio::fs::File::create(VirtualUtils::resolve_path(path, Some(&ctx.get_cwd())))
                .await
                .map_err(|error| failure("uniq", error))?,
        ),
        None => None,
    };
    let mut output = String::new();
    let mut previous = String::new();
    let mut previous_key = String::new();
    let mut count = 0;
    while let Some(line) = next_line("uniq", reader.as_mut(), ctx).await? {
        let text = line.strip_suffix('\n').unwrap_or(&line);
        let key = if options.flags.contains(&'i') {
            text.to_lowercase()
        } else {
            text.to_string()
        };
        if count > 0 && key != previous_key {
            write_group(
                &group(&previous, count, options),
                &mut file,
                ctx,
                &mut output,
            )
            .await?;
            count = 0;
        }
        if count == 0 {
            previous = line;
            previous_key = key;
        }
        count += 1;
    }
    if count > 0 {
        write_group(
            &group(&previous, count, options),
            &mut file,
            ctx,
            &mut output,
        )
        .await?;
    }
    if let Some(mut file) = file {
        file.flush().await.map_err(|error| failure("uniq", error))?;
    }
    Ok(output)
}

async fn execute(command: &str, ctx: CommandContext) -> CommandResult {
    let result = async {
        let options = parse(command, &ctx.args)?;
        cancelled(command, &ctx)?;
        match command {
            "head" | "tail" => select(command, &ctx, &options).await,
            "sort" => sorted(&ctx, &options).await,
            _ => unique(&ctx, &options).await,
        }
    }
    .await;
    match result {
        Ok(output) => CommandResult::success(output),
        Err(error) => error,
    }
}

/// Show the first N lines (default 10), preserving original line endings.
pub async fn head(ctx: CommandContext) -> CommandResult {
    execute("head", ctx).await
}
/// Show the last N lines (default 10), retaining at most N input lines.
pub async fn tail(ctx: CommandContext) -> CommandResult {
    execute("tail", ctx).await
}
/// Sort complete input using locale-independent UTF-8 byte ordering.
pub async fn sort(ctx: CommandContext) -> CommandResult {
    execute("sort", ctx).await
}
/// Filter consecutive duplicate groups, optionally counting or selecting them.
pub async fn uniq(ctx: CommandContext) -> CommandResult {
    execute("uniq", ctx).await
}
