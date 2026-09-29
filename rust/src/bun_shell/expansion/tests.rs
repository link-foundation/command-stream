use super::*;
use crate::bun_shell::env::EnvMap;
use crate::bun_shell::interpreter::InterpreterOptions;
use crate::bun_shell::parser::{self, Expr};

/// A quiet interpreter with a tiny, known environment (never the process
/// environment, which may hold credentials).
fn setup(env: &[(&str, &str)]) -> (Interpreter, ShellExecEnv) {
    Interpreter::new(InterpreterOptions {
        jsobjs: Vec::new(),
        env: env.iter().copied().collect::<EnvMap>(),
        cwd: None,
        quiet: true,
        argv: vec!["prog".into(), "first".into()],
    })
    .unwrap()
}

/// The argument atom of `echo <word>`.
fn arg_atom(word: &str) -> Atom {
    let script = parser::parse(&format!("echo {word}"), &[], 0).unwrap();
    match &script.stmts[0].exprs[0] {
        Expr::Cmd(cmd) => cmd.name_and_args[1].clone(),
        other => panic!("not a command: {other:?}"),
    }
}

async fn expand_word(word: &str, env: &[(&str, &str)]) -> Vec<String> {
    let (interp, shell) = setup(env);
    expand_atom(&interp, &shell, &arg_atom(word), ExpandOpts::default())
        .await
        .unwrap()
        .words()
}

#[test]
fn words_split_on_bounds() {
    let e = Expanded {
        buf: "abcde".into(),
        bounds: vec![1, 3],
        ..Default::default()
    };
    assert_eq!(e.words(), ["a", "bc", "de"]);
    assert_eq!(Expanded::default().words(), [""]);
}

#[test]
fn glob_metachars_outside_meta_offsets_are_escaped() {
    assert_eq!(neutralize_glob_metachars("a*b", &[1]), "a*b");
    assert_eq!(neutralize_glob_metachars("a*b", &[]), "a[*]b");
    assert_eq!(neutralize_glob_metachars("!x/!y", &[]), "{!}x/{!}y");
    assert_eq!(neutralize_glob_metachars("a!b", &[]), "a!b");
}

#[test]
fn error_display_matches_bun() {
    assert_eq!(
        ExpandError::Custom("boom".into()).display().unwrap(),
        "bun: boom"
    );
    let fatal = ExpandError::Fatal(ShellError::system("x")).display();
    assert_eq!(fatal.unwrap_err().message, "x");
}

#[tokio::test]
async fn variables_and_positionals() {
    let env = [("GREETING", "hello world")];
    // Like Bun, variables are not word-split.
    assert_eq!(expand_word("$GREETING", &env).await, ["hello world"]);
    assert_eq!(expand_word("\"$GREETING\"", &env).await, ["hello world"]);
    assert_eq!(expand_word("x$MISSING", &env).await, ["x"]);
    assert_eq!(expand_word("$1", &env).await, ["first"]);
    assert_eq!(expand_word("$9", &env).await, [""]);
}

#[tokio::test]
async fn tilde_and_braces() {
    // On Windows `~` expands to $USERPROFILE.
    let env = [("HOME", "/home/me"), ("USERPROFILE", "/home/me")];
    assert_eq!(expand_word("~/x", &env).await, ["/home/me/x"]);
    assert_eq!(expand_word("'~/x'", &env).await, ["~/x"]);
    assert_eq!(expand_word("a{b,c}d", &env).await, ["abd", "acd"]);
}

#[tokio::test]
async fn command_substitution_is_word_split_unless_quoted() {
    assert_eq!(expand_word("$(echo a  b)", &[]).await, ["a", "b"]);
    assert_eq!(expand_word("\"$(echo 'a  b')\"", &[]).await, ["a  b"]);
    assert_eq!(expand_word("`echo x`", &[]).await, ["x"]);
}

#[tokio::test]
async fn glob_with_no_matches_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let (interp, mut shell) = setup(&[]);
    shell
        .change_cwd(&dir.path().to_string_lossy(), true)
        .unwrap();
    let err = expand_atom(&interp, &shell, &arg_atom("*.nope"), ExpandOpts::default())
        .await
        .unwrap_err();
    assert_eq!(err.display().unwrap(), "bun: no matches found: *.nope");
    std::fs::write(dir.path().join("a.txt"), "").unwrap();
    std::fs::write(dir.path().join("b.txt"), "").unwrap();
    let mut words = expand_atom(&interp, &shell, &arg_atom("*.txt"), ExpandOpts::default())
        .await
        .unwrap()
        .words();
    words.sort();
    assert_eq!(words, ["a.txt", "b.txt"]);
}
