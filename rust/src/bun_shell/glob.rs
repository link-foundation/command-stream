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
pub(crate) fn glob_match(pattern: &str, path: &str) -> bool {
    match_bytes(pattern.as_bytes(), path.as_bytes()).matches
}

/// Port of glob/lib.rs `detect_glob_syntax`: true when `pattern` contains an
/// unescaped `*`, `{`, `[` or `?`, or starts with `!`.
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// A walker error. System errors mirror Bun's `SystemError` (and the JS
/// port's): `code` (`"ENOENT"`, ...), a negative `errno`, `syscall`
/// (`"open"`, `"fstatat"`, `"getdents64"`) and `path`; `message` is
/// `"<code>: <description>, <syscall> '<path>'"`. Other errors (an invalid
/// `cwd`, an OS error without a known errno name) have `code == None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GlobError {
    pub(crate) code: Option<&'static str>,
    pub(crate) errno: Option<i32>,
    pub(crate) syscall: &'static str,
    pub(crate) path: String,
    pub(crate) message: String,
}

impl GlobError {
    fn sys(code: &'static str, syscall: &'static str, path: &str) -> Self {
        Self {
            code: Some(code),
            errno: errno_for_code(code).map(|n| -n),
            syscall,
            path: path.to_string(),
            message: format!("{code}: {}, {syscall} '{path}'", description(code)),
        }
    }

    fn other(message: String) -> Self {
        Self {
            code: None,
            errno: None,
            syscall: "",
            path: String::new(),
            message,
        }
    }

    /// Whether this is a system error with the given code.
    pub(crate) fn is(&self, code: &str) -> bool {
        self.code == Some(code)
    }
}

impl fmt::Display for GlobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for GlobError {}

/// Descriptions of libuv's `uv_strerror` (Node's `util.getSystemErrorMap`).
fn description(code: &str) -> &str {
    match code {
        "EPERM" => "operation not permitted",
        "ENOENT" => "no such file or directory",
        "ESRCH" => "no such process",
        "EINTR" => "interrupted system call",
        "EIO" => "i/o error",
        "ENXIO" => "no such device or address",
        "E2BIG" => "argument list too long",
        "ENOEXEC" => "exec format error",
        "EBADF" => "bad file descriptor",
        "EAGAIN" => "resource temporarily unavailable",
        "ENOMEM" => "not enough memory",
        "EACCES" => "permission denied",
        "EFAULT" => "bad address in system call argument",
        "EBUSY" => "resource busy or locked",
        "EEXIST" => "file already exists",
        "EXDEV" => "cross-device link not permitted",
        "ENODEV" => "no such device",
        "ENOTDIR" => "not a directory",
        "EISDIR" => "illegal operation on a directory",
        "EINVAL" => "invalid argument",
        "ENFILE" => "file table overflow",
        "EMFILE" => "too many open files",
        "ENOTTY" => "inappropriate ioctl for device",
        "ETXTBSY" => "text file is busy",
        "EFBIG" => "file too large",
        "ENOSPC" => "no space left on device",
        "ESPIPE" => "invalid seek",
        "EROFS" => "read-only file system",
        "EMLINK" => "too many links",
        "EPIPE" => "broken pipe",
        "ENAMETOOLONG" => "name too long",
        "ENOSYS" => "function not implemented",
        "ENOTEMPTY" => "directory not empty",
        "ELOOP" => "too many symbolic links encountered",
        "EOVERFLOW" => "value too large for defined data type",
        "EILSEQ" => "illegal byte sequence",
        "ECANCELED" => "operation canceled",
        "ETIMEDOUT" => "connection timed out",
        other => other,
    }
}

#[cfg(unix)]
const ERRNO_CODES: &[(i32, &str)] = &[
    (libc::EPERM, "EPERM"),
    (libc::ENOENT, "ENOENT"),
    (libc::ESRCH, "ESRCH"),
    (libc::EINTR, "EINTR"),
    (libc::EIO, "EIO"),
    (libc::ENXIO, "ENXIO"),
    (libc::E2BIG, "E2BIG"),
    (libc::ENOEXEC, "ENOEXEC"),
    (libc::EBADF, "EBADF"),
    (libc::ECHILD, "ECHILD"),
    (libc::EAGAIN, "EAGAIN"),
    (libc::ENOMEM, "ENOMEM"),
    (libc::EACCES, "EACCES"),
    (libc::EFAULT, "EFAULT"),
    (libc::EBUSY, "EBUSY"),
    (libc::EEXIST, "EEXIST"),
    (libc::EXDEV, "EXDEV"),
    (libc::ENODEV, "ENODEV"),
    (libc::ENOTDIR, "ENOTDIR"),
    (libc::EISDIR, "EISDIR"),
    (libc::EINVAL, "EINVAL"),
    (libc::ENFILE, "ENFILE"),
    (libc::EMFILE, "EMFILE"),
    (libc::ENOTTY, "ENOTTY"),
    (libc::ETXTBSY, "ETXTBSY"),
    (libc::EFBIG, "EFBIG"),
    (libc::ENOSPC, "ENOSPC"),
    (libc::ESPIPE, "ESPIPE"),
    (libc::EROFS, "EROFS"),
    (libc::EMLINK, "EMLINK"),
    (libc::EPIPE, "EPIPE"),
    (libc::ENAMETOOLONG, "ENAMETOOLONG"),
    (libc::ENOSYS, "ENOSYS"),
    (libc::ENOTEMPTY, "ENOTEMPTY"),
    (libc::ELOOP, "ELOOP"),
    (libc::EOVERFLOW, "EOVERFLOW"),
    (libc::ESTALE, "ESTALE"),
    (libc::EILSEQ, "EILSEQ"),
    (libc::ECANCELED, "ECANCELED"),
    (libc::ETIMEDOUT, "ETIMEDOUT"),
];

