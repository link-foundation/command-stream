//! Shell lexer for the `$fy` translator.
//!
//! Produces a flat, lossless token stream: every character of the input ends
//! up in exactly one token's text, so the formalizer can rebuild the original
//! source from the links network.

/// Token kinds emitted by [`tokenize`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    Word,
    Operator,
    Redirect,
    Newline,
    Comment,
    Eof,
}

/// One lexed token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub token_type: TokenType,
    pub text: String,
}

impl Token {
    fn new(token_type: TokenType, text: impl Into<String>) -> Self {
        Token {
            token_type,
            text: text.into(),
        }
    }
}

const OPERATORS: [&str; 7] = ["&&", "||", ";;", ";", "|", "(", ")"];
const WORD_TERMINATORS: [char; 10] = [' ', '\t', '\n', ';', '|', '&', '(', ')', '<', '>'];

/// Consumes a balanced span that starts at `start` (for example `$(`, `${`).
/// Returns the index just past the closing delimiter.
fn read_balanced(source: &[char], start: usize, open: char, close: char) -> usize {
    let mut depth = 0usize;
    let mut index = start;
    while index < source.len() {
        let character = source[index];
        if character == '\\' {
            index += 2;
            continue;
        }
        if character == open {
            depth += 1;
        } else if character == close {
            depth -= 1;
            if depth == 0 {
                return index + 1;
            }
        }
        index += 1;
    }
    source.len()
}

/// Consumes a quoted span including both quote characters.
fn read_quoted(source: &[char], start: usize, quote: char) -> usize {
    let mut index = start + 1;
    while index < source.len() {
        let character = source[index];
        if quote == '"' && character == '\\' {
            index += 2;
            continue;
        }
        if character == quote {
            return index + 1;
        }
        index += 1;
    }
    source.len()
}

/// Reads one shell word starting at `start`, treating quotes, `$(...)`,
/// `${...}` and backticks as atomic spans.
fn read_word(source: &[char], start: usize) -> (String, usize) {
    let mut index = start;
    while index < source.len() {
        let character = source[index];
        if character == '\\' {
            index += 2;
            continue;
        }
        if character == '\'' || character == '"' {
            index = read_quoted(source, index, character);
            continue;
        }
        if character == '`' {
            index = read_quoted(source, index, '`');
            continue;
        }
        if character == '$' && source.get(index + 1) == Some(&'(') {
            index = read_balanced(source, index + 1, '(', ')');
            continue;
        }
        if character == '$' && source.get(index + 1) == Some(&'{') {
            index = read_balanced(source, index + 1, '{', '}');
            continue;
        }
        if WORD_TERMINATORS.contains(&character) {
            break;
        }
        index += 1;
    }
    let end = index.min(source.len());
    (source[start..end].iter().collect(), end)
}

/// A redirection operator may be prefixed by a file descriptor (`2>`). Only a
/// leading run of digits counts as part of the operator, never as a word.
fn match_redirect(source: &[char], index: usize) -> Option<String> {
    let mut cursor = index;
    while source.get(cursor).is_some_and(char::is_ascii_digit) {
        cursor += 1;
    }
    for operator in [">>", ">&", "<<<", "<<", ">", "<"] {
        if starts_with(source, cursor, operator) {
            return Some(
                source[index..cursor + operator.chars().count()]
                    .iter()
                    .collect(),
            );
        }
    }
    None
}

fn starts_with(source: &[char], index: usize, text: &str) -> bool {
    text.chars()
        .enumerate()
        .all(|(offset, expected)| source.get(index + offset) == Some(&expected))
}

fn match_operator(source: &[char], index: usize) -> Option<&'static str> {
    OPERATORS
        .into_iter()
        .find(|operator| starts_with(source, index, operator))
}

