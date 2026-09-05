//! Enhanced shell command parser that handles &&, ||, ;, and () operators
//! This allows virtual commands to work properly with shell operators

use std::fmt;

/// Token types for the parser
#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    Word(String),
    And,            // &&
    Or,             // ||
    Semicolon,      // ;
    Pipe,           // |
    LParen,         // (
    RParen,         // )
    RedirectOut,    // >
    RedirectAppend, // >>
    RedirectIn,     // <
    Eof,
}

impl fmt::Display for TokenType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TokenType::Word(s) => write!(f, "Word({})", s),
            TokenType::And => write!(f, "&&"),
            TokenType::Or => write!(f, "||"),
            TokenType::Semicolon => write!(f, ";"),
            TokenType::Pipe => write!(f, "|"),
            TokenType::LParen => write!(f, "("),
            TokenType::RParen => write!(f, ")"),
            TokenType::RedirectOut => write!(f, ">"),
            TokenType::RedirectAppend => write!(f, ">>"),
            TokenType::RedirectIn => write!(f, "<"),
            TokenType::Eof => write!(f, "EOF"),
        }
    }
}

/// A token with its type and original value
#[derive(Debug, Clone)]
pub struct Token {
    pub token_type: TokenType,
    pub value: String,
}

/// Redirect information
#[derive(Debug, Clone)]
pub struct Redirect {
    pub redirect_type: TokenType,
    pub target: String,
}

/// Parsed argument with quote information
#[derive(Debug, Clone)]
pub struct ParsedArg {
    pub value: String,
    pub quoted: bool,
    pub quote_char: Option<char>,
    /// The original word exactly as written, including any quote characters, so
    /// callers that re-serialize the command back to a real shell round-trip it
    /// without having to re-quote from `value`.
    pub raw: String,
}

/// Perform POSIX quote removal on a single already-tokenized word.
///
/// A shell word may carry quotes anywhere inside it, not just wrapped around
/// the whole thing: `label:'help wanted'`, `--flag="a b"` and `a'b c'd` are all
/// one word each. The shell strips the quote characters and concatenates the
/// quoted and unquoted pieces into a single argument. Our tokenizer keeps the
/// quotes in the word (so it can split correctly and hand a valid command back
/// to a real shell when needed); this function turns that raw word into the
/// literal value a built-in command should receive, exactly as `/bin/sh` would
/// (issue #48).
///
/// Rules mirrored from POSIX:
///   - Outside quotes, a backslash escapes the next character (it becomes
///     literal and loses any quoting role). On Windows the backslash is the
///     path separator, so an unquoted backslash is kept literal there — eating
///     it would corrupt paths such as `cd C:\Users\foo`.
///   - Inside `'...'`, every character is literal, including backslash.
///   - Inside `"..."`, a backslash only escapes `$`, `` ` ``, `"`, `\` and
///     newline; before anything else it stays a literal backslash.
///
/// Returns the quote-removed value, whether any quoting/escaping was applied,
/// and the first quote character seen.
pub fn remove_shell_quotes(word: &str) -> (String, bool, Option<char>) {
    let chars: Vec<char> = word.chars().collect();
    let mut value = String::new();
    let mut quoted = false;
    let mut quote_char: Option<char> = None;
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c == '\'' {
            quoted = true;
            if quote_char.is_none() {
                quote_char = Some('\'');
            }
            i += 1;
            while i < chars.len() && chars[i] != '\'' {
                value.push(chars[i]);
                i += 1;
            }
            i += 1; // skip the closing quote (if any)
            continue;
        }

        if c == '"' {
            quoted = true;
            if quote_char.is_none() {
                quote_char = Some('"');
            }
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\'
                    && i + 1 < chars.len()
                    && matches!(chars[i + 1], '$' | '`' | '"' | '\\' | '\n')
                {
                    value.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                value.push(chars[i]);
                i += 1;
            }
            i += 1; // skip the closing quote (if any)
            continue;
        }

        if c == '\\' && i + 1 < chars.len() && !cfg!(windows) {
            quoted = true;
            value.push(chars[i + 1]);
            i += 2;
            continue;
        }

        value.push(c);
        i += 1;
    }

    (value, quoted, quote_char)
}