/// The values of Node's `os.constants.errno` on Windows (the MSVC CRT's).
#[cfg(not(unix))]
const ERRNO_CODES: &[(i32, &str)] = &[
    (1, "EPERM"),
    (2, "ENOENT"),
    (5, "EIO"),
    (7, "E2BIG"),
    (9, "EBADF"),
    (12, "ENOMEM"),
    (13, "EACCES"),
    (16, "EBUSY"),
    (17, "EEXIST"),
    (18, "EXDEV"),
    (20, "ENOTDIR"),
    (21, "EISDIR"),
    (22, "EINVAL"),
    (24, "EMFILE"),
    (28, "ENOSPC"),
    (30, "EROFS"),
    (38, "ENAMETOOLONG"),
    (41, "ENOTEMPTY"),
    (114, "ELOOP"),
];

fn errno_for_code(code: &str) -> Option<i32> {
    ERRNO_CODES
        .iter()
        .find(|(_, c)| *c == code)
        .map(|(n, _)| *n)
}

/// The errno name of an I/O error (Node's `err.code`).
#[cfg(unix)]
fn io_error_code(e: &io::Error) -> Option<&'static str> {
    let raw = e.raw_os_error()?;
    ERRNO_CODES.iter().find(|(n, _)| *n == raw).map(|(_, c)| *c)
}

/// The errno name of an I/O error, following libuv's mapping of Windows
/// error codes (`uv_translate_sys_error`).
#[cfg(not(unix))]
fn io_error_code(e: &io::Error) -> Option<&'static str> {
    if let Some(raw) = e.raw_os_error() {
        let code = match raw {
            2 | 3 | 15 | 123 | 161 | 1920 => Some("ENOENT"),
            5 | 1314 => Some("EPERM"),
            267 => Some("ENOTDIR"),
            206 => Some("ENAMETOOLONG"),
            1921 => Some("ELOOP"),
            4 => Some("EMFILE"),
            32 | 33 | 170 => Some("EBUSY"),
            80 | 183 => Some("EEXIST"),
            145 => Some("ENOTEMPTY"),
            _ => None,
        };
        if code.is_some() {
            return code;
        }
    }
    match e.kind() {
        io::ErrorKind::NotFound => Some("ENOENT"),
        io::ErrorKind::PermissionDenied => Some("EACCES"),
        io::ErrorKind::NotADirectory => Some("ENOTDIR"),
        io::ErrorKind::IsADirectory => Some("EISDIR"),
        io::ErrorKind::AlreadyExists => Some("EEXIST"),
        io::ErrorKind::DirectoryNotEmpty => Some("ENOTEMPTY"),
        _ => None,
    }
}

/// `rethrowAs`: an OS error becomes a `SystemError` for `syscall`/`path`.
fn rethrow(e: &io::Error, syscall: &'static str, path: &str) -> GlobError {
    match io_error_code(e) {
        Some(code) => GlobError::sys(code, syscall, path),
        None => GlobError::other(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// `PATH_MAX` as used by Bun (`MAX_PATH_BYTES`).
const MAX_PATH_BYTES: usize = if cfg!(target_os = "macos") {
    1024
} else {
    4096
};

/// Whether `p` is an absolute path. POSIX-style (`/...`) everywhere, plus
/// drive/UNC-absolute paths on Windows.
fn is_absolute(p: &str) -> bool {
    p.starts_with('/') || (cfg!(windows) && std::path::Path::new(p).is_absolute())
}

/// Node's `normalizeString` (`path.posix`), on bytes.
fn normalize_string(path: &str, allow_above_root: bool) -> String {
    let bytes = path.as_bytes();
    let mut res: Vec<u8> = Vec::new();
    let mut last_segment_length: usize = 0;
    let mut last_slash: isize = -1;
    let mut dots: i32 = 0;
    let mut code: u8 = 0;
    let mut i: usize = 0;
    while i <= bytes.len() {
        if i < bytes.len() {
            code = bytes[i];
        } else if code == b'/' {
            break;
        } else {
            code = b'/';
        }
        let ii = i as isize;
        if code == b'/' {
            if last_slash == ii - 1 || dots == 1 {
                // NOOP
            } else if dots == 2 {
                let ends_with_dotdot = res.len() >= 2
                    && last_segment_length == 2
                    && res[res.len() - 1] == b'.'
                    && res[res.len() - 2] == b'.';
                if !ends_with_dotdot {
                    if res.len() > 2 {
                        match res.iter().rposition(|&b| b == b'/') {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                res.truncate(idx);
                                last_segment_length = match res.iter().rposition(|&b| b == b'/') {
                                    Some(j) => res.len() - 1 - j,
                                    None => res.len(),
                                };
                            }
                        }
                        last_slash = ii;
                        dots = 0;
                        i += 1;
                        continue;
                    } else if !res.is_empty() {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = ii;
                        dots = 0;
                        i += 1;
                        continue;
                    }
                }
                if allow_above_root {
                    if res.is_empty() {
                        res.extend_from_slice(b"..");
                    } else {
                        res.extend_from_slice(b"/..");
                    }
                    last_segment_length = 2;
                }
            } else {
                let seg = &bytes[(last_slash + 1) as usize..i];
                if !res.is_empty() {
                    res.push(b'/');
                }
                res.extend_from_slice(seg);
                last_segment_length = (ii - last_slash - 1) as usize;
            }
            last_slash = ii;
            dots = 0;
        } else if code == b'.' && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
        i += 1;
    }
    String::from_utf8_lossy(&res).into_owned()
}

/// Node's `path.posix.normalize`.
fn posix_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = path.starts_with('/');
    let trailing_sep = path.ends_with('/');
    let mut p = normalize_string(path, !absolute);
    if p.is_empty() {
        if absolute {
            return "/".to_string();
        }
        return if trailing_sep { "./" } else { "." }.to_string();
    }
    if trailing_sep {
        p.push('/');
    }
    if absolute {
        format!("/{p}")
    } else {
        p
    }
}

/// Node's `path.posix.join`.
fn posix_join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".to_string();
    }
    posix_normalize(&joined)
}

