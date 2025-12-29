//! Enhanced shell command parser that handles &&, ||, ;, and () operators
//! This allows virtual commands to work properly with shell operators

use std::fmt;

/// Token types for the parser
#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    Word(String),
    And,        // &&
    Or,         // ||
    Semicolon,  // ;
    Pipe,       // |
    LParen,     // (
    RParen,     // )
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
    Pipeline {
        commands: Vec<ParsedCommand>,
    },
    /// A subshell (commands in parentheses)
    Subshell {
        command: Box<ParsedCommand>,
    },
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

    fn current(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or(&Token {
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
                // Remove quotes if present
                if (word.starts_with('"') && word.ends_with('"'))
                    || (word.starts_with('\'') && word.ends_with('\''))
                {
                    ParsedArg {
                        value: word[1..word.len() - 1].to_string(),
                        quoted: true,
                        quote_char: Some(word.chars().next().unwrap()),
                    }
                } else {
                    ParsedArg {
                        value: word,
                        quoted: false,
                        quote_char: None,
                    }
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

/// Check if a command needs shell features we don't handle
pub fn needs_real_shell(command: &str) -> bool {
    // Check for features we don't handle yet
    let unsupported = [
        "`",   // Command substitution
        "$(",  // Command substitution
        "${",  // Variable expansion
        "~",   // Home expansion (at start of word)
        "*",   // Glob patterns
        "?",   // Glob patterns
        "[",   // Glob patterns
        "2>",  // stderr redirection
        "&>",  // Combined redirection
        ">&",  // File descriptor duplication
        "<<",  // Here documents
        "<<<", // Here strings
    ];

    for feature in &unsupported {
        if command.contains(feature) {
            return true;
        }
    }

    false
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
                assert!(matches!(
                    redirects[0].redirect_type,
                    TokenType::RedirectOut
                ));
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
}
