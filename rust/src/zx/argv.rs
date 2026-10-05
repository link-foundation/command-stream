//! Command line parsing compatible with `minimist` (as re-exported by zx) and
//! zx's `parseArgv` wrapper.
//!
//! Results are returned as a [`serde_json::Value`] object so that repeated
//! flags (arrays), dotted keys (nested objects), numbers, booleans and strings
//! can all be represented. Positional arguments live under `"_"`.

use std::collections::{HashMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use super::util::to_camel_case;

static NUMBER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$").expect("valid regex"));
static HEX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?i)0x[0-9a-f]+$").expect("valid regex"));
static FLAG_LIKE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(-|--)[^-]").expect("valid regex"));
static NUMERIC_TAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"-?\d+(\.\d*)?(e-?\d+)?$").expect("valid regex"));
const UNSAFE_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// Which flags are booleans.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Booleans {
    /// No flag is forced to be boolean.
    #[default]
    None,
    /// Every `--flag` without `=` is boolean (`boolean: true`).
    All,
    /// The listed flags are boolean.
    Keys(Vec<String>),
}

/// Callback for flags and positionals that were not declared; returning
/// `false` drops the argument.
pub type UnknownFn = fn(&str) -> bool;

/// Options for [`minimist`] and [`parse_argv`].
#[derive(Debug, Clone, Default)]
pub struct ArgvOptions {
    /// Boolean flags.
    pub boolean: Booleans,
    /// Flags whose values are always kept as strings (`"_"` for positionals).
    pub string: Vec<String>,
    /// Alias groups: key -> other names.
    pub alias: Vec<(String, Vec<String>)>,
    /// Default values (dotted keys allowed).
    pub default: Vec<(String, Value)>,
    /// Stop parsing at the first positional argument.
    pub stop_early: bool,
    /// Put arguments after `--` into `"--"` instead of `"_"`.
    pub double_dash: bool,
    /// Called for undeclared arguments.
    pub unknown: Option<UnknownFn>,
    /// (`parse_argv` only) convert `kebab-case` keys to `camelCase`.
    pub camel_case: bool,
    /// (`parse_argv` only) turn `"true"`/`"false"` string values into booleans.
    pub parse_boolean: bool,
}

impl ArgvOptions {
    /// Empty options.
    pub fn new() -> Self {
        Self::default()
    }

    /// Declare boolean flags.
    pub fn boolean<S: AsRef<str>>(mut self, keys: &[S]) -> Self {
        self.boolean = Booleans::Keys(keys.iter().map(|k| k.as_ref().to_string()).collect());
        self
    }

    /// Treat every long flag without `=` as boolean.
    pub fn all_boolean(mut self) -> Self {
        self.boolean = Booleans::All;
        self
    }

    /// Declare string flags.
    pub fn string<S: AsRef<str>>(mut self, keys: &[S]) -> Self {
        self.string = keys.iter().map(|k| k.as_ref().to_string()).collect();
        self
    }

    /// Add an alias group.
    pub fn alias<S: AsRef<str>>(mut self, key: &str, names: &[S]) -> Self {
        let names = names.iter().map(|n| n.as_ref().to_string()).collect();
        self.alias.push((key.to_string(), names));
        self
    }

    /// Add a default value.
    pub fn default_value(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.default.push((key.to_string(), value.into()));
        self
    }

    /// Enable `stop_early`.
    pub fn stop_early(mut self) -> Self {
        self.stop_early = true;
        self
    }

    /// Enable the `"--"` key.
    pub fn double_dash(mut self) -> Self {
        self.double_dash = true;
        self
    }

    /// Set the unknown-argument callback.
    pub fn unknown(mut self, callback: UnknownFn) -> Self {
        self.unknown = Some(callback);
        self
    }

    /// Enable camelCase keys (`parse_argv`).
    pub fn camel_case(mut self) -> Self {
        self.camel_case = true;
        self
    }