/// paths::join_sep_vec: non-normalizing join with `/`.
fn join_sep(dir: &str, name: &str) -> String {
    let mut out = String::with_capacity(dir.len() + name.len() + 1);
    let mut prev_last: Option<char> = None;
    for p in [dir, name] {
        let Some(last) = p.chars().last() else {
            continue;
        };
        match prev_last {
            None => out.push_str(p),
            Some(prev) => {
                let prev_sep = prev == '/';
                let this_sep = p.starts_with('/');
                if !prev_sep && !this_sep {
                    out.push('/');
                }
                out.push_str(if prev_sep && this_sep { &p[1..] } else { p });
            }
        }
        prev_last = Some(last);
    }
    out
}

fn current_dir_string() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Walker (GlobWalker.rs)
// ---------------------------------------------------------------------------

/// Options of [`walk`] (Bun's `ScanOpts`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WalkOptions {
    /// Directory to walk from; `""` means the process's current directory.
    /// A relative `cwd` is normalised (and made absolute when `absolute`).
    pub(crate) cwd: String,
    /// Let wildcards match names starting with `.` (default `false`).
    pub(crate) dot: bool,
    /// Return absolute paths (default `false`).
    pub(crate) absolute: bool,
    /// Descend into symlinked directories (default `false`).
    pub(crate) follow_symlinks: bool,
    /// Fail on broken symlinks while following (`throwErrorOnBrokenSymlink`).
    pub(crate) error_on_broken_symlinks: bool,
    /// Only return files, not directories or links (default `true`).
    pub(crate) only_files: bool,
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self {
            cwd: String::new(),
            dot: false,
            absolute: false,
            follow_symlinks: false,
            error_on_broken_symlinks: false,
            only_files: true,
        }
    }
}

/// An open directory. The first entry is read eagerly because Bun's glob
/// walker reports read errors (e.g. `EACCES`) from `open`.
struct DirHandle {
    rd: fs::ReadDir,
    peeked: Option<Option<fs::DirEntry>>,
}

impl DirHandle {
    fn open(os_path: &str) -> io::Result<Self> {
        let mut rd = fs::read_dir(os_path)?;
        let first = rd.next().transpose()?;
        Ok(Self {
            rd,
            peeked: Some(first),
        })
    }

    fn next_entry(&mut self) -> io::Result<Option<fs::DirEntry>> {
        if let Some(peeked) = self.peeked.take() {
            if peeked.is_none() {
                self.peeked = Some(None);
            }
            return Ok(peeked);
        }
        self.rd.next().transpose()
    }
}

/// Identity of a directory, to detect symlink cycles.
#[cfg(unix)]
type FileId = (u64, u64);
#[cfg(not(unix))]
type FileId = std::path::PathBuf;

#[cfg(unix)]
fn stat_target(os_path: &str) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    let st = fs::metadata(os_path).ok()?;
    Some((st.dev(), st.ino()))
}

#[cfg(not(unix))]
fn stat_target(os_path: &str) -> Option<FileId> {
    fs::canonicalize(os_path).ok()
}

enum FollowedLink {
    /// The first followed link: stat'ed lazily, only when a nested link is
    /// followed.
    Pending(String),
    Resolved(FileId),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ItemKind {
    Directory,
    Symlink,
}

struct WorkItem {
    path: String,
    active: Vec<usize>,
    kind: ItemKind,
    /// Byte offset of the entry name in `path` (symlinks).
    entry_start: usize,
    /// A directory already opened while resolving a symlink.
    dir: Option<(DirHandle, String)>,
    followed_len: usize,
    followed_link: Option<FollowedLink>,
}

impl WorkItem {
    fn new(path: String, active: Vec<usize>, kind: ItemKind) -> Self {
        Self {
            path,
            active,
            kind,
            entry_start: 0,
            dir: None,
            followed_len: 0,
            followed_link: None,
        }
    }
}

/// A directory being iterated.
struct DirIter {
    dir: DirHandle,
    dir_path: String,
    active: Vec<usize>,
}

struct EvalDirResult {
    add: bool,
    child: Vec<usize>,
}

struct Walker<'p> {
    cwd: String,
    dot: bool,
    absolute: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,
    only_files: bool,
    pattern: &'p str,
    comps: Vec<Component>,
    end_byte: usize,
    base_idx: usize,
    root_os: String,
    root_dir: Option<DirHandle>,
    matched: Vec<String>,
    matched_set: HashSet<String>,
    work: Vec<WorkItem>,
    followed: Vec<FollowedLink>,
}

