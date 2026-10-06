//! Bun Shell lexer, ported from Bun's `src/shell_parser/parse.rs` (`Lexer`)
//! via `js/src/bun-shell/lexer.mjs`.
//!
//! The input is the script assembled by the template builder: literal
//! template text plus `\x08__bunstr_N\x08` placeholders for interpolated
//! strings that must not be re-lexed, and `\x08__bun_N\x08` placeholders for
//! interpolated objects (byte buffers).
//!
//! Text-like tokens carry a `[start, end)` byte range into `strpool`, the
//! string the lexer accumulates word contents into. `js_string_ranges` records
//! which strpool ranges came from interpolated strings, so the parser can
//! refuse to treat them as keywords or assignments.

use super::parser::RedirectFlags;

/// Marks the start and end of a JS value reference in the script source.
pub(crate) const SPECIAL_JS_CHAR: char = '\x08';
/// Prefix of an interpolated object reference (`\x08__bun_N\x08`).
pub(crate) const LEX_JS_OBJREF_PREFIX: &str = "\x08__bun_";
/// Prefix of an interpolated string reference (`\x08__bunstr_N\x08`).
pub(crate) const LEX_JS_STRING_PREFIX: &str = "\x08__bunstr_";
const MAX_SUBSHELL_DEPTH: usize = 128;

mod tokens;
pub(crate) use tokens::{Tag, Token};

/// The lexer output.
#[derive(Debug, Default)]
pub(crate) struct LexResult {
    pub tokens: Vec<Token>,
    pub strpool: String,
    /// Strpool ranges holding interpolated strings.
    pub js_string_ranges: Vec<(usize, usize)>,
    /// Error messages; lexing failed when non-empty.
    pub errors: Vec<String>,
}

