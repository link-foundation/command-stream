//! Glob matching and directory walking for Bun Shell, ported from
//! `js/src/bun-shell/glob.mjs`, which is itself a port of Bun v1.4.2
//! (`src/glob/matcher.rs` and `src/glob/GlobWalker.rs`, commit 09bb5463) with
//! the option handling of `src/runtime/api/glob.rs` (`Bun.Glob#scanSync`).
//!
//! The matcher works on UTF-8 bytes exactly like Bun's, so non-ASCII
//! patterns and paths behave the same. The walker reads directories in raw
//! OS order and yields paths in the same order as `Bun.Glob#scanSync` (and
//! the JS port). Like the JS port only POSIX pattern semantics are
//! implemented: `/` is the only separator in patterns and results, and
//! matching is always case-sensitive. On Windows, drive-absolute paths
//! (`C:\...`) are additionally recognised as absolute when opening
//! directories, so the walker still finds them.
//!
//! The matcher is derived from works under the MIT License:
//! Copyright (c) 2023 Devon Govett, (c) 2023 Stephen Gregoratto,
//! (c) 2024 shulaoda.

use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::io;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const REPLACEMENT_CHAR: u32 = 0xFFFD;
const MAX_BRACE_DEPTH: usize = 10;
const BRACE_BRANCH_BUDGET: u32 = 10_000;

/// `strings::wtf8_byte_sequence_length`.
fn seq_len(b: u8) -> usize {
    match b {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf7 => 4,
        _ => 1,
    }
}

fn is_cont(b: u8) -> bool {
    b & 0xc0 == 0x80
}

/// `strings::decode_wtf8_rune_t_multibyte` over a zero-padded 4-byte window.
fn decode_multibyte(p: [u8; 4], len: usize) -> u32 {
    let [p0, p1, p2, p3] = p.map(u32::from);
    if !is_cont(p[1]) {
        return REPLACEMENT_CHAR;
    }
    if len == 2 {
        let cp = ((p0 & 0x1f) << 6) | (p1 & 0x3f);
        return if cp < 0x80 { REPLACEMENT_CHAR } else { cp };
    }
    if !is_cont(p[2]) {
        return REPLACEMENT_CHAR;
    }
    if len == 3 {
        let cp = ((p0 & 0x0f) << 12) | ((p1 & 0x3f) << 6) | (p2 & 0x3f);
        return if cp < 0x800 { REPLACEMENT_CHAR } else { cp };
    }
    if !is_cont(p[3]) {
        return REPLACEMENT_CHAR;
    }
    let cp = ((p0 & 0x07) << 18) | ((p1 & 0x3f) << 12) | ((p2 & 0x3f) << 6) | (p3 & 0x3f);
    if !(0x10000..=0x10ffff).contains(&cp) {
        REPLACEMENT_CHAR
    } else {
        cp
    }
}

/// matcher.rs `decode_wtf8_rune_at`: returns `(codepoint, byte_len)`.
fn decode_rune_at(bytes: &[u8], idx: usize) -> (u32, usize) {
    let len = seq_len(bytes[idx]);
    if len == 1 {
        return (u32::from(bytes[idx]), 1);
    }
    let at = |i: usize| bytes.get(idx + i).copied().unwrap_or(0);
    (
        decode_multibyte([bytes[idx], at(1), at(2), at(3)], len),
        len,
    )
}

fn unescape_byte(b: u8) -> u8 {
    match b {
        b'a' => 0x61,
        b'b' => 0x08,
        b'n' => b'\n',
        b'r' => b'\r',
        b't' => b'\t',
        other => other,
    }
}

// ---------------------------------------------------------------------------
// Matcher (matcher.rs)
// ---------------------------------------------------------------------------

/// Outcome of one iteration of `glob_match_impl`'s main loop.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Step {
    /// `continue 'main_loop`.
    Continue,
    /// Fall through to the backtracking check.
    Mismatch,
    /// Run the literal-character branch.
    ToElse,
    /// `return false`.
    Fail,
    /// `return true`.
    Success,
}

/// Matcher state; `w_*` is the wildcard backtrack point, `s_*` the globstar
/// one.
#[derive(Clone, Copy, Default)]
struct State {
    pi: usize,
    gi: usize,
    bd: u8,
    w_gi: usize,
    w_pi: usize,
    w_bd: u8,
    s_gi: usize,
    s_pi: usize,
    s_bd: u8,
}

