//! Brace expansion, ported from Bun's `src/shell_parser/braces.rs` (MIT) via
//! `js/src/bun-shell/braces.mjs`. Token shapes, the literal-group rules of
//! bash 5.2 and the output ordering follow Bun exactly.

use std::fmt;

/// Most `{` groups a pattern may have.
pub(crate) const MAX_BRACE_GROUPS: usize = 256;
/// Most words a pattern may expand to.
pub(crate) const MAX_BRACE_EXPANSIONS: u32 = 65536;

/// A brace expansion failure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BraceError {
    /// More than 256 brace groups.
    TooManyBraces,
    /// A malformed nested pattern.
    UnexpectedToken,
    /// The pattern expands to more than 65536 words (the count, saturated at
    /// `u32::MAX`).
    TooManyExpansions(u32),
}

impl fmt::Display for BraceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BraceError::TooManyBraces => f.write_str("Too many braces in brace expansion"),
            BraceError::UnexpectedToken => f.write_str("Unexpected token in brace expansion"),
            BraceError::TooManyExpansions(count) => write!(
                f,
                "Too many brace expansions ({count} > {MAX_BRACE_EXPANSIONS})"
            ),
        }
    }
}

impl std::error::Error for BraceError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BraceToken {
    /// `{`; `idx..end` is its range of variants in the flat expansion table.
    Open {
        idx: usize,
        end: usize,
    },
    Comma,
    Text(String),
    Close,
    Eof,
}

impl BraceToken {
    fn to_text(&self) -> String {
        match self {
            BraceToken::Open { .. } => "{".to_string(),
            BraceToken::Comma => ",".to_string(),
            BraceToken::Close => "}".to_string(),
            BraceToken::Text(t) => t.clone(),
            BraceToken::Eof => String::new(),
        }
    }
}

/// Tokens of a brace pattern (see [`tokenize`]).
#[derive(Clone, Debug)]
pub(crate) struct BraceTokens {
    /// Ends with [`BraceToken::Eof`].
    pub tokens: Vec<BraceToken>,
    /// Some group is nested in another one.
    pub contains_nested: bool,
}

fn replace_token_with_string(tokens: &mut [BraceToken], idx: usize) {
    tokens[idx] = BraceToken::Text(tokens[idx].to_text());
}

fn append_char(tokens: &mut Vec<BraceToken>, c: char) {
    if let Some(BraceToken::Text(t)) = tokens.last_mut() {
        t.push(c);
    } else {
        tokens.push(BraceToken::Text(c.to_string()));
    }
}

/// Unclosed groups are rolled back innermost first. Everything from the
/// previous rollback's start onwards is already a fixed point of this scan
/// (only balanced groups sit between two unclosed opens), so `limit` bounds
/// the scan and keeps the whole pass linear.
fn rollback_braces(tokens: &mut [BraceToken], starting_idx: usize, limit: usize) {
    let mut braces = 0usize;
    replace_token_with_string(tokens, starting_idx);
    for i in starting_idx + 1..limit {
        match tokens[i] {
            BraceToken::Open { .. } => braces += 1,
            BraceToken::Close if braces > 0 => braces -= 1,
            _ if braces > 0 => {}
            BraceToken::Close | BraceToken::Comma | BraceToken::Text(_) => {
                replace_token_with_string(tokens, i)
            }
            BraceToken::Eof => {}
        }
    }
}

fn flatten_tokens(tokens: Vec<BraceToken>) -> BraceTokens {
    let mut depth = 0usize;
    let mut contains_nested = false;
    let mut out: Vec<BraceToken> = Vec::with_capacity(tokens.len() + 1);
    for tok in tokens {
        match tok {
            BraceToken::Open { .. } => {
                depth += 1;
                contains_nested |= depth > 1;
            }
            BraceToken::Close => depth = depth.saturating_sub(1),
            _ => {}
        }
        match (out.last_mut(), tok) {
            (Some(BraceToken::Text(prev)), BraceToken::Text(t)) => prev.push_str(&t),
            (_, tok) => out.push(tok),
        }
    }
    BraceTokens {
        tokens: out,
        contains_nested,
    }
}

