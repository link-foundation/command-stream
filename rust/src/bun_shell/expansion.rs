//! Word expansion: Bun's `Expansion` state
//! (`src/runtime/shell/states/Expansion.rs`; MIT, Copyright (c) Oven-sh /
//! Jarred Sumner), ported by way of `js/src/bun-shell/expansion.mjs`:
//! variables, `$0..$9`, tilde, command substitution with word splitting,
//! brace expansion and globbing.
//!
//! The result mirrors Bun's `ExpansionResult`: `buf` holds the expanded words
//! back to back and `bounds` the offsets where a new word starts, so a single
//! word (no bounds) can be told apart from several (possibly empty) words.
//! Offsets are byte offsets into UTF-8 strings (the JS port uses UTF-16
//! indices; both only ever point at ASCII characters).

use super::braces::{self, BraceError, MAX_BRACE_EXPANSIONS};
use super::env::ShellExecEnv;
use super::glob::{self, WalkOptions};
use super::interpreter::Interpreter;
use super::io::ShellSysError;
use super::parser::{Atom, CmdSubst, SimpleAtom};
use super::ShellError;

const TRIM_CHARS: &[char] = &[' ', '\n', '\r', '\t'];

/// An expansion failure (Bun's `ShellErr`).
#[derive(Clone, Debug)]
pub(crate) enum ExpandError {
    /// `ShellErr::Sys`: displayed as `bun: {message}: {path}`.
    Sys(ShellSysError),
    /// `ShellErr::Custom`: displayed as `bun: {message}`.
    Custom(String),
    /// A command substitution rejected the whole run (an error Bun throws
    /// into JS); it is propagated, never displayed.
    Fatal(ShellError),
}

impl ExpandError {
    /// The text written to stderr (without the trailing newline), or the
    /// error that rejects the run (the JS `displayErr` rethrowing).
    pub(crate) fn display(self) -> Result<String, ShellError> {
        match self {
            ExpandError::Sys(e) => Ok(e.display()),
            ExpandError::Custom(msg) => Ok(format!("bun: {msg}")),
            ExpandError::Fatal(e) => Err(e),
        }
    }
}

/// The expanded words of one atom (Bun's `ExpansionResult`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Expanded {
    pub(crate) buf: String,
    /// Byte offsets in `buf` where the second, third, ... word starts.
    pub(crate) bounds: Vec<usize>,
    /// The exit code of a failed command substitution (simple atoms only).
    pub(crate) out_exit_code: Option<i32>,
    /// The atom contained `""` / `''`.
    pub(crate) has_quoted_empty: bool,
}

impl Expanded {
    /// Split `buf` into its words (the JS `expansionWords`).
    pub(crate) fn words(&self) -> Vec<String> {
        let mut words = Vec::with_capacity(self.bounds.len() + 1);
        let mut start = 0;
        for &end in &self.bounds {
            words.push(self.buf[start..end].to_string());
            start = end;
        }
        words.push(self.buf[start..].to_string());
        words
    }
}

/// How an atom is expanded.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ExpandOpts {
    /// The atom is the value of an assignment: a failed glob keeps the
    /// pattern.
    pub(crate) is_assign: bool,
    /// Command substitutions are not word-split.
    pub(crate) assign_ctx: bool,
}

fn is_sep(ch: char) -> bool {
    ch == '/' || (cfg!(windows) && ch == '\\')
}

/// Escape non-meta characters so the glob walker matches them literally.
fn neutralize_glob_metachars(current_out: &str, meta_offsets: &[usize]) -> String {
    let mut pattern = String::with_capacity(current_out.len());
    let mut next_meta = 0;
    for (i, ch) in current_out.char_indices() {
        if meta_offsets.get(next_meta) == Some(&i) {
            next_meta += 1;
            pattern.push(ch);
            continue;
        }
        match ch {
            '*' | '?' | '[' | ']' | '{' | '}' | ',' => {
                pattern.push('[');
                pattern.push(ch);
                pattern.push(']');
            }
            '!' => {
                if pattern.chars().last().is_none_or(is_sep) {
                    pattern.push_str("{!}");
                } else {
                    pattern.push('!');
                }
            }
            '\\' if !cfg!(windows) => pattern.push_str("[\\\\]"),
            _ => pattern.push(ch),
        }
    }
    pattern
}

