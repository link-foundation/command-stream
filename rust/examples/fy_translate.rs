//! Translates a shell script into a command-stream module with `$fy`.
//!
//! ```sh
//! cargo run --example fy_translate -- ../fixtures/fy/sample.sh
//! ```
//!
//! The translation is rule-based: the script is first formalized as a
//! link-foundation/meta-language links network, then rewritten into JavaScript
//! by a `TranslationRuleSet`. Diagnostics for untranslated constructs go to
//! stderr, so the stdout stream is exactly the translated module.

use command_stream::fy::{translate_shell_to_mjs, TranslateOptions};

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: fy_translate <script.sh>");
        std::process::exit(1);
    };

    let source = match std::fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("cannot read '{path}': {error}");
            std::process::exit(1);
        }
    };

    let translation = translate_shell_to_mjs(&source, &TranslateOptions::default());
    print!("{}", translation.code);
    for diagnostic in &translation.diagnostics {
        eprintln!("$fy: warning: {diagnostic}");
    }
}
