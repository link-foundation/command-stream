use crate::{CommandContext, CommandResult, VirtualUtils};
use regex::{Regex, RegexBuilder};
use std::path::{Path, PathBuf};

pub(super) async fn run(command: &str, context: CommandContext) -> CommandResult {
    let result = match command {
        "find" => find(&context),
        "grep" => grep(&context),
        "sed" => sed(&context),
        "ln" => link(&context),
        "chmod" => chmod(&context),
        _ => unreachable!(),
    };
    match result {
        Ok(output) => CommandResult::success(output),
        Err(error) => CommandResult::error(format!("{command}: {error}\n")),
    }
}

type ExtraResult = std::result::Result<String, Box<dyn std::error::Error + Send + Sync>>;
fn path(value: &str, ctx: &CommandContext) -> PathBuf {
    VirtualUtils::resolve_path(value, Some(&ctx.get_cwd()))
}
fn operands(ctx: &CommandContext) -> (String, Vec<&str>) {
    if ctx
        .args
        .first()
        .is_some_and(|value| value.starts_with('-') && value != "-")
    {
        (
            ctx.args[0].clone(),
            ctx.args.iter().skip(1).map(String::as_str).collect(),
        )
    } else {
        (String::new(), ctx.args.iter().map(String::as_str).collect())
    }
}

fn walk(actual: &Path, display: &Path, output: &mut Vec<String>) -> std::io::Result<()> {
    output.push(display.display().to_string());
    if actual.symlink_metadata()?.file_type().is_dir() {
        let mut entries = std::fs::read_dir(actual)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            walk(&entry.path(), &display.join(entry.file_name()), output)?;
        }
    }
    Ok(())
}
fn find(ctx: &CommandContext) -> ExtraResult {
    if ctx.args.is_empty() {
        return Err("no paths given".into());
    }
    let mut output = Vec::new();
    for file in &ctx.args {
        walk(&path(file, ctx), Path::new(file), &mut output)?;
    }
    Ok(format!("{}\n", output.join("\n")))
}
fn grep(ctx: &CommandContext) -> ExtraResult {
    let (flags, args) = operands(ctx);
    if flags.chars().any(|flag| !"-ivnl".contains(flag)) {
        return Err("unsupported option".into());
    }
    let Some(pattern) = args.first() else {
        return Err("missing pattern".into());
    };
    let regex = RegexBuilder::new(pattern)
        .case_insensitive(flags.contains('i'))
        .build()?;
    let files = &args[1..];
    let mut output = String::new();
    for file in files {
        let text = std::fs::read_to_string(path(file, ctx))?;
        for (index, line) in text.split_inclusive('\n').enumerate() {
            if regex.is_match(line.trim_end_matches('\n')) != flags.contains('v') {
                if flags.contains('l') {
                    output.push_str(&format!("{file}\n"));
                    break;
                }
                if flags.contains('n') {
                    output.push_str(&format!("{}:", index + 1));
                }
                output.push_str(line);
                if !line.ends_with('\n') {
                    output.push('\n');
                }
            }
        }
    }
    Ok(output)
}
fn sed(ctx: &CommandContext) -> ExtraResult {
    let (flags, args) = operands(ctx);
    if flags.chars().any(|flag| !"-ig".contains(flag)) {
        return Err("unsupported option".into());
    }
    if args.len() < 3 {
        return Err("expected pattern, replacement and file".into());
    }
    let regex = Regex::new(args[0])?;
    let mut output = String::new();
    for file in &args[2..] {
        let source = std::fs::read_to_string(path(file, ctx))?;
        let replaced = source
            .split_inclusive('\n')
            .map(|line| {
                if flags.contains('g') {
                    regex.replace_all(line, args[1]).into_owned()
                } else {
                    regex.replacen(line, 1, args[1]).into_owned()
                }
            })
            .collect::<String>();
        if flags.contains('i') {
            std::fs::write(path(file, ctx), &replaced)?;
        }
        output.push_str(&replaced);
    }
    Ok(output)
}
fn link(ctx: &CommandContext) -> ExtraResult {
    let (flags, args) = operands(ctx);
    if flags.chars().any(|flag| !"-sf".contains(flag)) {
        return Err("unsupported option".into());
    }
    if args.len() != 2 {
        return Err("expected source and destination".into());
    }
    let source = path(args[0], ctx);
    let mut destination = path(args[1], ctx);
    if destination.is_dir() {
        destination = destination.join(Path::new(args[0]).file_name().ok_or("invalid source")?);
    }
    if flags.contains('f') && destination.symlink_metadata().is_ok() {
        std::fs::remove_file(&destination)?;
    }
    if flags.contains('s') {
        #[cfg(unix)]
        std::os::unix::fs::symlink(args[0], destination)?;
        #[cfg(windows)]
        {
            if source.is_dir() {
                std::os::windows::fs::symlink_dir(args[0], destination)?;
            } else {
                std::os::windows::fs::symlink_file(args[0], destination)?;
            }
        }
    } else {
        std::fs::hard_link(source, destination)?;
    }
    Ok(String::new())
}
fn chmod(ctx: &CommandContext) -> ExtraResult {
    let (flags, args) = operands(ctx);
    if flags.chars().any(|flag| !"-R".contains(flag)) {
        return Err("unsupported option".into());
    }
    if args.len() < 2 {
        return Err("expected octal mode and file".into());
    }
    let mode = u32::from_str_radix(args[0], 8)?;
    if mode > 0o7777 {
        return Err("invalid octal mode".into());
    }
    for file in &args[1..] {
        let mut paths = Vec::new();
        let actual = path(file, ctx);
        if flags.contains('R') {
            walk(&actual, &actual, &mut paths)?;
        } else {
            paths.push(actual.display().to_string());
        }
        for target in paths {
            let mut permissions = std::fs::metadata(&target)?.permissions();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                permissions.set_mode(mode);
            }
            #[cfg(windows)]
            permissions.set_readonly(mode & 0o200 == 0);
            std::fs::set_permissions(target, permissions)?;
        }
    }
    Ok(String::new())
}
