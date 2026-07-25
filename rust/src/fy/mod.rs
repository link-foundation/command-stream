//! `$fy`: rule-based translation of shell scripts into command-stream modules.
//!
//! The pipeline has two halves, exactly as link-foundation/meta-language models
//! translation:
//!
//!   1. Formalize:  shell source -> links network   ([`formalizer`])
//!   2. Substitute: links network -> JavaScript     ([`rules`] + [`engine`])
//!
//! Step 2 contains no shell knowledge beyond the rule table, and step 1
//! contains no JavaScript knowledge at all.

pub mod engine;
pub mod formalizer;
pub mod lexer;
pub mod parser;
pub mod rules;
pub mod word_expander;

use std::collections::HashSet;

use engine::RuleEngine;
use formalizer::{formalize_shell, DeclaredNames};
use rules::{build_rule_set, language_fallbacks, modes, TARGET};

/// Terms whose presence requires `const args = process.argv.slice(2)`.
const ARGUMENT_TERMS: [&str; 3] = ["positional", "all-arguments", "argument-count"];

/// Options for [`translate_shell_to_mjs`].
#[derive(Debug, Clone)]
pub struct TranslateOptions {
    /// Emit a `#!/usr/bin/env node` line.
    pub shebang: bool,
    /// Module to import `$` from.
    pub module_name: String,
}

impl Default for TranslateOptions {
    fn default() -> Self {
        TranslateOptions {
            shebang: true,
            module_name: "command-stream".to_string(),
        }
    }
}

/// A translated module.
#[derive(Debug, Clone)]
pub struct Translation {
    /// `preamble` followed by `body`.
    pub code: String,
    pub preamble: String,
    pub body: String,
    /// Constructs the rule set could not translate.
    pub diagnostics: Vec<String>,
}

/// Builds the module header the translated statements need.
fn build_preamble(
    terms: &HashSet<String>,
    names: &DeclaredNames,
    options: &TranslateOptions,
) -> String {
    let mut imports = vec!["$"];
    if terms.contains("set-option") {
        imports.push("shell");
    }

    let mut lines: Vec<String> = Vec::new();
    if options.shebang {
        lines.push("#!/usr/bin/env node".to_string());
    }
    lines.push(format!(
        "import {{ {} }} from '{}';",
        imports.join(", "),
        options.module_name
    ));
    lines.push(String::new());

    if ARGUMENT_TERMS.iter().any(|term| terms.contains(*term)) {
        lines.push("const args = process.argv.slice(2);".to_string());
    }
    if terms.contains("exit-status") {
        lines.push("let exitCode = 0;".to_string());
    }
    // Shell variables have no block scope, so every non-`local` binding is
    // hoisted to the top of the module rather than declared at its first
    // assignment (which would break on reassignment inside a loop or branch).
    let hoisted = names.hoisted();
    if !hoisted.is_empty() {
        lines.push(format!("let {};", hoisted.join(", ")));
    }
    if lines.last().is_some_and(|line| !line.is_empty()) {
        lines.push(String::new());
    }
    // The trailing empty entry plus this newline separate the preamble from the
    // first translated statement by exactly one blank line.
    format!("{}\n", lines.join("\n"))
}

/// Collapses runs of three or more newlines into a blank line.
fn collapse_blank_lines(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut newlines = 0usize;
    for character in text.chars() {
        if character == '\n' {
            newlines += 1;
            if newlines > 2 {
                continue;
            }
        } else {
            newlines = 0;
        }
        output.push(character);
    }
    output
}