impl State {
    fn restore_globstar(&mut self) {
        self.w_gi = self.s_gi;
        self.w_pi = self.s_pi;
        self.w_bd = self.s_bd;
    }

    fn skip_to_separator(&mut self, path: &[u8], is_end_invalid: bool) {
        if self.pi == path.len() {
            self.w_pi += 1;
            return;
        }
        let mut pi = self.pi;
        while pi < path.len() && path[pi] != b'/' {
            pi += 1;
        }
        if is_end_invalid || pi != path.len() {
            pi += 1;
        }
        self.w_pi = pi;
        self.s_gi = self.w_gi;
        self.s_pi = self.w_pi;
        self.s_bd = self.w_bd;
    }
}

#[derive(Clone, Copy)]
struct Brace {
    open: usize,
    branch: usize,
    /// Index of the matching `}`, or `glob.len()` if unterminated.
    close: usize,
}

struct MatchCtx {
    stack: Vec<Brace>,
    budget: u32,
}

fn skip_globstars(glob: &[u8], gi: usize) -> usize {
    let mut i = gi + 2;
    while i + 4 <= glob.len() && &glob[i..i + 4] == b"/**/" {
        i += 3;
    }
    if i + 3 == glob.len() && &glob[i..i + 3] == b"/**" {
        i += 3;
    }
    i - 2
}

/// The `**` half of the `*` arm: `None` means `continue 'main_loop`,
/// otherwise whether the matcher is now inside a globstar.
fn enter_globstar(s: &mut State, glob: &[u8], glob_start: usize, path: &[u8]) -> Option<bool> {
    s.gi += 2;
    let is_end_invalid = s.gi < glob.len();
    if is_end_invalid
        && s.pi == path.len()
        && glob.len() - s.gi == 2
        && glob[s.gi] == b'/'
        && glob[s.gi + 1] == b'*'
    {
        return None;
    }
    let at_segment_start = s.gi.saturating_sub(glob_start) < 3 || glob[s.gi - 3] == b'/';
    if at_segment_start && (!is_end_invalid || glob[s.gi] == b'/') {
        if is_end_invalid {
            s.gi += 1;
        }
        s.skip_to_separator(path, is_end_invalid);
        return Some(true);
    }
    Some(false)
}

fn step_star(s: &mut State, glob: &[u8], glob_start: usize, path: &[u8]) -> Step {
    let is_globstar = s.gi + 1 < glob.len() && glob[s.gi + 1] == b'*';
    if is_globstar {
        s.gi = skip_globstars(glob, s.gi);
    }
    s.w_gi = s.gi;
    s.w_pi = s.pi + path.get(s.pi).map_or(1, |&b| seq_len(b));
    s.w_bd = s.bd;
    let mut in_globstar = false;
    if is_globstar {
        match enter_globstar(s, glob, glob_start, path) {
            None => return Step::Continue,
            Some(v) => in_globstar = v,
        }
    } else {
        s.gi += 1;
    }
    if !in_globstar && path.get(s.pi) == Some(&b'/') {
        s.restore_globstar();
    }
    Step::Continue
}

fn step_question(s: &mut State, path: &[u8]) -> Step {
    let Some(&b) = path.get(s.pi) else {
        return Step::ToElse;
    };
    if b == b'/' {
        return Step::Mismatch;
    }
    s.gi += 1;
    s.pi += seq_len(b);
    Step::Continue
}

/// matcher.rs `get_unicode`: the (unescaped) codepoint at `s.gi` and its
/// byte length, or `None` for an invalid pattern.
fn get_unicode(s: &mut State, glob: &[u8]) -> Option<(u32, usize)> {
    let c = glob[s.gi];
    if c <= 0x7f && c != b'\\' {
        return Some((u32::from(c), 1));
    }
    if c == b'\\' {
        s.gi += 1;
        let &e = glob.get(s.gi)?;
        if matches!(e, b'a' | b'b' | b'n' | b'r' | b't') {
            return Some((u32::from(unescape_byte(e)), 1));
        }
    }
    Some(decode_rune_at(glob, s.gi))
}

/// Scans one `[...]` class; `None` when the pattern is invalid.
fn scan_class(s: &mut State, glob: &[u8], c: u32) -> Option<bool> {
    let mut first = true;
    let mut is_match = false;
    while s.gi < glob.len() && (first || glob[s.gi] != b']') {
        let (low, low_len) = get_unicode(s, glob)?;
        s.gi += low_len;
        let mut high = low;
        if s.gi + 1 < glob.len() && glob[s.gi] == b'-' && glob[s.gi + 1] != b']' {
            s.gi += 1;
            let (h, h_len) = get_unicode(s, glob)?;
            s.gi += h_len;
            high = h;
        }
        if low <= c && c <= high {
            is_match = true;
        }
        first = false;
    }
    Some(is_match)
}

