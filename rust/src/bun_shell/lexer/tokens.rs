//! Token kinds shared by the shell lexer and parser.

use super::RedirectFlags;

/// A lexer token. Text-like tokens hold a byte range into the strpool.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Token {
    Pipe,
    DoublePipe,
    Ampersand,
    DoubleAmpersand,
    Redirect(RedirectFlags),
    Asterisk,
    DoubleAsterisk,
    Semicolon,
    Newline,
    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    /// Follows `CmdSubstBegin` when the substitution is inside double quotes.
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,
    Var {
        start: usize,
        end: usize,
    },
    /// `$0`..`$9`.
    VarArgv(u8),
    Text {
        start: usize,
        end: usize,
    },
    SingleQuotedText {
        start: usize,
        end: usize,
    },
    DoubleQuotedText {
        start: usize,
        end: usize,
    },
    /// An interpolated object (`\x08__bun_N\x08`).
    JsObjRef(usize),
    DoubleBracketOpen,
    DoubleBracketClose,
    Delimit,
    Eof,
}

/// Payload-free token kinds, used for matching.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tag {
    Pipe,
    DoublePipe,
    Ampersand,
    DoubleAmpersand,
    Redirect,
    Asterisk,
    DoubleAsterisk,
    Semicolon,
    Newline,
    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,
    Var,
    VarArgv,
    Text,
    SingleQuotedText,
    DoubleQuotedText,
    JsObjRef,
    DoubleBracketOpen,
    DoubleBracketClose,
    Delimit,
    Eof,
}

impl Tag {
    /// The tag name used in error messages (`tok.t` in the JavaScript port).
    pub(crate) fn name(self) -> &'static str {
        match self {
            Tag::Pipe => "Pipe",
            Tag::DoublePipe => "DoublePipe",
            Tag::Ampersand => "Ampersand",
            Tag::DoubleAmpersand => "DoubleAmpersand",
            Tag::Redirect => "Redirect",
            Tag::Asterisk => "Asterisk",
            Tag::DoubleAsterisk => "DoubleAsterisk",
            Tag::Semicolon => "Semicolon",
            Tag::Newline => "Newline",
            Tag::BraceBegin => "BraceBegin",
            Tag::Comma => "Comma",
            Tag::BraceEnd => "BraceEnd",
            Tag::CmdSubstBegin => "CmdSubstBegin",
            Tag::CmdSubstQuoted => "CmdSubstQuoted",
            Tag::CmdSubstEnd => "CmdSubstEnd",
            Tag::OpenParen => "OpenParen",
            Tag::CloseParen => "CloseParen",
            Tag::Var => "Var",
            Tag::VarArgv => "VarArgv",
            Tag::Text => "Text",
            Tag::SingleQuotedText => "SingleQuotedText",
            Tag::DoubleQuotedText => "DoubleQuotedText",
            Tag::JsObjRef => "JSObjRef",
            Tag::DoubleBracketOpen => "DoubleBracketOpen",
            Tag::DoubleBracketClose => "DoubleBracketClose",
            Tag::Delimit => "Delimit",
            Tag::Eof => "Eof",
        }
    }
}

impl Token {
    pub(crate) fn tag(&self) -> Tag {
        match self {
            Token::Pipe => Tag::Pipe,
            Token::DoublePipe => Tag::DoublePipe,
            Token::Ampersand => Tag::Ampersand,
            Token::DoubleAmpersand => Tag::DoubleAmpersand,
            Token::Redirect(_) => Tag::Redirect,
            Token::Asterisk => Tag::Asterisk,
            Token::DoubleAsterisk => Tag::DoubleAsterisk,
            Token::Semicolon => Tag::Semicolon,
            Token::Newline => Tag::Newline,
            Token::BraceBegin => Tag::BraceBegin,
            Token::Comma => Tag::Comma,
            Token::BraceEnd => Tag::BraceEnd,
            Token::CmdSubstBegin => Tag::CmdSubstBegin,
            Token::CmdSubstQuoted => Tag::CmdSubstQuoted,
            Token::CmdSubstEnd => Tag::CmdSubstEnd,
            Token::OpenParen => Tag::OpenParen,
            Token::CloseParen => Tag::CloseParen,
            Token::Var { .. } => Tag::Var,
            Token::VarArgv(_) => Tag::VarArgv,
            Token::Text { .. } => Tag::Text,
            Token::SingleQuotedText { .. } => Tag::SingleQuotedText,
            Token::DoubleQuotedText { .. } => Tag::DoubleQuotedText,
            Token::JsObjRef(_) => Tag::JsObjRef,
            Token::DoubleBracketOpen => Tag::DoubleBracketOpen,
            Token::DoubleBracketClose => Tag::DoubleBracketClose,
            Token::Delimit => Tag::Delimit,
            Token::Eof => Tag::Eof,
        }
    }

    /// The strpool range of a text-like token.
    pub(crate) fn range(&self) -> Option<(usize, usize)> {
        match *self {
            Token::Var { start, end }
            | Token::Text { start, end }
            | Token::SingleQuotedText { start, end }
            | Token::DoubleQuotedText { start, end } => Some((start, end)),
            _ => None,
        }
    }
}
