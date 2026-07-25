//! Recursive rule engine for translating a meta-language links network.
//!
//! meta-language models translation as a `TranslationRuleSet`: a query per
//! source construct plus a template per target language. Its own
//! `TranslationRuleSet::render` is `pub(crate)`, applies the *first* rule that
//! matches and does not recurse into a template's placeholders, so it cannot
//! translate a nested tree (see `js/docs/meta-language-gaps.md` for the report
//! filed upstream).
//!
//! This engine keeps meta-language's rule model — the rules really are
//! `TranslationRule`s carrying `LinkQuery`s and per-language templates — and
//! supplies only the missing evaluation strategy:
//!
//!   * bottom-up recursion through placeholders,
//!   * variadic placeholders over a node's children,
//!   * conditional segments for optional captures,
//!   * automatic indentation of multi-line substitutions.
//!
//! Once meta-language grows these, this file collapses into a call to its own
//! rule-set rendering.

use std::collections::HashMap;

use meta_language::link_network::{LinkId, LinkNetwork, LinkType};
use meta_language::translation_rules::{TranslationRule, TranslationRuleSet};

use super::formalizer::CHUNK_TERM;

/// How a placeholder renders its captured link.
#[derive(Clone, Default)]
pub struct Mode {
    /// Render the captured link in this target language instead of the current one.
    pub language: Option<String>,
    /// Post-process the rendered text.
    pub transform: Option<fn(&str) -> String>,
}

/// A parsed `{...}` placeholder.
struct Placeholder<'a> {
    variadic: bool,
    name: &'a str,
    mode: Option<&'a str>,
    separator: Option<&'a str>,
    length: usize,
}

/// Parses `{name}`, `{name:mode}` or `{*name:mode|separator}` at the start of
/// `source`, or the conditional opener `{?name}`.
fn parse_placeholder(source: &str) -> Option<Placeholder<'_>> {
    let body_end = source.find('}')?;
    if !source.starts_with('{') {
        return None;
    }
    let mut body = &source[1..body_end];
    if body.is_empty() || body.starts_with('?') || body.starts_with('/') {
        return None;
    }

    let variadic = body.starts_with('*');
    if variadic {
        body = &body[1..];
    }

    let (head, separator) = match body.find('|') {
        Some(bar) => (&body[..bar], Some(&body[bar + 1..])),
        None => (body, None),
    };
    let (name, mode) = match head.find(':') {
        Some(colon) => (&head[..colon], Some(&head[colon + 1..])),
        None => (head, None),
    };

    if name != "." && !is_capture_name(name) {
        return None;
    }
    Some(Placeholder {
        variadic,
        name,
        mode,
        separator,
        length: body_end + 1,
    })
}

fn is_capture_name(name: &str) -> bool {
    let mut characters = name.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

/// Parses the conditional opener `{?name}`.
fn parse_conditional(source: &str) -> Option<(&str, usize)> {
    let body_end = source.find('}')?;
    let body = source.strip_prefix("{?")?;
    let name = &body[..body_end - 2];
    if !is_capture_name(name) {
        return None;
    }
    Some((name, body_end + 1))
}

fn decode_separator(separator: Option<&str>) -> String {
    let Some(separator) = separator else {
        return String::new();
    };
    let mut decoded = String::new();
    let mut characters = separator.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        match characters.next() {
            Some('n') => decoded.push('\n'),
            Some('t') => decoded.push('\t'),
            Some('s') => decoded.push(' '),
            Some(other) => decoded.push(other),
            None => decoded.push('\\'),
        }
    }
    decoded
}