    /// Enable boolean parsing of values (`parse_argv`).
    pub fn parse_boolean(mut self) -> Self {
        self.parse_boolean = true;
        self
    }
}

fn is_number(text: &str) -> bool {
    HEX_RE.is_match(text) || NUMBER_RE.is_match(text)
}

/// Convert numeric text the way JavaScript's `Number()` does for the
/// accepted syntaxes; integral values become integers.
fn to_number(text: &str) -> Value {
    let value = if HEX_RE.is_match(text) {
        u64::from_str_radix(&text[2..], 16).map_or(f64::NAN, |v| v as f64)
    } else {
        text.parse::<f64>().unwrap_or(f64::NAN)
    };
    number_value(value)
}

fn number_value(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

struct Config {
    aliases: HashMap<String, Vec<String>>,
    bools: HashSet<String>,
    strings: HashSet<String>,
    all_bools: bool,
    defaults: Vec<(String, Value)>,
    unknown: Option<UnknownFn>,
}

impl Config {
    fn new(opts: &ArgvOptions) -> Self {
        let mut aliases: HashMap<String, Vec<String>> = HashMap::new();
        for (key, names) in &opts.alias {
            let group: Vec<&String> = std::iter::once(key).chain(names.iter()).collect();
            for name in &group {
                let entry = aliases.entry((*name).clone()).or_default();
                for other in &group {
                    if other != name && !entry.contains(other) {
                        entry.push((*other).clone());
                    }
                }
            }
        }
        let mut bools = HashSet::new();
        if let Booleans::Keys(keys) = &opts.boolean {
            bools.extend(keys.iter().filter(|k| !k.is_empty()).cloned());
        }
        let mut strings = HashSet::new();
        for key in opts.string.iter().filter(|k| !k.is_empty()) {
            strings.insert(key.clone());
            if let Some(names) = aliases.get(key) {
                strings.extend(names.iter().cloned());
            }
        }
        Self {
            aliases,
            bools,
            strings,
            all_bools: opts.boolean == Booleans::All,
            defaults: opts.default.clone(),
            unknown: opts.unknown,
        }
    }

    fn names(&self, key: &str) -> Vec<String> {
        let mut names = vec![key.to_string()];
        if let Some(others) = self.aliases.get(key) {
            names.extend(others.iter().cloned());
        }
        names
    }

    fn alias_is_boolean(&self, key: &str) -> bool {
        self.aliases
            .get(key)
            .is_some_and(|names| names.iter().any(|n| self.bools.contains(n)))
    }

    fn is_declared(&self, key: &str, arg: &str) -> bool {
        (self.all_bools && arg.starts_with("--") && !arg.contains('='))
            || self.strings.contains(key)
            || self.bools.contains(key)
            || self.aliases.contains_key(key)
    }

    fn empty_value(&self, key: &str) -> Value {
        if self.strings.contains(key) {
            Value::from("")
        } else {
            Value::Bool(true)
        }
    }
}

fn has_path(obj: &Map<String, Value>, keys: &[&str]) -> bool {
    let mut node = obj;
    let (last, parents) = keys.split_last().expect("at least one key");
    for key in parents {
        match node.get(*key) {
            Some(Value::Object(child)) => node = child,
            _ => return false,
        }
    }
    node.contains_key(*last)
}

fn assign_path(obj: &mut Map<String, Value>, keys: &[&str], value: Value, config: &Config) {
    if keys.iter().any(|k| UNSAFE_KEYS.contains(k)) {
        return;
    }
    let (last, parents) = keys.split_last().expect("at least one key");
    let mut node = obj;
    for key in parents {
        let slot = node
            .entry((*key).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if slot.is_null() {
            *slot = Value::Object(Map::new());
        }
        match slot {
            Value::Object(child) => node = child,
            _ => return,
        }
    }
    let replace = config.bools.contains(*last);
    match node.get_mut(*last) {
        None => {
            node.insert((*last).to_string(), value);
        }
        Some(existing) if replace || existing.is_boolean() || existing.is_null() => {
            *existing = value;
        }
        Some(Value::Array(items)) => items.push(value),
        Some(existing) => {
            let previous = existing.take();
            *existing = Value::Array(vec![previous, value]);
        }
    }
}

struct Parser<'a> {
    config: &'a Config,
    argv: Map<String, Value>,
    positionals: Vec<Value>,
}

impl Parser<'_> {
    fn set_arg(&mut self, key: &str, raw: Value, arg: Option<&str>) {
        if let (Some(arg), Some(unknown)) = (arg, self.config.unknown) {
            if !self.config.is_declared(key, arg) && !unknown(arg) {
                return;
            }
        }
        let value = match raw {
            Value::String(s) if !self.config.strings.contains(key) && is_number(&s) => {
                to_number(&s)
            }
            other => other,
        };
        for name in self.config.names(key) {
            let path: Vec<&str> = name.split('.').collect();
            assign_path(&mut self.argv, &path, value.clone(), self.config);
        }
    }

    fn takes_value(&self, key: &str, next: Option<&str>, arg: &str) -> bool {
        next.is_some_and(|n| !FLAG_LIKE_RE.is_match(n))
            && !self.config.bools.contains(key)
            && !(self.config.all_bools && arg.starts_with("--"))
            && !self.config.alias_is_boolean(key)
    }

    fn set_trailing_flag(&mut self, key: &str, next: Option<&str>, arg: &str) -> usize {
        if self.takes_value(key, next, arg) {
            self.set_arg(key, Value::from(next.unwrap_or_default()), Some(arg));
            return 1;
        }
        if let Some(word @ ("true" | "false")) = next {
            self.set_arg(key, Value::Bool(word == "true"), Some(arg));
            return 1;
        }
        let empty = self.config.empty_value(key);
        self.set_arg(key, empty, Some(arg));
        0
    }

    fn long_flag(&mut self, arg: &str, next: Option<&str>) -> usize {
        let body = &arg[2..];
        if let Some((key, raw)) = body.split_once('=').filter(|(k, _)| !k.is_empty()) {
            let value = if self.config.bools.contains(key) {
                Value::Bool(raw != "false")
            } else {
                Value::from(raw)
            };
            self.set_arg(key, value, Some(arg));
            return 0;
        }
        if let Some(key) = body.strip_prefix("no-").filter(|k| !k.is_empty()) {
            self.set_arg(key, Value::Bool(false), Some(arg));
            return 0;
        }
        self.set_trailing_flag(body, next, arg)
    }

    /// Handles all letters of a short group but the last; `true` when the
    /// rest of the group was consumed as a value.
    fn short_letters(&mut self, arg: &str) -> bool {
        let chars: Vec<char> = arg.chars().collect();
        let letters = &chars[1..chars.len() - 1];
        for (j, &letter) in letters.iter().enumerate() {
            let key = letter.to_string();
            let rest: String = chars[j + 2..].iter().collect();
            let alpha = letter.is_ascii_alphabetic();
            if rest == "-" {
                self.set_arg(&key, Value::from(rest), Some(arg));
            } else if alpha && rest.starts_with('=') {
                self.set_arg(&key, Value::from(&rest[1..]), Some(arg));
                return true;
            } else if (alpha && NUMERIC_TAIL_RE.is_match(&rest))
                || letters
                    .get(j + 1)
                    .is_some_and(|c| !(c.is_ascii_alphanumeric() || *c == '_'))
            {
                self.set_arg(&key, Value::from(rest), Some(arg));
                return true;
            } else {
                let empty = self.config.empty_value(&key);
                self.set_arg(&key, empty, Some(arg));
            }
        }
        false
    }

    fn short_group(&mut self, arg: &str, next: Option<&str>) -> usize {
        if self.short_letters(arg) {
            return 0;
        }
        let key = arg.chars().last().map(String::from).unwrap_or_default();
        if key == "-" {
            return 0;
        }
        self.set_trailing_flag(&key, next, arg)
    }

    fn push_positional(&mut self, arg: &str) {
        if let Some(unknown) = self.config.unknown {
            if !unknown(arg) {
                return;
            }
        }
        let value = if self.config.strings.contains("_") || !is_number(arg) {
            Value::from(arg)
        } else {
            to_number(arg)
        };
        self.positionals.push(value);
    }
}