/// Subshells nested deeper than Bun allows (`MAX_SUBSHELL_DEPTH`).
#[derive(Debug)]
pub(crate) struct DepthExceeded;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QuoteState {
    Normal,
    Single,
    Double,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SubshellKind {
    Normal,
    Backtick,
    Dollar,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BreakAdd {
    No,
    AfterText,
    AfterWord,
}

/// What a lexing step did with the character it was given.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    Consumed,
    NotConsumed,
    /// Stop this (sub)lexer.
    Return,
}

impl From<bool> for Step {
    fn from(consumed: bool) -> Self {
        if consumed {
            Step::Consumed
        } else {
            Step::NotConsumed
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct InputChar {
    ch: char,
    escaped: bool,
}

/// Cursor state of the shell character iterator (`ShellCharIter`).
#[derive(Clone, Copy)]
struct CharIter {
    i: usize,
    state: QuoteState,
    prev: Option<InputChar>,
    current: Option<InputChar>,
}

#[derive(Clone, Copy)]
struct Snapshot {
    chars: CharIter,
    j: usize,
    word_start: usize,
}

fn is_whitespace(c: InputChar) -> bool {
    matches!(c.ch, '\t' | '\r' | '\n' | ' ')
}

struct Lexer<'a> {
    cps: Vec<char>,
    chars: CharIter,
    word_start: usize,
    j: usize,
    out: LexResult,
    in_subshell: Option<SubshellKind>,
    subshell_depth: usize,
    string_refs: &'a [String],
    jsobjs_len: usize,
}

impl<'a> Lexer<'a> {
    fn new(src: &str, string_refs: &'a [String], jsobjs_len: usize) -> Self {
        Self {
            cps: src.chars().collect(),
            chars: CharIter {
                i: 0,
                state: QuoteState::Normal,
                prev: None,
                current: None,
            },
            word_start: 0,
            j: 0,
            out: LexResult::default(),
            in_subshell: None,
            subshell_depth: 0,
            string_refs,
            jsobjs_len,
        }
    }

    fn add_error(&mut self, msg: impl Into<String>) {
        self.out.errors.push(msg.into());
    }

    fn push(&mut self, tok: Token) {
        self.out.tokens.push(tok);
    }

    fn last_tag(&self) -> Option<Tag> {
        self.out.tokens.last().map(Token::tag)
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            chars: self.chars,
            j: self.j,
            word_start: self.word_start,
        }
    }

    fn backtrack(&mut self, s: Snapshot) {
        self.chars = s.chars;
        self.j = s.j;
        self.word_start = s.word_start;
    }

    fn append_char(&mut self, c: char) {
        self.out.strpool.push(c);
        self.j += c.len_utf8();
    }

    fn append_str(&mut self, s: &str) {
        self.out.strpool.push_str(s);
        self.j += s.len();
    }

    fn read_char(&self) -> Option<InputChar> {
        let ch = *self.cps.get(self.chars.i)?;
        if ch != '\\' || self.chars.state == QuoteState::Single {
            return Some(InputChar { ch, escaped: false });
        }
        let next = *self.cps.get(self.chars.i + 1)?;
        if self.chars.state == QuoteState::Double && !"$`\"\\\n#".contains(next) {
            return Some(InputChar { ch, escaped: false });
        }
        Some(InputChar {
            ch: next,
            escaped: true,
        })
    }

    fn eat(&mut self) -> Option<InputChar> {
        let r = self.read_char()?;
        self.chars.prev = self.chars.current;
        self.chars.current = Some(r);
        self.chars.i += if r.escaped { 2 } else { 1 };
        Some(r)
    }

    fn peek(&self) -> Option<InputChar> {
        self.read_char()
    }

    fn peek_is(&self, ch: char) -> bool {
        self.peek().is_some_and(|p| !p.escaped && p.ch == ch)
    }

    /// Lex the whole input (or, in a subshell, up to its closing token).
    fn lex(&mut self) -> Result<(), DepthExceeded> {
        loop {
            let Some(input) = self.eat() else {
                self.break_word(BreakAdd::AfterText);
                break;
            };
            if input.ch == SPECIAL_JS_CHAR {
                match self.lex_js_ref() {
                    Step::Return => return Ok(()),
                    Step::Consumed => continue,
                    Step::NotConsumed => {}
                }
            } else if !input.escaped {
                match self.lex_unescaped(input)? {
                    Step::Return => return Ok(()),
                    Step::Consumed => continue,
                    Step::NotConsumed => {}
                }
            } else if input.ch == '\n' {
                if self.chars.state != QuoteState::Double {
                    self.break_word(BreakAdd::AfterWord);
                }
                continue;
            }
            self.append_char(input.ch);
        }
        if let Some(kind) = self.in_subshell {
            self.add_error(if kind == SubshellKind::Normal {
                "Unclosed subshell"
            } else {
                "Unclosed command substitution"
            });
            return Ok(());
        }
        self.push(Token::Eof);
        Ok(())
    }

    fn lex_js_ref(&mut self) -> Step {
        if self.looks_like(LEX_JS_STRING_PREFIX) {
            let len = self.string_refs.len();
            let idx = self.eat_js_substitution_idx(LEX_JS_STRING_PREFIX, "JS string ref", |i| {
                (i < len)
                    .then_some(())
                    .ok_or("Invalid JS string ref (out of bounds")
            });
            if let Some(idx) = idx {
                self.break_word(BreakAdd::No);
                let refs = self.string_refs;
                self.handle_js_string_ref(&refs[idx]);
                return Step::Consumed;
            }
        } else if self.looks_like(LEX_JS_OBJREF_PREFIX) {
            let len = self.jsobjs_len;
            let idx = self.eat_js_substitution_idx(LEX_JS_OBJREF_PREFIX, "JS object ref", |i| {
                (i < len)
                    .then_some(())
                    .ok_or("Invalid JS object ref (out of bounds)")
            });
            if let Some(idx) = idx {
                if self.chars.state == QuoteState::Double {
                    self.add_error("JS object reference not allowed in double quotes");
                    return Step::Return;
                }
                self.break_word(BreakAdd::No);
                self.push(Token::JsObjRef(idx));
                return Step::Consumed;
            }
        }
        Step::NotConsumed
    }

    fn lex_unescaped(&mut self, input: InputChar) -> Result<Step, DepthExceeded> {
        let st = self.chars.state;
        let quoted = st != QuoteState::Normal;
        let step = match input.ch {
            '[' => Step::from(!quoted && self.lex_double_bracket('[')),
            ']' => Step::from(!quoted && self.lex_double_bracket(']')),
            '#' => {
                if quoted || self.chars.prev.is_some_and(|p| !is_whitespace(p)) {
                    return Ok(Step::NotConsumed);
                }
                self.break_word(BreakAdd::AfterText);
                self.eat_comment();
                Step::Consumed
            }
            ';' if !quoted => {
                self.break_word(BreakAdd::AfterText);
                self.push(Token::Semicolon);
                Step::Consumed
            }
            '\n' if !quoted => {
                self.break_word(BreakAdd::AfterWord);
                self.push(Token::Newline);
                Step::Consumed
            }
            '*' if !quoted => {
                if self.peek_is('*') {
                    self.eat();
                    self.break_word(BreakAdd::No);
                    self.push(Token::DoubleAsterisk);
                } else {
                    self.break_word(BreakAdd::No);
                    self.push(Token::Asterisk);
                }
                Step::Consumed
            }
            c @ ('{' | ',' | '}') if !quoted => {
                self.break_word(BreakAdd::No);
                self.push(match c {
                    '{' => Token::BraceBegin,
                    ',' => Token::Comma,
                    _ => Token::BraceEnd,
                });
                Step::Consumed
            }
            '`' if st != QuoteState::Single => {
                if self.in_subshell == Some(SubshellKind::Backtick) {
                    self.break_word(BreakAdd::AfterWord);
                    if self.last_tag().is_some_and(|t| t != Tag::Delimit) {
                        self.push(Token::Delimit);
                    }
                    self.push(Token::CmdSubstEnd);
                    return Ok(Step::Return);
                }
                self.eat_subshell(SubshellKind::Backtick)?
            }
            '$' if st != QuoteState::Single => self.lex_dollar()?,
            '(' if !quoted => {
                self.break_word(BreakAdd::AfterText);
                self.eat_subshell(SubshellKind::Normal)?
            }
            ')' if !quoted => self.lex_close_paren(),
            '|' if !quoted => self.lex_pipe(),
            c @ ('>' | '<') if !quoted => {
                self.break_word(BreakAdd::AfterWord);
                let flags = self.eat_simple_redirect(c == '>');
                self.push(Token::Redirect(flags));
                Step::Consumed
            }
            '&' if !quoted => self.lex_ampersand(),
            '\'' => match st {
                QuoteState::Single => {
                    self.break_word(BreakAdd::No);
                    self.chars.state = QuoteState::Normal;
                    Step::Consumed
                }
                QuoteState::Normal => {
                    self.break_word(BreakAdd::No);
                    self.chars.state = QuoteState::Single;
                    Step::Consumed
                }
                QuoteState::Double => Step::NotConsumed,
            },
            '"' if st != QuoteState::Single => {
                self.break_word(BreakAdd::No);
                self.chars.state = if st == QuoteState::Normal {
                    QuoteState::Double
                } else {
                    QuoteState::Normal
                };
                Step::Consumed
            }
            ' ' if st == QuoteState::Normal => {
                self.break_word(BreakAdd::AfterWord);
                Step::Consumed
            }
            c if c.is_ascii_digit() => Step::from(self.lex_digit(input)),
            _ => Step::NotConsumed,
        };
        Ok(step)
    }

    fn lex_double_bracket(&mut self, ch: char) -> bool {
        if !self.peek_is(ch) {
            return false;
        }
        let snap = self.snapshot();
        self.eat();
        let Some(p2) = self.peek() else {
            // Both `[[` and `]]` at end of input lex as DoubleBracketClose.
            self.break_word(BreakAdd::AfterText);
            self.push(Token::DoubleBracketClose);
            return true;
        };
        let follow = if ch == '[' { " \r\n\t" } else { " \r\n\t;&|>" };
        if !p2.escaped && follow.contains(p2.ch) {
            self.break_word(BreakAdd::AfterText);
            self.push(if ch == '[' {
                Token::DoubleBracketOpen
            } else {
                Token::DoubleBracketClose
            });
            return true;
        }
        self.backtrack(snap);
        false
    }

    fn lex_dollar(&mut self) -> Result<Step, DepthExceeded> {
        if self.peek_is('(') {
            self.break_word(BreakAdd::No);
            return self.eat_subshell(SubshellKind::Dollar);
        }
        self.break_word(BreakAdd::No);
        let (start, end) = self.eat_var();
        let name = &self.out.strpool.as_bytes()[start..end];
        if name.is_empty() {
            self.append_char('$');
            self.break_word(BreakAdd::No);
        } else if name.len() == 1 && name[0].is_ascii_digit() {
            let n = name[0] - b'0';
            self.push(Token::VarArgv(n));
        } else {
            self.push(Token::Var { start, end });
        }
        self.word_start = self.j;
        Ok(Step::Consumed)
    }

    fn lex_close_paren(&mut self) -> Step {
        let kind = match self.in_subshell {
            Some(k @ (SubshellKind::Dollar | SubshellKind::Normal)) => k,
            _ => {
                self.add_error("Unexpected ')'");
                return Step::Consumed;
            }
        };
        self.break_word(BreakAdd::AfterText);
        if kind == SubshellKind::Dollar {
            if self.last_tag().is_some_and(|t| {
                !matches!(t, Tag::Delimit | Tag::Semicolon | Tag::Eof | Tag::Newline)
            }) {
                self.push(Token::Delimit);
            }
            self.push(Token::CmdSubstEnd);
        } else {
            self.push(Token::CloseParen);
        }
        Step::Return
    }

    fn lex_digit(&mut self, input: InputChar) -> bool {
        if self.chars.state != QuoteState::Normal {
            return false;
        }
        let snap = self.snapshot();
        if let Some(flags) = self.eat_redirect(input) {
            self.break_word(BreakAdd::AfterText);
            self.push(Token::Redirect(flags));
            return true;
        }
        self.backtrack(snap);
        false
    }

    fn lex_pipe(&mut self) -> Step {
        self.break_word(BreakAdd::AfterWord);
        let Some(next) = self.peek() else {
            self.add_error("Unexpected EOF");
            return Step::Return;
        };
        if !next.escaped && next.ch == '&' {
            self.add_error(
                "Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.",
            );
            return Step::Return;
        }
        if next.escaped || next.ch != '|' {
            self.push(Token::Pipe);
        } else {
            self.eat();
            self.push(Token::DoublePipe);
        }
        Step::Consumed
    }

    fn lex_ampersand(&mut self) -> Step {
        self.break_word(BreakAdd::AfterWord);
        let Some(next) = self.peek() else {
            self.push(Token::Ampersand);
            return Step::Consumed;
        };
        if next.ch == '>' && !next.escaped {
            self.eat();
            let mut flags = RedirectFlags::STDOUT | RedirectFlags::STDERR;
            if self.eat_simple_redirect_operator(true) {
                flags = flags | RedirectFlags::APPEND;
            }
            self.push(Token::Redirect(flags));
        } else if next.escaped || next.ch != '&' {
            self.push(Token::Ampersand);
        } else {
            self.eat();
            self.push(Token::DoubleAmpersand);
        }
        Step::Consumed
    }

    fn is_immediately_escaped_quote(&self) -> bool {
        let q = match self.chars.state {
            QuoteState::Double => '"',
            QuoteState::Single => '\'',
            QuoteState::Normal => return false,
        };
        let is_q = |c: Option<InputChar>| c.is_some_and(|c| !c.escaped && c.ch == q);
        is_q(self.chars.current) && is_q(self.chars.prev)
    }

    fn break_word(&mut self, add: BreakAdd) {
        let (start, end) = (self.word_start, self.j);
        if start != end || self.is_immediately_escaped_quote() {
            self.push(match self.chars.state {
                QuoteState::Normal => Token::Text { start, end },
                QuoteState::Single => Token::SingleQuotedText { start, end },
                QuoteState::Double => Token::DoubleQuotedText { start, end },
            });
            if add != BreakAdd::No {
                self.push(Token::Delimit);
            }
        } else if add == BreakAdd::AfterWord
            && self.last_tag().is_some_and(|t| {
                matches!(
                    t,
                    Tag::Var
                        | Tag::VarArgv
                        | Tag::Text
                        | Tag::SingleQuotedText
                        | Tag::DoubleQuotedText
                        | Tag::BraceBegin
                        | Tag::Comma
                        | Tag::BraceEnd
                        | Tag::CmdSubstEnd
                        | Tag::Asterisk
                )
            })
        {
            self.push(Token::Delimit);
        }
        self.word_start = self.j;
    }

    fn eat_simple_redirect(&mut self, out: bool) -> RedirectFlags {
        let dbl = self.eat_simple_redirect_operator(out);
        let base = if out {
            RedirectFlags::STDOUT
        } else {
            RedirectFlags::STDIN
        };
        if dbl {
            base | RedirectFlags::APPEND
        } else {
            base
        }
    }

    fn eat_simple_redirect_operator(&mut self, out: bool) -> bool {
        if self.peek_is(if out { '>' } else { '<' }) {
            self.eat();
            return true;
        }
        false
    }

    fn eat_redirect(&mut self, first: InputChar) -> Option<RedirectFlags> {
        use RedirectFlags as F;
        let mut flags = match first.ch {
            '0' => F::STDIN,
            '1' => F::STDOUT,
            '2' => F::STDERR,
            _ => return None,
        };
        let input = self.peek().filter(|c| !c.escaped)?;
        if input.ch == '<' {
            if self.eat_simple_redirect_operator(false) {
                flags = flags | F::APPEND;
            }
            return Some(flags);
        }
        if input.ch != '>' {
            return None;
        }
        self.eat();
        if self.eat_simple_redirect_operator(true) {
            flags = flags | F::APPEND;
        }
        if self.peek_is('&') {
            self.eat();
            if let Some(p2) = self.peek() {
                match p2.ch {
                    '1' => {
                        self.eat();
                        if !flags.contains(F::STDOUT) && flags.contains(F::STDERR) {
                            flags = (flags | F::DUPLICATE_OUT | F::STDOUT).without(F::STDERR);
                        } else {
                            return None;
                        }
                    }
                    '2' => {
                        self.eat();
                        if !flags.contains(F::STDERR) && flags.contains(F::STDOUT) {
                            flags = (flags | F::DUPLICATE_OUT | F::STDERR).without(F::STDOUT);
                        } else {
                            return None;
                        }
                    }
                    _ => return None,
                }
            }
        }
        Some(flags)
    }

    fn eat_subshell(&mut self, kind: SubshellKind) -> Result<Step, DepthExceeded> {
        if self.subshell_depth >= MAX_SUBSHELL_DEPTH {
            self.add_error("Subshell nesting depth exceeded");
            return Err(DepthExceeded);
        }
        if kind == SubshellKind::Dollar {
            self.eat();
        }
        if kind == SubshellKind::Normal {
            self.push(Token::OpenParen);
        } else {
            self.push(Token::CmdSubstBegin);
            if self.chars.state == QuoteState::Double {
                self.push(Token::CmdSubstQuoted);
            }
        }
        let prev_state = self.chars.state;
        let prev_subshell = self.in_subshell.replace(kind);
        self.subshell_depth += 1;
        self.chars.state = QuoteState::Normal;
        let result = self.lex();
        self.in_subshell = prev_subshell;
        self.subshell_depth -= 1;
        self.chars.state = prev_state;
        result.map(|()| Step::Consumed)
    }

    fn handle_js_string_ref(&mut self, s: &str) {
        if s.is_empty() {
            self.push(Token::DoubleQuotedText {
                start: self.j,
                end: self.j,
            });
            return;
        }
        let start = self.j;
        self.append_str(s);
        self.out.js_string_ranges.push((start, self.j));
        if self.chars.state == QuoteState::Normal && s.starts_with('~') {
            self.push(Token::DoubleQuotedText { start, end: self.j });
            self.word_start = self.j;
        }
    }

    /// Whether the input at the cursor (just past a `\x08`) continues `prefix`.
    fn looks_like(&self, prefix: &str) -> bool {
        let rest: Vec<char> = prefix.chars().skip(1).collect();
        let i = self.chars.i;
        self.cps.len() - i > rest.len() && self.cps[i..i + rest.len()] == rest[..]
    }

    fn eat_js_substitution_idx(
        &mut self,
        literal: &str,
        name: &str,
        validate: impl Fn(usize) -> Result<(), &'static str>,
    ) -> Option<usize> {
        let rest_len = literal.len() - 1;
        if self.cps.len() - self.chars.i <= rest_len {
            return None;
        }
        let mut i = self.chars.i + rest_len;
        let mut digits = String::new();
        while i < self.cps.len() && self.cps[i].is_ascii_digit() {
            if digits.len() >= 32 {
                self.add_error(format!(
                    "Invalid {name} (number too high):  {digits}{}",
                    self.cps[i]
                ));
                return None;
            }
            digits.push(self.cps[i]);
            i += 1;
        }
        let Some(last_digit) = digits.chars().last() else {
            self.add_error(format!("Invalid {name} (no idx)"));
            return None;
        };
        if i >= self.cps.len() || self.cps[i] != SPECIAL_JS_CHAR {
            self.add_error(format!("Invalid {name} (unterminated)"));
            return None;
        }
        i += 1;
        const MAX_SAFE_INTEGER: u128 = (1 << 53) - 1;
        let idx = match digits.parse::<u128>() {
            Ok(n) if n <= MAX_SAFE_INTEGER => n as usize,
            _ => {
                self.add_error(format!("Invalid {name} ref "));
                return None;
            }
        };
        if let Err(msg) = validate(idx) {
            self.add_error(msg);
            return None;
        }
        self.chars.i = i;
        self.chars.prev = Some(InputChar {
            ch: last_digit,
            escaped: false,
        });
        self.chars.current = Some(InputChar {
            ch: SPECIAL_JS_CHAR,
            escaped: false,
        });
        Some(idx)
    }

    fn eat_var(&mut self) -> (usize, usize) {
        let start = self.j;
        let mut i = 0;
        let mut is_int = false;
        while let Some(InputChar { ch, escaped }) = self.peek() {
            if i == 0 {
                if ch == '=' {
                    break;
                }
                if ch.is_ascii_digit() {
                    is_int = true;
                    self.eat();
                    self.append_char(ch);
                    i += 1;
                    continue;
                }
                if !(ch.is_ascii_alphabetic() || ch == '_') {
                    break;
                }
            }
            i += 1;
            if is_int || "{};'\" |&>,$".contains(ch) {
                break;
            }
            if !escaped
                && ((matches!(
                    self.in_subshell,
                    Some(SubshellKind::Dollar | SubshellKind::Normal)
                ) && ch == ')')
                    || (self.in_subshell == Some(SubshellKind::Backtick) && ch == '`'))
            {
                break;
            }
            if ch.is_ascii_alphanumeric() || ch == '_' {
                self.eat();
                self.append_char(ch);
            } else {
                break;
            }
        }
        (start, self.j)
    }

    fn eat_comment(&mut self) {
        while let Some(c) = self.eat() {
            if !c.escaped && c.ch == '\n' {
                break;
            }
        }
    }
}

/// Lex a script. `string_refs` are the interpolated strings (`__bunstr_N`)
/// and `jsobjs_len` the number of interpolated objects (`__bun_N`).
pub(crate) fn lex(
    src: &str,
    string_refs: &[String],
    jsobjs_len: usize,
) -> Result<LexResult, DepthExceeded> {
    let mut lexer = Lexer::new(src, string_refs, jsobjs_len);
    lexer.lex()?;
    Ok(lexer.out)
}

#[cfg(test)]
mod tests;