fn step_bracket(s: &mut State, glob: &[u8], path: &[u8]) -> Step {
    if s.pi >= path.len() {
        return Step::ToElse;
    }
    s.gi += 1;
    let mut negated = false;
    if s.gi < glob.len() && (glob[s.gi] == b'^' || glob[s.gi] == b'!') {
        negated = true;
        s.gi += 1;
    }
    let (c, len) = decode_rune_at(path, s.pi);
    let Some(is_match) = scan_class(s, glob, c) else {
        return Step::Fail;
    };
    if s.gi >= glob.len() {
        return Step::Fail;
    }
    s.gi += 1;
    if is_match != negated {
        s.pi += len;
        return Step::Continue;
    }
    Step::Mismatch
}

fn step_literal(s: &mut State, glob: &[u8], path: &[u8], ch: u8) -> Step {
    if s.pi >= path.len() {
        return Step::Mismatch;
    }
    let mut cc = ch;
    if cc == b'\\' {
        s.gi += 1;
        let Some(&e) = glob.get(s.gi) else {
            return Step::Fail;
        };
        cc = unescape_byte(e);
    }
    let cc_len = seq_len(cc);
    let is_match = if cc == b'/' {
        path[s.pi] == b'/'
    } else if cc_len > 1 {
        s.pi + cc_len <= path.len()
            && s.gi + cc_len <= glob.len()
            && path[s.pi..s.pi + cc_len] == glob[s.gi..s.gi + cc_len]
    } else {
        path[s.pi] == cc
    };
    if !is_match {
        return Step::Mismatch;
    }
    s.gi += cc_len;
    s.pi += cc_len;
    if cc == b'/' {
        s.restore_globstar();
    }
    Step::Continue
}

fn step_open_brace(s: &mut State, glob: &[u8], path: &[u8], ctx: &mut MatchCtx) -> Step {
    if let Some(brace) = ctx.stack.iter().find(|b| b.open == s.gi) {
        s.gi = brace.branch;
        s.bd = s.bd.wrapping_add(1);
        return Step::Continue;
    }
    if match_brace(s, glob, path, ctx) {
        Step::Success
    } else {
        Step::Fail
    }
}

fn step_glob(
    s: &mut State,
    glob: &[u8],
    glob_start: usize,
    path: &[u8],
    ctx: &mut MatchCtx,
) -> Step {
    let ch = glob[s.gi];
    let r = match ch {
        b'*' => return step_star(s, glob, glob_start, path),
        b'?' => step_question(s, path),
        b'[' => step_bracket(s, glob, path),
        b'{' => return step_open_brace(s, glob, path, ctx),
        b',' | b'}' => {
            if s.bd > 0 && skip_branch(s, glob, &ctx.stack) {
                return Step::Continue;
            }
            Step::ToElse
        }
        _ => Step::ToElse,
    };
    if r != Step::ToElse {
        return r;
    }
    step_literal(s, glob, path, ch)
}

fn glob_match_impl(
    s: &mut State,
    glob: &[u8],
    glob_start: usize,
    path: &[u8],
    ctx: &mut MatchCtx,
) -> bool {
    while s.gi < glob.len() || s.pi < path.len() {
        if s.gi < glob.len() {
            match step_glob(s, glob, glob_start, path, ctx) {
                Step::Continue => continue,
                Step::Fail => return false,
                Step::Success => return true,
                Step::Mismatch | Step::ToElse => {}
            }
        }
        if s.w_pi > 0 && s.w_pi <= path.len() {
            s.pi = s.w_pi;
            s.gi = s.w_gi;
            s.bd = s.w_bd;
            continue;
        }
        return false;
    }
    true
}

/// Index of the `}` matching the `{` at `open`, or `glob.len()`.
fn find_brace_end(glob: &[u8], open: usize) -> usize {
    let mut depth: i32 = 0;
    let mut in_brackets = false;
    let mut i = open;
    while i < glob.len() {
        match glob[i] {
            b'{' if !in_brackets => depth += 1,
            b'}' if !in_brackets => {
                depth -= 1;
                if depth == 0 {
                    return i;
                }
            }
            b'[' if !in_brackets => in_brackets = true,
            b']' => in_brackets = false,
            b'\\' => i += 1,
            _ => {}
        }
        i += 1;
    }
    glob.len()
}