/// Parse `args` like the `minimist` package.
pub fn minimist<S: AsRef<str>>(args: &[S], opts: &ArgvOptions) -> Value {
    let config = Config::new(opts);
    let mut parser = Parser {
        config: &config,
        argv: Map::new(),
        positionals: Vec::new(),
    };
    let mut bools: Vec<&String> = config.bools.iter().collect();
    bools.sort();
    for key in bools {
        let fallback = config
            .defaults
            .iter()
            .find(|(k, _)| k == key)
            .map_or(Value::Bool(false), |(_, v)| v.clone());
        parser.set_arg(key, fallback, None);
    }

    let all: Vec<&str> = args.iter().map(AsRef::as_ref).collect();
    let (list, after) = match all.iter().position(|a| *a == "--") {
        Some(i) => (&all[..i], &all[i + 1..]),
        None => (&all[..], &all[all.len()..]),
    };

    let mut i = 0;
    while i < list.len() {
        let arg = list[i];
        let next = list.get(i + 1).copied();
        if arg.len() > 2 && arg.starts_with("--") {
            i += parser.long_flag(arg, next);
        } else if arg.len() > 1 && arg.starts_with('-') && !arg[1..].starts_with('-') {
            i += parser.short_group(arg, next);
        } else {
            parser.push_positional(arg);
            if opts.stop_early {
                parser
                    .positionals
                    .extend(list[i + 1..].iter().map(|a| Value::from(*a)));
                break;
            }
        }
        i += 1;
    }

    for (key, value) in &config.defaults {
        let path: Vec<&str> = key.split('.').collect();
        if has_path(&parser.argv, &path) {
            continue;
        }
        for name in config.names(key) {
            let path: Vec<&str> = name.split('.').collect();
            assign_path(&mut parser.argv, &path, value.clone(), &config);
        }
    }

    let rest: Vec<Value> = after.iter().map(|a| Value::from(*a)).collect();
    let mut argv = parser.argv;
    let mut positionals = parser.positionals;
    if opts.double_dash {
        argv.insert("--".into(), Value::Array(rest));
    } else {
        positionals.extend(rest);
    }
    argv.insert("_".into(), Value::Array(positionals));
    Value::Object(argv)
}

fn parse_bool_value(value: Value) -> Value {
    match value {
        Value::String(s) => match s.as_str() {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => Value::String(s),
        },
        other => other,
    }
}

/// zx `parseArgv(args, opts, defs)`: run [`minimist`] and merge the result
/// into `defs`, optionally camel-casing keys and parsing boolean strings.
pub fn parse_argv<S: AsRef<str>>(args: &[S], opts: &ArgvOptions, defs: Option<Value>) -> Value {
    let mut out = match defs {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    if let Value::Object(parsed) = minimist(args, opts) {
        for (key, value) in parsed {
            if key == "_" || key == "--" {
                out.insert(key, value);
                continue;
            }
            let key = if opts.camel_case {
                to_camel_case(&key)
            } else {
                key
            };
            let value = if opts.parse_boolean {
                parse_bool_value(value)
            } else {
                value
            };
            out.insert(key, value);
        }
    }
    Value::Object(out)
}

/// Parse the current process arguments (without the program name).
pub fn argv() -> Value {
    let args: Vec<String> = std::env::args().skip(1).collect();
    parse_argv(&args, &ArgvOptions::default(), None)
}