/// Whitespace, line splices, newlines and comments.
///
/// Returns the token to emit (`None` emits nothing) and the index to continue
/// from, or `None` when the character starts a word or operator instead.
fn match_trivia(source: &[char], index: usize) -> Option<(Option<Token>, usize)> {
    let character = source[index];

    if character == '\n' {
        return Some((Some(Token::new(TokenType::Newline, "\n")), index + 1));
    }
    if character == ' ' || character == '\t' || character == '\r' {
        return Some((None, index + 1));
    }
    // A backslash-newline pair splices two physical lines into one.
    if character == '\\' && source.get(index + 1) == Some(&'\n') {
        return Some((None, index + 2));
    }
    // `#` only opens a comment at the start of a word.
    let after_separator = index == 0
        || source[index - 1].is_whitespace()
        || [';', '|', '&', '(', ')'].contains(&source[index - 1]);
    if character == '#' && after_separator {
        let end = source[index..]
            .iter()
            .position(|&c| c == '\n')
            .map_or(source.len(), |offset| index + offset);
        let text: String = source[index..end].iter().collect();
        return Some((Some(Token::new(TokenType::Comment, text)), end));
    }
    None
}

/// Tokenizes a complete shell script. The stream always ends with an EOF token.
pub fn tokenize(source: &str) -> Vec<Token> {
    let source: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0usize;

    while index < source.len() {
        if let Some((token, next)) = match_trivia(&source, index) {
            if let Some(token) = token {
                tokens.push(token);
            }
            index = next;
            continue;
        }

        if let Some(redirect) = match_redirect(&source, index) {
            index += redirect.chars().count();
            tokens.push(Token::new(TokenType::Redirect, redirect));
            continue;
        }
        // `&` on its own backgrounds a command; `&&` was matched by the operator list.
        let operator = match_operator(&source, index).or({
            if source[index] == '&' {
                Some("&")
            } else {
                None
            }
        });
        if let Some(operator) = operator {
            tokens.push(Token::new(TokenType::Operator, operator));
            index += operator.chars().count();
            continue;
        }

        let (text, next) = read_word(&source, index);
        if text.is_empty() {
            index += 1;
            continue;
        }
        tokens.push(Token::new(TokenType::Word, text));
        index = next;
    }

    tokens.push(Token::new(TokenType::Eof, ""));
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(source: &str) -> Vec<(TokenType, String)> {
        tokenize(source)
            .into_iter()
            .map(|token| (token.token_type, token.text))
            .collect()
    }

    #[test]
    fn tokenizes_words_and_operators() {
        assert_eq!(
            kinds("ls -la | grep x"),
            vec![
                (TokenType::Word, "ls".to_string()),
                (TokenType::Word, "-la".to_string()),
                (TokenType::Operator, "|".to_string()),
                (TokenType::Word, "grep".to_string()),
                (TokenType::Word, "x".to_string()),
                (TokenType::Eof, String::new()),
            ]
        );
    }

    #[test]
    fn keeps_substitutions_and_quotes_in_one_word() {
        assert_eq!(
            kinds("echo \"$(ls | wc -l) items\""),
            vec![
                (TokenType::Word, "echo".to_string()),
                (TokenType::Word, "\"$(ls | wc -l) items\"".to_string()),
                (TokenType::Eof, String::new()),
            ]
        );
    }

    #[test]
    fn reads_a_file_descriptor_prefixed_redirect() {
        assert_eq!(
            kinds("ls >out.txt 2>&1"),
            vec![
                (TokenType::Word, "ls".to_string()),
                (TokenType::Redirect, ">".to_string()),
                (TokenType::Word, "out.txt".to_string()),
                (TokenType::Redirect, "2>&".to_string()),
                (TokenType::Word, "1".to_string()),
                (TokenType::Eof, String::new()),
            ]
        );
    }

    #[test]
    fn emits_comments_and_newlines() {
        assert_eq!(
            kinds("# note\nls"),
            vec![
                (TokenType::Comment, "# note".to_string()),
                (TokenType::Newline, "\n".to_string()),
                (TokenType::Word, "ls".to_string()),
                (TokenType::Eof, String::new()),
            ]
        );
    }
}
