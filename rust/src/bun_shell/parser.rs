//! Bun Shell parser and AST, ported from Bun's `src/shell_parser/parse.rs`
//! (`Parser`, `ast`) via `js/src/bun-shell/parser.mjs`.
//!
//! [`parse`] turns a script assembled by the template builder into a
//! [`Script`]. Failures carry exactly the message the JavaScript port throws.

use std::fmt;
use std::ops::BitOr;

use super::lexer::{self, LexResult, Tag, Token};

/// Redirection flags of a command or subshell (Bun's `RedirectFlags`).
#[derive(Clone, Copy, Default, PartialEq, Eq, Hash)]
pub(crate) struct RedirectFlags(u8);

impl RedirectFlags {
    pub(crate) const NONE: Self = Self(0);
    /// `<` / `0>`.
    pub(crate) const STDIN: Self = Self(1);
    /// `>` / `1>`.
    pub(crate) const STDOUT: Self = Self(2);
    /// `2>`.
    pub(crate) const STDERR: Self = Self(4);
    /// `>>`.
    pub(crate) const APPEND: Self = Self(8);
    /// `2>&1` (with `STDOUT`) or `1>&2` (with `STDERR`): the redirect target
    /// is the other standard stream, not a file.
    pub(crate) const DUPLICATE_OUT: Self = Self(16);

    pub(crate) fn bits(self) -> u8 {
        self.0
    }

    pub(crate) fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// Whether all flags of `other` are set.
    pub(crate) fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// These flags with those of `other` cleared.
    pub(crate) fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
}

impl BitOr for RedirectFlags {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl fmt::Debug for RedirectFlags {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RedirectFlags({:#07b})", self.0)
    }
}

/// A whole script, or the body of a subshell or command substitution.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Script {
    pub stmts: Vec<Stmt>,
}

/// Expressions separated by `;` or a newline are separate statements; a
/// statement may be empty (`a;;b`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Stmt {
    pub exprs: Vec<Expr>,
}

/// Variant names follow Bun's `AST.Expr` tags.
#[derive(Clone, Debug, PartialEq)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum Expr {
    /// Assignments without a command (`A=1 B=2`), which set shell variables.
    Assign(Vec<Assign>),
    /// `left && right` / `left || right` (left-associative).
    Binary(Box<Binary>),
    /// `a | b | c`. Items are never `Binary` or `Pipeline`.
    Pipeline(Vec<Expr>),
    Cmd(Box<Cmd>),
    /// `( script )`. The parser rejects subshells with redirections.
    Subshell(Box<Subshell>),
    If(Box<If>),
    /// `[[ ... ]]`.
    CondExpr(Box<CondExpr>),
}

/// `label=value`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Assign {
    pub label: String,
    pub value: Atom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BinaryOp {
    /// `&&`
    And,
    /// `||`
    Or,
}

impl BinaryOp {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BinaryOp::And => "and",
            BinaryOp::Or => "or",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Binary {
    pub op: BinaryOp,
    pub left: Expr,
    pub right: Expr,
}

/// A simple command: `A=1 name args... [redirect]`. Only one redirection per
/// command is parsed (like Bun).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Cmd {
    /// Environment assignments for this command only.
    pub assigns: Vec<Assign>,
    /// Never empty.
    pub name_and_args: Vec<Atom>,
    pub redirect: RedirectFlags,
    /// `None` when there is no redirection, or for `2>&1` / `1>&2`
    /// ([`RedirectFlags::DUPLICATE_OUT`]) without a file.
    pub redirect_file: Option<Redirect>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Subshell {
    pub script: Script,
    pub redirect: Option<Redirect>,
    pub redirect_flags: RedirectFlags,
}

/// `if cond; then then; [elif cond; then body;]... [else body;] fi`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct If {
    pub cond: Vec<Stmt>,
    pub then: Vec<Stmt>,
    /// Empty without `else`/`elif`; `[else_body]` for `else`; for `elif`,
    /// pairs `cond, then` for each `elif`, followed by the `else` body if
    /// present (so an odd length means a trailing `else`).
    pub else_parts: Vec<Vec<Stmt>>,
}

