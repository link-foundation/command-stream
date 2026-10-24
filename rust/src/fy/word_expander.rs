//! Splits a shell word into typed parts so that every leaf of the network is
//! translated by a rule rather than by ad-hoc string surgery.
//!
//! A word such as `"${DIR}/$(basename "$1").log"` becomes:
//!   literal(") variable(DIR) literal(/) substitution(...) literal(.log")

use std::collections::HashSet;

use super::parser::Node;

/// Length of the leading `[A-Za-z_][A-Za-z0-9_]*` run, or 0 when there is none.
fn name_length(text: &[char]) -> usize {
    let Some(&first) = text.first() else {
        return 0;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return 0;
    }
    text.iter()
        .position(|character| !(character.is_ascii_alphanumeric() || *character == '_'))
        .unwrap_or(text.len())
}

/// Length of the parameter a `${...}` body starts with: a name, a positional
/// number, or one of the special parameters.
fn parameter_length(text: &[char]) -> usize {
    let name = name_length(text);
    if name > 0 {
        return name;
    }
    let Some(&first) = text.first() else {
        return 0;
    };
    if first.is_ascii_digit() {
        return text
            .iter()
            .position(|character| !character.is_ascii_digit())
            .unwrap_or(text.len());
    }
    usize::from("@*#?$".contains(first))
}

/// Merges adjacent literal parts so the output stays compact.
fn compact(parts: Vec<Node>) -> Vec<Node> {
    let mut merged: Vec<Node> = Vec::new();
    for part in parts {
        if part.term == "literal" {
            if let Some(previous) = merged.last_mut() {
                if previous.term == "literal" {
                    let text = previous.text.get_or_insert_with(String::new);
                    text.push_str(part.text.as_deref().unwrap_or_default());
                    continue;
                }
            }
        }
        merged.push(part);
    }
    merged.retain(|part| part.term != "literal" || part.text.as_deref() != Some(""));
    merged
}

/// Classifies a `$...` expansion.
///
/// `declared` holds the names the script assigns itself.
fn expansion_node(name: &str, declared: &HashSet<String>) -> Node {
    if !name.is_empty() && name.chars().all(|character| character.is_ascii_digit()) {
        // `$0` is the script itself; `$1` is the first user argument, which is
        // index 0 of `std::env::args().skip(1)`. Doing the renumbering here
        // keeps the translation rules free of arithmetic.
        if name == "0" {
            return Node::leaf("script-name", name);
        }
        let index = name.parse::<u32>().unwrap_or(1).saturating_sub(1);
        return Node::leaf("positional", index.to_string());
    }
    match name {
        "@" | "*" => Node::leaf("all-arguments", name),
        "#" => Node::leaf("argument-count", name),
        "?" => Node::leaf("exit-status", name),
        "$" => Node::leaf("process-id", name),
        // A name the script assigns becomes a binding; anything else can only
        // come from the environment.
        _ => Node::leaf(
            if declared.contains(name) {
                "variable"
            } else {
                "env-variable"
            },
            name,
        ),
    }
}

/// `${NAME}`, `${NAME:-default}` and `${NAME:=default}` are supported directly;
/// anything more exotic is preserved verbatim as an environment lookup so no
/// information is silently dropped.
fn brace_expansion(body: &str, declared: &HashSet<String>) -> Node {
    let characters: Vec<char> = body.chars().collect();
    let name = parameter_length(&characters);
    if name == characters.len() && name > 0 {
        return expansion_node(body, declared);
    }
    // `NAME:-default` / `NAME:=default` / `NAME-default` / `NAME=default`
    if name > 0 {
        let mut cursor = name;
        if characters.get(cursor) == Some(&':') {
            cursor += 1;
        }
        if matches!(characters.get(cursor), Some('-') | Some('=')) {
            let variable: String = characters[..name].iter().collect();
            let fallback: String = characters[cursor + 1..].iter().collect();
            return Node::with_text(
                "default-expansion",
                vec![
                    expansion_node(&variable, declared),
                    Node::leaf("literal", fallback),
                ],
                variable,
            );
        }
    }
    Node::leaf("unsupported-expansion", body)
}

fn matching_delimiter(text: &[char], start: usize, open: char, close: char) -> usize {
    let mut depth = 0usize;
    for (offset, &character) in text[start..].iter().enumerate() {
        if character == open {
            depth += 1;
        } else if character == close {
            depth -= 1;
            if depth == 0 {
                return start + offset;
            }
        }
    }
    text.len()
}