/// Tokenize a brace pattern. `\X` is a literal `X`; a trailing `\` ends the
/// input. Groups without a comma and unclosed groups become text.
pub(crate) fn tokenize(src: &str) -> BraceTokens {
    struct Pending {
        tok_idx: usize,
        has_comma: bool,
    }
    let mut tokens = Vec::new();
    let mut stack: Vec<Pending> = Vec::new();
    let mut chars = src.chars();
    while let Some(mut c) = chars.next() {
        let mut escaped = false;
        if c == '\\' {
            let Some(next) = chars.next() else { break };
            c = next;
            escaped = true;
        }
        if !escaped {
            if c == '{' {
                stack.push(Pending {
                    tok_idx: tokens.len(),
                    has_comma: false,
                });
                tokens.push(BraceToken::Open { idx: 0, end: 0 });
                continue;
            }
            if c == '}' {
                if let Some(top) = stack.pop() {
                    if top.has_comma {
                        tokens.push(BraceToken::Close);
                    } else {
                        replace_token_with_string(&mut tokens, top.tok_idx);
                        tokens.push(BraceToken::Text("}".to_string()));
                    }
                    continue;
                }
            }
            if c == ',' {
                if let Some(top) = stack.last_mut() {
                    top.has_comma = true;
                    tokens.push(BraceToken::Comma);
                    continue;
                }
            }
        }
        append_char(&mut tokens, c);
    }
    let mut limit = tokens.len();
    while let Some(Pending { tok_idx, .. }) = stack.pop() {
        rollback_braces(&mut tokens, tok_idx, limit);
        limit = tok_idx;
    }
    let mut flat = flatten_tokens(tokens);
    flat.tokens.push(BraceToken::Eof);
    flat
}

/// Number of words the tokens expand to (0 when there is nothing to expand),
/// saturated at `u32::MAX`.
pub(crate) fn calculate_expanded_amount(tokens: &[BraceToken]) -> u32 {
    struct Entry {
        segment_product: u32,
        accumulator: u32,
    }
    let mut stack: Vec<Entry> = Vec::new();
    let mut variant_count = 0u32;
    for tok in tokens {
        match tok {
            BraceToken::Open { .. } => stack.push(Entry {
                segment_product: 1,
                accumulator: 0,
            }),
            BraceToken::Comma => {
                if let Some(top) = stack.last_mut() {
                    top.accumulator = top.accumulator.saturating_add(top.segment_product);
                    top.segment_product = 1;
                }
            }
            BraceToken::Close => {
                let Some(entry) = stack.pop() else { continue };
                let total = entry.accumulator.saturating_add(entry.segment_product);
                if let Some(parent) = stack.last_mut() {
                    parent.segment_product = parent.segment_product.saturating_mul(total);
                } else if variant_count == 0 {
                    variant_count = total;
                } else {
                    variant_count = variant_count.saturating_mul(total);
                }
            }
            _ => {}
        }
    }
    variant_count
}

fn check_brace_group_count(tokens: &[BraceToken]) -> Result<(), BraceError> {
    let opens = tokens
        .iter()
        .filter(|t| matches!(t, BraceToken::Open { .. }))
        .count();
    if opens > MAX_BRACE_GROUPS {
        return Err(BraceError::TooManyBraces);
    }
    Ok(())
}

/// Output words; keys are allocated in expansion order.
struct Out {
    words: Vec<String>,
    counter: usize,
}

impl Out {
    fn new_key(&mut self, from: usize, len: usize) -> usize {
        let key = self.counter;
        if key >= self.words.len() {
            self.words.resize(key + 1, String::new());
        }
        let prefix = self.words[from][..len].to_string();
        self.words[key].push_str(&prefix);
        self.counter += 1;
        key
    }
}

struct TableEntry {
    start: usize,
    end: usize,
}

fn build_expansion_table(tokens: &mut [BraceToken]) -> Vec<TableEntry> {
    struct Frame {
        tok_idx: usize,
        prev_tok_end: usize,
    }
    let mut table = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    for i in 0..tokens.len() {
        match tokens[i] {
            BraceToken::Open { .. } => {
                tokens[i] = BraceToken::Open {
                    idx: table.len(),
                    end: 0,
                };
                stack.push(Frame {
                    tok_idx: i,
                    prev_tok_end: i,
                });
            }
            BraceToken::Close => {
                let Some(top) = stack.pop() else { continue };
                table.push(TableEntry {
                    start: top.prev_tok_end + 1,
                    end: i,
                });
                if let BraceToken::Open { end, .. } = &mut tokens[top.tok_idx] {
                    *end = table.len();
                }
            }
            BraceToken::Comma => {
                let Some(top) = stack.last_mut() else {
                    continue;
                };
                table.push(TableEntry {
                    start: top.prev_tok_end + 1,
                    end: i,
                });
                top.prev_tok_end = i;
            }
            _ => {}
        }
    }
    table
}