struct Expansion<'a> {
    interp: &'a Interpreter,
    shell: &'a ShellExecEnv,
    atom: &'a Atom,
    opts: ExpandOpts,
    buf: String,
    bounds: Vec<usize>,
    current_out: String,
    meta_offsets: Vec<usize>,
    has_quoted_empty: bool,
    out_exit_code: Option<i32>,
}

impl<'a> Expansion<'a> {
    fn push_current_out(&mut self) {
        if !self.buf.is_empty() {
            self.bounds.push(self.buf.len());
        }
        self.buf.push_str(&self.current_out);
        self.current_out.clear();
        self.meta_offsets.clear();
    }

    fn push_word(&mut self, word: &str) {
        if !self.buf.is_empty() {
            self.bounds.push(self.buf.len());
        }
        self.buf.push_str(word);
    }

    fn push_meta(&mut self, s: &str) {
        for i in 0..s.len() {
            self.meta_offsets.push(self.current_out.len() + i);
        }
        self.current_out.push_str(s);
    }

    fn expand_simple(&mut self, simple: &SimpleAtom) {
        match simple {
            SimpleAtom::Text(text) => self.current_out.push_str(text),
            SimpleAtom::QuotedEmpty => self.has_quoted_empty = true,
            SimpleAtom::Var(name) => {
                if let Some(v) = self.shell.get_var(name) {
                    self.current_out.push_str(v);
                }
            }
            SimpleAtom::VarArgv(n) => {
                if let Some(v) = self.interp.argv.get(usize::from(*n)) {
                    self.current_out.push_str(v);
                }
            }
            SimpleAtom::Asterisk => self.push_meta("*"),
            SimpleAtom::DoubleAsterisk => self.push_meta("**"),
            SimpleAtom::BraceBegin => self.push_meta("{"),
            SimpleAtom::BraceEnd => self.push_meta("}"),
            SimpleAtom::Comma => self.push_meta(","),
            SimpleAtom::Tilde => {
                let home = self.shell.get_homedir();
                self.current_out.push_str(&home);
            }
            // Handled by `run`.
            SimpleAtom::CmdSubst(_) => {}
        }
    }

    async fn cmd_subst(&mut self, simple: &CmdSubst) -> Result<(), ExpandError> {
        let (exit_code, stdout) = self
            .interp
            .cmd_subst(&simple.script, self.shell)
            .await
            .map_err(ExpandError::Fatal)?;
        if exit_code != 0 && matches!(self.atom, Atom::Simple(_)) {
            self.out_exit_code = Some(exit_code);
        }
        if simple.quoted || self.opts.assign_ctx {
            self.current_out
                .push_str(stdout.trim_end_matches(TRIM_CHARS));
        } else {
            self.post_subshell_expansion(&stdout);
        }
        Ok(())
    }

    /// Word splitting of an unquoted command substitution.
    fn post_subshell_expansion(&mut self, stdout: &str) {
        let out = stdout.strip_suffix('\n').unwrap_or(stdout);
        let replaced = out.replace('\n', " ");
        let out = replaced.trim_matches(TRIM_CHARS);
        if out.is_empty() {
            return;
        }
        let mut prev_ws = false;
        let mut a = 0;
        for (i, c) in out.char_indices() {
            if prev_ws {
                if c != ' ' {
                    a = i;
                    prev_ws = false;
                }
                continue;
            }
            if c == ' ' {
                prev_ws = true;
                self.current_out.push_str(&out[a..i]);
                self.push_current_out();
            }
        }
        self.current_out.push_str(&out[a..]);
    }

    fn expand_leading_tilde(&mut self) {
        let home = self.shell.get_homedir();
        let before = self.current_out.len();
        match self.current_out.chars().next() {
            Some('/') | Some('\\') => self.current_out.insert_str(0, &home),
            Some(_) => self.current_out.insert(0, '~'),
            None if self.has_quoted_empty => self.current_out = home,
            None => {}
        }
        let prepended = self.current_out.len() - before;
        if prepended != 0 {
            for o in &mut self.meta_offsets {
                *o += prepended;
            }
        }
    }