/// Split a simple command string into its words, respecting quotes and applying
/// POSIX quote removal to each word. Operators are ignored, so this is meant for
/// simple commands (the virtual-command dispatch path). Mirrors the JS parser's
/// per-argument quote removal so `echo label:'help wanted'` yields
/// `["echo", "label:help wanted"]` rather than splitting inside the quotes.
pub fn split_command_words(command: &str) -> Vec<String> {
    tokenize(command)
        .into_iter()
        .filter_map(|token| match token.token_type {
            TokenType::Word(w) => Some(remove_shell_quotes(&w).0),
            _ => None,
        })
        .collect()
}

/// Types of parsed commands
#[derive(Debug, Clone)]
pub enum ParsedCommand {
    /// A simple command with command name, arguments, and optional redirects
    Simple {
        cmd: String,
        args: Vec<ParsedArg>,
        redirects: Vec<Redirect>,
    },
    /// A sequence of commands connected by &&, ||, or ;
    Sequence {
        commands: Vec<ParsedCommand>,
        operators: Vec<TokenType>,
    },
    /// A pipeline of commands connected by |
    Pipeline { commands: Vec<ParsedCommand> },
    /// A subshell (commands in parentheses)
    Subshell { command: Box<ParsedCommand> },
}

/// Tokenize a shell command string
pub fn tokenize(command: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = command.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Skip whitespace
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }

        if i >= chars.len() {
            break;
        }

        // Check for operators
        if chars[i] == '&' && i + 1 < chars.len() && chars[i + 1] == '&' {
            tokens.push(Token {
                token_type: TokenType::And,
                value: "&&".to_string(),
            });
            i += 2;
        } else if chars[i] == '&' {
            // A lone `&` (backgrounding, or the fd-duplication form in `2>&1`)
            // is not modeled by this parser. Consume it so the tokenizer always
            // makes progress: the word branch below lists `&` in its stop set,
            // so without this arm it would break without advancing `i` and spin
            // forever. Commands that truly rely on `&`/redirection are routed to
            // a real shell (needs_real_shell) before we tokenize for virtual
            // command dispatch, so dropping the token here is safe.
            i += 1;
        } else if chars[i] == '|' && i + 1 < chars.len() && chars[i + 1] == '|' {
            tokens.push(Token {
                token_type: TokenType::Or,
                value: "||".to_string(),
            });
            i += 2;
        } else if chars[i] == '|' {
            tokens.push(Token {
                token_type: TokenType::Pipe,
                value: "|".to_string(),
            });
            i += 1;
        } else if chars[i] == ';' {
            tokens.push(Token {
                token_type: TokenType::Semicolon,
                value: ";".to_string(),
            });
            i += 1;
        } else if chars[i] == '(' {
            tokens.push(Token {
                token_type: TokenType::LParen,
                value: "(".to_string(),
            });
            i += 1;
        } else if chars[i] == ')' {
            tokens.push(Token {
                token_type: TokenType::RParen,
                value: ")".to_string(),
            });
            i += 1;
        } else if chars[i] == '>' && i + 1 < chars.len() && chars[i + 1] == '>' {
            tokens.push(Token {
                token_type: TokenType::RedirectAppend,
                value: ">>".to_string(),
            });
            i += 2;
        } else if chars[i] == '>' {
            tokens.push(Token {
                token_type: TokenType::RedirectOut,
                value: ">".to_string(),
            });
            i += 1;
        } else if chars[i] == '<' {
            tokens.push(Token {
                token_type: TokenType::RedirectIn,
                value: "<".to_string(),
            });
            i += 1;
        } else {
            // Parse word (respecting quotes)
            let mut word = String::new();
            let mut in_quote = false;
            let mut quote_char = ' ';

            while i < chars.len() {
                let c = chars[i];

                if !in_quote {
                    if c == '"' || c == '\'' {
                        in_quote = true;
                        quote_char = c;
                        word.push(c);
                        i += 1;
                    } else if c.is_whitespace() || "&|;()<>".contains(c) {
                        break;
                    } else if c == '\\' && i + 1 < chars.len() {
                        // Handle escape sequences
                        word.push(c);
                        i += 1;
                        if i < chars.len() {
                            word.push(chars[i]);
                            i += 1;
                        }
                    } else {
                        word.push(c);
                        i += 1;
                    }
                } else {
                    let prev_char = if i > 0 { Some(chars[i - 1]) } else { None };
                    if c == quote_char && prev_char != Some('\\') {
                        in_quote = false;
                        word.push(c);
                        i += 1;
                    } else if c == '\\' && i + 1 < chars.len() {
                        let next_char = chars[i + 1];
                        if next_char == quote_char || next_char == '\\' {
                            // Handle escaped quotes and backslashes inside quotes
                            word.push(c);
                            i += 1;
                            if i < chars.len() {
                                word.push(chars[i]);
                                i += 1;
                            }
                        } else {
                            word.push(c);
                            i += 1;
                        }
                    } else {
                        word.push(c);
                        i += 1;
                    }
                }
            }

            if !word.is_empty() {
                tokens.push(Token {
                    token_type: TokenType::Word(word.clone()),
                    value: word,
                });
            }
        }
    }

    tokens.push(Token {
        token_type: TokenType::Eof,
        value: String::new(),
    });

    tokens
}