fn expand_flat(
    tokens: &[BraceToken],
    table: &[TableEntry],
    out: &mut Out,
    key: usize,
    start: usize,
    end: usize,
) {
    if start >= tokens.len() || end > tokens.len() {
        return;
    }
    for tok in &tokens[start..end] {
        match tok {
            BraceToken::Text(t) => out.words[key].push_str(t),
            BraceToken::Open { idx, end: vend } => {
                let variants = &table[*idx..*vend];
                let Some(last) = variants.last() else { return };
                let skip_over_idx = last.end;
                let starting_len = out.words[key].len();
                for (vi, variant) in variants.iter().enumerate() {
                    let k = if vi == 0 {
                        key
                    } else {
                        out.new_key(key, starting_len)
                    };
                    expand_flat(tokens, table, out, k, variant.start, variant.end);
                    expand_flat(tokens, table, out, k, skip_over_idx, end);
                }
                return;
            }
            _ => {}
        }
    }
}

enum Node {
    Text(String),
    Expansion(Vec<Vec<Node>>),
}

struct BraceParser<'a> {
    tokens: &'a [BraceToken],
    current: usize,
}

impl BraceParser<'_> {
    fn parse(&mut self) -> Result<Vec<Node>, BraceError> {
        check_brace_group_count(self.tokens)?;
        let mut nodes = Vec::new();
        while !self.match_eof() {
            match self.parse_atom()? {
                Some(atom) => nodes.push(atom),
                None => break,
            }
        }
        Ok(nodes)
    }

    fn parse_atom(&mut self) -> Result<Option<Node>, BraceError> {
        match self.advance() {
            BraceToken::Open { .. } => Ok(Some(Node::Expansion(self.parse_expansion()?))),
            BraceToken::Text(t) => Ok(Some(Node::Text(t.clone()))),
            BraceToken::Eof => Ok(None),
            _ => Err(BraceError::UnexpectedToken),
        }
    }

    fn parse_expansion(&mut self) -> Result<Vec<Vec<Node>>, BraceError> {
        let mut variants = Vec::new();
        loop {
            let mut group = Vec::new();
            let close = loop {
                if matches!(self.peek(), BraceToken::Close | BraceToken::Eof) {
                    self.advance();
                    break true;
                }
                if matches!(self.peek(), BraceToken::Comma) {
                    self.advance();
                    break false;
                }
                match self.parse_atom()? {
                    Some(atom) => group.push(atom),
                    None => break true,
                }
            };
            variants.push(group);
            if close {
                return Ok(variants);
            }
        }
    }

    fn match_eof(&mut self) -> bool {
        if matches!(self.peek(), BraceToken::Eof) {
            self.advance();
            return true;
        }
        false
    }

    fn advance(&mut self) -> &BraceToken {
        if !matches!(self.peek(), BraceToken::Eof) {
            self.current += 1;
        }
        if self.current > 0 {
            &self.tokens[self.current - 1]
        } else {
            self.peek()
        }
    }

    fn peek(&self) -> &BraceToken {
        self.tokens.get(self.current).unwrap_or(&BraceToken::Eof)
    }
}

/// Where to continue once a variant group is fully expanded: the rest of the
/// enclosing group, from atom `next`.
struct Cont<'a> {
    group: &'a [Node],
    next: usize,
    parent: Option<&'a Cont<'a>>,
}

fn expand_nested(out: &mut Out, group: &[Node], key: usize, start: usize, cont: Option<&Cont<'_>>) {
    for (i, node) in group.iter().enumerate().skip(start) {
        match node {
            Node::Text(t) => out.words[key].push_str(t),
            Node::Expansion(variants) => {
                let here = Cont {
                    group,
                    next: i + 1,
                    parent: cont,
                };
                let len = out.words[key].len();
                for (j, variant) in variants.iter().enumerate() {
                    let k = if j == 0 { key } else { out.new_key(key, len) };
                    expand_nested(out, variant, k, 0, Some(&here));
                }
                return;
            }
        }
    }
    if let Some(c) = cont {
        expand_nested(out, c.group, key, c.next, c.parent);
    }
}