/// Indents every line after the first by `indent`.
fn indent_continuation(value: &str, indent: &str) -> String {
    if indent.is_empty() || !value.contains('\n') {
        return value.to_string();
    }
    value
        .split('\n')
        .enumerate()
        .map(|(position, line)| {
            if position == 0 || line.is_empty() {
                line.to_string()
            } else {
                format!("{indent}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The whitespace run at the end of `output`, when `output` ends on a blank
/// line prefix.
fn current_indent(output: &str) -> &str {
    let line = match output.rfind('\n') {
        Some(newline) => &output[newline + 1..],
        None => output,
    };
    if line
        .chars()
        .all(|character| character == ' ' || character == '\t')
    {
        line
    } else {
        ""
    }
}

/// Renders a links network by recursively substituting translation-rule templates.
pub struct RuleEngine<'a> {
    network: &'a LinkNetwork,
    rule_set: &'a TranslationRuleSet,
    language: String,
    fallbacks: HashMap<String, Vec<String>>,
    modes: HashMap<String, Mode>,
    rules_by_link: HashMap<LinkId, usize>,
    diagnostics: Vec<String>,
}

impl<'a> RuleEngine<'a> {
    /// Builds an engine for `network`, resolving each rule's query once.
    pub fn new(
        network: &'a LinkNetwork,
        rule_set: &'a TranslationRuleSet,
        language: &str,
        fallbacks: HashMap<String, Vec<String>>,
        modes: HashMap<String, Mode>,
    ) -> Self {
        // Rule selection is query-driven: each rule's `LinkQuery` is evaluated
        // against the whole network once, and the first rule to claim a link
        // owns it.
        let mut rules_by_link = HashMap::new();
        for (index, rule) in rule_set.rules().iter().enumerate() {
            for query_match in network.query_matches(rule.query()) {
                rules_by_link.entry(query_match.link_id()).or_insert(index);
            }
        }

        RuleEngine {
            network,
            rule_set,
            language: language.to_string(),
            fallbacks,
            modes,
            rules_by_link,
            diagnostics: Vec::new(),
        }
    }

    /// Diagnostics collected while rendering (constructs with no rule).
    pub fn report(&self) -> Vec<String> {
        self.diagnostics.clone()
    }

    /// Renders one link in the engine's default target language.
    pub fn render_root(&mut self, link_id: LinkId) -> String {
        let language = self.language.clone();
        self.render(link_id, &language)
    }

    /// Renders one link in `language`.
    pub fn render(&mut self, link_id: LinkId, language: &str) -> String {
        let Some(&index) = self.rules_by_link.get(&link_id) else {
            // Token links are leaves and render as their own text; an unclaimed
            // *syntax* node means a construct nobody translates.
            if let Some(link) = self.network.link(link_id) {
                if link.metadata().link_type() == Some(LinkType::Syntax) {
                    let term = link.metadata().term().unwrap_or("?").to_string();
                    self.diagnostics
                        .push(format!("no translation rule for `{term}`"));
                }
            }
            return self.captured_text(link_id);
        };

        let rule = &self.rule_set.rules()[index];
        let Some(template) = self.template_for(rule, language) else {
            self.diagnostics
                .push(format!("rule `{}` has no {language} template", rule.name()));
            return self.captured_text(link_id);
        };
        self.expand(&template, index, link_id, language)
    }

    /// The source text a link captures, without applying any rule.
    fn captured_text(&self, link_id: LinkId) -> String {
        self.network.render_source_from(link_id, "Shell")
    }

    /// Looks a template up through the configured fallback chain.
    fn template_for(&self, rule: &TranslationRule, language: &str) -> Option<String> {
        if let Some(template) = rule.templates().get(language) {
            return Some(template.source().to_string());
        }
        for candidate in self.fallbacks.get(language)? {
            if let Some(template) = rule.templates().get(candidate) {
                return Some(template.source().to_string());
            }
        }
        None
    }

    /// Resolves a capture name to a child link id.
    fn resolve(&self, rule_index: usize, link_id: LinkId, name: &str) -> Option<LinkId> {
        if name == "." {
            return Some(link_id);
        }
        let index = *self.rule_set.rules()[rule_index]
            .reference_captures()
            .get(name)?;
        self.network.link(link_id)?.references().get(index).copied()
    }

    /// The renderable children of a link, with chunk nodes flattened.
    fn children_of(&self, link_id: LinkId) -> Vec<LinkId> {
        let Some(link) = self.network.link(link_id) else {
            return Vec::new();
        };
        let mut children = Vec::new();
        for &child in link.references() {
            let is_chunk = self
                .network
                .link(child)
                .and_then(|child| child.metadata().term().map(|term| term == CHUNK_TERM))
                .unwrap_or(false);
            if is_chunk {
                children.extend(self.children_of(child));
            } else {
                children.push(child);
            }
        }
        children
    }

    /// Renders `link_id` in the mode a placeholder asked for.
    fn render_mode(&mut self, link_id: LinkId, mode: Option<&str>, language: &str) -> String {
        let Some(mode) = mode else {
            return self.render(link_id, language);
        };
        let Some(definition) = self.modes.get(mode).cloned() else {
            self.diagnostics
                .push(format!("unknown placeholder mode `{mode}`"));
            return self.render(link_id, language);
        };
        let rendered = match definition.language.as_deref() {
            Some(language) => self.render(link_id, language),
            None => self.captured_text(link_id),
        };
        match definition.transform {
            Some(transform) => transform(&rendered),
            None => rendered,
        }
    }

    fn expand(
        &mut self,
        source: &str,
        rule_index: usize,
        link_id: LinkId,
        language: &str,
    ) -> String {
        let mut output = String::new();
        let mut index = 0usize;

        while index < source.len() {
            let rest = &source[index..];

            if let Some(stripped) = rest.strip_prefix("{{") {
                let _ = stripped;
                output.push('{');
                index += 2;
                continue;
            }
            if rest.starts_with("}}") {
                output.push('}');
                index += 2;
                continue;
            }

            if let Some((name, opener)) = parse_conditional(rest) {
                let closer = format!("{{/{name}}}");
                let end = rest.find(&closer).unwrap_or(rest.len());
                let body = rest[opener.min(end)..end].to_string();
                if self.resolve(rule_index, link_id, name).is_some() {
                    let expanded = self.expand(&body, rule_index, link_id, language);
                    output.push_str(&expanded);
                }
                index += if end == rest.len() {
                    rest.len()
                } else {
                    end + closer.len()
                };
                continue;
            }

            if let Some(placeholder) = parse_placeholder(rest) {
                let target = self.resolve(rule_index, link_id, placeholder.name);
                let Some(target) = target else {
                    // An unresolved capture renders as nothing rather than as
                    // its own source text, so optional children disappear.
                    index += placeholder.length;
                    continue;
                };

                let indent = current_indent(&output).to_string();
                let mode = placeholder.mode.map(str::to_string);
                let value = if placeholder.variadic {
                    let separator = decode_separator(placeholder.separator);
                    let children = self.children_of(target);
                    let rendered: Vec<String> = children
                        .into_iter()
                        .map(|child| {
                            let text = self.render_mode(child, mode.as_deref(), language);
                            indent_continuation(&text, &indent)
                        })
                        .collect();
                    rendered.join(&separator)
                } else {
                    let text = self.render_mode(target, mode.as_deref(), language);
                    indent_continuation(&text, &indent)
                };
                output.push_str(&value);
                index += placeholder.length;
                continue;
            }

            let character = rest.chars().next().expect("rest is non-empty");
            output.push(character);
            index += character.len_utf8();
        }

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_separator_escapes() {
        assert_eq!(decode_separator(Some("\\n")), "\n");
        assert_eq!(decode_separator(Some(", ")), ", ");
        assert_eq!(decode_separator(None), "");
    }

    #[test]
    fn indents_continuation_lines_only() {
        assert_eq!(indent_continuation("a\nb\n\nc", "  "), "a\n  b\n\n  c");
        assert_eq!(indent_continuation("a", "  "), "a");
    }

    #[test]
    fn reports_the_current_indent() {
        assert_eq!(current_indent("x\n  "), "  ");
        assert_eq!(current_indent("x\n  y"), "");
    }

    #[test]
    fn parses_placeholder_forms() {
        let placeholder = parse_placeholder("{*items:string|, }rest").expect("placeholder");
        assert!(placeholder.variadic);
        assert_eq!(placeholder.name, "items");
        assert_eq!(placeholder.mode, Some("string"));
        assert_eq!(placeholder.separator, Some(", "));

        let plain = parse_placeholder("{.}").expect("placeholder");
        assert_eq!(plain.name, ".");
        assert!(!plain.variadic);

        assert!(parse_placeholder("{?name}").is_none());
        assert_eq!(
            parse_conditional("{?name}body").map(|it| it.0),
            Some("name")
        );
    }
}