/// Shell command parser
pub struct ShellParser {
    tokens: Vec<Token>,
    pos: usize,
}

impl ShellParser {
    /// Create a new parser for the given command
    pub fn new(command: &str) -> Self {
        ShellParser {
            tokens: tokenize(command),
            pos: 0,
        }
    }

    fn current(&self) -> Token {
        self.tokens.get(self.pos).cloned().unwrap_or(Token {
            token_type: TokenType::Eof,
            value: String::new(),
        })
    }

    fn consume(&mut self) -> Token {
        let token = self.current().clone();
        self.pos += 1;
        token
    }

    /// Parse the main command sequence
    pub fn parse(&mut self) -> Option<ParsedCommand> {
        self.parse_sequence()
    }

    /// Parse a sequence of commands connected by &&, ||, ;
    fn parse_sequence(&mut self) -> Option<ParsedCommand> {
        let mut commands = Vec::new();
        let mut operators = Vec::new();

        // Parse first command
        if let Some(cmd) = self.parse_pipeline() {
            commands.push(cmd);
        }

        // Parse additional commands with operators
        loop {
            match &self.current().token_type {
                TokenType::Eof | TokenType::RParen => break,
                TokenType::And | TokenType::Or | TokenType::Semicolon => {
                    let op = self.consume().token_type;
                    operators.push(op);

                    if let Some(cmd) = self.parse_pipeline() {
                        commands.push(cmd);
                    }
                }
                _ => break,
            }
        }

        if commands.len() == 1 && operators.is_empty() {
            return commands.into_iter().next();
        }

        if commands.is_empty() {
            return None;
        }

        Some(ParsedCommand::Sequence {
            commands,
            operators,
        })
    }

    /// Parse a pipeline (commands connected by |)
    fn parse_pipeline(&mut self) -> Option<ParsedCommand> {
        let mut commands = Vec::new();

        if let Some(cmd) = self.parse_command() {
            commands.push(cmd);
        }

        while matches!(self.current().token_type, TokenType::Pipe) {
            self.consume();
            if let Some(cmd) = self.parse_command() {
                commands.push(cmd);
            }
        }

        if commands.len() == 1 {
            return commands.into_iter().next();
        }

        if commands.is_empty() {
            return None;
        }

        Some(ParsedCommand::Pipeline { commands })
    }

