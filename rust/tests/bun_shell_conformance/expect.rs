//! EXPECT matching (`matchText`, `matchExit`, `checkExpectations` in
//! `corpus.mjs`).

use super::*;

/// Compare actual text with an EXPECT (`None` means `""`). `Err` carries the
/// mismatch description, worded like corpus.mjs.
pub fn match_text(actual: &str, exp: Option<&Value>, ctx: &Context) -> Result<(), String> {
    let empty = Value::String(String::new());
    let exp = exp.unwrap_or(&empty);
    if exp.is_string() || is_text_generator(exp) {
        let want = text(exp, ctx)?;
        return if actual == want {
            Ok(())
        } else {
            Err(format!("expected {}, got {}", show(&want), show(actual)))
        };
    }
    let Some(o) = exp.as_object() else {
        return Err(format!("unknown text expectation {}", json(exp)));
    };
    if let Some(map) = o.get("byPlatform") {
        return match_text(actual, Some(for_platform(map, &ctx.platform)?), ctx);
    }
    if truthy(o.get("any")) {
        return Ok(());
    }
    if let Some(all) = o.get("allOf") {
        for e in all.as_array().map(Vec::as_slice).unwrap_or_default() {
            match_text(actual, Some(e), ctx)?;
        }
        return Ok(());
    }
    if let Some(one) = o.get("oneOf") {
        let errs: Vec<Result<(), String>> = one
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|e| match_text(actual, Some(e), ctx))
            .collect();
        if errs.iter().any(Result::is_ok) {
            return Ok(());
        }
        let msgs: Vec<String> = errs.into_iter().filter_map(Result::err).collect();
        return Err(format!("none of oneOf matched: {}", msgs.join(" | ")));
    }
    if let Some(c) = o.get("contains") {
        for s in one_or_many(c, ctx) {
            if !actual.contains(&s) {
                return Err(format!(
                    "expected to contain {}, got {}",
                    show(&s),
                    show(actual)
                ));
            }
        }
        if !o.contains_key("notContains") {
            return Ok(());
        }
    }
    if let Some(c) = o.get("notContains") {
        for s in one_or_many(c, ctx) {
            if actual.contains(&s) {
                return Err(format!(
                    "expected NOT to contain {}, got {}",
                    show(&s),
                    show(actual)
                ));
            }
        }
        return Ok(());
    }
    if let Some(re) = o.get("regex") {
        let source = js_string(re);
        let flags = o.get("flags").map(js_string).unwrap_or_default();
        let regex = js_regex(&subst_regex(&source, ctx), &flags)?;
        return match regex.is_match(actual) {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!(
                "expected to match /{source}/{flags}, got {}",
                show(actual)
            )),
            Err(e) => Err(format!("regex /{source}/{flags} failed: {e}")),
        };
    }
    if let Some(sw) = o.get("startsWith") {
        let s = text(sw, ctx)?;
        if !actual.starts_with(&s) {
            return Err(format!(
                "expected to start with {}, got {}",
                show(&s),
                show(actual)
            ));
        }
        if let Some(ew) = o.get("endsWith") {
            return match_text(actual, Some(&serde_json::json!({ "endsWith": ew })), ctx);
        }
        if let Some(len) = o.get("length") {
            return match_text(actual, Some(&serde_json::json!({ "length": len })), ctx);
        }
        return Ok(());
    }
    if let Some(ew) = o.get("endsWith") {
        let s = text(ew, ctx)?;
        if !actual.ends_with(&s) {
            return Err(format!(
                "expected to end with {}, got {}",
                show(&s),
                show(actual)
            ));
        }
        if let Some(len) = o.get("length") {
            return match_text(actual, Some(&serde_json::json!({ "length": len })), ctx);
        }
        return Ok(());
    }
    if let Some(len) = o.get("length") {
        // JavaScript string length: UTF-16 code units.
        let got = actual.encode_utf16().count();
        return if len.as_f64() == Some(got as f64) {
            Ok(())
        } else {
            Err(format!(
                "expected length {}, got {got}: {}",
                js_string(len),
                show(actual)
            ))
        };
    }
    if let Some(lines) = o.get("sortedLines") {
        let mut got: Vec<String> = actual
            .split('\n')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        let mut want: Vec<String> = lines
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(|s| subst_value(s, ctx))
            .collect();
        js_sort(&mut got);
        js_sort(&mut want);
        return if got == want {
            Ok(())
        } else {
            Err(format!(
                "expected sorted lines {}, got {}",
                serde_json::to_string(&want).unwrap_or_default(),
                serde_json::to_string(&got).unwrap_or_default()
            ))
        };
    }
    if let Some(count) = o.get("lineCount") {
        let n = actual.split('\n').filter(|s| !s.is_empty()).count();
        return if count.as_f64() == Some(n as f64) {
            Ok(())
        } else {
            Err(format!(
                "expected {} lines, got {n}: {}",
                js_string(count),
                show(actual)
            ))
        };
    }
    Err(format!("unknown text expectation {}", json(exp)))
}

