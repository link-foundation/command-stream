//! Lossless source migration: parse, formalize typed links, substitute rules.
use super::{
    engine::{Mode, RuleEngine},
    formalizer::formalize_shell,
    Translation,
};
use meta_language::link_network::{LinkId, LinkMetadata, LinkNetwork, LinkType};
use meta_language::query::LinkQuery;
use meta_language::translation_rules::{TranslationRule, TranslationRuleSet};
use std::collections::HashMap;

/// Source selection and generated module options shared by the CLI and API.
#[derive(Clone, Debug)]
pub struct SourceOptions {
    pub from: String,
    pub filename: String,
    pub module_name: String,
    pub shell: Option<String>,
    pub name: String,
    pub shebang: bool,
    pub use_m: bool,
    pub commonjs: bool,
}
impl Default for SourceOptions {
    fn default() -> Self {
        Self {
            from: "auto".into(),
            filename: String::new(),
            module_name: "command-stream".into(),
            shell: None,
            name: "translated.sh".into(),
            shebang: true,
            use_m: true,
            commonjs: false,
        }
    }
}

fn syntax(network: &mut LinkNetwork, language: &str, term: &str, children: &[LinkId]) -> LinkId {
    network.insert_dynamic_link(
        children,
        LinkMetadata::new()
            .with_link_type(LinkType::Syntax)
            .with_language(language)
            .with_term(term),
    )
}
fn rule(language: &str, term: &str, text: &str, captures: &[(&str, usize)]) -> TranslationRule {
    let mut rule = TranslationRule::new(
        term,
        LinkQuery::new()
            .with_link_type(LinkType::Syntax)
            .with_language(language)
            .with_term(term),
    )
    .with_template("JavaScript", text);
    for (name, index) in captures {
        rule = rule.with_reference_capture(*name, *index);
    }
    rule
}
fn json(text: &str) -> String {
    serde_json::to_string(text).expect("string serialization")
}
fn result(code: String, diagnostics: Vec<String>) -> Translation {
    Translation {
        body: code.clone(),
        code,
        preamble: String::new(),
        diagnostics,
    }
}

/// Translate a complete shell program without changing its interpreter semantics.
pub fn translate_shell_program(source: &str, options: &SourceOptions) -> Translation {
    let mut formal = formalize_shell(source);
    let inferred = source
        .lines()
        .next()
        .filter(|line| line.starts_with("#!"))
        .and_then(|line| line.split_whitespace().last())
        .and_then(|word| word.rsplit('/').next())
        .filter(|word| ["sh", "bash", "dash", "zsh"].contains(word));
    let shell = options.shell.as_deref().or(inferred).unwrap_or("sh");
    let refs: Vec<_> = [source, shell, &options.name, &options.module_name]
        .iter()
        .map(|value| formal.network.insert_source_token("Shell", value))
        .chain(std::iter::once(formal.root))
        .collect();
    let root = syntax(&mut formal.network, "Shell", "shell-program", &refs);
    let header = if options.shebang {
        "#!/usr/bin/env node\n"
    } else {
        ""
    };
    let load = if options.use_m {
        "import {{ use }} from 'use-m';\nconst {{ command }} = await use({module:json});\n"
    } else {
        "import {{ command }} from {module:json};\n"
    };
    let template = format!("{header}{load}const source = {{source:json}};\nconst result = await command({{shell:json}}, '-c', source, {{name:json}}, ...process.argv.slice(2))\n  .with({{{{ mirror: true, capture: false, stdin: 'inherit' }}}}).run();\nprocess.exitCode = result.code;\n");
    let rules = TranslationRuleSet::new("source-to-command-stream").with_rule(rule(
        "Shell",
        "shell-program",
        &template,
        &[("source", 0), ("shell", 1), ("name", 2), ("module", 3)],
    ));
    let modes = HashMap::from([(
        "json".into(),
        Mode {
            language: None,
            transform: Some(json),
        },
    )]);
    let mut engine = RuleEngine::new(&formal.network, &rules, "JavaScript", HashMap::new(), modes);
    let code = engine.render_root(root);
    result(code, engine.report())
}
fn target(module: &str) -> Option<&str> {
    match module {
        "zx" | "zx/core" | "zx/globals" | "zx/cli" | "execa" | "shelljs" | "shelljs/plugin"
        | "cross-spawn" | "bun" => Some(module),
        _ => None,
    }
}