    /// Parse a single command or subshell
    fn parse_command(&mut self) -> Option<ParsedCommand> {
        // Check for subshell
        if matches!(self.current().token_type, TokenType::LParen) {
            self.consume(); // consume (
            let subshell = self.parse_sequence();

            if matches!(self.current().token_type, TokenType::RParen) {
                self.consume(); // consume )
            }

            return subshell.map(|cmd| ParsedCommand::Subshell {
                command: Box::new(cmd),
            });
        }

        // Parse simple command
        self.parse_simple_command()
    }

    /// Parse a simple command (command + args + redirections)
    fn parse_simple_command(&mut self) -> Option<ParsedCommand> {
        let mut words = Vec::new();
        let mut redirects = Vec::new();

        loop {
            match &self.current().token_type {
                TokenType::Eof => break,
                TokenType::Word(w) => {
                    words.push(w.clone());
                    self.consume();
                }
                TokenType::RedirectOut | TokenType::RedirectAppend | TokenType::RedirectIn => {
                    let redirect_type = self.consume().token_type;
                    if let TokenType::Word(target) = &self.current().token_type {
                        redirects.push(Redirect {
                            redirect_type,
                            target: target.clone(),
                        });
                        self.consume();
                    }
                }
                _ => break,
            }
        }

        if words.is_empty() {
            return None;
        }

        let cmd = words.remove(0);
        let args: Vec<ParsedArg> = words
            .into_iter()
            .map(|word| {
                // POSIX quote removal: strip quotes wherever they appear in the
                // word and concatenate the pieces, so `label:'help wanted'`
                // becomes one argument `label:help wanted` (issue #48). `raw`
                // keeps the original text for paths that re-serialize the
                // command back to a real shell.
                let (value, quoted, quote_char) = remove_shell_quotes(&word);
                ParsedArg {
                    value,
                    quoted,
                    quote_char,
                    raw: word,
                }
            })
            .collect();

        Some(ParsedCommand::Simple {
            cmd,
            args,
            redirects,
        })
    }
}

/// Parse a shell command with support for &&, ||, ;, and ()
pub fn parse_shell_command(command: &str) -> Option<ParsedCommand> {
    let mut parser = ShellParser::new(command);
    parser.parse()
}

