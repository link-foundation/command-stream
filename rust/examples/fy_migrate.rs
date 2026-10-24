//! `cargo run --example fy_migrate` prints migrated automation source.
use command_stream::fy::{translate_source, SourceOptions};

fn main() -> Result<(), String> {
    let source = "import { $ } from 'zx';\nconst branch = (await $`git branch --show-current`).text().trim();\nconsole.log(branch);\n";
    let translated = translate_source(
        source,
        &SourceOptions {
            from: "zx".into(),
            ..Default::default()
        },
    )?;
    print!("{}", translated.code);
    for diagnostic in translated.diagnostics {
        eprintln!("{diagnostic}");
    }
    Ok(())
}
