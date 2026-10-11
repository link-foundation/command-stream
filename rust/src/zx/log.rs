//! Verbose logging (zx `log`) and the command highlighter (zx `formatCmd`).
//!
//! Entries are written only when they are verbose. Colors follow zx: the
//! command name is bright green, operators red, quoted strings bright yellow
//! and shell keywords bright cyan. [`format_cmd`] always colors (like zx with
//! a forced color level); [`Logger::stderr`] enables colors only when stderr
//! is a terminal and `NO_COLOR` is unset.

use std::collections::HashMap;
use std::io::{IsTerminal, Write};
use std::time::Duration;

/// A pair of ANSI open/close sequences.
#[derive(Debug, Clone, Copy)]
struct Style {
    open: &'static str,
    close: &'static str,
}

const RED: Style = Style {
    open: "\x1b[31m",
    close: "\x1b[39m",
};
const GREEN_BRIGHT: Style = Style {
    open: "\x1b[92m",
    close: "\x1b[39m",
};
const YELLOW_BRIGHT: Style = Style {
    open: "\x1b[93m",
    close: "\x1b[39m",
};
const CYAN_BRIGHT: Style = Style {
    open: "\x1b[96m",
    close: "\x1b[39m",
};
const RESET: Style = Style {
    open: "\x1b[0m",
    close: "\x1b[0m",
};
const FAIL_BADGE: Style = Style {
    open: "\x1b[41m\x1b[37m",
    close: "\x1b[39m\x1b[49m",
};

/// Wrap `text` in `style`, closing and reopening the style around line
/// breaks so that a prefix inserted after `\n` stays uncolored.
fn paint(style: Style, text: &str, colors: bool) -> String {
    if !colors || text.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len() + 16);
    out.push_str(style.open);
    let mut rest = text;
    while let Some(i) = rest.find('\n') {
        let cut = if rest[..i].ends_with('\r') { i - 1 } else { i };
        out.push_str(&rest[..cut]);
        out.push_str(style.close);
        out.push_str(&rest[cut..=i]);
        out.push_str(style.open);
        rest = &rest[i + 1..];
    }
    out.push_str(rest);
    out.push_str(style.close);
    out
}

const SYNTAX: &str = "()[]{}<>;:+|&=";
const CMD_BREAK: &str = "|&;><";
const RESERVED_WORDS: [&str; 15] = [
    "if", "then", "else", "elif", "fi", "case", "esac", "for", "select", "while", "until", "do",
    "done", "in", "EOF",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Plain,
    Quote,
    Dollar,
    Syntax,
}

/// Word position inside a simple command: `First` is the command name.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Position {
    Start,
    First,
    Assignment,
    Rest,
}

struct Highlighter {
    colors: bool,
    out: String,
    word: String,
    mode: Mode,
    quote: Option<char>,
    pos: Position,
}

impl Highlighter {
    fn advance(&mut self) {
        self.pos = match self.pos {
            Position::Start => Position::First,
            Position::Assignment => Position::Start,
            _ => Position::Rest,
        };
    }

    fn style_word(&mut self, trimmed: &str) -> String {
        self.advance();
        match self.mode {
            Mode::Syntax => {
                if CMD_BREAK.contains(trimmed) {
                    self.pos = Position::Start;
                }
                paint(RED, &self.word, self.colors)
            }
            Mode::Quote | Mode::Dollar => paint(YELLOW_BRIGHT, &self.word, self.colors),
            Mode::Plain if RESERVED_WORDS.contains(&trimmed) => {
                paint(CYAN_BRIGHT, &self.word, self.colors)
            }
            Mode::Plain if self.pos == Position::First => {
                self.pos = Position::Rest;
                paint(GREEN_BRIGHT, &self.word, self.colors)
            }
            Mode::Plain => self.word.clone(),
        }
    }

