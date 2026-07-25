//! Recursive-descent shell parser for the `$fy` translator.
//!
//! Produces a plain node tree which [`crate::fy::formalizer`] then
//! materialises as a meta-language links network. Keeping the two steps apart
//! means the grammar stays readable and the network construction stays
//! mechanical.
//!
//! This parser is deliberately separate from [`crate::shell_parser`], which
//! parses a *single* command line for the runtime. `$fy` needs whole-script
//! structure: comments, blank lines, control flow and function definitions.

use std::collections::HashSet;

use super::lexer::{tokenize, Token, TokenType};

/// A parsed shell construct.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    /// Construct name, for example `command`, `pipeline` or `if`.
    pub term: String,
    /// The node's own text, when it carries one (a variable name, a comment).
    pub text: Option<String>,
    pub children: Vec<Node>,
}

impl Node {
    pub fn new(term: &str, children: Vec<Node>) -> Self {
        Node {
            term: term.to_string(),
            text: None,
            children,
        }
    }

    pub fn with_text(term: &str, children: Vec<Node>, text: impl Into<String>) -> Self {
        Node {
            term: term.to_string(),
            text: Some(text.into()),
            children,
        }
    }

    pub fn leaf(term: &str, text: impl Into<String>) -> Self {
        Node::with_text(term, Vec::new(), text)
    }
}

/// Reserved words that terminate a command list.
const BLOCK_TERMINATORS: [&str; 8] = ["then", "elif", "else", "fi", "do", "done", "esac", "}"];

/// Splits `NAME=value` into its two halves.
fn match_assignment(text: &str) -> Option<(String, String)> {
    let equals = text.find('=')?;
    let (name, value) = text.split_at(equals);
    if !is_identifier(name) {
        return None;
    }
    Some((name.to_string(), value[1..].to_string()))
}

