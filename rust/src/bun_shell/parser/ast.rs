//! The Bun Shell AST (Bun's `src/shell_parser/parse.rs` `ast`).

use std::fmt;
use std::ops::BitOr;

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
    /// The JS AST spelling (used by the parser corpus tests).
    #[cfg(test)]
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
    pub(super) fn from_str(s: &str) -> Option<Self> {
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

    /// The operator's spelling (used by the parser corpus tests).
    #[cfg(test)]
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
    pub(super) fn merge(self, right: Atom) -> Atom {
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

    /// The simple atoms of this word, in order.
    pub(crate) fn atoms(&self) -> &[SimpleAtom] {
        match self {
            Atom::Simple(a) => std::slice::from_ref(a),
            Atom::Compound(c) => &c.atoms,
        }
    }
}