    fn flush(&mut self) {
        let trimmed = self.word.trim().to_string();
        let piece = if trimmed.is_empty() {
            self.word.clone()
        } else {
            self.style_word(&trimmed)
        };
        self.out.push_str(&piece);
        self.word.clear();
        self.mode = Mode::Plain;
    }

    fn emit_single(&mut self, mode: Mode, c: char) {
        self.flush();
        self.mode = mode;
        self.word.push(c);
        self.flush();
    }

    fn push(&mut self, c: char) {
        if let Some(q) = self.quote {
            self.word.push(c);
            if c == q {
                self.flush();
                self.quote = None;
            }
        } else if c == '$' {
            self.emit_single(Mode::Dollar, c);
        } else if c == '\'' || c == '"' {
            self.flush();
            self.mode = Mode::Quote;
            self.quote = Some(c);
            self.word.push(c);
        } else if c.is_whitespace() {
            self.flush();
            self.word.push(c);
        } else if SYNTAX.contains(c) {
            // `FOO=bar cmd`: an assignment before the command keeps the
            // command-name color for the word after it.
            let assignment = c == '=' && self.pos == Position::Start;
            if assignment {
                // The pending word (the variable name) must not be painted
                // as the command name.
                self.pos = Position::First;
            }
            self.emit_single(Mode::Syntax, c);
            if assignment {
                self.pos = Position::Assignment;
            }
        } else {
            self.word.push(c);
        }
    }
}

fn highlight(cmd: &str, colors: bool) -> String {
    let mut h = Highlighter {
        colors,
        out: String::new(),
        word: String::new(),
        mode: Mode::Plain,
        quote: None,
        pos: Position::Start,
    };
    for c in cmd.chars() {
        h.push(c);
    }
    h.flush();
    let continuation = paint(RESET, "\n> ", colors);
    format!("$ {}\n", h.out.replace('\n', &continuation))
}

/// Render a command as zx prints it in verbose mode (`$ cmd`, continuation
/// lines prefixed with `> `), with ANSI colors.
pub fn format_cmd(cmd: &str) -> String {
    highlight(cmd, true)
}

/// Like [`format_cmd`] without colors.
pub fn format_cmd_plain(cmd: &str) -> String {
    highlight(cmd, false)
}

/// A log record (zx `LogEntry`).
#[derive(Debug, Clone, PartialEq)]
pub enum LogEntry {
    /// A command about to run.
    Cmd {
        /// The command line.
        cmd: String,
    },
    /// A chunk of process stdout.
    Stdout {
        /// Raw bytes.
        data: Vec<u8>,
    },
    /// A chunk of process stderr.
    Stderr {
        /// Raw bytes.
        data: Vec<u8>,
    },
    /// A directory change.
    Cd {
        /// The new directory.
        dir: String,
    },
    /// An HTTP request.
    Fetch {
        /// Target URL.
        url: String,
        /// Rendered request options, if any.
        init: Option<String>,
    },
    /// Arbitrary text.
    Custom {
        /// Text written as-is.
        data: String,
    },
    /// A failed retry attempt.
    Retry {
        /// 1-based attempt number.
        attempt: usize,
        /// Total attempts (`None` for unbounded).
        total: Option<usize>,
        /// Delay before the next attempt.
        delay: Duration,
    },
    /// A process finished.
    End {
        /// Exit code, if any.
        exit_code: Option<i32>,
        /// Terminating signal, if any.
        signal: Option<String>,
        /// Run time.
        duration: Duration,
    },
    /// A signal was sent.
    Kill {
        /// Target pid.
        pid: u32,
        /// Signal name, if any.
        signal: Option<String>,
    },
}

