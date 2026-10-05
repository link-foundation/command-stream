//! Bun Shell parser and AST, ported from Bun's `src/shell_parser/parse.rs`
//! (`Parser`, `ast`) via `js/src/bun-shell/parser.mjs`.
//!
//! [`parse`] turns a script assembled by the template builder into a
//! [`Script`]. Failures carry exactly the message the JavaScript port throws.

use super::lexer::{self, LexResult, Tag, Token};

mod ast;
pub(crate) use ast::*;

const SINGLE_ARG_OPS: [&str; 26] = [
    "-a", "-b", "-c", "-d", "-e", "-f", "-g", "-h", "-k", "-p", "-r", "-s", "-t", "-u", "-w", "-x",
    "-G", "-L", "-N", "-O", "-S", "-o", "-v", "-R", "-z", "-n",
];
const BINARY_OPS: [&str; 13] = [
    "-ef", "-nt", "-ot", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge",
];
const IF_CLAUSE_TOKS: [&str; 5] = ["if", "else", "elif", "then", "fi"];

/// Deepest `if`/subshell nesting the parser accepts; deeper scripts fail with
/// the error JavaScript reports when it runs out of stack.
const MAX_PARSE_DEPTH: usize = 2048;
/// Scripts that may nest deeper than this are parsed on a helper thread with
/// a [`DEEP_PARSE_STACK`]-byte stack instead of the caller's stack.
const INLINE_PARSE_DEPTH: usize = 64;
const DEEP_PARSE_STACK: usize = 64 * 1024 * 1024;

fn is_valid_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SubshellKind {
    CmdSubst,
    Normal,
}

type PResult<T> = Result<T, String>;

