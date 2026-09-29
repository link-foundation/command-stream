//! Rust port of `conformance/bun-shell/corpus.mjs`: loading the corpus,
//! placeholders and TEXT specs, temp dir setup, VALUE materialization,
//! EXPECT matching and applicability (skip) rules.
//!
//! The functions mirror the JavaScript reference helpers one to one (same
//! names in snake_case, same precedence of the EXPECT forms, same mismatch
//! messages) so that a case means exactly the same thing in both languages.
//! The case data is kept as `serde_json::Value`, which keeps the JavaScript
//! `'key' in obj` checks literal.

use command_stream::bun_shell::{OutBuffer, ShellValue};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/// `conformance/bun-shell/cases` of this repository.
pub fn cases_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("bun-shell")
        .join("cases")
}

/// One `cases/<name>.json` file.
pub struct CorpusFile {
    pub file: String,
    pub source: String,
    pub units: Vec<Value>,
}

/// `JSON.parse`: like `serde_json::from_str`, but without serde_json's
/// nesting limit of 128 (some cases nest arrays ~200 levels deep to test
/// Bun's own limit).
pub fn parse_json(raw: &str) -> Result<Value, serde_json::Error> {
    use serde::Deserialize;
    let mut de = serde_json::Deserializer::from_str(raw);
    de.disable_recursion_limit();
    let value = Value::deserialize(&mut de)?;
    de.end()?;
    Ok(value)
}

/// Load every `cases/*.json` file, sorted by file name (`loadCorpus`).
pub fn load_corpus(dir: &Path) -> Result<Vec<CorpusFile>, String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|f| f.ends_with(".json"))
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|file| {
            let path = dir.join(&file);
            let raw = fs::read_to_string(&path)
                .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
            let data =
                parse_json(&raw).map_err(|e| format!("invalid JSON in {}: {e}", path.display()))?;
            Ok(CorpusFile {
                source: js_string(data.get("source").unwrap_or(&Value::Null)),
                units: data
                    .get("units")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
                file,
            })
        })
        .collect()
}

/// A case plus the corpus file and unit it comes from (`allCases`).
#[derive(Clone, Debug)]
pub struct Case {
    pub file: String,
    pub source: String,
    pub unit_line: String,
    /// The CASE object exactly as it appears in the corpus.
    pub data: Value,
}

impl Case {
    pub fn id(&self) -> &str {
        self.data.get("id").and_then(Value::as_str).unwrap_or("")
    }
}

/// Flat list of every case, annotated with its corpus file and unit line.
pub fn all_cases(dir: &Path) -> Result<Vec<Case>, String> {
    let mut out = Vec::new();
    for f in load_corpus(dir)? {
        for unit in &f.units {
            let line = js_string(unit.get("line").unwrap_or(&Value::Null));
            for c in unit
                .get("cases")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default()
            {
                out.push(Case {
                    file: f.file.clone(),
                    source: f.source.clone(),
                    unit_line: line.clone(),
                    data: c.clone(),
                });
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// JavaScript value semantics used by the reference helpers
// ---------------------------------------------------------------------------

/// JavaScript truthiness of an (optional) JSON value.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// JavaScript `String(v)` for a JSON value.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => i.to_string(),
            (None, Some(f)) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
            (None, Some(f)) => f.to_string(),
            (None, None) => n.to_string(),
        },
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `JSON.stringify(v)` for a JSON value.
fn json(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_default()
}

/// The `show()` helper: a JSON string literal, cut after 400 UTF-16 units.
pub fn show(s: &str) -> String {
    // Only the first 400 units of the literal are shown, so encoding the first
    // 401 chars (each one at least one unit, plus the opening quote) is enough;
    // some corpus outputs are megabytes long.
    let prefix: String = s.chars().take(401).collect();
    let j = serde_json::to_string(&prefix).unwrap_or_default();
    let units: Vec<u16> = j.encode_utf16().collect();
    if units.len() > 400 || prefix.len() < s.len() {
        format!(
            "{}...({} chars)",
            String::from_utf16_lossy(&units[..400]),
            s.encode_utf16().count()
        )
    } else {
        j
    }
}

/// Node's `process.platform` for the current OS.
pub fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

/// `"windows"` or `"posix"`, the family names used by `platforms` and
/// `byPlatform`.
pub fn platform_family(platform: &str) -> &'static str {
    if platform == "win32" {
        "windows"
    } else {
        "posix"
    }
}

/// Pick the entry of a `{"byPlatform": {...}}` map for `platform`: the exact
/// platform (`linux`, `darwin`, `win32`), then its family (`windows`,
/// `posix`), then `default` (`forPlatform`).
pub fn for_platform<'a>(map: &'a Value, platform: &str) -> Result<&'a Value, String> {
    [platform, platform_family(platform), "default"]
        .iter()
        .find_map(|key| map.get(*key))
        .ok_or_else(|| format!("byPlatform has no entry for {platform}"))
}