/// Expand tokens produced by [`tokenize`] into the `count` words computed by
/// [`calculate_expanded_amount`].
pub(crate) fn expand(
    mut tokens: Vec<BraceToken>,
    count: u32,
    contains_nested: bool,
) -> Result<Vec<String>, BraceError> {
    check_brace_group_count(&tokens)?;
    let mut out = Out {
        words: vec![String::new(); count as usize],
        counter: 1,
    };
    if out.words.is_empty() {
        out.words.push(String::new());
    }
    if !contains_nested {
        let table = build_expansion_table(&mut tokens);
        let len = tokens.len();
        expand_flat(&tokens, &table, &mut out, 0, 0, len);
    } else {
        let root = BraceParser {
            tokens: &tokens,
            current: 0,
        }
        .parse()?;
        expand_nested(&mut out, &root, 0, 0, None);
    }
    Ok(out.words)
}

/// `$.braces(pattern)`: expand a brace pattern into words.
pub(crate) fn braces(pattern: &str) -> Result<Vec<String>, BraceError> {
    let BraceTokens {
        tokens,
        contains_nested,
    } = tokenize(pattern);
    let count = calculate_expanded_amount(&tokens);
    if count == 0 {
        return Ok(vec![pattern.to_string()]);
    }
    if count > MAX_BRACE_EXPANSIONS {
        return Err(BraceError::TooManyExpansions(count));
    }
    expand(tokens, count, contains_nested)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(p: &str) -> Vec<String> {
        braces(p).unwrap_or_else(|e| panic!("{p}: {e}"))
    }

    #[test]
    fn flat() {
        assert_eq!(b("echo 123"), ["echo 123"]);
        assert_eq!(b("echo {123,456}"), ["echo 123", "echo 456"]);
        assert_eq!(b("{a,b}{c,d}"), ["ac", "ad", "bc", "bd"]);
        assert_eq!(b(""), [""]);
        assert_eq!(b("lol {😂,🫵,🤣}"), ["lol 😂", "lol 🫵", "lol 🤣"]);
        assert_eq!(b("\\{a,b}"), ["\\{a,b}"]);
        assert_eq!(b("\\{a,b},{c,d}"), ["{a,b},c", "{a,b},d"]);
        assert_eq!(b("{a}"), ["{a}"]);
    }

    #[test]
    fn nested() {
        assert_eq!(
            b("echo {123,{456,789},abc}"),
            ["echo 123", "echo 456", "echo 789", "echo abc"]
        );
        assert_eq!(b("{{d,e}{g,h}}"), ["{dg}", "{dh}", "{eg}", "{eh}"]);
        assert_eq!(b("{a,{b,c}{d,e},f}"), ["a", "bd", "be", "cd", "ce", "f"]);
        for (pattern, expected) in [
            ("{x,a{,}b}", &["x", "ab", "ab"][..]),
            ("{x,{a,}}z", &["xz", "az", "z"]),
            ("{x,{,a}}z", &["xz", "z", "az"]),
            ("a{b,c{d,}}e", &["abe", "acde", "ace"]),
            ("{x,{a,,b}}", &["x", "a", "", "b"]),
            ("{{a,},x}", &["a", "", "x"]),
            ("p{q,{r,}{s,}}t", &["pqt", "prst", "prt", "pst", "pt"]),
        ] {
            assert_eq!(b(pattern), expected, "{pattern}");
        }
        let deep = b("{1,{2,{3,{4,{5,{6,{7,{8,{9,{10,{11,{12,{13,{14,{15,{16,{17}}}}}}}}}}}}}}}}}");
        assert_eq!(deep.len(), 17);
        assert_eq!(deep[16], "{17}");
    }

    #[test]
    fn literal_outer_group_around_many_groups() {
        let pattern = format!("{{{}b{}", "{a,".repeat(256), "}".repeat(256));
        let mut expected = vec!["{a".to_string(); 256];
        expected.push("{b".to_string());
        assert_eq!(b(&pattern), expected);
    }

    #[test]
    fn errors() {
        let pattern = format!("{}{}", "{a,".repeat(257), "}".repeat(257));
        assert_eq!(braces(&pattern), Err(BraceError::TooManyBraces));
        let pattern = "{a,b}".repeat(17);
        assert_eq!(
            braces(&pattern).unwrap_err().to_string(),
            "Too many brace expansions (131072 > 65536)"
        );
        assert_eq!(b(&"{a,b}".repeat(16)).len(), 65536);
        assert_eq!(
            BraceError::UnexpectedToken.to_string(),
            "Unexpected token in brace expansion"
        );
    }
}