impl Walker<'_> {
    fn join_path(&self, dir: &str, name: &str) -> String {
        if self.absolute {
            posix_join(&[dir, name])
        } else {
            join_sep(dir, name)
        }
    }

    fn to_os_path(&self, p: &str) -> String {
        if is_absolute(p) {
            return p.to_string();
        }
        if p.is_empty() {
            return self.root_os.clone();
        }
        if self.root_os.ends_with('/') {
            format!("{}{p}", self.root_os)
        } else {
            format!("{}/{p}", self.root_os)
        }
    }

    fn add_match(&mut self, p: String) {
        if self.matched_set.insert(p.clone()) {
            self.matched.push(p);
        }
    }

    fn match_pattern_impl(&self, comp: &Component, name: &str) -> bool {
        if !self.dot && name.starts_with('.') && !comp.slice.starts_with('.') {
            return false;
        }
        match comp.hint {
            Hint::Double | Hint::Single => true,
            Hint::WildcardFilepath => name.ends_with(&comp.slice[1..]),
            Hint::Literal => name == comp.slice,
            _ => match_bytes(comp.slice.as_bytes(), name.as_bytes()).matches,
        }
    }

    /// `match_pattern_dir`: the index bump, or `None` for "don't recurse".
    fn match_pattern_dir(
        &self,
        idx: usize,
        name: &str,
        hidden: bool,
        res: &mut EvalDirResult,
    ) -> Option<usize> {
        let comps = &self.comps;
        let is_last = idx == comps.len() - 1;
        if comps[idx].hint == Hint::Double {
            if !is_last && self.match_pattern_impl(&comps[idx + 1], name) {
                if idx + 1 == comps.len() - 1 {
                    res.add = true;
                    return if hidden { None } else { Some(0) };
                }
                return Some(2);
            }
            if hidden {
                return None;
            }
            if is_last {
                res.add = true;
            }
            return Some(0);
        }
        if self.match_pattern_impl(&comps[idx], name) {
            if is_last {
                res.add = true;
                return None;
            }
            return Some(1);
        }
        None
    }

    fn match_pattern_file(&self, idx: usize, name: &str) -> bool {
        let comps = &self.comps;
        let comp = &comps[idx];
        if comp.trailing_sep {
            return false;
        }
        if idx != comps.len() - 1 {
            return comp.hint == Hint::Double
                && idx + 1 == comps.len() - 1
                && comps[idx + 1].hint != Hint::Double
                && self.match_pattern_impl(&comps[idx + 1], name);
        }
        self.match_pattern_impl(comp, name)
    }

    fn normalize_idx(&self, idx: usize) -> usize {
        let mut i = idx;
        if i < self.comps.len() && self.comps[i].hint == Hint::Double {
            while i + 1 < self.comps.len() && self.comps[i + 1].hint == Hint::Double {
                i += 1;
            }
        }
        i
    }

    fn eval_dir(&self, active: &[usize], name: &str) -> EvalDirResult {
        let mut res = EvalDirResult {
            add: false,
            child: Vec::new(),
        };
        let hidden = !self.dot && name.starts_with('.');
        let mut picked = Vec::new();
        for &idx in active {
            let Some(bump) = self.match_pattern_dir(idx, name, hidden, &mut res) else {
                continue;
            };
            picked.push(self.normalize_idx(idx + bump));
            if bump == 2 && !hidden && self.comps[idx + 2].hint != Hint::Double {
                picked.push(idx);
            }
        }
        picked.sort_unstable();
        picked.dedup();
        res.child = picked;
        res
    }

    fn eval_file(&self, active: &[usize], name: &str) -> bool {
        active.iter().any(|&idx| self.match_pattern_file(idx, name))
    }

    fn eval_impl(&self, active: &[usize], name: &str) -> bool {
        let comps = &self.comps;
        active.iter().any(|&idx| {
            self.match_pattern_impl(&comps[idx], name)
                || (comps[idx].hint == Hint::Double
                    && idx + 1 < comps.len()
                    && self.match_pattern_impl(&comps[idx + 1], name))
        })
    }

    fn eval_literal_subset(&self, active: &[usize], name: &str) -> Vec<usize> {
        active
            .iter()
            .copied()
            .filter(|&idx| {
                self.comps[idx].hint == Hint::Literal
                    && self.match_pattern_impl(&self.comps[idx], name)
            })
            .collect()
    }

    /// `skip_special_components`: appends `.`/`..` to `dir_path` and
    /// collapses `**`. Returns `(idx, dir_path, had_dot_dot)`.
    fn skip_special_components(
        &self,
        idx: usize,
        dir_path: String,
    ) -> Result<(usize, String, bool), GlobError> {
        let mut i = idx;
        let mut p = dir_path;
        let mut had_dot_dot = false;
        while i < self.comps.len() {
            let hint = self.comps[i].hint;
            if hint != Hint::Dot && hint != Hint::DotBack {
                break;
            }
            let (extra, seg) = if hint == Hint::Dot {
                (2, ".")
            } else {
                (3, "..")
            };
            if p.len() + extra >= MAX_PATH_BYTES {
                return Err(GlobError::sys("ENAMETOOLONG", "open", &p));
            }
            had_dot_dot = had_dot_dot || hint == Hint::DotBack;
            if p.is_empty() {
                p = seg.to_string();
            } else {
                p.push('/');
                p.push_str(seg);
            }
            i += 1;
        }
        Ok((self.normalize_idx(i), p, had_dot_dot))
    }

    fn push_work_item(&mut self, mut item: WorkItem, followed_link: Option<FollowedLink>) {
        item.followed_len = self.followed.len();
        item.followed_link = followed_link;
        self.work.push(item);
    }

    /// Literal-tail optimization of `transition_to_dir_iter_state`.
    fn stat_literal_tail(
        &mut self,
        fd_os: &str,
        dir_path: &str,
        comp_idx: usize,
    ) -> Result<(), GlobError> {
        let slice = self.comps[comp_idx].slice.clone();
        if slice.is_empty() {
            // fstatat(fd, "") fails with ENOENT, which Bun skips.
            return Ok(());
        }
        let st = match fs::metadata(format!("{fd_os}/{slice}")) {
            Ok(st) => st,
            Err(e) => {
                let err = rethrow(&e, "fstatat", &slice);
                if err.is("ENOENT") {
                    return Ok(());
                }
                return Err(err);
            }
        };
        if st.is_file() || !self.only_files {
            let p = self.join_path(dir_path, &slice);
            self.add_match(p);
        }
        Ok(())
    }

    /// `transition_to_dir_iter_state`: a directory to iterate, or `None`.
    fn transition(&mut self, item: WorkItem, root: bool) -> Result<Option<DirIter>, GlobError> {
        let mut dir_path = String::new();
        if !(root && !self.absolute) {
            if item.path.len() >= MAX_PATH_BYTES {
                return Err(GlobError::sys("ENAMETOOLONG", "open", &item.path));
            }
            dir_path = item.path.clone();
        }
        let mut active = item.active;
        let mut had_dot_dot = false;
        if active.len() == 1 {
            let (idx, p, dd) = self.skip_special_components(active[0], dir_path)?;
            if idx >= self.comps.len() {
                return Ok(None);
            }
            dir_path = p;
            had_dot_dot = dd;
            active = vec![idx];
        }
        let (dir, fd_os) = match item.dir {
            Some(opened) => opened,
            None => {
                let root_dir = if root && !had_dot_dot {
                    self.root_dir.take()
                } else {
                    None
                };
                match root_dir {
                    Some(d) => (d, self.root_os.clone()),
                    None => {
                        let fd_os = self.to_os_path(&dir_path);
                        let d =
                            DirHandle::open(&fd_os).map_err(|e| rethrow(&e, "open", &dir_path))?;
                        (d, fd_os)
                    }
                }
            }
        };
        let last_idx = self.comps.len() - 1;
        if active.len() == 1 && active[0] == last_idx && self.comps[last_idx].hint == Hint::Literal
        {
            drop(dir);
            self.stat_literal_tail(&fd_os, &dir_path, last_idx)?;
            return Ok(None);
        }
        Ok(Some(DirIter {
            dir,
            dir_path,
            active,
        }))
    }

    fn follow_active_for(
        &self,
        active: &[usize],
        name: &str,
        prefiltered: bool,
    ) -> Option<Vec<usize>> {
        if self.follow_symlinks {
            return (prefiltered || self.eval_impl(active, name)).then(|| active.to_vec());
        }
        let subset = self.eval_literal_subset(active, name);
        (!subset.is_empty()).then_some(subset)
    }

    fn handle_dir_entry(&mut self, d: &DirIter, name: &str) {
        let EvalDirResult { add, child } = self.eval_dir(&d.active, name);
        if !child.is_empty() {
            let path = self.join_path(&d.dir_path, name);
            self.push_work_item(WorkItem::new(path, child, ItemKind::Directory), None);
        }
        if add && !self.only_files {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    fn handle_symlink_entry(&mut self, d: &DirIter, name: &str, prefiltered: bool) {
        if let Some(follow) = self.follow_active_for(&d.active, name, prefiltered) {
            let p = self.join_path(&d.dir_path, name);
            let entry_start = p.len().saturating_sub(name.len());
            let mut item = WorkItem::new(p, follow, ItemKind::Symlink);
            item.entry_start = entry_start;
            self.push_work_item(item, None);
            return;
        }
        if !self.only_files && self.eval_file(&d.active, name) {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    fn handle_file_entry(&mut self, d: &DirIter, name: &str) {
        if self.eval_file(&d.active, name) {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    /// Dispatches one directory entry on its type. `DirEntry::file_type`
    /// falls back to `lstat` when the OS does not report a type, which is
    /// equivalent to the JS port's `handleUnknownEntry` (every handler only
    /// acts when `eval_impl` holds).
    fn process_entry(&mut self, d: &DirIter, ent: &fs::DirEntry) {
        let name = ent.file_name().to_string_lossy().into_owned();
        let Ok(ft) = ent.file_type() else {
            return;
        };
        if ft.is_file() {
            self.handle_file_entry(d, &name);
        } else if ft.is_dir() {
            self.handle_dir_entry(d, &name);
        } else if ft.is_symlink() {
            self.handle_symlink_entry(d, &name, false);
        }
    }

    fn iterate_dir(&mut self, mut d: DirIter) -> Result<(), GlobError> {
        loop {
            let ent = d
                .dir
                .next_entry()
                .map_err(|e| rethrow(&e, "getdents64", &d.dir_path))?;
            let Some(ent) = ent else {
                return Ok(());
            };
            self.process_entry(&d, &ent);
        }
    }

    fn resolve_pending_followed_links(&mut self) {
        for i in 0..self.followed.len() {
            if let FollowedLink::Pending(p) = &self.followed[i] {
                if let Some(target) = stat_target(&self.to_os_path(p)) {
                    self.followed[i] = FollowedLink::Resolved(target);
                }
            }
        }
    }

    fn is_followed_link_cycle(&self, target: &FileId) -> bool {
        self.followed
            .iter()
            .any(|l| matches!(l, FollowedLink::Resolved(id) if id == target))
    }

    /// Decides whether to descend into a followed symlinked directory.
    fn followed_link_for(
        &mut self,
        full_path: &str,
        os_path: &str,
    ) -> (bool, Option<FollowedLink>) {
        if self.followed.is_empty() {
            return (true, Some(FollowedLink::Pending(full_path.to_string())));
        }
        let Some(target) = stat_target(os_path) else {
            return (true, None);
        };
        self.resolve_pending_followed_links();
        if self.is_followed_link_cycle(&target) {
            return (false, None);
        }
        (true, Some(FollowedLink::Resolved(target)))
    }

    fn open_symlink_target(
        &mut self,
        full_path: &str,
        active: &[usize],
        entry_name: &str,
    ) -> Result<Option<(DirHandle, String)>, GlobError> {
        let os_path = self.to_os_path(full_path);
        match DirHandle::open(&os_path) {
            Ok(dir) => Ok(Some((dir, os_path))),
            Err(e) => {
                if io_error_code(&e) == Some("ENOTDIR") {
                    if self.eval_file(active, entry_name) {
                        self.add_match(full_path.to_string());
                    }
                    return Ok(None);
                }
                if self.error_on_broken_symlinks {
                    return Err(rethrow(&e, "open", full_path));
                }
                if !self.only_files && self.eval_file(active, entry_name) {
                    self.add_match(full_path.to_string());
                }
                Ok(None)
            }
        }
    }

    /// The Symlink arm of `Iterator::next`.
    fn process_symlink_item(&mut self, item: WorkItem) -> Result<(), GlobError> {
        if item.path.len() >= MAX_PATH_BYTES {
            return Err(GlobError::sys("ENAMETOOLONG", "open", &item.path));
        }
        let mut full_path = item.path.clone();
        let mut active = item.active;
        if active.len() == 1 {
            let (idx, p, _) = self.skip_special_components(active[0], full_path)?;
            if idx >= self.comps.len() {
                return Ok(());
            }
            full_path = p;
            active = vec![idx];
        }
        let entry_name = full_path
            .get(item.entry_start..)
            .unwrap_or_default()
            .to_string();
        let Some((dir, os_path)) = self.open_symlink_target(&full_path, &active, &entry_name)?
        else {
            return Ok(());
        };
        let EvalDirResult { add, child } = self.eval_dir(&active, &entry_name);
        let (descend, link) = if child.is_empty() {
            (false, None)
        } else {
            self.followed_link_for(&full_path, &os_path)
        };
        if descend {
            let mut next = WorkItem::new(item.path, child, ItemKind::Directory);
            next.dir = Some((dir, os_path));
            self.push_work_item(next, link);
        }
        if add && !self.only_files {
            self.add_match(full_path);
        }
        Ok(())
    }

    /// `Iterator::init`: opens the root; returns the first directory.
    fn init_walk(&mut self) -> Result<Option<DirIter>, GlobError> {
        let mut root_path = self.cwd.clone();
        let mut start_idx = 0;
        let pattern_is_absolute = is_absolute(self.pattern);
        if pattern_is_absolute {
            root_path =
                String::from_utf8_lossy(&self.pattern.as_bytes()[..self.end_byte]).into_owned();
            start_idx = self.base_idx;
            if root_path.is_empty() {
                root_path = "/".to_string();
            } else {
                start_idx += 1;
                if start_idx >= self.comps.len() {
                    // A pattern without glob syntax: Bun only probes the
                    // path and does not add it to the results.
                    probe_literal_path(&root_path)?;
                    return Ok(None);
                }
            }
        }
        if root_path.len() >= MAX_PATH_BYTES {
            return Err(GlobError::sys("ENAMETOOLONG", "open", &root_path));
        }
        let dir = DirHandle::open(&root_path).map_err(|e| rethrow(&e, "open", &root_path))?;
        self.root_dir = Some(dir);
        self.root_os = root_path.clone();
        let root = WorkItem::new(root_path, vec![start_idx], ItemKind::Directory);
        self.transition(root, !pattern_is_absolute)
    }

    fn run(&mut self) -> Result<(), GlobError> {
        let mut dir = self.init_walk()?;
        loop {
            if let Some(d) = dir.take() {
                self.iterate_dir(d)?;
            }
            let Some(mut item) = self.work.pop() else {
                return Ok(());
            };
            self.followed.truncate(item.followed_len);
            if let Some(link) = item.followed_link.take() {
                self.followed.push(link);
            }
            match item.kind {
                ItemKind::Directory => dir = self.transition(item, false)?,
                ItemKind::Symlink => self.process_symlink_item(item)?,
            }
        }
    }
}

fn probe_literal_path(p: &str) -> Result<(), GlobError> {
    match DirHandle::open(p) {
        Ok(_) => Ok(()),
        Err(e) => {
            let err = rethrow(&e, "open", p);
            if err.is("ENOTDIR") || err.is("ENOENT") {
                Ok(())
            } else {
                Err(err)
            }
        }
    }
}

fn parse_cwd(cwd: &str, absolute: bool) -> Result<String, GlobError> {
    let too_long = || {
        GlobError::other(format!(
            "globWalkSync: invalid `cwd`, longer than {MAX_PATH_BYTES} bytes"
        ))
    };
    if cwd.len() > MAX_PATH_BYTES {
        return Err(too_long());
    }
    if is_absolute(cwd) {
        return Ok(cwd.to_string());
    }
    let result = if absolute {
        posix_join(&[&current_dir_string(), cwd])
    } else {
        posix_join(&[cwd])
    };
    if result.len() > MAX_PATH_BYTES {
        return Err(too_long());
    }
    Ok(result)
}

/// Walks the file system and returns the paths matching `pattern`, in the
/// same order and form as `new Bun.Glob(pattern).scanSync(options)` (and the
/// JS port's `globWalkSync`).
///
/// Relative patterns yield paths relative to `cwd` joined with `/`
/// (`./*` yields `./a`, `a/../*` yields `a/../b`, `*/` yields `a`); with
/// `absolute` they are `cwd`-joined and normalised. An absolute pattern walks
/// from its literal prefix and yields absolute paths. Symlinks are only
/// descended into when `follow_symlinks` is set (a literal component such as
/// `link/*` is always followed), with cycle detection. A pattern without
/// components (`""`) yields nothing.
///
/// Errors: an unopenable root (`cwd` or the literal prefix of an absolute
/// pattern) or subdirectory is reported as a [`GlobError`] with syscall
/// `open` (`ENOENT`, `ENOTDIR`, `EACCES`, ...); a failing literal last
/// component other than `ENOENT` (e.g. `ELOOP`) as `fstatat`; read errors
/// as `getdents64`. The shell ignores `ENOENT`/`ENOTDIR` and reports
/// "no matches found" itself.
pub(crate) fn walk(pattern: &str, options: &WalkOptions) -> Result<Vec<String>, GlobError> {
    let cwd = if options.cwd.is_empty() {
        String::new()
    } else {
        parse_cwd(&options.cwd, options.absolute)?
    };
    let PatternComponents {
        comps,
        end_byte,
        base_idx,
    } = build_pattern_components(pattern.as_bytes());
    if comps.is_empty() {
        return Ok(Vec::new());
    }
    let mut w = Walker {
        cwd: if cwd.is_empty() {
            current_dir_string()
        } else {
            cwd
        },
        dot: options.dot,
        absolute: options.absolute,
        follow_symlinks: options.follow_symlinks,
        error_on_broken_symlinks: options.error_on_broken_symlinks,
        only_files: options.only_files,
        pattern,
        comps,
        end_byte,
        base_idx,
        root_os: String::new(),
        root_dir: None,
        matched: Vec::new(),
        matched_set: HashSet::new(),
        work: Vec::new(),
        followed: Vec::new(),
    };
    w.run()?;
    Ok(w.matched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const MATCH_CASES: &[(&str, &str, bool)] = &[
        ("*", "abc", true),
        ("*", "a/b", false),
        ("*", "", true),
        ("**", "a/b/c", true),
        ("a/**/b", "a/b", true),
        ("a/**/b", "a/x/y/b", true),
        ("a/**", "a/", true),
        ("**/*.txt", "x/y/z.txt", true),
        ("**/*.txt", "z.md", false),
        ("?", "a", true),
        ("?", "/", false),
        ("?", "日", true),
        ("??", "😀", false),
        ("[abc]", "b", true),
        ("[!abc]", "b", false),
        ("[^abc]", "d", true),
        ("[a-z]*", "hello", true),
        ("[é-ü]", "ö", true),
        ("[é-ü]", "z", false),
        ("[]]", "]", true),
        ("[abc", "a", false),
        ("{a,b}", "a", true),
        ("{a,b}", "c", false),
        ("*.{js,ts}", "x.ts", true),
        ("{a,{b,c}}d", "cd", true),
        ("{,a}b", "b", true),
        ("!*.md", "x.txt", true),
        ("!*.md", "x.md", false),
        ("!!a", "a", true),
        ("\\*", "*", true),
        ("\\*", "a", false),
        ("a\\", "a", false),
        ("\\n", "\n", true),
        ("日本*", "日本語", true),
        ("*語", "日本語", true),
        ("a/*/c", "a/b/c", true),
        ("a/*/c", "a/b/x/c", false),
        ("", "", true),
        ("", "a", false),
    ];

    #[test]
    fn glob_match_cases() {
        for &(pattern, path, expected) in MATCH_CASES {
            assert_eq!(
                glob_match(pattern, path),
                expected,
                "{pattern:?} vs {path:?}"
            );
        }
    }

    #[test]
    fn match_bytes_reports_negation_and_handles_invalid_utf8() {
        assert_eq!(
            match_bytes(b"!a", b"b"),
            MatchResult {
                matches: true,
                negated: true
            }
        );
        assert!(!match_bytes(b"!!a", b"b").negated);
        // A lone continuation byte is a one-byte "character".
        assert!(match_bytes(b"?", b"\x80").matches);
        assert!(match_bytes(b"[\x80]", b"\x80").matches);
    }

    #[test]
    fn deeply_nested_braces_fail() {
        let p = format!("{}b{}", "{a,".repeat(12), "}".repeat(12));
        assert!(!glob_match(&p, "b"));
        let p = format!("{}b{}", "{a,".repeat(9), "}".repeat(9));
        assert!(glob_match(&p, "b"));
    }

    #[test]
    fn has_glob_syntax_cases() {
        assert!(has_glob_syntax("*.txt"));
        assert!(has_glob_syntax("a{b,c}"));
        assert!(has_glob_syntax("!a"));
        assert!(has_glob_syntax("a?"));
        assert!(!has_glob_syntax("plain/path"));
        assert!(!has_glob_syntax("\\*"));
        assert!(has_glob_syntax("\\\\*"));
    }

    #[test]
    fn posix_join_matches_node() {
        assert_eq!(posix_join(&["/a/b", "../c"]), "/a/c");
        assert_eq!(posix_join(&["a", ".."]), ".");
        assert_eq!(posix_join(&["a/", "./"]), "a/");
        assert_eq!(posix_join(&["", ""]), ".");
        assert_eq!(posix_join(&["..", "../x"]), "../../x");
        assert_eq!(posix_join(&["/", ".."]), "/");
        assert_eq!(join_sep("a/", "/b"), "a/b");
        assert_eq!(join_sep("", "b"), "b");
    }

    fn write(root: &Path, rel: &str) {
        fs::write(root.join(rel), "").unwrap();
    }

    /// The tree of js/tests/bun-shell-glob.test.mjs (symlinks on Unix only).
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("a").join("b")).unwrap();
        fs::create_dir(root.join(".h")).unwrap();
        fs::create_dir(root.join("é")).unwrap();
        write(root, "a/x.txt");
        write(root, "a/b/y.txt");
        write(root, ".h/z");
        write(root, "é/日本.txt");
        write(root, "top");
        write(root, ".dot");
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink("a", root.join("la")).unwrap();
            symlink("top", root.join("lf")).unwrap();
            symlink("nowhere", root.join("broken")).unwrap();
            symlink("loop", root.join("loop")).unwrap();
        }
        dir
    }

    fn opts(root: &Path) -> WalkOptions {
        WalkOptions {
            cwd: root.to_string_lossy().into_owned(),
            ..WalkOptions::default()
        }
    }

    fn sorted(pattern: &str, o: &WalkOptions) -> Vec<String> {
        let mut v = walk(pattern, o).unwrap();
        v.sort();
        v
    }

    #[test]
    fn walk_basics() {
        let dir = fixture();
        let o = opts(dir.path());
        assert_eq!(sorted("*", &o), ["top"]);
        let dot = WalkOptions {
            dot: true,
            ..o.clone()
        };
        assert_eq!(sorted("*", &dot), [".dot", "top"]);
        assert_eq!(sorted(".h/*", &o), [".h/z"]);
        assert_eq!(
            sorted("**/*.txt", &o),
            ["a/b/y.txt", "a/x.txt", "é/日本.txt"]
        );
        assert_eq!(sorted("./*", &o), ["./top"]);
        assert_eq!(sorted("a/../t*", &o), ["a/../top"]);
        assert_eq!(sorted("a/x.txt", &o), ["a/x.txt"]);
        assert!(sorted("a/missing", &o).is_empty());
        assert!(walk("", &o).unwrap().is_empty());
        let all = WalkOptions {
            only_files: false,
            ..o.clone()
        };
        assert_eq!(sorted("./", &all), ["."]);
        assert_eq!(sorted("{a,é}/", &all), ["a", "é"]);
        let everything = sorted("**", &all);
        assert!(everything.contains(&"a/b".to_string()));
        assert!(everything.contains(&"a/b/y.txt".to_string()));
        assert!(!everything.contains(&".h".to_string()));
    }

    #[test]
    fn walk_absolute() {
        let dir = fixture();
        let root = dir.path().to_string_lossy().into_owned();
        let abs = WalkOptions {
            absolute: true,
            ..opts(dir.path())
        };
        let expected = posix_join(&[&root.replace('\\', "/"), "a/x.txt"]);
        let got: Vec<String> = sorted("a/*", &abs)
            .into_iter()
            .map(|p| p.replace('\\', "/"))
            .collect();
        assert_eq!(got, std::slice::from_ref(&expected));
        #[cfg(unix)]
        assert_eq!(
            walk(&format!("{root}/a/*"), &WalkOptions::default()).unwrap(),
            [expected]
        );
    }

    #[cfg(unix)]
    #[test]
    fn walk_symlinks() {
        let dir = fixture();
        let o = opts(dir.path());
        let follow = WalkOptions {
            follow_symlinks: true,
            ..o.clone()
        };
        assert_eq!(sorted("*", &follow), ["lf", "top"]);
        let all_nofollow = WalkOptions {
            only_files: false,
            ..o.clone()
        };
        assert_eq!(
            sorted("*", &all_nofollow),
            ["a", "broken", "la", "lf", "loop", "top", "é"]
        );
        assert_eq!(sorted("la/*", &o), ["la/x.txt"]);
        assert_eq!(
            sorted("**/*.txt", &follow),
            [
                "a/b/y.txt",
                "a/x.txt",
                "la/b/y.txt",
                "la/x.txt",
                "é/日本.txt"
            ]
        );
        let all = WalkOptions {
            only_files: false,
            ..follow.clone()
        };
        assert!(sorted("broken", &all).is_empty());
        assert_eq!(sorted("b*", &all), ["broken"]);
        let strict = WalkOptions {
            error_on_broken_symlinks: true,
            ..all
        };
        let err = walk("b*", &strict).unwrap_err();
        assert_eq!(
            (err.code, err.syscall, err.path.as_str()),
            (Some("ENOENT"), "open", "broken")
        );
        let err = walk("loop", &o).unwrap_err();
        assert_eq!((err.code, err.syscall), (Some("ELOOP"), "fstatat"));
        assert_eq!(
            err.message,
            "ELOOP: too many symbolic links encountered, fstatat 'loop'"
        );
    }

    #[cfg(unix)]
    #[test]
    fn walk_symlink_cycles_terminate() {
        let dir = fixture();
        let root = dir.path();
        std::os::unix::fs::symlink("..", root.join("a").join("up")).unwrap();
        let follow = WalkOptions {
            follow_symlinks: true,
            ..opts(root)
        };
        let found = sorted("**/y.txt", &follow);
        assert!(found.contains(&"a/b/y.txt".to_string()));
        assert!(found.len() < 20, "{found:?}");
    }

    #[test]
    fn walk_errors() {
        let dir = fixture();
        let missing = dir.path().join("nope").to_string_lossy().into_owned();
        let missing_opts = WalkOptions {
            cwd: missing.clone(),
            ..WalkOptions::default()
        };
        let err = walk("*", &missing_opts).unwrap_err();
        assert_eq!(err.code, Some("ENOENT"));
        assert_eq!(err.syscall, "open");
        assert_eq!(err.path, missing);
        #[cfg(target_os = "linux")]
        assert_eq!(err.errno, Some(-2));
        assert!(err.is("ENOENT"));
        assert_eq!(
            err.to_string(),
            format!("ENOENT: no such file or directory, open '{missing}'")
        );

        let file_opts = WalkOptions {
            cwd: dir.path().join("top").to_string_lossy().into_owned(),
            ..WalkOptions::default()
        };
        let err = walk("*", &file_opts).unwrap_err();
        assert_eq!((err.code, err.syscall), (Some("ENOTDIR"), "open"));

        let long_opts = WalkOptions {
            cwd: "x".repeat(MAX_PATH_BYTES + 1),
            ..WalkOptions::default()
        };
        let err = walk("*", &long_opts).unwrap_err();
        assert_eq!(err.code, None);
        assert_eq!(
            err.message,
            format!("globWalkSync: invalid `cwd`, longer than {MAX_PATH_BYTES} bytes")
        );
    }

    #[cfg(unix)]
    #[test]
    fn walk_unreadable_directory() {
        use std::os::unix::fs::PermissionsExt;
        let dir = fixture();
        let na = dir.path().join("na");
        fs::create_dir(&na).unwrap();
        write(dir.path(), "na/f");
        fs::set_permissions(&na, fs::Permissions::from_mode(0o000)).unwrap();
        let readable = fs::read_dir(&na).is_ok(); // running as root
        let o = opts(dir.path());
        let deep = walk("na/*", &o);
        let shallow = walk("*", &o);
        fs::set_permissions(&na, fs::Permissions::from_mode(0o755)).unwrap();
        if readable {
            return;
        }
        let err = deep.unwrap_err();
        assert_eq!(
            (err.code, err.syscall, err.path.as_str()),
            (Some("EACCES"), "open", "na")
        );
        assert_eq!(err.message, "EACCES: permission denied, open 'na'");
        assert_eq!(shallow.unwrap(), ["top"]);
    }

    /// Differential harness driven by experiments/issue-27/rust-glob-diff.mjs:
    /// reads JSON lines from `$GLOB_DIFF_IN` and writes one result line per
    /// case to `$GLOB_DIFF_OUT`.
    #[test]
    #[ignore = "driven by experiments/issue-27/rust-glob-diff.mjs"]
    fn glob_diff_harness() {
        use serde_json::{json, Value};
        let (Ok(input), Ok(output)) = (
            std::env::var("GLOB_DIFF_IN"),
            std::env::var("GLOB_DIFF_OUT"),
        ) else {
            return;
        };
        if let Ok(cwd) = std::env::var("GLOB_DIFF_CWD") {
            std::env::set_current_dir(cwd).unwrap();
        }
        let text = fs::read_to_string(input).unwrap();
        let mut out = String::new();
        for line in text.lines().filter(|l| !l.is_empty()) {
            let case: Value = serde_json::from_str(line).unwrap();
            let s = |k: &str| case[k].as_str().unwrap_or_default().to_string();
            let b = |k: &str| case[k].as_bool().unwrap_or_default();
            let result = match case["t"].as_str() {
                Some("m") => {
                    let r = match_bytes(s("p").as_bytes(), s("s").as_bytes());
                    json!({ "m": r.matches, "n": r.negated })
                }
                Some("h") => json!({ "h": has_glob_syntax(&s("p")) }),
                _ => {
                    let o = WalkOptions {
                        cwd: s("cwd"),
                        dot: b("dot"),
                        absolute: b("absolute"),
                        follow_symlinks: b("followSymlinks"),
                        error_on_broken_symlinks: b("throwErrorOnBrokenSymlink"),
                        only_files: b("onlyFiles"),
                    };
                    match walk(&s("p"), &o) {
                        Ok(paths) => json!({ "ok": paths }),
                        Err(e) => json!({ "err": {
                            "code": e.code,
                            "syscall": e.code.map(|_| e.syscall),
                            "path": e.code.map(|_| e.path.clone()),
                            "errno": e.errno,
                            "message": e.message,
                        }}),
                    }
                }
            };
            out.push_str(&result.to_string());
            out.push('\n');
        }
        fs::write(output, out).unwrap();
    }
}
