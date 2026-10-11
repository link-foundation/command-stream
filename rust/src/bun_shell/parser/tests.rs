use super::*;
use serde_json::{json, Value};

/// The AST in the JSON shape the JavaScript parser produces.
pub(crate) fn script_json(s: &Script) -> Value {
    json!({ "stmts": s.stmts.iter().map(stmts_json).collect::<Vec<_>>() })
}

fn stmts_json(s: &Stmt) -> Value {
    json!({ "exprs": s.exprs.iter().map(expr_json).collect::<Vec<_>>() })
}

fn stmt_list_json(s: &[Stmt]) -> Value {
    Value::Array(s.iter().map(stmts_json).collect())
}

fn assign_json(a: &Assign) -> Value {
    json!({ "label": a.label, "value": atom_json(&a.value) })
}

fn redirect_json(r: &Option<Redirect>) -> Value {
    match r {
        None => Value::Null,
        Some(Redirect::JsBuf(idx)) => json!({ "type": "jsbuf", "idx": idx }),
        Some(Redirect::Atom(a)) => json!({ "type": "atom", "atom": atom_json(a) }),
    }
}

fn expr_json(e: &Expr) -> Value {
    match e {
        Expr::Assign(a) => {
            json!({ "type": "assign", "assigns": a.iter().map(assign_json).collect::<Vec<_>>() })
        }
        Expr::Binary(b) => json!({
            "type": "binary",
            "op": b.op.as_str(),
            "left": expr_json(&b.left),
            "right": expr_json(&b.right),
        }),
        Expr::Pipeline(items) => {
            json!({ "type": "pipeline", "items": items.iter().map(expr_json).collect::<Vec<_>>() })
        }
        Expr::Cmd(c) => json!({
            "type": "cmd",
            "assigns": c.assigns.iter().map(assign_json).collect::<Vec<_>>(),
            "nameAndArgs": c.name_and_args.iter().map(atom_json).collect::<Vec<_>>(),
            "redirectFile": redirect_json(&c.redirect_file),
            "redirect": c.redirect.bits(),
        }),
        Expr::Subshell(s) => json!({
            "type": "subshell",
            "script": script_json(&s.script),
            "redirect": redirect_json(&s.redirect),
            "redirectFlags": s.redirect_flags.bits(),
        }),
        Expr::If(i) => json!({
            "type": "if",
            "cond": stmt_list_json(&i.cond),
            "then": stmt_list_json(&i.then),
            "elseParts": i.else_parts.iter().map(|p| stmt_list_json(p)).collect::<Vec<_>>(),
        }),
        Expr::CondExpr(c) => json!({
            "type": "condexpr",
            "op": c.op.as_str(),
            "args": c.args.iter().map(atom_json).collect::<Vec<_>>(),
        }),
    }
}

fn simple_json(a: &SimpleAtom) -> Value {
    match a {
        SimpleAtom::Var(name) => json!({ "t": "Var", "name": name }),
        SimpleAtom::VarArgv(n) => json!({ "t": "VarArgv", "n": n }),
        SimpleAtom::Text(text) => json!({ "t": "Text", "text": text }),
        SimpleAtom::QuotedEmpty => json!({ "t": "QuotedEmpty" }),
        SimpleAtom::Asterisk => json!({ "t": "Asterisk" }),
        SimpleAtom::DoubleAsterisk => json!({ "t": "DoubleAsterisk" }),
        SimpleAtom::BraceBegin => json!({ "t": "BraceBegin" }),
        SimpleAtom::BraceEnd => json!({ "t": "BraceEnd" }),
        SimpleAtom::Comma => json!({ "t": "Comma" }),
        SimpleAtom::Tilde => json!({ "t": "Tilde" }),
        SimpleAtom::CmdSubst(c) => {
            json!({ "t": "CmdSubst", "script": script_json(&c.script), "quoted": c.quoted })
        }
    }
}