/// A supported `[[ ]]` operator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CondExprOp {
    /// `-f file`: is a regular file.
    IsFile,
    /// `-z str`: is empty.
    IsEmpty,
    /// `-n str`: is non-empty.
    IsNonEmpty,
    /// `-d file`: is a directory.
    IsDirectory,
    /// `-c file`: is a character device.
    IsCharDevice,
    /// `a == b`
    Eq,
    /// `a != b`
    NotEq,
}

impl CondExprOp {
    fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "-f" => Self::IsFile,
            "-z" => Self::IsEmpty,
            "-n" => Self::IsNonEmpty,
            "-d" => Self::IsDirectory,
            "-c" => Self::IsCharDevice,
            "==" => Self::Eq,
            "!=" => Self::NotEq,
            _ => return None,
        })
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::IsFile => "-f",
            Self::IsEmpty => "-z",
            Self::IsNonEmpty => "-n",
            Self::IsDirectory => "-d",
            Self::IsCharDevice => "-c",
            Self::Eq => "==",
            Self::NotEq => "!=",
        }
    }

    /// Unary operators take one argument, the others two.
    pub(crate) fn is_unary(self) -> bool {
        !matches!(self, Self::Eq | Self::NotEq)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CondExpr {
    pub op: CondExprOp,
    /// One argument for unary operators, two for binary ones.
    pub args: Vec<Atom>,
}

/// A word: one simple atom, or several adjacent ones (`a"b"$c`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Atom {
    Simple(SimpleAtom),
    Compound(CompoundAtom),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CompoundAtom {
    /// At least two atoms.
    pub atoms: Vec<SimpleAtom>,
    /// The word has `{`, `,` and `}` and needs brace expansion.
    pub brace_expansion_hint: bool,
    /// The word has `*` or `**` and needs glob expansion.
    pub glob_hint: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum SimpleAtom {
    /// `$NAME` / `${NAME}`.
    Var(String),
    /// `$0`..`$9`.
    VarArgv(u8),
    /// Literal text (quoted or not; quotes are already removed).
    Text(String),
    /// `""` or `''` (or an interpolated empty string): an empty argument.
    QuotedEmpty,
    /// Unquoted `*`.
    Asterisk,
    /// Unquoted `**`.
    DoubleAsterisk,
    /// Unquoted `{`.
    BraceBegin,
    /// Unquoted `}`.
    BraceEnd,
    /// Unquoted `,`.
    Comma,
    /// A leading unquoted `~`.
    Tilde,
    /// `$(...)` or `` `...` ``.
    CmdSubst(Box<CmdSubst>),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CmdSubst {
    pub script: Script,
    /// Inside double quotes: the output is not word-split.
    pub quoted: bool,
}

/// The target of a redirection.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Redirect {
    /// A file path (or, for `<`, the path to read).
    Atom(Atom),
    /// An interpolated buffer: an index into the template's object values.
    JsBuf(usize),
}

fn is_brace_atom(a: &SimpleAtom) -> bool {
    matches!(a, SimpleAtom::BraceBegin | SimpleAtom::BraceEnd)
}

fn is_glob_atom(a: &SimpleAtom) -> bool {
    matches!(a, SimpleAtom::Asterisk | SimpleAtom::DoubleAsterisk)
}

impl Atom {
    /// `ast::Atom::merge`: concatenate two words.
    fn merge(self, right: Atom) -> Atom {
        let brace = self.merge_brace_hint() || right.merge_brace_hint();
        let glob = self.has_glob_expansion() || right.has_glob_expansion();
        let mut atoms = self.into_atoms();
        atoms.extend(right.into_atoms());
        Atom::Compound(CompoundAtom {
            atoms,
            brace_expansion_hint: brace,
            glob_hint: glob,
        })
    }

    fn merge_brace_hint(&self) -> bool {
        match self {
            Atom::Simple(a) => is_brace_atom(a),
            Atom::Compound(c) => c.brace_expansion_hint,
        }
    }

    fn into_atoms(self) -> Vec<SimpleAtom> {
        match self {
            Atom::Simple(a) => vec![a],
            Atom::Compound(c) => c.atoms,
        }
    }

    pub(crate) fn has_glob_expansion(&self) -> bool {
        match self {
            Atom::Simple(a) => is_glob_atom(a),
            Atom::Compound(c) => c.glob_hint,
        }
    }

    pub(crate) fn has_brace_expansion(&self) -> bool {
        matches!(self, Atom::Compound(c) if c.brace_expansion_hint)
    }

    pub(crate) fn atoms_len(&self) -> usize {
        match self {
            Atom::Simple(_) => 1,
            Atom::Compound(c) => c.atoms.len(),
        }
    }

    /// The simple atoms of this word, in order.
    pub(crate) fn atoms(&self) -> &[SimpleAtom] {
        match self {
            Atom::Simple(a) => std::slice::from_ref(a),
            Atom::Compound(c) => &c.atoms,
        }
    }
}

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
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};

    /// The AST in the JSON shape the JavaScript parser produces.
    pub(crate) fn script_json(s: &Script) -> Value {
        json!({ "stmts": s.stmts.iter().map(stmts_json).collect::<Vec<_>>() })
    }

    fn stmts_json(s: &Stmt) -> Value {
        json!({ "exprs": s.exprs.iter().map(expr_json).collect::<Vec<_>>() })
    }

    fn stmt_list_json(s: &[Stmt]) -> Value {
        Value::Array(s.iter().map(stmts_json).collect())
    }

    fn assign_json(a: &Assign) -> Value {
        json!({ "label": a.label, "value": atom_json(&a.value) })
    }

    fn redirect_json(r: &Option<Redirect>) -> Value {
        match r {
            None => Value::Null,
            Some(Redirect::JsBuf(idx)) => json!({ "type": "jsbuf", "idx": idx }),
            Some(Redirect::Atom(a)) => json!({ "type": "atom", "atom": atom_json(a) }),
        }
    }

    fn expr_json(e: &Expr) -> Value {
        match e {
            Expr::Assign(a) => {
                json!({ "type": "assign", "assigns": a.iter().map(assign_json).collect::<Vec<_>>() })
            }
            Expr::Binary(b) => json!({
                "type": "binary",
                "op": b.op.as_str(),
                "left": expr_json(&b.left),
                "right": expr_json(&b.right),
            }),
            Expr::Pipeline(items) => {
                json!({ "type": "pipeline", "items": items.iter().map(expr_json).collect::<Vec<_>>() })
            }
            Expr::Cmd(c) => json!({
                "type": "cmd",
                "assigns": c.assigns.iter().map(assign_json).collect::<Vec<_>>(),
                "nameAndArgs": c.name_and_args.iter().map(atom_json).collect::<Vec<_>>(),
                "redirectFile": redirect_json(&c.redirect_file),
                "redirect": c.redirect.bits(),
            }),
            Expr::Subshell(s) => json!({
                "type": "subshell",
                "script": script_json(&s.script),
                "redirect": redirect_json(&s.redirect),
                "redirectFlags": s.redirect_flags.bits(),
            }),
            Expr::If(i) => json!({
                "type": "if",
                "cond": stmt_list_json(&i.cond),
                "then": stmt_list_json(&i.then),
                "elseParts": i.else_parts.iter().map(|p| stmt_list_json(p)).collect::<Vec<_>>(),
            }),
            Expr::CondExpr(c) => json!({
                "type": "condexpr",
                "op": c.op.as_str(),
                "args": c.args.iter().map(atom_json).collect::<Vec<_>>(),
            }),
        }
    }

    fn simple_json(a: &SimpleAtom) -> Value {
        match a {
            SimpleAtom::Var(name) => json!({ "t": "Var", "name": name }),
            SimpleAtom::VarArgv(n) => json!({ "t": "VarArgv", "n": n }),
            SimpleAtom::Text(text) => json!({ "t": "Text", "text": text }),
            SimpleAtom::QuotedEmpty => json!({ "t": "QuotedEmpty" }),
            SimpleAtom::Asterisk => json!({ "t": "Asterisk" }),
            SimpleAtom::DoubleAsterisk => json!({ "t": "DoubleAsterisk" }),
            SimpleAtom::BraceBegin => json!({ "t": "BraceBegin" }),
            SimpleAtom::BraceEnd => json!({ "t": "BraceEnd" }),
            SimpleAtom::Comma => json!({ "t": "Comma" }),
            SimpleAtom::Tilde => json!({ "t": "Tilde" }),
            SimpleAtom::CmdSubst(c) => {
                json!({ "t": "CmdSubst", "script": script_json(&c.script), "quoted": c.quoted })
            }
        }
    }

    fn atom_json(a: &Atom) -> Value {
        match a {
            Atom::Simple(s) => json!({ "type": "simple", "atom": simple_json(s) }),
            Atom::Compound(c) => json!({
                "type": "compound",
                "atoms": c.atoms.iter().map(simple_json).collect::<Vec<_>>(),
                "braceExpansionHint": c.brace_expansion_hint,
                "globHint": c.glob_hint,
            }),
        }
    }

    fn p(src: &str) -> Script {
        parse(src, &[], 0).unwrap_or_else(|e| panic!("{src:?}: {e}"))
    }

    fn err(src: &str) -> String {
        parse(src, &[], 0).expect_err(src)
    }

    fn text(s: &str) -> Atom {
        Atom::Simple(SimpleAtom::Text(s.to_string()))
    }

    fn only_expr(s: Script) -> Expr {
        assert_eq!(s.stmts.len(), 1);
        let mut exprs = s.stmts.into_iter().next().unwrap().exprs;
        assert_eq!(exprs.len(), 1);
        exprs.pop().unwrap()
    }

    #[test]
    fn empty_script() {
        assert_eq!(p("").stmts, []);
        assert_eq!(p("   ").stmts.len(), 0);
    }

    #[test]
    fn simple_command() {
        let Expr::Cmd(cmd) = only_expr(p("FOO=1 echo hi \"a b\" > out.txt")) else {
            panic!()
        };
        assert_eq!(cmd.assigns[0].label, "FOO");
        assert_eq!(cmd.assigns[0].value, text("1"));
        assert_eq!(cmd.name_and_args, [text("echo"), text("hi"), text("a b")]);
        assert_eq!(cmd.redirect, RedirectFlags::STDOUT);
        assert_eq!(cmd.redirect_file, Some(Redirect::Atom(text("out.txt"))));
    }

    #[test]
    fn binary_and_pipeline() {
        let Expr::Binary(b) = only_expr(p("a | b && c || d")) else {
            panic!()
        };
        assert_eq!(b.op, BinaryOp::Or);
        let Expr::Binary(inner) = &b.left else {
            panic!()
        };
        assert_eq!(inner.op, BinaryOp::And);
        assert!(matches!(&inner.left, Expr::Pipeline(items) if items.len() == 2));
    }

    #[test]
    fn words_and_atoms() {
        let Expr::Cmd(cmd) = only_expr(p("echo ~/x *.txt {a,b}c $1 \"\" $(ls) `pwd`")) else {
            panic!()
        };
        let args = &cmd.name_and_args;
        assert_eq!(
            args[1].atoms(),
            [SimpleAtom::Tilde, SimpleAtom::Text("/x".into())]
        );
        assert!(args[2].has_glob_expansion());
        assert!(args[3].has_brace_expansion());
        assert_eq!(args[4], Atom::Simple(SimpleAtom::VarArgv(1)));
        assert_eq!(args[5], Atom::Simple(SimpleAtom::QuotedEmpty));
        assert!(matches!(&args[6], Atom::Simple(SimpleAtom::CmdSubst(c)) if !c.quoted));
        assert_eq!(args.len(), 8);
    }

    #[test]
    fn if_clause() {
        let Expr::If(i) = only_expr(p("if a; then b; elif c; then d; else e; fi")) else {
            panic!()
        };
        assert_eq!(i.cond.len(), 1);
        assert_eq!(i.then.len(), 1);
        assert_eq!(i.else_parts.len(), 3);
    }

    #[test]
    fn cond_expr_and_subshell() {
        let Expr::CondExpr(c) = only_expr(p("[[ -f foo ]]")) else {
            panic!()
        };
        assert_eq!((c.op, c.args.len()), (CondExprOp::IsFile, 1));
        let Expr::CondExpr(c) = only_expr(p("[[ $a == b ]]")) else {
            panic!()
        };
        assert_eq!((c.op, c.args.len()), (CondExprOp::Eq, 2));
        assert!(matches!(only_expr(p("(a; b)")), Expr::Subshell(s) if s.script.stmts.len() == 2));
    }

    #[test]
    fn assignments_and_redirect_buffers() {
        assert!(matches!(only_expr(p("A=1 B=\"x\"$y")), Expr::Assign(a) if a.len() == 2));
        let script = parse("cat < \x08__bun_0\x08", &[], 1).unwrap();
        let Expr::Cmd(cmd) = only_expr(script) else {
            panic!()
        };
        assert_eq!(cmd.redirect_file, Some(Redirect::JsBuf(0)));
        let Expr::Cmd(cmd) = only_expr(p("a 2>&1")) else {
            panic!()
        };
        assert_eq!(cmd.redirect_file, None);
        assert!(cmd.redirect.contains(RedirectFlags::DUPLICATE_OUT));
    }

    #[test]
    fn interpolated_keywords_are_words() {
        let strings = vec!["if".to_string()];
        let script = parse("echo \x08__bunstr_0\x08", &strings, 0).unwrap();
        assert!(matches!(only_expr(script), Expr::Cmd(_)));
        let script = parse("\x08__bunstr_0\x08 a; then b; fi", &strings, 0).unwrap();
        assert_eq!(script.stmts.len(), 3);
        assert!(script
            .stmts
            .iter()
            .all(|s| matches!(s.exprs.as_slice(), [Expr::Cmd(_)])));
    }

    #[test]
    fn error_messages() {
        assert_eq!(
            err("echo hi &"),
            "Background commands \"&\" are not supported yet."
        );
        assert_eq!(err("echo >"), "Redirection with no file");
        assert_eq!(
            err("(echo) > f"),
            "Subshells with redirections are currently not supported. Please open a GitHub issue."
        );
        assert_eq!(err("if a; b; fi"), "Expected \"then\" but got: Eof");
        assert_eq!(
            err("if a; then b"),
            "Expected \"else\", \"elif\", or \"fi\" but got: Eof"
        );
        assert_eq!(
            err("[[ -q x ]]"),
            "Unknown conditional expression operation: -q"
        );
        assert_eq!(
            err("[[ -e x ]]"),
            "Conditional expression operation: -e, is not supported right now. Please open a GitHub issue if you would like it to be supported."
        );
        assert_eq!(err("[[ -f ]]"), "Expected a word, but got: ]]");
        assert_eq!(err("[[ a == b"), "Expected \"]]\" but got: EOF");
        assert_eq!(err("echo a (b)"), "Unexpected token: `(`");
        assert_eq!(err("echo a | ;"), "expected a command or assignment");
        assert_eq!(
            err("echo | &&"),
            "expected a command or assignment but got: \"DoubleAmpersand\""
        );
        assert_eq!(err("echo $(ls"), "Unclosed command substitution");
        assert_eq!(err("ls )\nls |"), "Unexpected ')'\nUnexpected EOF");
        assert_eq!(
            err(&"(".repeat(200)),
            "failed to lex/parse shell: Subshell nesting depth exceeded"
        );
    }

    #[test]
    fn deep_nesting_is_an_error_not_a_crash() {
        let ifs = |n: usize| format!("{}b{}", "if a; then ".repeat(n), "; fi".repeat(n));
        assert!(parse(&ifs(2000), &[], 0).is_ok());
        assert_eq!(err(&ifs(2049)), "Maximum call stack size exceeded");
        let substs = format!("{}b{}", "$(".repeat(128), ")".repeat(128));
        assert!(parse(&substs, &[], 0).is_ok());
        let mixed = format!("{}{}{}", "(".repeat(60), ifs(1900), ")".repeat(60));
        assert!(parse(&mixed, &[], 0).is_ok());
    }

    /// Decode one value from the prefix-order specs of the diff script (an
    /// array is `{"array": len}` followed by its items).
    fn value_from_spec<'a>(
        specs: &mut impl Iterator<Item = &'a Value>,
    ) -> crate::bun_shell::ShellValue {
        use crate::bun_shell::ShellValue;
        let spec = specs.next().expect("value spec");
        let field = |k: &str| spec.get(k);
        if spec.is_null() {
            ShellValue::Null
        } else if let Some(s) = field("str") {
            ShellValue::Str(s.as_str().unwrap().to_string())
        } else if let Some(s) = field("raw") {
            ShellValue::Raw(s.as_str().unwrap().to_string())
        } else if let Some(n) = field("num") {
            ShellValue::Number(match n.as_str() {
                Some("NaN") => f64::NAN,
                Some("Infinity") => f64::INFINITY,
                Some("-Infinity") => f64::NEG_INFINITY,
                Some("-0") => -0.0,
                _ => n.as_f64().unwrap(),
            })
        } else if let Some(s) = field("bigint") {
            ShellValue::BigInt(s.as_str().unwrap().to_string())
        } else if let Some(b) = field("bool") {
            ShellValue::Bool(b.as_bool().unwrap())
        } else if field("undefined").is_some() {
            ShellValue::Undefined
        } else if let Some(len) = field("array") {
            ShellValue::Array(
                (0..len.as_u64().unwrap())
                    .map(|_| value_from_spec(specs))
                    .collect(),
            )
        } else if let Some(bytes) = field("bytes") {
            ShellValue::Bytes(
                bytes
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_u64().unwrap() as u8)
                    .collect(),
            )
        } else {
            panic!("unknown value spec {spec}")
        }
    }

    fn strings_of(v: &Value) -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    }

    /// Differential test hook for `experiments/issue-27/rust-frontend-diff.mjs`.
    /// Reads JSON lines from the file named by `BUN_SHELL_PARSE_IN`, each one
    /// of `{"script", "jsstrings", "jsobjsLen"}` (parse only),
    /// `{"strings", "values"}` (template builder, then parse) or
    /// `{"braces"}` (brace expansion), and writes one JSON result per line to
    /// `BUN_SHELL_PARSE_OUT`.
    #[test]
    #[ignore]
    fn dump_parse_results() {
        std::thread::Builder::new()
            .stack_size(512 * 1024 * 1024)
            .spawn(dump_parse_results_impl)
            .unwrap()
            .join()
            .unwrap();
    }

    fn dump_parse_results_impl() {
        use crate::bun_shell::template::build_shell_source;
        let input = std::env::var("BUN_SHELL_PARSE_IN").expect("BUN_SHELL_PARSE_IN");
        let output = std::env::var("BUN_SHELL_PARSE_OUT").expect("BUN_SHELL_PARSE_OUT");
        let mut out = String::new();
        for line in std::fs::read_to_string(input).unwrap().lines() {
            let case: Value = serde_json::from_str(line).unwrap();
            let result = if let Some(pattern) = case.get("braces") {
                match crate::bun_shell::braces::braces(pattern.as_str().unwrap()) {
                    Ok(words) => json!({ "words": words }),
                    Err(e) => json!({ "error": e.to_string() }),
                }
            } else if let Some(strings) = case.get("strings") {
                let strings = strings_of(strings);
                let strings: Vec<&str> = strings.iter().map(String::as_str).collect();
                let mut specs = case["values"].as_array().unwrap().iter().peekable();
                let mut values = Vec::new();
                while specs.peek().is_some() {
                    values.push(value_from_spec(&mut specs));
                }
                match build_shell_source(&strings, values) {
                    Err(e) => json!({ "error": e }),
                    Ok(src) => {
                        let parsed = match parse(&src.script, &src.jsstrings, src.jsobjs.len()) {
                            Ok(ast) => json!({ "ast": script_json(&ast) }),
                            Err(e) => json!({ "error": e }),
                        };
                        json!({
                            "script": src.script,
                            "jsstrings": src.jsstrings,
                            "jsobjsLen": src.jsobjs.len(),
                            "parsed": parsed,
                        })
                    }
                }
            } else {
                match parse(
                    case["script"].as_str().unwrap(),
                    &strings_of(&case["jsstrings"]),
                    case["jsobjsLen"].as_u64().unwrap() as usize,
                ) {
                    Ok(ast) => json!({ "ast": script_json(&ast) }),
                    Err(e) => json!({ "error": e }),
                }
            };
            out.push_str(&result.to_string());
            out.push('\n');
        }
        std::fs::write(output, out).unwrap();
    }
}
