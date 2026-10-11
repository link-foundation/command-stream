//! Markdown to script transform (zx `transformMarkdown`).
//!
//! Prose becomes `// ` comments, indented blocks and js/ts fences are kept as
//! code, sh/bash/shell fences become an awaited `$` template and any other
//! fence is commented out.

use once_cell::sync::Lazy;
use regex::Regex;

static TAB_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^( {2,}|\t)").expect("valid regex"));
static FENCE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(?P<indent> {0,3})(?P<fence>`{3,20}|~{3,20})(?:(?P<js>js|javascript|ts|typescript)|(?P<bash>sh|shell|bash)|.*)$",
    )
    .expect("valid regex")
});

struct Fence {
    prefix: &'static str,
    close: &'static str,
    indent: usize,
    end: Regex,
}

#[derive(PartialEq, Eq)]
enum State {
    Root,
    Tab,
    Fence,
}

struct Script {
    out: Vec<String>,
    state: State,
    prev_empty: bool,
    fence: Option<Fence>,
}

impl Script {
    fn open_fence(&mut self, caps: &regex::Captures<'_>) {
        let fence = &caps["fence"];
        let marker = regex::escape(&fence[..1]);
        let (open, prefix, close) = if caps.name("js").is_some() {
            ("", "", "")
        } else if caps.name("bash").is_some() {
            ("await $`", "", "`")
        } else {
            ("", "// ", "")
        };
        let end = format!(r"^ {{0,3}}{marker}{{{},}}[ \t]*$", fence.len());
        self.fence = Some(Fence {
            prefix,
            close,
            indent: caps["indent"].len(),
            end: Regex::new(&end).expect("valid fence regex"),
        });
        self.out.push(open.to_string());
        self.state = State::Fence;
        self.prev_empty = false;
    }

    fn root(&mut self, line: &str) {
        if let Some(caps) = FENCE_RE.captures(line) {
            self.open_fence(&caps);
            return;
        }
        if self.prev_empty && TAB_RE.is_match(line) {
            self.out.push(line.to_string());
            self.state = State::Tab;
            return;
        }
        self.prev_empty = line.is_empty();
        self.out.push(format!("// {line}"));
    }

    fn tab(&mut self, line: &str) {
        if line.is_empty() || TAB_RE.is_match(line) {
            self.out.push(line.to_string());
        } else {
            self.out.push(format!("// {line}"));
            self.state = State::Root;
        }
        self.prev_empty = line.is_empty();
    }

    fn in_fence(&mut self, line: &str) {
        let Some(fence) = &self.fence else {
            self.state = State::Root;
            return self.root(line);
        };
        if fence.end.is_match(line) {
            self.out.push(fence.close.to_string());
            self.state = State::Root;
            self.prev_empty = true;
            self.fence = None;
            return;
        }
        let spaces = line
            .bytes()
            .take(fence.indent)
            .take_while(|b| *b == b' ')
            .count();
        self.out
            .push(format!("{}{}", fence.prefix, &line[spaces..]));
        self.prev_empty = false;
    }

    fn push(&mut self, line: &str) {
        match self.state {
            State::Fence => self.in_fence(line),
            State::Tab => self.tab(line),
            State::Root => self.root(line),
        }
    }
}

/// Split on every ECMAScript line terminator (`\r\n`, `\n`, `\r`, U+2028,
/// U+2029).
fn split_lines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut iter = text.char_indices().peekable();
    while let Some((i, c)) = iter.next() {
        if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
            lines.push(&text[start..i]);
            let mut end = i + c.len_utf8();
            if c == '\r' && iter.peek().is_some_and(|(_, n)| *n == '\n') {
                iter.next();
                end += 1;
            }
            start = end;
        }
    }
    lines.push(&text[start..]);
    lines
}

/// Turn a markdown document into an executable zx script.
pub fn transform_markdown(source: &str) -> String {
    let mut script = Script {
        out: Vec::new(),
        state: State::Root,
        prev_empty: true,
        fence: None,
    };
    for line in split_lines(source) {
        script.push(line);
    }
    script.out.join("\n")
}