/// Node's `path.sep`.
pub const SEP: &str = std::path::MAIN_SEPARATOR_STR;

fn is_sep(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// Node's `path.join(base, rel)` for the current platform: joins with the
/// platform separator and normalizes `.`/`..`/repeated separators, keeping a
/// trailing separator.
pub fn node_join(base: &str, rel: &str) -> String {
    let joined = match (base.is_empty(), rel.is_empty()) {
        (true, true) => return ".".to_string(),
        (false, true) => base.to_string(),
        (true, false) => rel.to_string(),
        (false, false) => format!("{base}{SEP}{rel}"),
    };
    node_normalize(&joined)
}

fn node_normalize(p: &str) -> String {
    let b = p.as_bytes();
    let (prefix, rest) =
        if cfg!(windows) && b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
            p.split_at(2)
        } else {
            ("", p)
        };
    let absolute = rest.starts_with(is_sep);
    let trailing = rest.ends_with(is_sep);
    let mut parts: Vec<&str> = Vec::new();
    for comp in rest.split(is_sep) {
        match comp {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|l| *l != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            c => parts.push(c),
        }
    }
    let mut out = prefix.to_string();
    if absolute {
        out.push_str(SEP);
    }
    out.push_str(&parts.join(SEP));
    if parts.is_empty() && !absolute {
        out.push('.');
    }
    if trailing && !parts.is_empty() {
        out.push_str(SEP);
    }
    out
}

// ---------------------------------------------------------------------------
// Placeholders and text specs
// ---------------------------------------------------------------------------

/// Context used for placeholder substitution (`makeContext`).
#[derive(Clone, Debug)]
pub struct Context {
    /// The temp dir with forward slashes (`{{TEMP}}`).
    pub temp_dir: String,
    /// The temp dir with `sep` as the separator (`{{TEMP_NATIVE}}`).
    pub temp_dir_native: String,
    /// The node binary with forward slashes (`{{NODE}}`).
    pub node: String,
    /// The platform path separator (`{{SEP}}`).
    pub sep: String,
    /// Node's `process.platform`, for `byPlatform` expectations.
    pub platform: String,
}

pub fn make_context(temp_dir: &str, node: &str, sep: &str) -> Context {
    let temp_dir = to_slash(temp_dir);
    Context {
        temp_dir_native: temp_dir.replace('/', sep),
        temp_dir,
        node: to_slash(node),
        sep: sep.to_string(),
        platform: node_platform().to_string(),
    }
}

pub fn to_slash(p: &str) -> String {
    p.replace('\\', "/")
}

/// Replace `{{TEMP}}`, `{{TEMP_NATIVE}}`, `{{TEMP_NATIVE_JSON}}`, `{{NODE}}`
/// and `{{SEP}}` inside a string.
pub fn subst(s: &str, ctx: &Context) -> String {
    subst_with(s, ctx, str::to_string)
}

/// `subst` for a regex source: the substituted values match literally.
pub fn subst_regex(s: &str, ctx: &Context) -> String {
    subst_with(s, ctx, |v| fancy_regex::escape(v).into_owned())
}