/// Find import/export/dynamic-import/require arguments through a JavaScript CST.
fn module_references(
    source: &str,
    commonjs: bool,
    diagnostics: &mut Vec<String>,
) -> Result<Vec<(usize, usize, String)>, String> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_javascript::LANGUAGE.into())
        .map_err(|error| error.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or("JavaScript parsing cancelled")?;
    if tree.root_node().has_error() {
        return Err("Invalid JavaScript source".into());
    }
    let mut pending = vec![tree.root_node()];
    let mut references = Vec::new();
    let mut requires = Vec::new();
    let mut bound_require = false;
    while let Some(node) = pending.pop() {
        let binding = match node.kind() {
            "variable_declarator"
            | "function_declaration"
            | "function_expression"
            | "class_declaration" => node.child_by_field_name("name"),
            "catch_clause" => node.child_by_field_name("parameter"),
            "formal_parameters" | "import_clause" => Some(node),
            "arrow_function" => node.child_by_field_name("parameter"),
            _ => None,
        };
        if let Some(binding) = binding {
            let mut bindings = vec![binding];
            while let Some(binding) = bindings.pop() {
                if binding.kind() == "identifier" && &source[binding.byte_range()] == "require" {
                    bound_require = true;
                }
                let mut cursor = binding.walk();
                bindings.extend(binding.named_children(&mut cursor));
            }
        }
        let child = match node.kind() {
            "import_statement" | "export_statement" => node.child_by_field_name("source"),
            "call_expression" => {
                let function = node.child_by_field_name("function");
                let name = function.map(|node| &source[node.byte_range()]);
                if matches!(name, Some("import" | "require")) {
                    node.child_by_field_name("arguments")
                        .and_then(|args| args.named_child(0))
                } else {
                    None
                }
            }
            "return_statement"
                if !commonjs
                    && node
                        .parent()
                        .is_some_and(|parent| parent.kind() == "program") =>
            {
                return Err("Top-level return requires CommonJS mode".into())
            }
            _ => None,
        };
        if let Some(child) = child.filter(|child| child.kind() == "string") {
            let raw = &source[child.byte_range()];
            let reference = (child.start_byte(), child.end_byte(), decode_string(raw)?);
            if node.kind() == "call_expression"
                && node
                    .child_by_field_name("function")
                    .is_some_and(|function| &source[function.byte_range()] == "require")
            {
                requires.push(reference);
            } else {
                references.push(reference);
            }
        }
        let mut cursor = node.walk();
        pending.extend(node.named_children(&mut cursor));
    }
    if bound_require && !requires.is_empty() {
        diagnostics.push(
            "locally bound require: require calls retained; import declarations still migrate"
                .into(),
        );
    } else {
        references.extend(requires);
    }
    references.sort_by_key(|reference| reference.0);
    Ok(references)
}

// Decode the escape forms JavaScript permits in either quote style. Parsing
// already validated the literal; do not confuse JSON's narrower grammar with JS.
fn decode_string(raw: &str) -> Result<String, String> {
    let mut chars = raw[1..raw.len() - 1].chars().peekable();
    let mut result = String::new();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            result.push(ch);
            continue;
        }
        let ch = chars.next().ok_or("Invalid string escape")?;
        match ch {
            '\n' => {}
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
            }
            'n' => result.push('\n'),
            'r' => result.push('\r'),
            't' => result.push('\t'),
            'b' => result.push('\u{8}'),
            'f' => result.push('\u{c}'),
            'v' => result.push('\u{b}'),
            '0' => result.push('\0'),
            'x' | 'u' => {
                let digits = if ch == 'u' && chars.peek() == Some(&'{') {
                    chars.next();
                    chars.by_ref().take_while(|c| *c != '}').collect::<String>()
                } else {
                    chars.by_ref().take(if ch == 'x' { 2 } else { 4 }).collect()
                };
                let code = u32::from_str_radix(&digits, 16).map_err(|error| error.to_string())?;
                // Isolated UTF-16 surrogates cannot name one of our ASCII
                // competitor packages. Preserve them as non-matching text.
                result.push(char::from_u32(code).unwrap_or('\u{fffd}'));
            }
            other => result.push(other),
        }
    }
    Ok(result)
}