/// `[].concat(x).map(subst)`.
fn one_or_many(v: &Value, ctx: &Context) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().map(|x| subst_value(x, ctx)).collect(),
        other => vec![subst_value(other, ctx)],
    }
}

/// JavaScript's default `Array.prototype.sort` order (UTF-16 code units).
fn js_sort(v: &mut [String]) {
    v.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
}

/// Build a regex with JavaScript flags. `fancy_regex` is used because the
/// corpus relies on backreferences (`\1`), which the `regex` crate lacks.
/// Without the `m` flag, `^`/`$` match only at the ends of the input, as in
/// JavaScript.
pub fn js_regex(source: &str, flags: &str) -> Result<fancy_regex::Regex, String> {
    let mut inline = String::new();
    for f in flags.chars() {
        match f {
            's' | 'i' | 'm' => inline.push(f),
            // `g` does not change a fresh RegExp's `test()`; `u`/`v` only
            // tighten the syntax, `d` adds match indices.
            'g' | 'u' | 'v' | 'd' => {}
            other => {
                return Err(format!(
                    "unsupported regex flag {other:?} in /{source}/{flags}"
                ))
            }
        }
    }
    let pattern = if inline.is_empty() {
        source.to_string()
    } else {
        format!("(?{inline}){source}")
    };
    fancy_regex::Regex::new(&pattern).map_err(|e| format!("invalid regex /{source}/{flags}: {e}"))
}

fn show_exit(actual: Option<i32>) -> String {
    actual.map_or_else(|| "undefined".to_string(), |c| c.to_string())
}

fn exit_eq(actual: Option<i32>, want: &Value) -> bool {
    matches!((actual, want.as_f64()), (Some(a), Some(w)) if f64::from(a) == w)
}

/// Compare an exit code with `n`, `{"not": n}`, `{"oneOf": [..]}` or
/// `{"any": true}` (`matchExit`).
pub fn match_exit(actual: Option<i32>, exp: &Value) -> Result<(), String> {
    if exp.is_number() {
        return if exit_eq(actual, exp) {
            Ok(())
        } else {
            Err(format!(
                "expected exitCode {}, got {}",
                js_string(exp),
                show_exit(actual)
            ))
        };
    }
    if let Some(o) = exp.as_object() {
        if let Some(not) = o.get("not") {
            return if exit_eq(actual, not) {
                Err(format!(
                    "expected exitCode != {}, got {}",
                    js_string(not),
                    show_exit(actual)
                ))
            } else {
                Ok(())
            };
        }
        if let Some(one) = o.get("oneOf") {
            let list = one.as_array().map(Vec::as_slice).unwrap_or_default();
            return if list.iter().any(|w| exit_eq(actual, w)) {
                Ok(())
            } else {
                Err(format!(
                    "expected exitCode in {}, got {}",
                    json(one),
                    show_exit(actual)
                ))
            };
        }
        if truthy(o.get("any")) {
            return Ok(());
        }
    }
    Err(format!("unknown exitCode expectation {}", json(exp)))
}

/// What a case run produced (the `result` object of corpus.mjs).
#[derive(Debug, Default)]
pub struct RunResult {
    pub temp_dir: PathBuf,
    pub node: String,
    pub sep: String,
    /// `None` when the run failed before producing output (JS `undefined`).
    pub stdout: Option<Vec<u8>>,
    pub stderr: Option<Vec<u8>>,
    pub exit_code: Option<i32>,
    /// The message of the returned error, if any.
    pub error: Option<String>,
    /// outBuffer id -> contents after the run.
    pub buffers: HashMap<String, Vec<u8>>,
}

fn push_if(errs: &mut Vec<String>, label: &str, r: Result<(), String>) {
    if let Err(e) = r {
        errs.push(format!("{label}: {e}"));
    }
}

/// Node's `err.code` for common I/O errors.
fn io_code(e: &io::Error) -> String {
    let code = match e.kind() {
        io::ErrorKind::NotFound => "ENOENT",
        io::ErrorKind::PermissionDenied => "EACCES",
        io::ErrorKind::IsADirectory => "EISDIR",
        io::ErrorKind::NotADirectory => "ENOTDIR",
        io::ErrorKind::InvalidData => "EINVAL",
        _ => return e.to_string(),
    };
    code.to_string()
}