fn subst_with(s: &str, ctx: &Context, map: impl Fn(&str) -> String) -> String {
    let native_json = Value::String(ctx.temp_dir_native.clone()).to_string();
    let native_json = &native_json[1..native_json.len() - 1];
    s.replace("{{TEMP}}", &map(&ctx.temp_dir))
        .replace("{{TEMP_NATIVE_JSON}}", &map(native_json))
        .replace("{{TEMP_NATIVE}}", &map(&ctx.temp_dir_native))
        .replace("{{NODE}}", &map(&ctx.node))
        .replace("{{SEP}}", &map(&ctx.sep))
}

/// `subst` for a JSON value that is expected to be a string (non-strings are
/// converted like JavaScript's `String(v)`).
fn subst_value(v: &Value, ctx: &Context) -> String {
    match v {
        Value::String(s) => subst(s, ctx),
        other => js_string(other),
    }
}

fn is_text_generator(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.contains_key("repeat") || o.contains_key("concat") || o.contains_key("seq")
    })
}

/// Expand a TEXT spec: a string, `{"repeat": TEXT, "count": N}`,
/// `{"concat": [TEXT...]}` or `{"seq": [from, to]}`.
pub fn text(spec: &Value, ctx: &Context) -> Result<String, String> {
    let invalid = || format!("invalid text spec: {}", json(spec));
    match spec {
        Value::String(s) => Ok(subst(s, ctx)),
        Value::Object(o) if o.contains_key("repeat") => {
            let count = match o.get("count") {
                None | Some(Value::Null) => 1,
                Some(c) => c.as_u64().ok_or_else(invalid)?,
            };
            Ok(text(&o["repeat"], ctx)?.repeat(count as usize))
        }
        Value::Object(o) if o.contains_key("concat") => o["concat"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .map(|s| text(s, ctx))
            .collect(),
        Value::Object(o) if o.contains_key("seq") => {
            let bounds = o["seq"].as_array().ok_or_else(invalid)?;
            let from = bounds.first().and_then(Value::as_i64).ok_or_else(invalid)?;
            let to = bounds.get(1).and_then(Value::as_i64).ok_or_else(invalid)?;
            Ok((from..=to).map(|i| format!("{i}\n")).collect())
        }
        _ => Err(invalid()),
    }
}

// ---------------------------------------------------------------------------
// Temp dir setup
// ---------------------------------------------------------------------------

/// Create the case's `dirs` and `files` inside `temp_dir` (`setupFiles`).
///
/// `files` maps a relative path to a TEXT, `{"content": TEXT, "mode": "755"}`
/// or `{"symlink": "target"}`. Symlinks are created after the regular files so
/// that, on Windows, the link type (file or dir) can be taken from the target
/// like Node's `fs.symlinkSync` does.
pub fn setup_files(case: &Value, temp_dir: &Path, ctx: &Context) -> Result<(), String> {
    let base = temp_dir.to_string_lossy();
    for d in case
        .get("dirs")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let full = node_join(&base, &js_string(d));
        fs::create_dir_all(&full).map_err(|e| format!("mkdir {full}: {e}"))?;
    }
    let Some(files) = case.get("files").and_then(Value::as_object) else {
        return Ok(());
    };
    let mut links = Vec::new();
    for (rel, spec) in files {
        let full = PathBuf::from(node_join(&base, rel));
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let obj = spec.as_object();
        if let Some(target) = obj.and_then(|o| o.get("symlink")) {
            links.push((subst_value(target, ctx), full));
            continue;
        }
        let content = obj.and_then(|o| o.get("content"));
        let data = text(content.unwrap_or(spec), ctx)?;
        fs::write(&full, data).map_err(|e| format!("write {}: {e}", full.display()))?;
        if let Some(mode) = content.and(obj.and_then(|o| o.get("mode"))) {
            let mode_str = js_string(mode);
            let mode = u32::from_str_radix(&mode_str, 8)
                .map_err(|_| format!("{rel}: invalid mode {mode_str:?}"))?;
            set_mode(&full, mode).map_err(|e| format!("chmod {}: {e}", full.display()))?;
        }
    }
    for (target, full) in links {
        create_symlink(&target, &full)
            .map_err(|e| format!("symlink {} -> {target}: {e}", full.display()))?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

/// Like Node's `fs.chmodSync` on Windows: only the owner write bit matters
/// (it toggles the read-only attribute).
#[cfg(not(unix))]
#[allow(clippy::permissions_set_readonly_false)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_readonly(mode & 0o200 == 0);
    fs::set_permissions(path, perms)
}

#[cfg(unix)]
fn create_symlink(target: &str, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

/// Like Node's `fs.symlinkSync(target, link)` without a type on Windows: a
/// directory symlink when the target (relative to the link) is a directory,
/// a file symlink otherwise.
#[cfg(windows)]
fn create_symlink(target: &str, link: &Path) -> io::Result<()> {
    let target = PathBuf::from(target.replace('/', "\\"));
    let resolved = link.parent().unwrap_or(Path::new(".")).join(&target);
    if fs::metadata(resolved).is_ok_and(|m| m.is_dir()) {
        std::os::windows::fs::symlink_dir(&target, link)
    } else {
        std::os::windows::fs::symlink_file(&target, link)
    }
}

#[cfg(not(any(unix, windows)))]
fn create_symlink(_target: &str, _link: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "symlinks are not supported on this platform",
    ))
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/// A `{template, values}` pair turned into `shell()` arguments.
#[derive(Debug)]
pub struct Template {
    pub strings: Vec<String>,
    pub values: Vec<ShellValue>,
}

/// A materialized case (`materialize`).
#[derive(Debug)]
pub struct Materialized {
    pub strings: Vec<String>,
    pub values: Vec<ShellValue>,
    /// Env overrides from the case (placeholders substituted), in case order.
    pub env: Vec<(String, String)>,
    /// Absolute working directory.
    pub cwd: PathBuf,
    /// outBuffer id -> buffer, to inspect after running.
    pub buffers: HashMap<String, OutBuffer>,
}

pub fn materialize(case: &Value, temp_dir: &Path, ctx: &Context) -> Result<Materialized, String> {
    let mut buffers = HashMap::new();
    let Template { strings, values } = materialize_template(case, ctx, &mut buffers)?;
    let env = case
        .get("env")
        .and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .map(|(k, v)| (k.clone(), subst_value(v, ctx)))
                .collect()
        })
        .unwrap_or_default();
    let cwd = match case.get("cwd") {
        Some(c) if truthy(Some(c)) => {
            PathBuf::from(node_join(&temp_dir.to_string_lossy(), &subst_value(c, ctx)))
        }
        _ => temp_dir.to_path_buf(),
    };
    Ok(Materialized {
        strings,
        values,
        env,
        cwd,
        buffers,
    })
}

