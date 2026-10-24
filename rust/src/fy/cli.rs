//! Shared options for the virtual command and the native CLI.
use super::SourceOptions;

pub const USAGE: &str = "$fy - Convert shell scripts and competitor source to command-stream modules\n\nUsage: $fy [options] [input.sh|input.mjs|input.cjs|-] [output.mjs]\nRead stdin when no input is given or input is -; print unless output is given.\n\n  --from shell|javascript|zx|execa|shelljs|cross-spawn|bun\n  --shell sh|bash|dash|zsh    Interpreter (default: shebang or sh)\n  --module NAME             Target package (default: command-stream)\n  --no-use-m                Import the installed package directly\n  --no-shebang              Omit the generated interpreter line\n  --commonjs                Wrap CommonJS source as an ES module\n  --structural              Compile the supported shell subset to JS statements\n  -h, --help                Show this help\n\nShell programs use command-stream + use-m and retain shell semantics.\nJavaScript imports migrate to command-stream compatibility APIs.\nOutput files must not already exist.\n";

#[derive(Default)]
pub struct Arguments {
    pub options: SourceOptions,
    pub positional: Vec<String>,
    pub structural: bool,
    pub help: bool,
}

pub fn parse_arguments(args: &[String]) -> Result<Arguments, String> {
    let mut result = Arguments::default();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" => {
                result.positional.extend(args.cloned());
                break;
            }
            "--from" | "--shell" | "--module" => {
                let value = args
                    .next()
                    .filter(|value| !value.starts_with("--") && !value.is_empty())
                    .ok_or_else(|| format!("Missing value for {arg}"))?;
                match arg.as_str() {
                    "--from" => result.options.from.clone_from(value),
                    "--shell" => result.options.shell = Some(value.clone()),
                    _ => result.options.module_name.clone_from(value),
                }
            }
            "--no-use-m" => result.options.use_m = false,
            "--no-shebang" => result.options.shebang = false,
            "--commonjs" => result.options.commonjs = true,
            "--structural" => result.structural = true,
            "--help" | "-h" => result.help = true,
            "-" => result.positional.push(arg.clone()),
            value if value.starts_with('-') => return Err(format!("Unknown option: {value}")),
            _ => result.positional.push(arg.clone()),
        }
    }
    if result.positional.len() > 2 {
        return Err("Expected input and optional output filename".into());
    }
    result.options.filename = result.positional.first().cloned().unwrap_or_default();
    Ok(result)
}