fn atom_json(a: &Atom) -> Value {
    match a {
        Atom::Simple(s) => json!({ "type": "simple", "atom": simple_json(s) }),
        Atom::Compound(c) => json!({
            "type": "compound",
            "atoms": c.atoms.iter().map(simple_json).collect::<Vec<_>>(),
            "braceExpansionHint": c.brace_expansion_hint,
            "globHint": c.glob_hint,
        }),
    }
}

fn p(src: &str) -> Script {
    parse(src, &[], 0).unwrap_or_else(|e| panic!("{src:?}: {e}"))
}

fn err(src: &str) -> String {
    parse(src, &[], 0).expect_err(src)
}

fn text(s: &str) -> Atom {
    Atom::Simple(SimpleAtom::Text(s.to_string()))
}

fn only_expr(s: Script) -> Expr {
    assert_eq!(s.stmts.len(), 1);
    let mut exprs = s.stmts.into_iter().next().unwrap().exprs;
    assert_eq!(exprs.len(), 1);
    exprs.pop().unwrap()
}

#[test]
fn empty_script() {
    assert_eq!(p("").stmts, []);
    assert_eq!(p("   ").stmts.len(), 0);
}

#[test]
fn simple_command() {
    let Expr::Cmd(cmd) = only_expr(p("FOO=1 echo hi \"a b\" > out.txt")) else {
        panic!()
    };
    assert_eq!(cmd.assigns[0].label, "FOO");
    assert_eq!(cmd.assigns[0].value, text("1"));
    assert_eq!(cmd.name_and_args, [text("echo"), text("hi"), text("a b")]);
    assert_eq!(cmd.redirect, RedirectFlags::STDOUT);
    assert_eq!(cmd.redirect_file, Some(Redirect::Atom(text("out.txt"))));
}

#[test]
fn binary_and_pipeline() {
    let Expr::Binary(b) = only_expr(p("a | b && c || d")) else {
        panic!()
    };
    assert_eq!(b.op, BinaryOp::Or);
    let Expr::Binary(inner) = &b.left else {
        panic!()
    };
    assert_eq!(inner.op, BinaryOp::And);
    assert!(matches!(&inner.left, Expr::Pipeline(items) if items.len() == 2));
}

#[test]
fn words_and_atoms() {
    let Expr::Cmd(cmd) = only_expr(p("echo ~/x *.txt {a,b}c $1 \"\" $(ls) `pwd`")) else {
        panic!()
    };
    let args = &cmd.name_and_args;
    assert_eq!(
        args[1].atoms(),
        [SimpleAtom::Tilde, SimpleAtom::Text("/x".into())]
    );
    assert!(args[2].has_glob_expansion());
    assert!(args[3].has_brace_expansion());
    assert_eq!(args[4], Atom::Simple(SimpleAtom::VarArgv(1)));
    assert_eq!(args[5], Atom::Simple(SimpleAtom::QuotedEmpty));
    assert!(matches!(&args[6], Atom::Simple(SimpleAtom::CmdSubst(c)) if !c.quoted));
    assert_eq!(args.len(), 8);
}

#[test]
fn if_clause() {
    let Expr::If(i) = only_expr(p("if a; then b; elif c; then d; else e; fi")) else {
        panic!()
    };
    assert_eq!(i.cond.len(), 1);
    assert_eq!(i.then.len(), 1);
    assert_eq!(i.else_parts.len(), 3);
}

#[test]
fn cond_expr_and_subshell() {
    let Expr::CondExpr(c) = only_expr(p("[[ -f foo ]]")) else {
        panic!()
    };
    assert_eq!((c.op, c.args.len()), (CondExprOp::IsFile, 1));
    let Expr::CondExpr(c) = only_expr(p("[[ $a == b ]]")) else {
        panic!()
    };
    assert_eq!((c.op, c.args.len()), (CondExprOp::Eq, 2));
    assert!(matches!(only_expr(p("(a; b)")), Expr::Subshell(s) if s.script.stmts.len() == 2));
}

