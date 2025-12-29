//! Integration tests for shell parser
//!
//! These tests mirror the JavaScript shell parser tests

use command_stream::shell_parser::{needs_real_shell, parse_shell_command, tokenize, ParsedCommand, TokenType};

// ============================================================================
// Tokenizer Tests
// ============================================================================

#[test]
fn test_tokenize_simple_command() {
    let tokens = tokenize("echo hello world");
    assert_eq!(tokens.len(), 4); // 3 words + EOF
    assert!(matches!(tokens[0].token_type, TokenType::Word(_)));
    assert!(matches!(tokens[1].token_type, TokenType::Word(_)));
    assert!(matches!(tokens[2].token_type, TokenType::Word(_)));
    assert!(matches!(tokens[3].token_type, TokenType::Eof));
}

#[test]
fn test_tokenize_with_and_operator() {
    let tokens = tokenize("cmd1 && cmd2");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::And)));
}

#[test]
fn test_tokenize_with_or_operator() {
    let tokens = tokenize("cmd1 || cmd2");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::Or)));
}

#[test]
fn test_tokenize_with_pipe() {
    let tokens = tokenize("ls | grep foo");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::Pipe)));
}

#[test]
fn test_tokenize_with_semicolon() {
    let tokens = tokenize("cmd1 ; cmd2");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::Semicolon)));
}

#[test]
fn test_tokenize_with_parentheses() {
    let tokens = tokenize("(echo hello)");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::LParen)));
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::RParen)));
}

#[test]
fn test_tokenize_with_redirect() {
    let tokens = tokenize("echo hello > file.txt");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::RedirectOut)));
}

#[test]
fn test_tokenize_with_append_redirect() {
    let tokens = tokenize("echo hello >> file.txt");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::RedirectAppend)));
}

#[test]
fn test_tokenize_with_input_redirect() {
    let tokens = tokenize("cat < file.txt");
    assert!(tokens.iter().any(|t| matches!(t.token_type, TokenType::RedirectIn)));
}

#[test]
fn test_tokenize_single_quoted_string() {
    let tokens = tokenize("echo 'hello world'");
    assert_eq!(tokens.len(), 3); // echo + quoted string + EOF
    if let TokenType::Word(w) = &tokens[1].token_type {
        assert_eq!(w, "'hello world'");
    } else {
        panic!("Expected Word token");
    }
}

#[test]
fn test_tokenize_double_quoted_string() {
    let tokens = tokenize("echo \"hello world\"");
    assert_eq!(tokens.len(), 3); // echo + quoted string + EOF
    if let TokenType::Word(w) = &tokens[1].token_type {
        assert_eq!(w, "\"hello world\"");
    } else {
        panic!("Expected Word token");
    }
}

#[test]
fn test_tokenize_mixed_operators() {
    let tokens = tokenize("cmd1 && cmd2 || cmd3 ; cmd4");
    let ops: Vec<_> = tokens
        .iter()
        .filter(|t| matches!(t.token_type, TokenType::And | TokenType::Or | TokenType::Semicolon))
        .collect();
    assert_eq!(ops.len(), 3);
}