/// Materialize a `{template, values}` pair (the main script or a setup step).
pub fn materialize_template(
    obj: &Value,
    ctx: &Context,
    buffers: &mut HashMap<String, OutBuffer>,
) -> Result<Template, String> {
    let strings: Vec<String> = obj
        .get("template")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("case {}: missing template", id_of(obj)))?
        .iter()
        .map(|s| subst_value(s, ctx))
        .collect();
    let values = obj
        .get("values")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|v| convert_value(v, ctx, buffers))
        .collect::<Result<Vec<_>, _>>()?;
    if values.len() + 1 != strings.len() {
        return Err(format!(
            "case {}: values.length ({}) must be template.length-1 ({})",
            id_of(obj),
            values.len(),
            strings.len() as i64 - 1
        ));
    }
    Ok(Template { strings, values })
}

fn id_of(obj: &Value) -> String {
    obj.get("id").map(js_string).unwrap_or_default()
}

/// VALUE -> `ShellValue`, checking the kinds in the same order as corpus.mjs.
pub fn convert_value(
    v: &Value,
    ctx: &Context,
    buffers: &mut HashMap<String, OutBuffer>,
) -> Result<ShellValue, String> {
    let o = v
        .as_object()
        .ok_or_else(|| format!("unknown value kind: {}", json(v)))?;
    if let Some(s) = o.get("string") {
        let count = o.get("repeat").and_then(Value::as_u64).unwrap_or(1);
        return Ok(ShellValue::Str(text(s, ctx)?.repeat(count as usize)));
    }
    if let Some(n) = o.get("number") {
        let n = n
            .as_f64()
            .ok_or_else(|| format!("invalid number value: {}", json(v)))?;
        return Ok(ShellValue::Number(n));
    }
    if let Some(b) = o.get("bigint") {
        return Ok(ShellValue::BigInt(js_string(b).trim().to_string()));
    }
    if let Some(b) = o.get("bool") {
        return Ok(ShellValue::Bool(truthy(Some(b))));
    }
    if o.contains_key("null") {
        return Ok(ShellValue::Null);
    }
    if o.contains_key("undefined") {
        return Ok(ShellValue::Undefined);
    }
    if let Some(r) = o.get("raw") {
        return Ok(ShellValue::Raw(text(r, ctx)?));
    }
    if let Some(a) = o.get("array") {
        return a
            .as_array()
            .ok_or_else(|| format!("invalid array value: {}", json(v)))?
            .iter()
            .map(|x| convert_value(x, ctx, buffers))
            .collect::<Result<Vec<_>, _>>()
            .map(ShellValue::Array);
    }
    if let Some(b) = o.get("bytes") {
        return Ok(ShellValue::Bytes(text(b, ctx)?.into_bytes()));
    }
    if let Some(spec) = o.get("outBuffer") {
        let size = spec.get("size").and_then(Value::as_u64).unwrap_or(0) as usize;
        let id = spec.get("id").map(js_string).unwrap_or_default();
        let buf = OutBuffer::new(size);
        buffers.insert(id, buf.clone());
        return Ok(ShellValue::OutBuffer(buf));
    }
    for kind in ["response", "blob", "jsfile"] {
        if o.contains_key(kind) {
            return Err(format!(
                "value kind `{kind}` is JS-only (the case needs languages: [\"js\"])"
            ));
        }
    }
    if let Some(p) = o.get("path") {
        return Ok(ShellValue::Str(to_slash(&node_join(
            &ctx.temp_dir,
            &subst_value(p, ctx),
        ))));
    }
    Err(format!("unknown value kind: {}", json(v)))
}

