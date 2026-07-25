//! The Shell -> JavaScript substitution rules.
//!
//! Every construct the formalizer can produce has exactly one
//! `TranslationRule` here: a `LinkQuery` selecting the links it owns, plus one
//! template per target language. Nothing about the translation lives outside
//! this file — [`super::engine`] only walks the network and substitutes.
//!
//! Four target languages express the four contexts a node can appear in:
//!
//! | language                | context             | example                |
//! |-------------------------|---------------------|------------------------|
//! | `JavaScript`            | a statement         | ``await $`ls`;``       |
//! | `JavaScript:command`    | text inside ``$`…```| `ls`                   |
//! | `JavaScript:value`      | text inside `` `…` `` | `ls` without quoting |
//! | `JavaScript:expression` | a JavaScript value  | `process.env.HOME`     |
//!
//! Placeholder syntax is documented in [`super::engine`].

use std::collections::HashMap;

use meta_language::link_network::LinkType;
use meta_language::query::LinkQuery;
use meta_language::translation_rules::{TranslationRule, TranslationRuleSet};

use super::engine::Mode;
use super::formalizer::SHELL_LANGUAGE;

pub const TARGET: &str = "JavaScript";
pub const COMMAND: &str = "JavaScript:command";
pub const VALUE: &str = "JavaScript:value";
pub const EXPRESSION: &str = "JavaScript:expression";

/// A `:value` rendering falls back to the `:command` one when unquoting is a no-op.
pub fn language_fallbacks() -> HashMap<String, Vec<String>> {
    HashMap::from([(VALUE.to_string(), vec![COMMAND.to_string()])])
}

/// `set -e` and friends map onto `shell.set('e')`.
const SET_FLAGS: [&str; 3] = ["e", "v", "x"];

/// Escapes text so it survives inside a JavaScript template literal.
fn escape_template(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '`' | '\\' => {
                escaped.push('\\');
                escaped.push(character);
            }
            '$' if characters.peek() == Some(&'{') => {
                escaped.push_str("\\$");
            }
            _ => escaped.push(character),
        }
    }
    escaped
}

/// Removes the shell quoting from a literal.
///
/// Quotes are meaningful to the shell (word splitting, globbing) so they are
/// kept in `:command` context, but a JavaScript value must not contain them.
fn strip_shell_quotes(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut output = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0usize;

    while index < characters.len() {
        let character = characters[index];
        if character == '\\' && quote != Some('\'') {
            if let Some(&next) = characters.get(index + 1) {
                output.push(next);
            }
            index += 2;
            continue;
        }
        if quote.is_none() && (character == '"' || character == '\'') {
            quote = Some(character);
            index += 1;
            continue;
        }
        if Some(character) == quote {
            quote = None;
            index += 1;
            continue;
        }
        output.push(character);
        index += 1;
    }
    output
}