struct Parser<'a> {
    strpool: &'a str,
    tokens: &'a [Token],
    js_string_ranges: &'a [(usize, usize)],
    current: usize,
    inside_subshell: Option<SubshellKind>,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn new(lexed: &'a LexResult) -> Self {
        Self {
            strpool: &lexed.strpool,
            tokens: &lexed.tokens,
            js_string_ranges: &lexed.js_string_ranges,
            current: 0,
            inside_subshell: None,
            depth: 0,
        }
    }

    /// An upper bound of the nesting depth: every `enter` needs an `if`
    /// keyword or a subshell/command-substitution opener.
    fn nesting_bound(&self) -> usize {
        self.tokens
            .iter()
            .filter(|t| match t {
                Token::OpenParen | Token::CmdSubstBegin | Token::CmdSubstQuoted => true,
                Token::Text { .. } => self.if_clause_tok_at(**t) == Some("if"),
                _ => false,
            })
            .count()
    }

    fn closing_tok(&self) -> Tag {
        if self.inside_subshell == Some(SubshellKind::CmdSubst) {
            Tag::CmdSubstEnd
        } else {
            Tag::CloseParen
        }
    }

    fn is_closing(&self, t: Tag) -> bool {
        self.inside_subshell.is_some() && t == self.closing_tok()
    }

    fn enter(&mut self) -> PResult<()> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            return Err("Maximum call stack size exceeded".to_string());
        }
        Ok(())
    }

    fn run_subparser(&mut self, kind: SubshellKind) -> PResult<Script> {
        self.enter()?;
        let outer = self.inside_subshell.replace(kind);
        let script = self.parse_impl();
        self.inside_subshell = outer;
        self.depth -= 1;
        if self.current < self.tokens.len() {
            self.current += 1;
        }
        script
    }

    fn parse_impl(&mut self) -> PResult<Script> {
        let mut stmts = Vec::new();
        if self.tokens.is_empty() || (self.tokens.len() == 1 && self.tokens[0] == Token::Eof) {
            return Ok(Script { stmts });
        }
        while !self.match_end() {
            self.skip_newlines();
            stmts.push(self.parse_stmt()?);
            self.skip_newlines();
        }
        Ok(Script { stmts })
    }

    /// `matchAny([Eof, closing])`; the token is never advanced past.
    fn match_end(&self) -> bool {
        let t = self.peek_tag();
        t == Tag::Eof || self.is_closing(t)
    }

    fn is_stmt_end(&self, t: Tag) -> bool {
        matches!(t, Tag::Semicolon | Tag::Newline | Tag::Eof) || self.is_closing(t)
    }

    fn parse_stmt(&mut self) -> PResult<Stmt> {
        let mut exprs = Vec::new();
        loop {
            if self.is_stmt_end(self.peek_tag()) {
                self.advance();
                break;
            }
            let expr = self.parse_binary()?;
            if self.match_tag(Tag::Ampersand) {
                return Err("Background commands \"&\" are not supported yet.".to_string());
            }
            exprs.push(expr);
        }
        Ok(Stmt { exprs })
    }

    fn parse_binary(&mut self) -> PResult<Expr> {
        let mut left = self.parse_pipeline()?;
        loop {
            let op = match self.peek_tag() {
                Tag::DoubleAmpersand => BinaryOp::And,
                Tag::DoublePipe => BinaryOp::Or,
                _ => break,
            };
            self.advance();
            let right = self.parse_pipeline()?;
            left = Expr::Binary(Box::new(Binary { op, left, right }));
        }
        Ok(left)
    }

    fn parse_pipeline(&mut self) -> PResult<Expr> {
        let expr = self.parse_compound_cmd()?;
        if self.peek_tag() != Tag::Pipe {
            return Ok(expr);
        }
        let mut items = vec![expr];
        while self.match_tag(Tag::Pipe) {
            items.push(self.parse_compound_cmd()?);
        }
        Ok(Expr::Pipeline(items))
    }

    fn parse_compound_cmd(&mut self) -> PResult<Expr> {
        if self.peek_tag() == Tag::OpenParen {
            let subshell = self.parse_subshell()?;
            if !subshell.redirect_flags.is_empty() {
                return Err("Subshells with redirections are currently not supported. Please open a GitHub issue.".to_string());
            }
            return Ok(Expr::Subshell(Box::new(subshell)));
        }
        if self.peek_if_clause_tok(&["if"]) {
            self.enter()?;
            let clause = self.parse_if_clause();
            self.depth -= 1;
            return clause.map(|c| Expr::If(Box::new(c)));
        }
        if self.peek_tag() == Tag::DoubleBracketOpen {
            return self.parse_cond_expr();
        }
        self.parse_simple_cmd()
    }

    fn parse_subshell(&mut self) -> PResult<Subshell> {
        self.expect(Tag::OpenParen)?;
        let script = self.run_subparser(SubshellKind::Normal)?;
        let (redirect_flags, redirect) = self.parse_redirect()?;
        Ok(Subshell {
            script,
            redirect,
            redirect_flags,
        })
    }

    fn expect_cond_arg(&mut self, prefix: &str) -> PResult<Atom> {
        match self.parse_atom()? {
            Some(arg) => Ok(arg),
            None => Err(format!("{prefix}{}", self.human_readable(self.peek()))),
        }
    }

    fn expect_double_bracket_close(&mut self) -> PResult<()> {
        if self.match_tag(Tag::DoubleBracketClose) {
            return Ok(());
        }
        Err(format!(
            "Expected \"]]\" but got: {}",
            self.human_readable(self.peek())
        ))
    }

    fn supported_cond_op(name: &str) -> PResult<CondExprOp> {
        CondExprOp::from_str(name).ok_or_else(|| {
            format!("Conditional expression operation: {name}, is not supported right now. Please open a GitHub issue if you would like it to be supported.")
        })
    }

    fn parse_cond_expr(&mut self) -> PResult<Expr> {
        self.expect(Tag::DoubleBracketOpen)?;
        let first = self.peek();
        if first.tag() == Tag::Text {
            let txt = self.text(first);
            if txt.starts_with('-') {
                if !SINGLE_ARG_OPS.contains(&txt) {
                    return Err(format!("Unknown conditional expression operation: {txt}"));
                }
                let op = Self::supported_cond_op(txt)?;
                self.expect(Tag::Text)?;
                if !self.match_tag(Tag::Delimit) {
                    return Err("Expected a single, simple word".to_string());
                }
                let arg = self.expect_cond_arg("Expected a word, but got: ")?;
                self.expect_double_bracket_close()?;
                return Ok(Expr::CondExpr(Box::new(CondExpr {
                    op,
                    args: vec![arg],
                })));
            }
        }
        let arg1 = self.expect_cond_arg("Expected a conditional expression operand, but got: ")?;
        if self.peek_tag() != Tag::Text {
            return Err(format!(
                "Expected a conditional expression operator, but got: {}",
                self.human_readable(self.peek())
            ));
        }
        let op_tok = self.expect(Tag::Text)?;
        if !self.match_tag(Tag::Delimit) {
            return Err("Expected a single, simple word".to_string());
        }
        let txt = self.text(op_tok);
        if !BINARY_OPS.contains(&txt) {
            return Err(format!("Unknown conditional expression operation: {txt}"));
        }
        let op = Self::supported_cond_op(txt)?;
        let arg2 = self.expect_cond_arg("Expected a word, but got: ")?;
        self.expect_double_bracket_close()?;
        Ok(Expr::CondExpr(Box::new(CondExpr {
            op,
            args: vec![arg1, arg2],
        })))
    }

    fn parse_if_body(&mut self, until: &[&str]) -> PResult<Vec<Stmt>> {
        let mut ret = Vec::new();
        while !self.peek_if_clause_tok(until) && !self.match_end() {
            self.skip_newlines();
            ret.push(self.parse_stmt()?);
            self.skip_newlines();
        }
        Ok(ret)
    }

    fn expect_if_keyword(&mut self, name: &str) -> PResult<()> {
        if self.peek_if_clause_tok(&[name]) {
            self.advance();
            self.expect_delimit()?;
            return Ok(());
        }
        Err(format!(
            "Expected \"{name}\" but got: {}",
            self.peek_tag().name()
        ))
    }

    fn expect_if_clause_text_token(&mut self, name: &str) -> PResult<()> {
        let tok = self.peek();
        if tok.tag() == Tag::Text && self.delimits(self.peek_n(1)) && self.text(tok) == name {
            self.advance();
            self.expect_delimit()?;
            return Ok(());
        }
        Err(format!("Expected: {name}"))
    }

    fn parse_if_clause(&mut self) -> PResult<If> {
        self.expect_if_clause_text_token("if")?;
        let cond = self.parse_if_body(&["then"])?;
        self.expect_if_keyword("then")?;
        let then = self.parse_if_body(&["else", "elif", "fi"])?;
        let mut else_parts = Vec::new();
        match self.if_clause_tok_from_tok() {
            Some("else") => {
                self.expect_if_clause_text_token("else")?;
                else_parts.push(self.parse_if_body(&["fi"])?);
                self.expect_if_keyword("fi")?;
            }
            Some("elif") => {
                loop {
                    self.expect_if_clause_text_token("elif")?;
                    let elif_cond = self.parse_if_body(&["then"])?;
                    self.expect_if_keyword("then")?;
                    let then_part = self.parse_if_body(&["elif", "else", "fi"])?;
                    else_parts.push(elif_cond);
                    else_parts.push(then_part);
                    match self.if_clause_tok_from_tok() {
                        Some("elif") => continue,
                        Some("else") => {
                            self.expect_if_clause_text_token("else")?;
                            else_parts.push(self.parse_if_body(&["fi"])?);
                        }
                        _ => {}
                    }
                    break;
                }
                self.expect_if_keyword("fi")?;
            }
            Some("fi") => self.expect_if_clause_text_token("fi")?,
            _ => {
                return Err(format!(
                    "Expected \"else\", \"elif\", or \"fi\" but got: {}",
                    self.peek_tag().name()
                ))
            }
        }
        Ok(If {
            cond,
            then,
            else_parts,
        })
    }

    fn parse_simple_cmd(&mut self) -> PResult<Expr> {
        let mut assigns = Vec::new();
        while !self.is_stmt_end(self.peek_tag()) {
            match self.parse_assign()? {
                Some(assign) => assigns.push(assign),
                None => break,
            }
        }
        if self.is_stmt_end(self.peek_tag()) {
            if assigns.is_empty() {
                return Err("expected a command or assignment".to_string());
            }
            return Ok(Expr::Assign(assigns));
        }
        let Some(name) = self.parse_atom()? else {
            if assigns.is_empty() {
                return Err(format!(
                    "expected a command or assignment but got: \"{}\"",
                    self.peek_tag().name()
                ));
            }
            return Ok(Expr::Assign(assigns));
        };
        let mut name_and_args = vec![name];
        while let Some(arg) = self.parse_atom()? {
            name_and_args.push(arg);
        }
        let (redirect, redirect_file) = self.parse_redirect()?;
        Ok(Expr::Cmd(Box::new(Cmd {
            assigns,
            name_and_args,
            redirect,
            redirect_file,
        })))
    }

    fn parse_redirect(&mut self) -> PResult<(RedirectFlags, Option<Redirect>)> {
        let Token::Redirect(flags) = self.peek() else {
            return Ok((RedirectFlags::NONE, None));
        };
        self.advance();
        if let Token::JsObjRef(idx) = self.peek() {
            self.advance();
            return Ok((flags, Some(Redirect::JsBuf(idx))));
        }
        match self.parse_atom()? {
            Some(file) => Ok((flags, Some(Redirect::Atom(file)))),
            None if flags.contains(RedirectFlags::DUPLICATE_OUT) => Ok((flags, None)),
            None => Err("Redirection with no file".to_string()),
        }
    }

    fn parse_assign(&mut self) -> PResult<Option<Assign>> {
        let tok = self.peek();
        let Token::Text { start, .. } = tok else {
            return Ok(None);
        };
        let start_idx = self.current;
        self.advance();
        let txt = self.text(tok);
        if let Some(eq) = txt.find('=') {
            if eq > 0 && !self.is_interpolated_position(start + eq) && is_valid_var_name(&txt[..eq])
            {
                let label = txt[..eq].to_string();
                let left = Atom::Simple(SimpleAtom::Text(txt[eq + 1..].to_string()));
                if self.delimits(self.peek()) {
                    self.expect_delimit()?;
                    return Ok(Some(Assign { label, value: left }));
                }
                let Some(right) = self.parse_atom()? else {
                    return Err("Expected an atom".to_string());
                };
                let value = if eq == txt.len() - 1 {
                    right
                } else {
                    left.merge(right)
                };
                return Ok(Some(Assign { label, value }));
            }
        }
        self.current = start_idx;
        Ok(None)
    }

    /// `atomSep`: after an atom, a following delimiter ends the word.
    fn atom_sep(&mut self, next_delimits: bool) -> bool {
        if next_delimits {
            self.match_tag(Tag::Delimit);
        }
        next_delimits
    }

    fn parse_atom(&mut self) -> PResult<Option<Atom>> {
        let mut atoms = Vec::new();
        let (mut brace_open, mut brace_close, mut comma, mut glob) = (false, false, false, false);
        loop {
            let peeked = self.peek();
            let tag = peeked.tag();
            if tag == Tag::Delimit {
                self.advance();
                break;
            }
            if matches!(tag, Tag::Eof | Tag::Semicolon | Tag::Newline) || self.is_closing(tag) {
                break;
            }
            let next_delimits = self.delimits(self.peek_n(1));
            let stop = match peeked {
                Token::Asterisk | Token::DoubleAsterisk => {
                    glob = true;
                    self.advance();
                    atoms.push(if tag == Tag::Asterisk {
                        SimpleAtom::Asterisk
                    } else {
                        SimpleAtom::DoubleAsterisk
                    });
                    self.atom_sep(next_delimits)
                }
                Token::BraceBegin | Token::BraceEnd | Token::Comma => {
                    self.advance();
                    atoms.push(match tag {
                        Tag::BraceBegin => {
                            brace_open = true;
                            SimpleAtom::BraceBegin
                        }
                        Tag::BraceEnd => {
                            brace_close = true;
                            SimpleAtom::BraceEnd
                        }
                        _ => {
                            comma = true;
                            SimpleAtom::Comma
                        }
                    });
                    self.atom_sep(next_delimits)
                }
                Token::CmdSubstBegin => {
                    self.advance();
                    let quoted = self.match_tag(Tag::CmdSubstQuoted);
                    let script = self.run_subparser(SubshellKind::CmdSubst)?;
                    atoms.push(SimpleAtom::CmdSubst(Box::new(CmdSubst { script, quoted })));
                    let delimits = self.delimits(self.peek());
                    self.atom_sep(delimits)
                }
                Token::Text { .. }
                | Token::SingleQuotedText { .. }
                | Token::DoubleQuotedText { .. } => {
                    self.advance();
                    let txt = self.text(peeked);
                    if tag == Tag::Text && txt.starts_with('~') {
                        atoms.push(SimpleAtom::Tilde);
                        if txt.len() > 1 {
                            atoms.push(SimpleAtom::Text(txt[1..].to_string()));
                        }
                    } else if txt.is_empty() && tag != Tag::Text {
                        atoms.push(SimpleAtom::QuotedEmpty);
                    } else {
                        atoms.push(SimpleAtom::Text(txt.to_string()));
                    }
                    self.atom_sep(next_delimits)
                }
                Token::Var { .. } => {
                    self.advance();
                    atoms.push(SimpleAtom::Var(self.text(peeked).to_string()));
                    self.atom_sep(next_delimits)
                }
                Token::VarArgv(n) => {
                    self.advance();
                    atoms.push(SimpleAtom::VarArgv(n));
                    self.atom_sep(next_delimits)
                }
                Token::OpenParen => return Err("Unexpected token: `(`".to_string()),
                Token::CloseParen => return Err("Unexpected token: `)`".to_string()),
                _ => return Ok(None),
            };
            if stop {
                break;
            }
        }
        Ok(match atoms.len() {
            0 => None,
            1 => atoms.pop().map(Atom::Simple),
            _ => Some(Atom::Compound(CompoundAtom {
                atoms,
                brace_expansion_hint: brace_open && brace_close && comma,
                glob_hint: glob,
            })),
        })
    }

    fn text(&self, tok: Token) -> &'a str {
        match tok.range() {
            Some((start, end)) => &self.strpool[start..end],
            None => "",
        }
    }

    fn is_interpolated_position(&self, pos: usize) -> bool {
        self.js_string_ranges
            .iter()
            .any(|&(s, e)| pos >= s && pos < e)
    }

    /// The if-clause keyword `tok` spells, unless it came from an
    /// interpolated string.
    fn if_clause_tok_at(&self, tok: Token) -> Option<&'static str> {
        let Token::Text { start, .. } = tok else {
            return None;
        };
        if self.is_interpolated_position(start) {
            return None;
        }
        let txt = self.text(tok);
        IF_CLAUSE_TOKS.iter().copied().find(|k| *k == txt)
    }

    fn if_clause_tok_from_tok(&self) -> Option<&'static str> {
        let tok = self.peek();
        if tok.tag() == Tag::Text && self.delimits(self.peek_n(1)) {
            return self.if_clause_tok_at(tok);
        }
        None
    }

    fn peek_if_clause_tok(&self, names: &[&str]) -> bool {
        self.if_clause_tok_from_tok()
            .is_some_and(|name| names.contains(&name))
    }

    fn human_readable(&self, tok: Token) -> String {
        match tok {
            Token::Pipe => "`|`",
            Token::DoublePipe => "`||`",
            Token::Ampersand => "`&`",
            Token::DoubleAmpersand => "`&&`",
            Token::Redirect(_) => "`>`",
            Token::Asterisk => "`*`",
            Token::DoubleAsterisk => "`**`",
            Token::Semicolon => "`;`",
            Token::Newline => "`\\n`",
            Token::BraceBegin => "`{`",
            Token::Comma => "`,`",
            Token::BraceEnd => "`}`",
            Token::CmdSubstBegin => "`$(`",
            Token::CmdSubstQuoted => "CmdSubstQuoted",
            Token::CmdSubstEnd => "`)`",
            Token::OpenParen => "`(`",
            Token::CloseParen => "`)",
            Token::Var { .. }
            | Token::Text { .. }
            | Token::SingleQuotedText { .. }
            | Token::DoubleQuotedText { .. } => return self.text(tok).to_string(),
            Token::VarArgv(n) => return format!("${n}"),
            Token::JsObjRef(_) => "JSObjRef",
            Token::DoubleBracketOpen => "[[",
            Token::DoubleBracketClose => "]]",
            Token::Delimit => "Delimit",
            Token::Eof => "EOF",
        }
        .to_string()
    }

    fn is_at_end(&self) -> bool {
        self.match_end()
    }

    /// Move past the current token, unless it ends the (sub)script.
    fn advance(&mut self) {
        if !self.is_at_end() {
            self.current += 1;
        }
    }

    fn expect(&mut self, tag: Tag) -> PResult<Token> {
        let tok = self.peek();
        if tok.tag() == tag {
            self.advance();
            return Ok(tok);
        }
        Err("Unexpected token".to_string())
    }

    fn delimits(&self, tok: Token) -> bool {
        let t = tok.tag();
        matches!(t, Tag::Delimit | Tag::Semicolon | Tag::Eof | Tag::Newline) || self.is_closing(t)
    }

    fn expect_delimit(&mut self) -> PResult<()> {
        if self.delimits(self.peek()) {
            self.advance();
            return Ok(());
        }
        Err("Expected a delimiter token".to_string())
    }

    fn match_tag(&mut self, tag: Tag) -> bool {
        if self.peek_tag() == tag {
            self.advance();
            return true;
        }
        false
    }

    fn skip_newlines(&mut self) {
        while self.match_tag(Tag::Newline) {}
    }

    fn peek(&self) -> Token {
        self.peek_n(0)
    }

    fn peek_tag(&self) -> Tag {
        self.peek().tag()
    }

    fn peek_n(&self, n: usize) -> Token {
        self.tokens
            .get(self.current + n)
            .or(self.tokens.last())
            .copied()
            .unwrap_or(Token::Eof)
    }
}

/// Lex and parse a script built by the template builder. `jsstrings` are the
/// interpolated strings (`\x08__bunstr_N\x08`) and `jsobjs_len` the number of
/// interpolated objects (`\x08__bun_N\x08`).
///
/// Errors carry the exact message of the JavaScript port: all lexer errors
/// joined with `\n`, or the first parser error.
pub(crate) fn parse(
    script: &str,
    jsstrings: &[String],
    jsobjs_len: usize,
) -> Result<Script, String> {
    let lexed = lexer::lex(script, jsstrings, jsobjs_len)
        .map_err(|_| "failed to lex/parse shell: Subshell nesting depth exceeded".to_string())?;
    if !lexed.errors.is_empty() {
        return Err(lexed.errors.join("\n"));
    }
    let mut parser = Parser::new(&lexed);
    if parser.nesting_bound() <= INLINE_PARSE_DEPTH {
        return parser.parse_impl();
    }
    let overflow = || "Maximum call stack size exceeded".to_string();
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(DEEP_PARSE_STACK)
            .spawn_scoped(scope, move || parser.parse_impl())
            .map_err(|_| overflow())?
            .join()
            .map_err(|_| overflow())?
    })
}

#[cfg(test)]
pub(crate) mod tests;