/// Migrate source to matching command-stream APIs, retaining all other bytes.
pub fn translate_competitor_source(
    source: &str,
    options: &SourceOptions,
) -> Result<Translation, String> {
    let commonjs = options.commonjs || options.filename.to_ascii_lowercase().ends_with(".cjs");
    let mut network = LinkNetwork::new();
    let mut children = Vec::new();
    let mut rules = vec![rule("JavaScript", "source-program", "{*.:raw}", &[])];
    let mut diagnostics = Vec::new();
    let mut end = 0;
    for (start, stop, module) in module_references(source, commonjs, &mut diagnostics)? {
        let Some(suffix) = target(&module) else {
            if ["zx/", "execa/", "shelljs/", "cross-spawn/"]
                .iter()
                .any(|prefix| module.starts_with(prefix))
            {
                diagnostics.push(format!("unsupported competitor entry point: {module}"));
            }
            continue;
        };
        children.push(network.insert_source_token("JavaScript", &source[end..start]));
        let original = network.insert_source_token("JavaScript", &source[start..stop]);
        let term = format!("module-{module}");
        children.push(syntax(&mut network, "JavaScript", &term, &[original]));
        rules.push(rule(
            "JavaScript",
            &term,
            &json(&format!("{}/{suffix}", options.module_name))
                .replace('{', "{{")
                .replace('}', "}}"),
            &[],
        ));
        end = stop;
    }
    children.push(network.insert_source_token("JavaScript", &source[end..]));
    let root = syntax(&mut network, "JavaScript", "source-program", &children);
    let mut rule_set = TranslationRuleSet::new("competitors-to-command-stream");
    for rule in rules {
        rule_set.add_rule(rule);
    }
    let rules = rule_set;
    let modes = HashMap::from([(
        "raw".into(),
        Mode {
            language: Some("JavaScript".into()),
            transform: None,
        },
    )]);
    let mut engine = RuleEngine::new(&network, &rules, "JavaScript", HashMap::new(), modes);
    engine.preserve_layout = true;
    let mut code = engine.render_root(root);
    diagnostics.extend(engine.report());
    if commonjs {
        code = commonjs_module(&code);
    }
    if !options.shebang && code.starts_with("#!") {
        code = code
            .split_once('\n')
            .map_or("", |(_, body)| body)
            .to_owned();
    }
    Ok(result(code, diagnostics))
}
fn commonjs_module(source: &str) -> String {
    let body = if source.starts_with("#!") {
        source.split_once('\n').map_or("", |(_, body)| body)
    } else {
        source
    };
    format!("#!/usr/bin/env node\nimport {{ createRequire as __fyRequire }} from 'node:module';\nimport {{ fileURLToPath as __fyPath }} from 'node:url';\nimport {{ dirname as __fyDir }} from 'node:path';\nconst __fyModule = {{ exports: {{}} }};\n(function (require, module, exports, __filename, __dirname) {{\n{body}\n}})(__fyRequire(import.meta.url), __fyModule, __fyModule.exports, __fyPath(import.meta.url), __fyDir(__fyPath(import.meta.url)));\nexport default __fyModule.exports;\n")
}

/// Select a source front end and translate through its typed links and rules.
pub fn translate_source(source: &str, options: &SourceOptions) -> Result<Translation, String> {
    if source.contains('\0') {
        return Err("Source must not contain NUL".into());
    }
    let from = if options.from == "auto" {
        if [".js", ".mjs", ".cjs"]
            .iter()
            .any(|ext| options.filename.to_ascii_lowercase().ends_with(ext))
        {
            "javascript"
        } else {
            "shell"
        }
    } else {
        &options.from
    };
    match from {
        "shell" | "sh" | "bash" | "dash" | "zsh" => {
            let mut options = options.clone();
            if from != "shell" && options.shell.is_none() {
                options.shell = Some(from.into());
            }
            Ok(translate_shell_program(source, &options))
        }
        "javascript" | "js" | "zx" | "execa" | "shelljs" | "cross-spawn" | "bun" => {
            translate_competitor_source(source, options)
        }
        _ => Err(format!("Unsupported source language: {from}")),
    }
}