fn is_identifier(text: &str) -> bool {
    let mut characters = text.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

struct ShellParser {
    tokens: Vec<Token>,
    position: usize,
}

/// The words and redirects making up one simple command.
struct CommandParts {
    assignments: Vec<Node>,
    words: Vec<Node>,
    redirects: Vec<Node>,
}

impl ShellParser {
    fn new(source: &str) -> Self {
        ShellParser {
            tokens: tokenize(source),
            position: 0,
        }
    }

    fn current(&self) -> &Token {
        &self.tokens[self.position]
    }

    fn at(&self, token_type: TokenType) -> bool {
        self.current().token_type == token_type
    }

    fn at_text(&self, token_type: TokenType, text: &str) -> bool {
        self.at(token_type) && self.current().text == text
    }

    fn at_word(&self, text: &str) -> bool {
        self.at_text(TokenType::Word, text)
    }

    fn consume(&mut self) -> Token {
        let token = self.tokens[self.position].clone();
        self.position += 1;
        token
    }

    fn expect_word(&mut self, text: &str) -> bool {
        if self.at_word(text) {
            self.consume();
            true
        } else {
            false
        }
    }

    /// Skips newlines and `;` separators, emitting `blank` nodes for blank lines.
    fn skip_separators(&mut self, collector: Option<&mut Vec<Node>>) {
        let mut newlines = 0usize;
        let mut collector = collector;
        loop {
            if self.at(TokenType::Newline) {
                self.consume();
                newlines += 1;
                // The first newline ends the previous statement; each further
                // one is a blank line worth preserving in the output.
                if newlines > 1 {
                    if let Some(statements) = collector.as_deref_mut() {
                        statements.push(Node::new("blank", Vec::new()));
                    }
                }
                continue;
            }
            if self.at_text(TokenType::Operator, ";") {
                self.consume();
                continue;
            }
            return;
        }
    }

    /// Whether the current token closes the enclosing block.
    fn at_block_end(&self, extra_terminators: &HashSet<String>) -> bool {
        let token = self.current();
        if token.token_type == TokenType::Eof {
            return true;
        }
        if token.token_type == TokenType::Operator && (token.text == ")" || token.text == ";;") {
            return true;
        }
        if token.token_type != TokenType::Word {
            return false;
        }
        BLOCK_TERMINATORS.contains(&token.text.as_str())
            || extra_terminators.contains(token.text.as_str())
    }

    fn parse_script(&mut self) -> Node {
        let statements = self.parse_statements(&HashSet::new());
        Node::new("script", statements)
    }

    fn parse_statements(&mut self, extra_terminators: &HashSet<String>) -> Vec<Node> {
        let mut statements = Vec::new();
        // Leading blank lines are not "blank lines between statements".
        self.skip_separators(None);

        while !self.at_block_end(extra_terminators) {
            if self.at(TokenType::Comment) {
                let text = self.consume().text;
                let body = text.trim_start_matches('#');
                let body = body.strip_prefix(' ').unwrap_or(body);
                statements.push(Node::leaf("comment", body));
            } else {
                match self.parse_list() {
                    Some(statement) => statements.push(statement),
                    None => break,
                }
            }
            self.skip_separators(Some(&mut statements));
        }

        // Trailing blank lines add nothing to the translation.
        while statements.last().is_some_and(|last| last.term == "blank") {
            statements.pop();
        }
        statements
    }

    /// `pipeline (&& | ||) pipeline ...`, left associative.
    fn parse_list(&mut self) -> Option<Node> {
        let mut left = self.parse_pipeline()?;
        while self.at_text(TokenType::Operator, "&&") || self.at_text(TokenType::Operator, "||") {
            let operator = if self.consume().text == "&&" {
                "and"
            } else {
                "or"
            };
            // An operator may be followed by a newline before its right operand.
            while self.at(TokenType::Newline) {
                self.consume();
            }
            match self.parse_pipeline() {
                Some(right) => left = Node::new(operator, vec![left, right]),
                None => break,
            }
        }
        Some(left)
    }

    fn parse_pipeline(&mut self) -> Option<Node> {
        let mut stages = vec![self.parse_command()?];
        while self.at_text(TokenType::Operator, "|") {
            self.consume();
            while self.at(TokenType::Newline) {
                self.consume();
            }
            match self.parse_command() {
                Some(stage) => stages.push(stage),
                None => break,
            }
        }
        if stages.len() == 1 {
            stages.pop()
        } else {
            Some(Node::new("pipeline", stages))
        }
    }

    fn parse_command(&mut self) -> Option<Node> {
        if self.at_text(TokenType::Operator, "(") {
            self.consume();
            let body = self.parse_statements(&HashSet::new());
            if self.at_text(TokenType::Operator, ")") {
                self.consume();
            }
            return Some(Node::new("subshell", vec![Node::new("block", body)]));
        }
        if self.at_word("{") {
            self.consume();
            let body = self.parse_statements(&HashSet::new());
            self.expect_word("}");
            return Some(Node::new("block", body));
        }
        if self.at_word("if") {
            return Some(self.parse_if());
        }
        if self.at_word("while") || self.at_word("until") {
            return Some(self.parse_loop());
        }
        if self.at_word("for") {
            return Some(self.parse_for());
        }
        if self.at_word("case") {
            return Some(self.parse_case());
        }
        if let Some(function) = self.try_parse_function() {
            return Some(function);
        }
        self.parse_simple_command()
    }

    /// `if list; then block [elif ...] [else block] fi`
    fn parse_if(&mut self) -> Node {
        self.consume(); // `if` / `elif`
        let condition = self.parse_condition("then");
        let consequent = Node::new("block", self.parse_statements(&HashSet::new()));

        if self.at_word("elif") {
            let alternative = self.parse_if();
            return Node::new("if", vec![condition, consequent, alternative]);
        }
        let alternative = if self.expect_word("else") {
            Some(Node::new("block", self.parse_statements(&HashSet::new())))
        } else {
            None
        };
        self.expect_word("fi");
        match alternative {
            Some(alternative) => Node::new("if", vec![condition, consequent, alternative]),
            None => Node::new("if", vec![condition, consequent]),
        }
    }

    fn parse_loop(&mut self) -> Node {
        let term = if self.consume().text == "while" {
            "while"
        } else {
            "until"
        };
        let condition = self.parse_condition("do");
        let body = Node::new("block", self.parse_statements(&HashSet::new()));
        self.expect_word("done");
        Node::new(term, vec![condition, body])
    }

    /// `for NAME in word...; do block done`
    fn parse_for(&mut self) -> Node {
        self.consume(); // `for`
        let variable = if self.at(TokenType::Word) {
            self.consume().text
        } else {
            "_".to_string()
        };
        let mut items = Vec::new();
        if self.expect_word("in") {
            while self.at(TokenType::Word)
                && !BLOCK_TERMINATORS.contains(&self.current().text.as_str())
            {
                let text = self.consume().text;
                items.push(Node::leaf("word", text));
            }
        }
        self.skip_separators(None);
        self.expect_word("do");
        let body = Node::new("block", self.parse_statements(&HashSet::new()));
        self.expect_word("done");
        Node::new(
            "for",
            vec![
                Node::leaf("name", variable),
                Node::new("word-list", items),
                body,
            ],
        )
    }

    /// `case word in pattern) block ;; ... esac`
    fn parse_case(&mut self) -> Node {
        self.consume(); // `case`
        let subject = if self.at(TokenType::Word) {
            let text = self.consume().text;
            Node::leaf("word", text)
        } else {
            Node::leaf("word", "")
        };
        self.expect_word("in");
        self.skip_separators(None);

        let mut branches = Vec::new();
        while !self.at_word("esac") && !self.at(TokenType::Eof) {
            branches.push(self.parse_case_branch());
        }
        self.expect_word("esac");
        Node::new(
            "case",
            vec![subject, Node::new("case-branch-list", branches)],
        )
    }

    fn parse_case_branch(&mut self) -> Node {
        // A pattern list is `a|b|c)`. The lexer already split on `|` and `)`.
        let mut patterns = Vec::new();
        while self.at(TokenType::Word) {
            // `*` is the shell's catch-all pattern, i.e. `default:`.
            let pattern = self.consume().text;
            let term = if pattern == "*" {
                "pattern-default"
            } else {
                "pattern"
            };
            patterns.push(Node::leaf(term, pattern));
            if self.at_text(TokenType::Operator, "|") {
                self.consume();
                continue;
            }
            break;
        }
        if self.at_text(TokenType::Operator, ")") {
            self.consume();
        }
        let body = Node::new("block", self.parse_statements(&HashSet::new()));
        if self.at_text(TokenType::Operator, ";;") {
            self.consume();
        }
        self.skip_separators(None);
        Node::new(
            "case-branch",
            vec![Node::new("pattern-list", patterns), body],
        )
    }

    /// Consumes `function name [()]`, or `None` when that is not next.
    fn parse_keyword_function_name(&mut self) -> Option<String> {
        self.consume();
        if !self.at(TokenType::Word) {
            return None;
        }
        let name = self.consume().text;
        if self.at_text(TokenType::Operator, "(") {
            self.consume();
            if self.at_text(TokenType::Operator, ")") {
                self.consume();
            }
        }
        Some(name)
    }

    /// Consumes `name ()`, or `None` when that is not next.
    fn parse_bare_function_name(&mut self) -> Option<String> {
        let is_operator = |token: Option<&Token>, text: &str| {
            token.is_some_and(|token| token.token_type == TokenType::Operator && token.text == text)
        };

        if !self.at(TokenType::Word)
            || !is_identifier(&self.current().text)
            || !is_operator(self.tokens.get(self.position + 1), "(")
            || !is_operator(self.tokens.get(self.position + 2), ")")
        {
            return None;
        }
        let name = self.consume().text;
        self.consume();
        self.consume();
        Some(name)
    }

    /// `name() { ... }` or `function name { ... }`
    fn try_parse_function(&mut self) -> Option<Node> {
        let start = self.position;
        let name = if self.at_word("function") {
            self.parse_keyword_function_name()
        } else {
            self.parse_bare_function_name()
        };

        let Some(name) = name else {
            self.position = start;
            return None;
        };

        self.skip_separators(None);
        if !self.expect_word("{") {
            self.position = start;
            return None;
        }
        let body = Node::new("block", self.parse_statements(&HashSet::new()));
        self.expect_word("}");
        Some(Node::new("function", vec![Node::leaf("name", name), body]))
    }

    /// Parses the condition of `if`/`while`/`until` up to its introducer
    /// keyword (`then`/`do`), which the caller has named.
    fn parse_condition(&mut self, introducer: &str) -> Node {
        let terminators: HashSet<String> = HashSet::from([introducer.to_string()]);
        let mut condition = self.parse_statements(&terminators);
        self.skip_separators(None);
        self.expect_word(introducer);
        if condition.len() == 1 {
            return condition.remove(0);
        }
        Node::new("block", condition)
    }

    /// True once the current token can no longer belong to a simple command.
    ///
    /// `words` are the words read so far; an empty list means the parser is
    /// still in command position.
    fn at_command_end(&self, words: &[Node]) -> bool {
        // Reserved words are only reserved in command position: `echo done`
        // runs `echo` with the argument `done`, it does not close a loop.
        // Assignment prefixes do not consume the command position, so the
        // check stays on `words`.
        if words.is_empty() && self.at_block_end(&HashSet::new()) {
            return true;
        }
        self.at(TokenType::Eof)
            || self.at(TokenType::Newline)
            || self.at(TokenType::Comment)
            || self.at(TokenType::Operator)
    }

    /// Reads the assignment prefixes, words and redirects of one command.
    fn parse_command_parts(&mut self) -> CommandParts {
        let mut parts = CommandParts {
            assignments: Vec::new(),
            words: Vec::new(),
            redirects: Vec::new(),
        };

        while !self.at_command_end(&parts.words) {
            if self.at(TokenType::Redirect) {
                let operator = self.consume().text;
                let target = if self.at(TokenType::Word) {
                    self.consume().text
                } else {
                    String::new()
                };
                parts.redirects.push(Node::with_text(
                    "redirect",
                    vec![Node::leaf("word", target)],
                    operator,
                ));
                continue;
            }

            let token = self.consume();
            let assignment = if parts.words.is_empty() {
                match_assignment(&token.text)
            } else {
                None
            };
            if let Some((name, value)) = assignment {
                parts.assignments.push(Node::with_text(
                    "assignment",
                    vec![Node::leaf("word", value)],
                    name,
                ));
                continue;
            }
            parts.words.push(Node::leaf("word", token.text));
        }

        parts
    }

    fn parse_simple_command(&mut self) -> Option<Node> {
        let CommandParts {
            mut assignments,
            words,
            redirects,
        } = self.parse_command_parts();

        if words.is_empty() {
            if assignments.is_empty() {
                return None;
            }
            // Bare `NAME=value` statements are variable declarations.
            return Some(if assignments.len() == 1 {
                assignments.remove(0)
            } else {
                Node::new("block", assignments)
            });
        }

        let name = words[0].text.clone().unwrap_or_default();
        let rest: Vec<Node> = words[1..].to_vec();

        match name.as_str() {
            "export" | "local" | "readonly" => return Some(build_declaration(&name, rest)),
            "set" if !rest.is_empty() => return Some(Node::new("set-option", rest)),
            "exit" => return Some(Node::new("exit", rest)),
            "return" => return Some(Node::new("return", rest)),
            "source" | "." => return Some(Node::new("source", rest)),
            _ => {}
        }

        let mut children = vec![
            Node::new("word-list", words),
            Node::new("redirect-list", redirects),
        ];
        if !assignments.is_empty() {
            // Prefixed assignments (`FOO=bar cmd`) scope an environment
            // variable to one command; keep them attached so a rule can
            // render them.
            children.push(Node::new("assignment-list", assignments));
        }
        Some(Node::new("command", children))
    }
}

fn build_declaration(keyword: &str, words: Vec<Node>) -> Node {
    let term = if keyword == "export" {
        "export"
    } else {
        "local"
    };
    let mut declarations: Vec<Node> = words
        .into_iter()
        .map(|word| {
            let text = word.text.unwrap_or_default();
            match match_assignment(&text) {
                Some((name, value)) => Node::with_text(term, vec![Node::leaf("word", value)], name),
                None => Node::with_text(term, vec![Node::leaf("word", "")], text),
            }
        })
        .collect();

    if declarations.len() == 1 {
        declarations.remove(0)
    } else {
        Node::new("block", declarations)
    }
}

/// Parses a shell script into a plain node tree rooted at a `script` node.
pub fn parse_shell_script(source: &str) -> Node {
    ShellParser::new(source).parse_script()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(node: &Node) -> Vec<String> {
        node.children
            .iter()
            .map(|child| child.term.clone())
            .collect()
    }

    #[test]
    fn parses_a_pipeline_into_stages() {
        let script = parse_shell_script("ls | grep test | wc -l");
        assert_eq!(script.term, "script");
        assert_eq!(script.children[0].term, "pipeline");
        assert_eq!(script.children[0].children.len(), 3);
    }

    #[test]
    fn parses_and_or_left_associatively() {
        let script = parse_shell_script("a && b || c");
        assert_eq!(script.children[0].term, "or");
        assert_eq!(script.children[0].children[0].term, "and");
    }

    #[test]
    fn parses_control_flow_functions_and_case() {
        let script = parse_shell_script(
            "if [ -f x ]; then echo a; else echo b; fi\n\
             while true; do echo loop; done\n\
             for i in 1 2; do echo $i; done\n\
             greet() { echo hi; }\n\
             case \"$1\" in start) run ;; *) usage ;; esac\n",
        );
        assert_eq!(
            terms(&script),
            vec!["if", "while", "for", "function", "case"]
        );
    }

    #[test]
    fn reserved_words_stay_arguments_outside_command_position() {
        let script = parse_shell_script("echo done | tr a-z A-Z");
        let pipeline = &script.children[0];
        assert_eq!(pipeline.term, "pipeline");
        let words = &pipeline.children[0].children[0];
        assert_eq!(words.children.len(), 2);
    }
}