fn match_brace(s: &mut State, glob: &[u8], path: &[u8], ctx: &mut MatchCtx) -> bool {
    let mut depth: i32 = 0;
    let mut in_brackets = false;
    let open = s.gi;
    let close = find_brace_end(glob, open);
    let mut branch = 0;
    while s.gi < glob.len() {
        match glob[s.gi] {
            b'{' if !in_brackets => {
                depth += 1;
                if depth == 1 {
                    branch = s.gi + 1;
                }
            }
            b'}' if !in_brackets => {
                depth -= 1;
                if depth == 0 {
                    let brace = Brace {
                        open,
                        branch,
                        close,
                    };
                    return match_brace_branch(s, glob, path, brace, ctx);
                }
            }
            b',' if depth == 1 && !in_brackets => {
                let brace = Brace {
                    open,
                    branch,
                    close,
                };
                if match_brace_branch(s, glob, path, brace, ctx) {
                    return true;
                }
                branch = s.gi + 1;
            }
            b'[' => in_brackets = true,
            b']' => in_brackets = false,
            b'\\' => s.gi += 1,
            _ => {}
        }
        s.gi += 1;
    }
    false
}

fn match_brace_branch(
    s: &State,
    glob: &[u8],
    path: &[u8],
    brace: Brace,
    ctx: &mut MatchCtx,
) -> bool {
    if ctx.budget == 0 {
        return false;
    }
    ctx.budget -= 1;
    if ctx.stack.len() >= MAX_BRACE_DEPTH {
        return false;
    }
    ctx.stack.push(brace);
    let mut branch_state = *s;
    branch_state.gi = brace.branch;
    // At most MAX_BRACE_DEPTH (10), so the cast cannot truncate.
    branch_state.bd = ctx.stack.len() as u8;
    let matched = glob_match_impl(&mut branch_state, glob, brace.branch, path, ctx);
    ctx.stack.pop();
    matched
}

/// Jumps past the `}` of the innermost stacked group enclosing `s.gi`;
/// returns `false` if none does (the `,`/`}` is then a literal).
fn skip_branch(s: &mut State, glob: &[u8], stack: &[Brace]) -> bool {
    let gi = s.gi;
    for frame in stack.iter().rev() {
        if frame.open < gi && gi <= frame.close {
            if frame.close < glob.len() {
                s.gi = frame.close + 1;
                s.bd = s.bd.wrapping_sub(1);
            } else {
                s.gi = frame.close;
            }
            return true;
        }
    }
    false
}

/// Result of matching one path (matcher.rs `MatchResult`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct MatchResult {
    /// Whether the path matched, with any leading `!` negation applied.
    pub(crate) matches: bool,
    /// Whether the pattern was negated (an odd number of leading `!`).
    pub(crate) negated: bool,
}

/// Matches the UTF-8 bytes of `path` against the glob `pattern` bytes
/// (matcher.rs `match`).
pub(crate) fn match_bytes(glob: &[u8], path: &[u8]) -> MatchResult {
    let mut s = State::default();
    let mut negated = false;
    while s.gi < glob.len() && glob[s.gi] == b'!' {
        negated = !negated;
        s.gi += 1;
    }
    let mut ctx = MatchCtx {
        stack: Vec::with_capacity(MAX_BRACE_DEPTH),
        budget: BRACE_BRANCH_BUDGET,
    };
    let glob_start = s.gi;
    let matched = glob_match_impl(&mut s, glob, glob_start, path, &mut ctx);
    MatchResult {
        matches: matched != negated,
        negated,
    }
}

/// Returns whether `path` matches the glob `pattern`, exactly like Bun's
/// `new Bun.Glob(pattern).match(path)` (and `globMatch` of the JS port).
///
/// Syntax: `?`, `*` (not across `/`), `**` (whole segments), `[ab]`,
/// `[a-z]`, `[!ab]`/`[^ab]`, `{a,b}` (nested up to 10 deep), leading `!`
/// (negation, repeatable) and `\` escapes (`\n`, `\t`, `\r`, `\b` are
/// control characters).
///
/// The shell itself only walks directories ([`walk`]); this matcher (and
/// [`has_glob_syntax`]) back the conformance tests of the glob engine.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn glob_match(pattern: &str, path: &str) -> bool {
    match_bytes(pattern.as_bytes(), path.as_bytes()).matches
}