    fn brace_expand(&mut self) -> Result<(), ExpandError> {
        let mut escaped = String::with_capacity(self.current_out.len());
        let mut next_meta = 0;
        for (i, ch) in self.current_out.char_indices() {
            if self.meta_offsets.get(next_meta) == Some(&i) {
                next_meta += 1;
            } else if matches!(ch, '{' | '}' | ',' | '\\') {
                escaped.push('\\');
            }
            escaped.push(ch);
        }
        let tokens = braces::tokenize(&escaped);
        let count = braces::calculate_expanded_amount(&tokens.tokens);
        if count > MAX_BRACE_EXPANSIONS {
            return Err(ExpandError::Custom(format!(
                "too many brace expansions ({count} > {MAX_BRACE_EXPANSIONS})"
            )));
        }
        let expanded = if count == 0 {
            vec![self.current_out.clone()]
        } else {
            match braces::expand(tokens.tokens, count, tokens.contains_nested) {
                Ok(words) => words,
                Err(BraceError::TooManyBraces) => {
                    return Err(ExpandError::Custom(
                        "too many braces in brace expansion".to_string(),
                    ))
                }
                Err(e) => return Err(ExpandError::Custom(e.to_string())),
            }
        };
        for word in &expanded {
            self.push_word(word);
        }
        Ok(())
    }

    fn glob(&mut self) -> Result<(), ExpandError> {
        let pattern = neutralize_glob_metachars(&self.current_out, &self.meta_offsets);
        let options = WalkOptions {
            cwd: self.shell.cwd.clone(),
            dot: false,
            absolute: false,
            follow_symlinks: false,
            error_on_broken_symlinks: false,
            only_files: false,
        };
        let (entries, walk_err) = match glob::walk(&pattern, &options) {
            Ok(entries) => (entries, None),
            Err(e) if e.is("ENOENT") || e.is("ENOTDIR") => (Vec::new(), None),
            Err(e) => (Vec::new(), Some(e)),
        };
        if entries.is_empty() || walk_err.is_some() {
            if self.opts.is_assign {
                self.push_current_out();
                return Ok(());
            }
            if let Some(e) = walk_err {
                return Err(match e.code {
                    Some(code) if code.starts_with('E') => ExpandError::Sys(
                        ShellSysError::new(code)
                            .with_path(e.path)
                            .with_syscall(e.syscall),
                    ),
                    _ => ExpandError::Custom(e.message),
                });
            }
            return Err(ExpandError::Custom(format!(
                "no matches found: {}",
                self.current_out
            )));
        }
        for entry in &entries {
            self.push_word(entry);
        }
        Ok(())
    }

    async fn run(&mut self) -> Result<(), ExpandError> {
        let atom = self.atom;
        let atoms = atom.atoms();
        let leading_tilde =
            matches!(atom, Atom::Compound(_)) && matches!(atoms.first(), Some(SimpleAtom::Tilde));
        for simple in &atoms[usize::from(leading_tilde)..] {
            match simple {
                SimpleAtom::CmdSubst(cs) => self.cmd_subst(cs).await?,
                _ => self.expand_simple(simple),
            }
        }
        if leading_tilde {
            self.expand_leading_tilde();
        }
        if atom.has_brace_expansion() {
            self.brace_expand()?;
            if atom.has_glob_expansion() {
                self.glob()?;
            }
            return Ok(());
        }
        if atom.has_glob_expansion() {
            return self.glob();
        }
        self.push_current_out();
        Ok(())
    }
}

/// Expand one atom in `shell` (command substitutions run through `interp`).
pub(crate) async fn expand_atom(
    interp: &Interpreter,
    shell: &ShellExecEnv,
    atom: &Atom,
    opts: ExpandOpts,
) -> Result<Expanded, ExpandError> {
    let mut e = Expansion {
        interp,
        shell,
        atom,
        opts,
        buf: String::new(),
        bounds: Vec::new(),
        current_out: String::new(),
        meta_offsets: Vec::new(),
        has_quoted_empty: false,
        out_exit_code: None,
    };
    e.run().await?;
    Ok(Expanded {
        buf: e.buf,
        bounds: e.bounds,
        out_exit_code: e.out_exit_code,
        has_quoted_empty: e.has_quoted_empty,
    })
}

#[cfg(test)]
mod tests;