fn quote_json(text: &str) -> String {
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn as_string(text: &str) -> String {
    format!("`{text}`")
}

fn as_unquoted(text: &str) -> String {
    escape_template(&strip_shell_quotes(text))
}

fn as_flag(text: &str) -> String {
    let letter = text.trim_start_matches('-');
    if SET_FLAGS.contains(&letter) {
        quote_json(letter)
    } else {
        quote_json(text)
    }
}

/// Placeholder modes available to the templates below.
pub fn modes() -> HashMap<String, Mode> {
    let mode = |language: Option<&str>, transform: Option<fn(&str) -> String>| Mode {
        language: language.map(str::to_string),
        transform,
    };
    HashMap::from([
        // Raw shell source text of the captured link.
        ("text".to_string(), mode(None, None)),
        // The captured link rendered as shell command text.
        ("command".to_string(), mode(Some(COMMAND), None)),
        // The captured link rendered as an unquoted value.
        ("value".to_string(), mode(Some(VALUE), None)),
        // The captured link rendered as a JavaScript expression.
        ("expr".to_string(), mode(Some(EXPRESSION), None)),
        // The captured link as a JavaScript string (a template literal).
        ("string".to_string(), mode(Some(VALUE), Some(as_string))),
        // Literal source text, escaped for a template literal.
        ("literal".to_string(), mode(None, Some(escape_template))),
        // Literal source text with shell quoting removed.
        ("unquoted".to_string(), mode(None, Some(as_unquoted))),
        // A `set` operand such as `-e`, as a `shell.set` argument.
        ("flag".to_string(), mode(None, Some(as_flag))),
    ])
}

fn syntax(term: &str) -> LinkQuery {
    LinkQuery::new()
        .with_link_type(LinkType::Syntax)
        .with_language(SHELL_LANGUAGE)
        .with_term(term)
}

/// Declares one rule: the node term it owns, its capture name -> reference
/// index bindings, and one template per target language.
fn rule(term: &str, captures: &[(&str, usize)], templates: &[(&str, &str)]) -> TranslationRule {
    let mut created = TranslationRule::new(term, syntax(term));
    for (name, index) in captures {
        created = created.with_reference_capture(*name, *index);
    }
    for (language, text) in templates {
        created = created.with_template(*language, *text);
    }
    created
}

/// A word expansion: one JavaScript expression, interpolated in command text.
fn expansion(term: &str, expression: &str) -> TranslationRule {
    // `{{`/`}}` are literal braces, so this emits `${<expression>}`.
    let interpolated = format!("${{{{{expression}}}}}");
    rule(
        term,
        &[("name", 0)],
        &[
            (COMMAND, interpolated.as_str()),
            (VALUE, interpolated.as_str()),
            (EXPRESSION, expression),
        ],
    )
}

/// Builds the Shell -> JavaScript rule set.
///
/// `track_exit_code` emits `exitCode = ...` for each command, which is only
/// needed when the script reads `$?`.
pub fn build_rule_set(track_exit_code: bool) -> TranslationRuleSet {
    let run_command = if track_exit_code {
        "exitCode = (await $`{.:command}`).code;"
    } else {
        "await $`{.:command}`;"
    };

    let mut rule_set = TranslationRuleSet::new("shell-to-javascript");
    for created in structure_rules(run_command)
        .into_iter()
        .chain(control_flow_rules())
        .chain(declaration_rules())
        .chain(expansion_rules())
    {
        rule_set.add_rule(created);
    }
    rule_set
}

/// Script structure, commands, pipelines and the `&&`/`||` operators.
fn structure_rules(run_command: &str) -> Vec<TranslationRule> {
    vec![
        // ---- Script structure ----------------------------------------------
        rule(
            "script",
            &[],
            &[(TARGET, "{*.|\\n}"), (COMMAND, "{*.:command|; }")],
        ),
        rule(
            "block",
            &[],
            &[(TARGET, "{*.|\\n}"), (COMMAND, "{*.:command|; }")],
        ),
        rule("blank", &[], &[(TARGET, "")]),
        rule("comment", &[("body", 0)], &[(TARGET, "// {body:text}")]),
        // ---- Commands -------------------------------------------------------
        rule(
            "command",
            &[("words", 0), ("redirects", 1), ("prefix", 2)],
            &[
                (TARGET, run_command),
                (
                    COMMAND,
                    "{?prefix}{prefix:command} {/prefix}{words:command}{redirects:command}",
                ),
            ],
        ),
        rule("word-list", &[], &[(COMMAND, "{*.:command| }")]),
        rule("redirect-list", &[], &[(COMMAND, "{*.:command}")]),
        rule(
            "redirect",
            &[("operator", 0), ("target", 1)],
            &[(COMMAND, " {operator:text}{target:command}")],
        ),
        rule("assignment-list", &[], &[(COMMAND, "{*.:command| }")]),
        rule(
            "word",
            &[],
            &[(COMMAND, "{*.:command}"), (VALUE, "{*.:value}")],
        ),
        rule(
            "pipeline",
            &[],
            &[(TARGET, run_command), (COMMAND, "{*.:command| | }")],
        ),
        rule(
            "subshell",
            &[("body", 0)],
            &[(TARGET, run_command), (COMMAND, "({body:command})")],
        ),
        // ---- Operators ------------------------------------------------------
        // `a && b` is a conditional, not a boolean expression: `b` runs only
        // when `a` exits zero. In command position the shell operator is kept.
        rule(
            "and",
            &[("left", 0), ("right", 1)],
            &[
                (
                    TARGET,
                    "if ((await $`{left:command}`).code === 0) {\n  {right}\n}",
                ),
                (COMMAND, "{left:command} && {right:command}"),
            ],
        ),
        rule(
            "or",
            &[("left", 0), ("right", 1)],
            &[
                (
                    TARGET,
                    "if ((await $`{left:command}`).code !== 0) {\n  {right}\n}",
                ),
                (COMMAND, "{left:command} || {right:command}"),
            ],
        ),
    ]
}

/// `if`, loops, `case` and function definitions.
fn control_flow_rules() -> Vec<TranslationRule> {
    vec![
        rule(
            "if",
            &[("condition", 0), ("consequent", 1), ("alternative", 2)],
            &[(
                TARGET,
                concat!(
                    "if ((await $`{condition:command}`).code === 0) {\n  {consequent}\n}",
                    "{?alternative} else {\n  {alternative}\n}{/alternative}"
                ),
            )],
        ),
        rule(
            "while",
            &[("condition", 0), ("body", 1)],
            &[(
                TARGET,
                "while ((await $`{condition:command}`).code === 0) {\n  {body}\n}",
            )],
        ),
        rule(
            "until",
            &[("condition", 0), ("body", 1)],
            &[(
                TARGET,
                "while ((await $`{condition:command}`).code !== 0) {\n  {body}\n}",
            )],
        ),
        rule(
            "for",
            &[("name", 0), ("items", 1), ("body", 2)],
            &[(
                TARGET,
                "for (const {name:text} of [{*items:string|, }]) {\n  {body}\n}",
            )],
        ),
        rule(
            "case",
            &[("subject", 0), ("branches", 1)],
            &[(TARGET, "switch ({subject:string}) {\n  {*branches|\n  }\n}")],
        ),
        rule(
            "case-branch",
            &[("patterns", 0), ("body", 1)],
            &[(TARGET, "{patterns}\n  {body}\n  break;")],
        ),
        rule("pattern-list", &[], &[(TARGET, "{*.|\\n}")]),
        rule(
            "pattern",
            &[("name", 0)],
            &[(TARGET, "case {name:string}:")],
        ),
        // `*` is the shell's catch-all pattern.
        rule("pattern-default", &[], &[(TARGET, "default:")]),
        rule(
            "function",
            &[("name", 0), ("body", 1)],
            &[(TARGET, "async function {name:text}(...args) {\n  {body}\n}")],
        ),
        rule(
            "name",
            &[("name", 0)],
            &[(TARGET, "{name:text}"), (COMMAND, "{name:text}")],
        ),
    ]
}

/// Assignments, `export`/`local`, and the shell builtins with a JS equivalent.
fn declaration_rules() -> Vec<TranslationRule> {
    vec![
        rule(
            "assignment",
            &[("name", 0), ("value", 1)],
            &[(TARGET, "{name:text} = {value:string};")],
        ),
        rule(
            "local",
            &[("name", 0), ("value", 1)],
            &[(TARGET, "let {name:text} = {value:string};")],
        ),
        rule(
            "export",
            &[("name", 0), ("value", 1)],
            &[(TARGET, "process.env.{name:text} = {value:string};")],
        ),
        rule("set-option", &[], &[(TARGET, "shell.set({*.:flag|, });")]),
        rule("exit", &[], &[(TARGET, "process.exit({*.:value|});")]),
        rule(
            "return",
            &[("first", 0)],
            &[(TARGET, "return{?first} {first:string}{/first};")],
        ),
        rule(
            "source",
            &[("file", 0)],
            &[(TARGET, "await import({file:string});")],
        ),
    ]
}

/// The leaves produced by the word expander.
fn expansion_rules() -> Vec<TranslationRule> {
    vec![
        rule(
            "literal",
            &[("name", 0)],
            &[
                (COMMAND, "{name:literal}"),
                (VALUE, "{name:unquoted}"),
                (EXPRESSION, "{name:string}"),
            ],
        ),
        expansion("variable", "{name:text}"),
        expansion("env-variable", "process.env.{name:text}"),
        expansion("positional", "args[{name:text}]"),
        expansion("script-name", "process.argv[1]"),
        expansion("all-arguments", "args.join(' ')"),
        expansion("argument-count", "args.length"),
        expansion("exit-status", "exitCode"),
        expansion("process-id", "process.pid"),
        rule(
            "default-expansion",
            &[("name", 0), ("value", 1), ("fallback", 2)],
            &[
                (COMMAND, "${{{value:expr} ?? {fallback:string}}}"),
                (VALUE, "${{{value:expr} ?? {fallback:string}}}"),
                (EXPRESSION, "({value:expr} ?? {fallback:string})"),
            ],
        ),
        rule(
            "substitution",
            &[("body", 0)],
            &[
                (COMMAND, "${{(await $`{body:command}`).stdout.trim()}}"),
                (VALUE, "${{(await $`{body:command}`).stdout.trim()}}"),
                (EXPRESSION, "(await $`{body:command}`).stdout.trim()"),
            ],
        ),
        // Anything the expander could not classify stays a shell expansion: the
        // escaped `\${...}` reaches command-stream's shell verbatim rather than
        // being silently mistranslated.
        rule(
            "unsupported-expansion",
            &[("name", 0)],
            &[
                (COMMAND, "\\${{{name:text}}}"),
                (VALUE, "\\${{{name:text}}}"),
            ],
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_template_literal_syntax() {
        assert_eq!(escape_template("a`b"), "a\\`b");
        assert_eq!(escape_template("${x}"), "\\${x}");
    }

    #[test]
    fn strips_shell_quoting() {
        assert_eq!(strip_shell_quotes("\"hi there\""), "hi there");
        assert_eq!(strip_shell_quotes("'a\\b'"), "a\\b");
    }

    #[test]
    fn maps_set_flags() {
        assert_eq!(as_flag("-e"), "\"e\"");
        assert_eq!(as_flag("-o"), "\"-o\"");
    }

    #[test]
    fn every_rule_is_uniquely_named() {
        let rule_set = build_rule_set(false);
        let mut names: Vec<&str> = rule_set.rules().iter().map(TranslationRule::name).collect();
        let count = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), count);
    }
}