#[test]
fn assignments_and_redirect_buffers() {
    assert!(matches!(only_expr(p("A=1 B=\"x\"$y")), Expr::Assign(a) if a.len() == 2));
    let script = parse("cat < \x08__bun_0\x08", &[], 1).unwrap();
    let Expr::Cmd(cmd) = only_expr(script) else {
        panic!()
    };
    assert_eq!(cmd.redirect_file, Some(Redirect::JsBuf(0)));
    let Expr::Cmd(cmd) = only_expr(p("a 2>&1")) else {
        panic!()
    };
    assert_eq!(cmd.redirect_file, None);
    assert!(cmd.redirect.contains(RedirectFlags::DUPLICATE_OUT));
}

#[test]
fn interpolated_keywords_are_words() {
    let strings = vec!["if".to_string()];
    let script = parse("echo \x08__bunstr_0\x08", &strings, 0).unwrap();
    assert!(matches!(only_expr(script), Expr::Cmd(_)));
    let script = parse("\x08__bunstr_0\x08 a; then b; fi", &strings, 0).unwrap();
    assert_eq!(script.stmts.len(), 3);
    assert!(script
        .stmts
        .iter()
        .all(|s| matches!(s.exprs.as_slice(), [Expr::Cmd(_)])));
}

#[test]
fn error_messages() {
    assert_eq!(
        err("echo hi &"),
        "Background commands \"&\" are not supported yet."
    );
    assert_eq!(err("echo >"), "Redirection with no file");
    assert_eq!(
        err("(echo) > f"),
        "Subshells with redirections are currently not supported. Please open a GitHub issue."
    );
    assert_eq!(err("if a; b; fi"), "Expected \"then\" but got: Eof");
    assert_eq!(
        err("if a; then b"),
        "Expected \"else\", \"elif\", or \"fi\" but got: Eof"
    );
    assert_eq!(
        err("[[ -q x ]]"),
        "Unknown conditional expression operation: -q"
    );
    assert_eq!(
        err("[[ -e x ]]"),
        "Conditional expression operation: -e, is not supported right now. Please open a GitHub issue if you would like it to be supported."
    );
    assert_eq!(err("[[ -f ]]"), "Expected a word, but got: ]]");
    assert_eq!(err("[[ a == b"), "Expected \"]]\" but got: EOF");
    assert_eq!(err("echo a (b)"), "Unexpected token: `(`");
    assert_eq!(err("echo a | ;"), "expected a command or assignment");
    assert_eq!(
        err("echo | &&"),
        "expected a command or assignment but got: \"DoubleAmpersand\""
    );
    assert_eq!(err("echo $(ls"), "Unclosed command substitution");
    assert_eq!(err("ls )\nls |"), "Unexpected ')'\nUnexpected EOF");
    assert_eq!(
        err(&"(".repeat(200)),
        "failed to lex/parse shell: Subshell nesting depth exceeded"
    );
}

#[test]
fn deep_nesting_is_an_error_not_a_crash() {
    let ifs = |n: usize| format!("{}b{}", "if a; then ".repeat(n), "; fi".repeat(n));
    assert!(parse(&ifs(2000), &[], 0).is_ok());
    assert_eq!(err(&ifs(2049)), "Maximum call stack size exceeded");
    let substs = format!("{}b{}", "$(".repeat(128), ")".repeat(128));
    assert!(parse(&substs, &[], 0).is_ok());
    let mixed = format!("{}{}{}", "(".repeat(60), ifs(1900), ")".repeat(60));
    assert!(parse(&mixed, &[], 0).is_ok());
}

