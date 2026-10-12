use super::*;

/// Tokens rendered like Bun's lexer debug output (`$.lex` in tests).
fn toks(src: &str) -> Vec<String> {
    let res = lex(src, &[], 0).unwrap();
    assert!(res.errors.is_empty(), "{:?}", res.errors);
    res.tokens
        .iter()
        .map(|t| match t.range() {
            Some((s, e)) => format!("{}:{}", t.tag().name(), &res.strpool[s..e]),
            None => match t {
                Token::Redirect(f) => format!("Redirect:{}", f.bits()),
                Token::VarArgv(n) => format!("VarArgv:{n}"),
                _ => t.tag().name().to_string(),
            },
        })
        .collect()
}

fn errors(src: &str) -> Vec<String> {
    lex(src, &[], 0).unwrap().errors
}

#[test]
fn words_and_operators() {
    assert_eq!(
        toks("echo hi && ls | wc; x"),
        [
            "Text:echo",
            "Delimit",
            "Text:hi",
            "Delimit",
            "DoubleAmpersand",
            "Text:ls",
            "Delimit",
            "Pipe",
            "Text:wc",
            "Delimit",
            "Semicolon",
            "Text:x",
            "Delimit",
            "Eof"
        ]
    );
}

#[test]
fn quotes_and_vars() {
    assert_eq!(
        toks("echo \"a $FOO\"'b'$1"),
        [
            "Text:echo",
            "Delimit",
            "DoubleQuotedText:a ",
            "Var:FOO",
            "SingleQuotedText:b",
            "VarArgv:1",
            "Eof"
        ]
    );
    assert_eq!(toks("\"\""), ["DoubleQuotedText:", "Eof"]);
    assert_eq!(
        toks("echo \\$x"),
        ["Text:echo", "Delimit", "Text:$x", "Delimit", "Eof"]
    );
}

#[test]
fn redirects() {
    assert_eq!(
        toks("a 2>&1 >> f"),
        [
            "Text:a",
            "Delimit",
            "Redirect:18",
            "Redirect:10",
            "Text:f",
            "Delimit",
            "Eof"
        ]
    );
    assert_eq!(toks("a &> f")[2], "Redirect:6");
    assert_eq!(toks("a &>> f")[2], "Redirect:14");
}

#[test]
fn substitutions() {
    assert_eq!(
        toks("echo $(ls)`pwd`"),
        [
            "Text:echo",
            "Delimit",
            "CmdSubstBegin",
            "Text:ls",
            "Delimit",
            "CmdSubstEnd",
            "CmdSubstBegin",
            "Text:pwd",
            "Delimit",
            "CmdSubstEnd",
            "Eof"
        ]
    );
}

#[test]
fn lexer_errors() {
    assert_eq!(errors("echo $(ls"), ["Unclosed command substitution"]);
    assert_eq!(errors("(ls"), ["Unclosed subshell"]);
    assert_eq!(errors("ls )"), ["Unexpected ')'"]);
    assert_eq!(errors("ls |"), ["Unexpected EOF"]);
    assert_eq!(
        errors("ls |& cat"),
        ["Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub."]
    );
    assert_eq!(
        errors("echo \x08__bunstr_0\x08"),
        ["Invalid JS string ref (out of bounds"]
    );
    assert!(lex(&"(".repeat(129), &[], 0).is_err());
}

#[test]
fn js_refs() {
    let refs = vec!["a b".to_string()];
    let res = lex("echo \x08__bunstr_0\x08 \x08__bun_0\x08", &refs, 1).unwrap();
    assert!(res.errors.is_empty());
    assert_eq!(res.js_string_ranges, [(4, 7)]);
    assert_eq!(res.tokens[4], Token::JsObjRef(0));
    let res = lex("\"\x08__bun_0\x08\"", &[], 1).unwrap();
    assert_eq!(
        res.errors,
        ["JS object reference not allowed in double quotes"]
    );
}