impl LogEntry {
    /// The zx `kind` of the entry (`cmd`, `stdout`, `retry`, ...).
    pub fn kind(&self) -> &'static str {
        match self {
            LogEntry::Cmd { .. } => "cmd",
            LogEntry::Stdout { .. } => "stdout",
            LogEntry::Stderr { .. } => "stderr",
            LogEntry::Cd { .. } => "cd",
            LogEntry::Fetch { .. } => "fetch",
            LogEntry::Custom { .. } => "custom",
            LogEntry::Retry { .. } => "retry",
            LogEntry::End { .. } => "end",
            LogEntry::Kill { .. } => "kill",
        }
    }
}

/// The default rendering of `entry` (empty for `end` and `kill`).
pub fn format_entry(entry: &LogEntry, colors: bool) -> Vec<u8> {
    let text = match entry {
        LogEntry::Cmd { cmd } => highlight(cmd, colors),
        LogEntry::Stdout { data } | LogEntry::Stderr { data } => return data.clone(),
        LogEntry::Custom { data } => data.clone(),
        LogEntry::Cd { dir } => format!("$ {} {dir}\n", paint(GREEN_BRIGHT, "cd", colors)),
        LogEntry::Fetch { url, init } => {
            let init = init.as_ref().map(|i| format!(" {i}")).unwrap_or_default();
            format!("$ {} {url}{init}\n", paint(GREEN_BRIGHT, "fetch", colors))
        }
        LogEntry::Retry {
            attempt,
            total,
            delay,
        } => {
            let total = total.map(|t| format!("/{t}")).unwrap_or_default();
            let delay = if delay.is_zero() {
                String::new()
            } else {
                format!("; next in {}ms", delay.as_millis())
            };
            let badge = paint(FAIL_BADGE, " FAIL ", colors);
            format!("{badge} Attempt: {attempt}{total}{delay}\n")
        }
        LogEntry::End { .. } | LogEntry::Kill { .. } => String::new(),
    };
    text.into_bytes()
}

/// A custom renderer registered with [`Logger::formatter`].
pub type Formatter = Box<dyn Fn(&LogEntry) -> String + Send + Sync>;

/// Writes verbose [`LogEntry`] records to an output (zx `log`).
pub struct Logger<W: Write> {
    output: W,
    colors: bool,
    formatters: HashMap<&'static str, Formatter>,
}

impl Logger<std::io::Stderr> {
    /// A logger writing to stderr, colored when stderr is a terminal and
    /// `NO_COLOR` is unset.
    pub fn stderr() -> Self {
        let colors = std::io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none();
        Logger::new(std::io::stderr()).colors(colors)
    }
}

impl<W: Write> Logger<W> {
    /// A logger writing colored output to `output`.
    pub fn new(output: W) -> Self {
        Self {
            output,
            colors: true,
            formatters: HashMap::new(),
        }
    }

    /// Enable or disable ANSI colors.
    pub fn colors(mut self, colors: bool) -> Self {
        self.colors = colors;
        self
    }

    /// Override the rendering of one entry kind (zx `log.formatters`).
    pub fn formatter(
        mut self,
        kind: &'static str,
        f: impl Fn(&LogEntry) -> String + Send + Sync + 'static,
    ) -> Self {
        self.formatters.insert(kind, Box::new(f));
        self
    }

    /// The underlying output.
    pub fn output(&self) -> &W {
        &self.output
    }

    /// Consume the logger, returning its output.
    pub fn into_output(self) -> W {
        self.output
    }

    /// Write `entry` if `verbose` is set.
    pub fn log(&mut self, entry: &LogEntry, verbose: bool) -> std::io::Result<()> {
        if !verbose {
            return Ok(());
        }
        let bytes = match self.formatters.get(entry.kind()) {
            Some(f) => f(entry).into_bytes(),
            None => format_entry(entry, self.colors),
        };
        if bytes.is_empty() {
            return Ok(());
        }
        self.output.write_all(&bytes)?;
        self.output.flush()
    }
}

/// Log `entry` to stderr when `verbose` is set (errors are ignored).
pub fn log(entry: &LogEntry, verbose: bool) {
    if verbose {
        let _ = Logger::stderr().log(entry, true);
    }
}