/// Port of glob/lib.rs `detect_glob_syntax`: true when `pattern` contains an
/// unescaped `*`, `{`, `[` or `?`, or starts with `!`.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn has_glob_syntax(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    if bytes.first() == Some(&b'!') {
        return true;
    }
    for token in *b"*{[?" {
        let mut from = 0;
        while let Some(off) = bytes[from..].iter().position(|&b| b == token) {
            let idx = from + off;
            let mut i = idx;
            let mut escaped = false;
            while i > from && bytes[i - 1] == b'\\' {
                escaped = !escaped;
                i -= 1;
            }
            if !escaped {
                return true;
            }
            from = idx + 1;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Pattern components (GlobWalker.rs)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Hint {
    None,
    Single,
    Double,
    WildcardFilepath,
    Literal,
    Dot,
    DotBack,
}

#[derive(Debug)]
struct Component {
    hint: Hint,
    trailing_sep: bool,
    /// The component text without its trailing `/`.
    slice: String,
}

fn has_special_syntax(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .any(|&c| matches!(c, b'*' | b'[' | b'{' | b'?' | b'!'))
}

/// Note: like Bun, this scans to the end of the whole pattern, not just the
/// component.
fn is_wildcard_filepath(bytes: &[u8], start: usize, len: usize) -> bool {
    if !(len > 1 && bytes[start] == b'*' && bytes[start + 1] == b'.') || start + 2 >= bytes.len() {
        return false;
    }
    !bytes[start + 2..]
        .iter()
        .any(|&c| matches!(c, b'[' | b'{' | b'?' | b'*'))
}

fn syntax_hint(bytes: &[u8], start: usize, len: usize) -> Hint {
    let comp = &bytes[start..start + len];
    if comp == b"." {
        return Hint::Dot;
    }
    if comp == b".." {
        return Hint::DotBack;
    }
    if !has_special_syntax(comp) {
        return Hint::Literal;
    }
    if len == 1 {
        return if comp[0] == b'*' {
            Hint::Single
        } else {
            Hint::None
        };
    }
    if comp == b"**" {
        return Hint::Double;
    }
    if is_wildcard_filepath(bytes, start, len) {
        Hint::WildcardFilepath
    } else {
        Hint::None
    }
}

fn make_component(bytes: &[u8], start: usize, end: usize) -> Option<Component> {
    let len = end - start;
    if len == 0 {
        return None;
    }
    let hint = syntax_hint(bytes, start, len);
    let trailing_sep = bytes[end - 1] == b'/';
    let slice_end = if trailing_sep { end - 1 } else { end };
    Some(Component {
        hint,
        trailing_sep,
        slice: String::from_utf8_lossy(&bytes[start..slice_end]).into_owned(),
    })
}

struct PatternComponents {
    comps: Vec<Component>,
    /// Byte length of the literal (glob-free) prefix of the pattern.
    end_byte: usize,
    /// Index of the last component of that literal prefix.
    base_idx: usize,
}

fn build_pattern_components(bytes: &[u8]) -> PatternComponents {
    let mut pc = PatternComponents {
        comps: Vec::new(),
        end_byte: 0,
        base_idx: 0,
    };
    let mut saw_special = false;
    let mut record = |pc: &mut PatternComponents, comp: Option<Component>, end: usize| {
        if let Some(c) = &comp {
            saw_special = saw_special || c.hint != Hint::Literal;
        }
        if !saw_special {
            pc.base_idx = pc.comps.len();
            pc.end_byte = end.min(bytes.len());
        }
        if let Some(c) = comp {
            pc.comps.push(c);
        }
    };
    let mut start = 0;
    let mut width = 0;
    let mut i = 0;
    while i < bytes.len() {
        width = seq_len(bytes[i]);
        if bytes[i] == b'/' {
            let end = if i + width == bytes.len() {
                i + width
            } else {
                i
            };
            if let Some(comp) = make_component(bytes, start, end) {
                record(&mut pc, Some(comp), i + width);
            }
            start = i + width;
        }
        i += 1;
    }
    let i = i.saturating_sub(1);
    let last = make_component(bytes, start, bytes.len());
    record(&mut pc, last, i + width);
    pc
}

mod error;
mod path;
mod walker;

pub(crate) use error::*;
use path::*;
pub(crate) use walker::*;

#[cfg(test)]
mod tests;