// ============================================================================
// Parser Tests
// ============================================================================

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
fn test_parse_command_with_quoted_args() {
    let cmd = parse_shell_command("echo 'hello world'").unwrap();
    match cmd {
        ParsedCommand::Simple { cmd, args, .. } => {
            assert_eq!(cmd, "echo");
            assert_eq!(args.len(), 1);
            assert_eq!(args[0].value, "hello world");
            assert!(args[0].quoted);
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
fn test_parse_sequence_with_and() {
    let cmd = parse_shell_command("cmd1 && cmd2").unwrap();
    match cmd {
        ParsedCommand::Sequence { commands, operators } => {
            assert_eq!(commands.len(), 2);
            assert_eq!(operators.len(), 1);
            assert!(matches!(operators[0], TokenType::And));
        }
        _ => panic!("Expected Sequence"),
    }
}

#[test]
fn test_parse_sequence_with_or() {
    let cmd = parse_shell_command("cmd1 || cmd2").unwrap();
    match cmd {
        ParsedCommand::Sequence { commands, operators } => {
            assert_eq!(commands.len(), 2);
            assert_eq!(operators.len(), 1);
            assert!(matches!(operators[0], TokenType::Or));
        }
        _ => panic!("Expected Sequence"),
    }
}

#[test]
fn test_parse_sequence_mixed() {
    let cmd = parse_shell_command("cmd1 && cmd2 || cmd3").unwrap();
    match cmd {
        ParsedCommand::Sequence { commands, operators } => {
            assert_eq!(commands.len(), 3);
            assert_eq!(operators.len(), 2);
            assert!(matches!(operators[0], TokenType::And));
            assert!(matches!(operators[1], TokenType::Or));
        }
        _ => panic!("Expected Sequence"),
    }
}

#[test]
fn test_parse_with_redirect_out() {
    let cmd = parse_shell_command("echo hello > output.txt").unwrap();
    match cmd {
        ParsedCommand::Simple { cmd, args, redirects } => {
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
fn test_parse_with_redirect_append() {
    let cmd = parse_shell_command("echo hello >> output.txt").unwrap();
    match cmd {
        ParsedCommand::Simple { redirects, .. } => {
            assert_eq!(redirects.len(), 1);
            assert!(matches!(redirects[0].redirect_type, TokenType::RedirectAppend));
        }
        _ => panic!("Expected Simple command with redirect"),
    }
}

#[test]
fn test_parse_subshell() {
    let cmd = parse_shell_command("(echo hello)").unwrap();
    match cmd {
        ParsedCommand::Subshell { command } => {
            match *command {
                ParsedCommand::Simple { cmd, .. } => {
                    assert_eq!(cmd, "echo");
                }
                _ => panic!("Expected Simple command inside subshell"),
            }
        }
        _ => panic!("Expected Subshell"),
    }
}

#[test]
fn test_parse_subshell_with_sequence() {
    let cmd = parse_shell_command("(echo hello) && echo world").unwrap();
    match cmd {
        ParsedCommand::Sequence { commands, .. } => {
            assert_eq!(commands.len(), 2);
            assert!(matches!(commands[0], ParsedCommand::Subshell { .. }));
        }
        _ => panic!("Expected Sequence with Subshell"),
    }
}

#[test]
fn test_parse_complex_pipeline_and_sequence() {
    let cmd = parse_shell_command("ls | grep foo && cat file | wc").unwrap();
    // This should be: (ls | grep foo) && (cat file | wc)
    match cmd {
        ParsedCommand::Sequence { commands, operators } => {
            assert_eq!(commands.len(), 2);
            assert_eq!(operators.len(), 1);
            // Both commands should be pipelines
        }
        _ => panic!("Expected Sequence"),
    }
}

// ============================================================================
// needs_real_shell Tests
// ============================================================================

#[test]
fn test_needs_real_shell_command_substitution() {
    assert!(needs_real_shell("echo $(date)"));
    assert!(needs_real_shell("echo `date`"));
}

#[test]
fn test_needs_real_shell_variable_expansion() {
    assert!(needs_real_shell("echo ${HOME}"));
}

#[test]
fn test_needs_real_shell_glob_patterns() {
    assert!(needs_real_shell("ls *.txt"));
    assert!(needs_real_shell("ls file?.txt"));
    assert!(needs_real_shell("ls [abc].txt"));
}

#[test]
fn test_needs_real_shell_stderr_redirect() {
    assert!(needs_real_shell("cmd 2>/dev/null"));
}

#[test]
fn test_needs_real_shell_combined_redirect() {
    assert!(needs_real_shell("cmd &>/dev/null"));
}

#[test]
fn test_needs_real_shell_here_document() {
    assert!(needs_real_shell("cat << EOF"));
}

#[test]
fn test_needs_real_shell_simple_commands() {
    assert!(!needs_real_shell("echo hello"));
    assert!(!needs_real_shell("ls | grep foo"));
    assert!(!needs_real_shell("cmd1 && cmd2"));
}