/// Check a result against `case.expect` (`checkExpectations`). Returns the
/// mismatch descriptions (empty = pass).
///
/// - Without `expect.error`, no error may be returned; omitted stdout/stderr
///   mean `""` and an omitted exitCode means `0`.
/// - With `expect.error`, an error must be returned; stdout/stderr/exitCode
///   are only checked when given (against the error's output).
pub fn check_expectations(case: &Value, result: &RunResult) -> Vec<String> {
    let empty = serde_json::Map::new();
    let exp = case
        .get("expect")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let ctx = make_context(
        &result.temp_dir.to_string_lossy(),
        &result.node,
        &result.sep,
    );
    let mut errs = Vec::new();
    let as_text = |b: &Option<Vec<u8>>| {
        b.as_deref()
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default()
    };
    let stdout = as_text(&result.stdout);
    let stderr = as_text(&result.stderr);

    match exp.get("error") {
        Some(want) if *want != Value::Bool(false) => {
            match &result.error {
                None => errs.push(format!(
                    "expected an error to be thrown, but none was (exitCode {}, stdout {}, stderr {})",
                    show_exit(result.exit_code),
                    show(&stdout),
                    show(&stderr)
                )),
                Some(msg) if *want != Value::Bool(true) => {
                    let contains;
                    let expect = match want {
                        Value::String(s) => {
                            contains = serde_json::json!({ "contains": s });
                            &contains
                        }
                        other => other,
                    };
                    if let Err(e) = match_text(msg, Some(expect), &ctx) {
                        errs.push(format!("error message: {e}"));
                    }
                }
                Some(_) => {}
            }
            if exp.contains_key("stdout") {
                push_if(
                    &mut errs,
                    "stdout",
                    match_text(&stdout, exp.get("stdout"), &ctx),
                );
            }
            if exp.contains_key("stderr") {
                push_if(
                    &mut errs,
                    "stderr",
                    match_text(&stderr, exp.get("stderr"), &ctx),
                );
            }
            if let Some(code) = exp.get("exitCode") {
                push_if(&mut errs, "exitCode", match_exit(result.exit_code, code));
            }
        }
        _ => {
            if let Some(msg) = &result.error {
                errs.push(format!("unexpected error thrown: {msg}"));
            } else {
                push_if(
                    &mut errs,
                    "stdout",
                    match_text(&stdout, exp.get("stdout"), &ctx),
                );
                push_if(
                    &mut errs,
                    "stderr",
                    match_text(&stderr, exp.get("stderr"), &ctx),
                );
                let zero = Value::from(0);
                let code = match exp.get("exitCode") {
                    None | Some(Value::Null) => &zero,
                    Some(c) => c,
                };
                push_if(&mut errs, "exitCode", match_exit(result.exit_code, code));
            }
        }
    }

    let base = result.temp_dir.to_string_lossy();
    let full = |rel: &str| PathBuf::from(node_join(&base, &subst(rel, &ctx)));
    if let Some(files) = exp.get("files").and_then(Value::as_object) {
        for (rel, want) in files {
            match fs::read(full(rel)) {
                Ok(bytes) => push_if(
                    &mut errs,
                    &format!("file {rel}"),
                    match_text(&String::from_utf8_lossy(&bytes), Some(want), &ctx),
                ),
                Err(e) => errs.push(format!("file {rel}: cannot read ({})", io_code(&e))),
            }
        }
    }
    for rel in exp
        .get("exists")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let rel = js_string(rel);
        if fs::symlink_metadata(full(&rel)).is_err() {
            errs.push(format!("expected {rel} to exist"));
        }
    }
    for rel in exp
        .get("absent")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let rel = js_string(rel);
        if fs::symlink_metadata(full(&rel)).is_ok() {
            errs.push(format!("expected {rel} to NOT exist"));
        }
    }
    if let Some(types) = exp.get("types").and_then(Value::as_object) {
        for (rel, kind) in types {
            let kind = js_string(kind);
            let Ok(meta) = fs::symlink_metadata(full(rel)) else {
                errs.push(format!(
                    "expected {rel} to be a {kind}, but it does not exist"
                ));
                continue;
            };
            let ft = meta.file_type();
            let actual = if ft.is_symlink() {
                "symlink"
            } else if ft.is_dir() {
                "dir"
            } else if ft.is_file() {
                "file"
            } else {
                "other"
            };
            if actual != kind {
                errs.push(format!("expected {rel} to be a {kind}, got {actual}"));
            }
        }
    }
    if let Some(buffers) = exp.get("buffers").and_then(Value::as_object) {
        for (id, want) in buffers {
            let Some(buf) = result.buffers.get(id) else {
                errs.push(format!("buffer {id} missing"));
                continue;
            };
            let got = String::from_utf8_lossy(buf);
            let got = got.trim_end_matches('\0');
            push_if(
                &mut errs,
                &format!("buffer {id}"),
                match_text(got, Some(want), &ctx),
            );
        }
    }
    errs
}