/// Translates a shell script into a command-stream ES module.
pub fn translate_shell_to_mjs(source: &str, options: &TranslateOptions) -> Translation {
    // A shell script checked out with CRLF endings is still a shell script:
    // `\r` is not a token, so it is dropped before anything else looks at the
    // text.
    let normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    let source = normalized.as_str();
    // A `#!/bin/sh` line selects the interpreter for the *shell* script; the
    // translated module gets its own shebang from `build_preamble`.
    let script = match source.strip_prefix("#!") {
        Some(rest) => rest.split_once('\n').map_or("", |(_, rest)| rest),
        None => source,
    };

    let formalization = formalize_shell(script);
    let rule_set = build_rule_set(formalization.terms.contains("exit-status"));
    let mut engine = RuleEngine::new(
        &formalization.network,
        &rule_set,
        TARGET,
        language_fallbacks(),
        modes(),
    );

    let rendered = engine.render_root(formalization.root);
    let body = format!("{}\n", collapse_blank_lines(&rendered).trim_end());
    let preamble = build_preamble(&formalization.terms, &formalization.names, options);

    Translation {
        code: format!("{preamble}{body}"),
        preamble,
        body,
        diagnostics: engine.report(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn translate(source: &str) -> Translation {
        translate_shell_to_mjs(source, &TranslateOptions::default())
    }

    #[test]
    fn translates_a_command_into_an_awaited_template_literal() {
        let translation = translate("ls -la\n");
        assert_eq!(translation.body, "await $`ls -la`;\n");
        assert!(translation.diagnostics.is_empty());
    }

    #[test]
    fn emits_a_preamble_with_the_import_and_hoisted_bindings() {
        let translation = translate("NAME=world\necho $NAME\n");
        assert!(translation
            .preamble
            .starts_with("#!/usr/bin/env node\nimport { $ } from 'command-stream';"));
        assert!(translation.preamble.contains("let NAME;"));
        assert!(translation.body.contains("NAME = `world`;"));
        assert!(translation.body.contains("await $`echo ${NAME}`;"));
    }

    #[test]
    fn translates_control_flow_into_javascript_control_flow() {
        let translation = translate("if [ -f x ]; then\n  echo yes\nelse\n  echo no\nfi\n");
        assert!(translation
            .body
            .contains("if ((await $`[ -f x ]`).code === 0) {"));
        assert!(translation.body.contains("} else {"));
    }

    #[test]
    fn translates_a_for_loop_and_a_pipeline() {
        let translation = translate("for i in a b; do\n  echo $i | tr a-z A-Z\ndone\n");
        assert!(translation.body.contains("for (const i of [`a`, `b`]) {"));
        assert!(translation
            .body
            .contains("await $`echo ${i} | tr a-z A-Z`;"));
    }

    #[test]
    fn tracks_the_exit_code_only_when_the_script_reads_it() {
        let plain = translate("false\n");
        assert!(!plain.body.contains("exitCode"));

        let tracked = translate("false\necho $?\n");
        assert!(tracked.preamble.contains("let exitCode = 0;"));
        assert!(tracked.body.contains("exitCode = (await $`false`).code;"));
    }

    #[test]
    fn maps_expansions_onto_javascript_expressions() {
        let translation = translate("echo \"$1 $# ${HOME}\"\n");
        assert!(translation.body.contains("${args[0]}"));
        assert!(translation.body.contains("${args.length}"));
        assert!(translation.body.contains("${process.env.HOME}"));
    }

    #[test]
    fn keeps_comments_and_drops_the_source_shebang() {
        let translation = translate("#!/bin/sh\n# note\nls\n");
        assert_eq!(translation.body, "// note\nawait $`ls`;\n");
    }

    #[test]
    fn translates_a_script_with_crlf_line_endings() {
        let translation = translate("ls\r\necho hi\r\n");
        assert_eq!(translation.body, "await $`ls`;\nawait $`echo hi`;\n");
        assert!(translation.diagnostics.is_empty());
    }

    #[test]
    fn honours_the_options() {
        let translation = translate_shell_to_mjs(
            "ls\n",
            &TranslateOptions {
                shebang: false,
                module_name: "../src/index.mjs".to_string(),
            },
        );
        assert!(!translation.preamble.contains("#!"));
        assert!(translation.preamble.contains("from '../src/index.mjs';"));
    }
}