#[path = "expect.rs"]
mod expect;
pub use expect::*;

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

/// A skip reason, or `None` if the case applies (`skipReason`). `platform` is
/// a Node `process.platform` name, `which` looks up executables on PATH.
pub fn skip_reason(
    case: &Value,
    platform: &str,
    language: &str,
    mut which: impl FnMut(&str) -> bool,
) -> Option<String> {
    let list = |key: &str| -> Option<Vec<String>> {
        case.get(key)
            .and_then(Value::as_array)
            .map(|a| a.iter().map(js_string).collect())
    };
    if let Some(platforms) = list("platforms") {
        let family = platform_family(platform);
        if !platforms.iter().any(|p| p == platform || p == family) {
            return Some(format!(
                "platform {platform} not in {}",
                platforms.join(",")
            ));
        }
    }
    if let Some(languages) = list("languages") {
        if !languages.iter().any(|l| l == language) {
            return Some(format!(
                "language {language} not in {}",
                languages.join(",")
            ));
        }
    }
    for bin in list("requires").unwrap_or_default() {
        if bin == "node" {
            continue; // {{NODE}} is always provided by the runner
        }
        if !which(&bin) {
            return Some(format!("requires {bin}"));
        }
    }
    None
}

/// Whether a case needs a node binary (`requires: ["node"]` or a `{{NODE}}`
/// placeholder anywhere in its executable data).
pub fn uses_node(case: &Value) -> bool {
    let requires_node = case
        .get("requires")
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|b| b == "node"));
    requires_node
        || [
            "template", "values", "env", "setup", "files", "dirs", "cwd", "expect",
        ]
        .iter()
        .any(|k| case.get(*k).is_some_and(|v| json(v).contains("{{NODE}}")))
}