/// Check if a command needs shell features we don't handle.
///
/// Redirection counts as such a feature. Virtual commands receive a plain
/// argument list built by splitting on whitespace, so a redirection left in
/// that list is passed through as a literal argument: `echo hello > out.txt`
/// would print `hello > out.txt` and write no file, and `git push ... 2>&1`
/// would report success while nothing was pushed. Handing the whole command to
/// the system shell is the only way to get exactly the POSIX result
/// (issue #46).
pub fn needs_real_shell(command: &str) -> bool {
    // Check for features we don't handle yet
    let unsupported = [
        '`', // Command substitution
        '$', // Command substitution and variable expansion
        '~', // Home expansion (at start of word)
        '*', // Glob patterns
        '?', // Glob patterns
        '[', // Glob patterns
        '>', // Output redirection, in every form (>, >>, 2>, &>, >&)
        '<', // Input redirection, in every form (<, <<, <<<)
    ];

    command.chars().any(|c| unsupported.contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_simple_command() {
        let tokens = tokenize("echo hello world");
        assert_eq!(tokens.len(), 4); // 3 words + EOF
        assert!(matches!(tokens[0].token_type, TokenType::Word(_)));
        assert!(matches!(tokens[3].token_type, TokenType::Eof));
    }

    #[test]
    fn test_tokenize_with_operators() {
        let tokens = tokenize("cmd1 && cmd2 || cmd3");
        assert_eq!(tokens.len(), 6); // 3 words + 2 operators + EOF
        assert!(matches!(tokens[1].token_type, TokenType::And));
        assert!(matches!(tokens[3].token_type, TokenType::Or));
    }

    #[test]
    fn test_tokenize_with_pipe() {
        let tokens = tokenize("ls | grep foo");
        assert_eq!(tokens.len(), 5); // 3 words + 1 pipe + EOF
        assert!(matches!(tokens[1].token_type, TokenType::Pipe));
    }

    #[test]
    fn test_tokenize_with_quotes() {
        let tokens = tokenize("echo 'hello world'");
        assert_eq!(tokens.len(), 3); // echo + quoted string + EOF
        if let TokenType::Word(w) = &tokens[1].token_type {
            assert_eq!(w, "'hello world'");
        } else {
            panic!("Expected Word token");
        }
    }

    #[test]
    fn test_parse_simple_command() {
        let cmd = parse_shell_command("echo hello world").unwrap();
        match cmd {
            ParsedCommand::Simple { cmd, args, .. } => {
                assert_eq!(cmd, "echo");
                assert_eq!(args.len(), 2);
                assert_eq!(args[0].value, "hello");
                assert_eq!(args[1].value, "world");
            }
            _ => panic!("Expected Simple command"),
        }
    }

    #[test]
    fn test_parse_pipeline() {
        let cmd = parse_shell_command("ls | grep foo | wc -l").unwrap();
        match cmd {
            ParsedCommand::Pipeline { commands } => {
                assert_eq!(commands.len(), 3);
            }
            _ => panic!("Expected Pipeline"),
        }
    }

    #[test]
    fn test_parse_sequence() {
        let cmd = parse_shell_command("cmd1 && cmd2 || cmd3").unwrap();
        match cmd {
            ParsedCommand::Sequence {
                commands,
                operators,
            } => {
                assert_eq!(commands.len(), 3);
                assert_eq!(operators.len(), 2);
                assert!(matches!(operators[0], TokenType::And));
                assert!(matches!(operators[1], TokenType::Or));
            }
            _ => panic!("Expected Sequence"),
        }
    }

    #[test]
    fn test_needs_real_shell() {
        assert!(needs_real_shell("echo $(date)"));
        assert!(needs_real_shell("ls *.txt"));
        assert!(needs_real_shell("echo ${HOME}"));
        assert!(!needs_real_shell("echo hello"));
        assert!(!needs_real_shell("ls | grep foo"));
    }

    #[test]
    fn test_parse_with_redirect() {
        let cmd = parse_shell_command("echo hello > output.txt").unwrap();
        match cmd {
            ParsedCommand::Simple {
                cmd,
                args,
                redirects,
            } => {
                assert_eq!(cmd, "echo");
                assert_eq!(args.len(), 1);
                assert_eq!(redirects.len(), 1);
                assert!(matches!(redirects[0].redirect_type, TokenType::RedirectOut));
                assert_eq!(redirects[0].target, "output.txt");
            }
            _ => panic!("Expected Simple command with redirect"),
        }
    }

    #[test]
    fn test_parse_subshell() {
        let cmd = parse_shell_command("(echo hello) && echo world").unwrap();
        match cmd {
            ParsedCommand::Sequence { commands, .. } => {
                assert_eq!(commands.len(), 2);
                assert!(matches!(commands[0], ParsedCommand::Subshell { .. }));
            }
            _ => panic!("Expected Sequence with Subshell"),
        }
    }

    // ------------------------------------------------------------------------
    // Quote removal (issue #48)
    // ------------------------------------------------------------------------

    #[test]
    fn test_remove_shell_quotes_whole_word() {
        assert_eq!(remove_shell_quotes("'help wanted'").0, "help wanted");
        assert_eq!(remove_shell_quotes("\"help wanted\"").0, "help wanted");
    }

    #[test]
    fn test_remove_shell_quotes_embedded() {
        // The shape from the issue: an interpolated label inside a search term.
        assert_eq!(
            remove_shell_quotes("label:'help wanted'").0,
            "label:help wanted"
        );
        assert_eq!(
            remove_shell_quotes("label:\"help wanted\"").0,
            "label:help wanted"
        );
        assert_eq!(
            remove_shell_quotes("--label='help wanted'").0,
            "--label=help wanted"
        );
    }

    #[test]
    fn test_remove_shell_quotes_concatenation() {
        assert_eq!(remove_shell_quotes("a'b c'd").0, "ab cd");
        assert_eq!(remove_shell_quotes("pre'post'").0, "prepost");
        assert_eq!(remove_shell_quotes("'a''b'").0, "ab");
        assert_eq!(remove_shell_quotes("a''b").0, "ab");
    }

    #[test]
    fn test_remove_shell_quotes_escapes() {
        // Inside double quotes, backslash only escapes a small set (this is the
        // same on every platform).
        assert_eq!(remove_shell_quotes("\"a\\\"b\"").0, "a\"b");
        assert_eq!(remove_shell_quotes("\"a\\nb\"").0, "a\\nb");

        // Unquoted backslash escaping is POSIX-only. On Windows the backslash is
        // the path separator, so it stays literal (see the Windows path test).
        #[cfg(not(windows))]
        {
            // POSIX single-quote idiom produced by quote() for a quoted value.
            assert_eq!(remove_shell_quotes("'it'\\''s here'").0, "it's here");
            // Backslash escapes a space outside quotes.
            assert_eq!(remove_shell_quotes("a\\ b").0, "a b");
        }
    }

    // On Windows an unquoted backslash must be preserved so that virtual
    // commands like `cd C:\Users\foo` still receive a valid path.
    #[cfg(windows)]
    #[test]
    fn test_remove_shell_quotes_windows_path() {
        assert_eq!(
            remove_shell_quotes("C:\\Users\\foo").0,
            "C:\\Users\\foo".to_string()
        );
        // A quoted Windows path is likewise preserved.
        assert_eq!(
            remove_shell_quotes("\"C:\\Users\\foo\"").0,
            "C:\\Users\\foo".to_string()
        );
    }

    #[test]
    fn test_remove_shell_quotes_flags() {
        let (value, quoted, quote_char) = remove_shell_quotes("'x'");
        assert_eq!(value, "x");
        assert!(quoted);
        assert_eq!(quote_char, Some('\''));

        let (value, quoted, quote_char) = remove_shell_quotes("plain");
        assert_eq!(value, "plain");
        assert!(!quoted);
        assert_eq!(quote_char, None);
    }

    #[test]
    fn test_tokenize_terminates_on_lone_ampersand() {
        // Regression: a lone `&` (fd duplication `2>&1`, or backgrounding) used
        // to spin the tokenizer forever because it matched neither the `&&`
        // operator nor advanced the word scanner. It must now terminate.
        let tokens = tokenize("git push origin HEAD 2>&1");
        let words: Vec<String> = tokens
            .into_iter()
            .filter_map(|t| match t.token_type {
                TokenType::Word(w) => Some(w),
                _ => None,
            })
            .collect();
        assert_eq!(words, vec!["git", "push", "origin", "HEAD", "2", "1"]);
    }

    #[test]
    fn test_split_command_words_terminates_on_background() {
        // `echo a & echo b` is not caught by needs_real_shell, so it can reach
        // the tokenizer with a lone `&`; it must terminate rather than hang.
        assert_eq!(
            split_command_words("echo a & echo b"),
            vec![
                "echo".to_string(),
                "a".to_string(),
                "echo".to_string(),
                "b".to_string()
            ]
        );
    }

    #[test]
    fn test_split_command_words_quote_removal() {
        assert_eq!(
            split_command_words("echo label:'help wanted' is:open"),
            vec![
                "echo".to_string(),
                "label:help wanted".to_string(),
                "is:open".to_string()
            ]
        );
    }

    #[test]
    fn test_parse_simple_command_embedded_quotes() {
        let cmd = parse_shell_command("gh search issues label:'help wanted'").unwrap();
        match cmd {
            ParsedCommand::Simple { cmd, args, .. } => {
                assert_eq!(cmd, "gh");
                assert_eq!(args.last().unwrap().value, "label:help wanted");
                assert!(args.last().unwrap().quoted);
                // `raw` keeps the original word for re-serialization.
                assert_eq!(args.last().unwrap().raw, "label:'help wanted'");
            }
            _ => panic!("Expected Simple command"),
        }
    }
}