/// Decode one value from the prefix-order specs of the diff script (an
/// array is `{"array": len}` followed by its items).
fn value_from_spec<'a>(
    specs: &mut impl Iterator<Item = &'a Value>,
) -> crate::bun_shell::ShellValue {
    use crate::bun_shell::ShellValue;
    let spec = specs.next().expect("value spec");
    let field = |k: &str| spec.get(k);
    if spec.is_null() {
        ShellValue::Null
    } else if let Some(s) = field("str") {
        ShellValue::Str(s.as_str().unwrap().to_string())
    } else if let Some(s) = field("raw") {
        ShellValue::Raw(s.as_str().unwrap().to_string())
    } else if let Some(n) = field("num") {
        ShellValue::Number(match n.as_str() {
            Some("NaN") => f64::NAN,
            Some("Infinity") => f64::INFINITY,
            Some("-Infinity") => f64::NEG_INFINITY,
            Some("-0") => -0.0,
            _ => n.as_f64().unwrap(),
        })
    } else if let Some(s) = field("bigint") {
        ShellValue::BigInt(s.as_str().unwrap().to_string())
    } else if let Some(b) = field("bool") {
        ShellValue::Bool(b.as_bool().unwrap())
    } else if field("undefined").is_some() {
        ShellValue::Undefined
    } else if let Some(len) = field("array") {
        ShellValue::Array(
            (0..len.as_u64().unwrap())
                .map(|_| value_from_spec(specs))
                .collect(),
        )
    } else if let Some(bytes) = field("bytes") {
        ShellValue::Bytes(
            bytes
                .as_array()
                .unwrap()
                .iter()
                .map(|b| b.as_u64().unwrap() as u8)
                .collect(),
        )
    } else {
        panic!("unknown value spec {spec}")
    }
}

fn strings_of(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

/// Differential test hook for `experiments/issue-27/rust-frontend-diff.mjs`.
/// Reads JSON lines from the file named by `BUN_SHELL_PARSE_IN`, each one
/// of `{"script", "jsstrings", "jsobjsLen"}` (parse only),
/// `{"strings", "values"}` (template builder, then parse) or
/// `{"braces"}` (brace expansion), and writes one JSON result per line to
/// `BUN_SHELL_PARSE_OUT`.
#[test]
#[ignore]
fn dump_parse_results() {
    std::thread::Builder::new()
        .stack_size(512 * 1024 * 1024)
        .spawn(dump_parse_results_impl)
        .unwrap()
        .join()
        .unwrap();
}

fn dump_parse_results_impl() {
    use crate::bun_shell::template::build_shell_source;
    let input = std::env::var("BUN_SHELL_PARSE_IN").expect("BUN_SHELL_PARSE_IN");
    let output = std::env::var("BUN_SHELL_PARSE_OUT").expect("BUN_SHELL_PARSE_OUT");
    let mut out = String::new();
    for line in std::fs::read_to_string(input).unwrap().lines() {
        let case: Value = serde_json::from_str(line).unwrap();
        let result = if let Some(pattern) = case.get("braces") {
            match crate::bun_shell::braces::braces(pattern.as_str().unwrap()) {
                Ok(words) => json!({ "words": words }),
                Err(e) => json!({ "error": e.to_string() }),
            }
        } else if let Some(strings) = case.get("strings") {
            let strings = strings_of(strings);
            let strings: Vec<&str> = strings.iter().map(String::as_str).collect();
            let mut specs = case["values"].as_array().unwrap().iter().peekable();
            let mut values = Vec::new();
            while specs.peek().is_some() {
                values.push(value_from_spec(&mut specs));
            }
            match build_shell_source(&strings, values) {
                Err(e) => json!({ "error": e }),
                Ok(src) => {
                    let parsed = match parse(&src.script, &src.jsstrings, src.jsobjs.len()) {
                        Ok(ast) => json!({ "ast": script_json(&ast) }),
                        Err(e) => json!({ "error": e }),
                    };
                    json!({
                        "script": src.script,
                        "jsstrings": src.jsstrings,
                        "jsobjsLen": src.jsobjs.len(),
                        "parsed": parsed,
                    })
                }
            }
        } else {
            match parse(
                case["script"].as_str().unwrap(),
                &strings_of(&case["jsstrings"]),
                case["jsobjsLen"].as_u64().unwrap() as usize,
            ) {
                Ok(ast) => json!({ "ast": script_json(&ast) }),
                Err(e) => json!({ "error": e }),
            }
        };
        out.push_str(&result.to_string());
        out.push('\n');
    }
    std::fs::write(output, out).unwrap();
}