/// Reads the expansion starting at `index`, if there is one.
///
/// Returns the expansion node and the index just past it, or `None` when the
/// character is ordinary text.
fn expansion_at(
    text: &[char],
    index: usize,
    declared: &HashSet<String>,
    parse_substitution: &dyn Fn(&str) -> Node,
) -> Option<(Node, usize)> {
    let character = text[index];

    if character == '`' {
        let close = text[index + 1..]
            .iter()
            .position(|&c| c == '`')
            .map_or(text.len(), |offset| index + 1 + offset);
        let body: String = text[index + 1..close.min(text.len())].iter().collect();
        return Some((
            Node::new("substitution", vec![parse_substitution(&body)]),
            close + 1,
        ));
    }

    if character != '$' {
        return None;
    }

    if text.get(index + 1) == Some(&'(') {
        let close = matching_delimiter(text, index + 1, '(', ')');
        let body: String = text[(index + 2).min(close)..close].iter().collect();
        return Some((
            Node::new("substitution", vec![parse_substitution(&body)]),
            close + 1,
        ));
    }

    if text.get(index + 1) == Some(&'{') {
        let close = matching_delimiter(text, index + 1, '{', '}');
        let body: String = text[(index + 2).min(close)..close].iter().collect();
        return Some((brace_expansion(&body, declared), close + 1));
    }

    let rest = &text[index + 1..];
    let length = name_length(rest);
    if length > 0 {
        let name: String = rest[..length].iter().collect();
        return Some((expansion_node(&name, declared), index + 1 + length));
    }
    let special = *rest.first()?;
    if "@*#?$".contains(special) || special.is_ascii_digit() {
        return Some((expansion_node(&special.to_string(), declared), index + 2));
    }
    None
}

/// Expands a shell word (quotes included) into part nodes.
///
/// `declared` holds the variable names assigned by the script and
/// `parse_substitution` parses the body of a command substitution into a
/// statement node.
pub fn expand_word(
    text: &str,
    declared: &HashSet<String>,
    parse_substitution: &dyn Fn(&str) -> Node,
) -> Vec<Node> {
    let text: Vec<char> = text.chars().collect();
    let mut parts: Vec<Node> = Vec::new();
    let mut literal = String::new();
    let mut single_quoted = false;
    let mut index = 0usize;

    while index < text.len() {
        let character = text[index];

        if character == '\'' {
            single_quoted = !single_quoted;
            literal.push(character);
            index += 1;
            continue;
        }
        // Inside single quotes the shell performs no expansion at all.
        if single_quoted {
            literal.push(character);
            index += 1;
            continue;
        }
        if character == '\\' {
            literal.extend(text[index..(index + 2).min(text.len())].iter());
            index += 2;
            continue;
        }

        if let Some((part, end)) = expansion_at(&text, index, declared, parse_substitution) {
            if !literal.is_empty() {
                parts.push(Node::leaf("literal", std::mem::take(&mut literal)));
            }
            parts.push(part);
            index = end;
            continue;
        }

        literal.push(character);
        index += 1;
    }

    if !literal.is_empty() {
        parts.push(Node::leaf("literal", literal));
    }
    compact(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_substitution(source: &str) -> Node {
        Node::leaf("word", source)
    }

    fn expand(text: &str, declared: &[&str]) -> Vec<(String, Option<String>)> {
        let declared: HashSet<String> = declared.iter().map(|name| name.to_string()).collect();
        expand_word(text, &declared, &no_substitution)
            .into_iter()
            .map(|part| (part.term, part.text))
            .collect()
    }

    #[test]
    fn splits_a_word_into_typed_parts() {
        assert_eq!(
            expand("\"${DIR}/log\"", &["DIR"]),
            vec![
                ("literal".to_string(), Some("\"".to_string())),
                ("variable".to_string(), Some("DIR".to_string())),
                ("literal".to_string(), Some("/log\"".to_string())),
            ]
        );
    }

    #[test]
    fn classifies_special_parameters() {
        assert_eq!(
            expand("$1 $# $? $HOME", &[]),
            vec![
                ("positional".to_string(), Some("0".to_string())),
                ("literal".to_string(), Some(" ".to_string())),
                ("argument-count".to_string(), Some("#".to_string())),
                ("literal".to_string(), Some(" ".to_string())),
                ("exit-status".to_string(), Some("?".to_string())),
                ("literal".to_string(), Some(" ".to_string())),
                ("env-variable".to_string(), Some("HOME".to_string())),
            ]
        );
    }

    #[test]
    fn keeps_single_quoted_text_unexpanded() {
        assert_eq!(
            expand("'$HOME'", &[]),
            vec![("literal".to_string(), Some("'$HOME'".to_string()))]
        );
    }

    #[test]
    fn reads_a_default_expansion() {
        let declared = HashSet::new();
        let parts = expand_word("${NAME:-anon}", &declared, &no_substitution);
        assert_eq!(parts[0].term, "default-expansion");
        assert_eq!(parts[0].text.as_deref(), Some("NAME"));
        assert_eq!(parts[0].children[1].text.as_deref(), Some("anon"));
    }
}
