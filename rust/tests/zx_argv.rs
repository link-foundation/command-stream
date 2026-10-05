//! Port of zx `parseArgv` (`test/goods.test.ts`) and the minimist vectors
//! used by the JS port, for `command_stream::zx::argv`.

use std::sync::Mutex;

use command_stream::zx::{minimist, parse_argv, ArgvOptions};
use serde_json::json;

fn zx_cli_opts() -> ArgvOptions {
    ArgvOptions::new()
        .string(&["shell", "prefix", "postfix", "eval", "cwd", "ext", "env"])
        .boolean(&[
            "version",
            "help",
            "quiet",
            "verbose",
            "install",
            "repl",
            "experimental",
            "prefer-local",
        ])
        .alias("e", &["eval"])
        .alias("i", &["install"])
        .alias("v", &["version"])
        .alias("h", &["help"])
        .alias("l", &["prefer-local"])
        .alias("env-file", &["env"])
        .default_value("prefer-local", false)
        .stop_early()
}

// zx:test/goods.test.ts:291:5:registration
#[test]
fn parse_argv_works() {
    let args = [
        "--foo-bar",
        "baz",
        "-a",
        "5",
        "-a",
        "42",
        "--aaa",
        "AAA",
        "--force",
        "./some.file",
        "--b1",
        "true",
        "--b2",
        "false",
        "--b3",
        "--b4",
        "false",
        "--b5",
        "true",
        "--b6",
        "str",
    ];
    let opts = ArgvOptions::new()
        .boolean(&["force", "b3", "b4", "b5", "b6"])
        .camel_case()
        .parse_boolean()
        .alias("a", &["aaa"]);
    assert_eq!(
        parse_argv(&args, &opts, Some(json!({"def": "def"}))),
        json!({
            "a": [5, 42, "AAA"],
            "aaa": [5, 42, "AAA"],
            "fooBar": "baz",
            "force": true,
            "_": ["./some.file", "str"],
            "b1": true,
            "b2": false,
            "b3": true,
            "b4": false,
            "b5": true,
            "b6": true,
            "def": "def",
        })
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist canonical example)
#[test]
fn minimist_canonical_example() {
    let args = [
        "--foo",
        "bar",
        "-a",
        "5",
        "-a",
        "42",
        "--force",
        "./some.file",
    ];
    assert_eq!(
        minimist(&args, &ArgvOptions::new().boolean(&["force"])),
        json!({"a": [5, 42], "foo": "bar", "force": true, "_": ["./some.file"]})
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist short groups)
#[test]
fn minimist_short_groups_numbers_and_key_value() {
    let args = [
        "-x",
        "3",
        "-y",
        "4",
        "-n5",
        "-abc",
        "--beep=boop",
        "foo",
        "bar",
        "10",
    ];
    assert_eq!(
        minimist(&args, &ArgvOptions::new()),
        json!({
            "_": ["foo", "bar", 10],
            "x": 3, "y": 4, "n": 5,
            "a": true, "b": true, "c": true,
            "beep": "boop",
        })
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist negation and dotted keys)
#[test]
fn minimist_negation_and_dotted_keys() {
    assert_eq!(
        minimist(&["--no-foo", "--a.b=1", "--a.c", "x"], &ArgvOptions::new()),
        json!({"_": [], "foo": false, "a": {"b": 1, "c": "x"}})
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist strings)
#[test]
fn minimist_declared_strings_stay_strings() {
    let opts = ArgvOptions::new().string(&["num", "s"]);
    assert_eq!(
        minimist(&["--num", "007", "-s", "--hex", "0x10"], &opts),
        json!({"_": [], "num": "007", "s": "", "hex": 16})
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist booleans)
#[test]
fn minimist_booleans() {
    let opts = ArgvOptions::new().boolean(&["verbose", "q"]);
    assert_eq!(
        minimist(&["--verbose", "file.mjs", "-q", "x"], &opts),
        json!({"_": ["file.mjs", "x"], "verbose": true, "q": true})
    );
    assert_eq!(
        minimist(
            &["--a", "x", "--b=false"],
            &ArgvOptions::new().all_boolean()
        ),
        json!({"_": ["x"], "a": true, "b": "false"})
    );
    let opts = ArgvOptions::new().boolean(&["debug", "v"]);
    assert_eq!(
        minimist(&["--debug", "false", "-v", "true"], &opts),
        json!({"_": [], "debug": false, "v": true})
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist aliases and defaults)
#[test]
fn minimist_aliases_and_defaults() {
    let opts = ArgvOptions::new()
        .alias("o", &["output"])
        .alias("l", &["level", "lvl"]);
    assert_eq!(
        minimist(&["-o", "out.txt", "--level", "2"], &opts),
        json!({"_": [], "o": "out.txt", "output": "out.txt", "level": 2, "l": 2, "lvl": 2})
    );
    let opts = ArgvOptions::new()
        .default_value("port", 8080)
        .default_value("host", "localhost")
        .default_value("a.b", 1)
        .alias("host", &["H"]);
    assert_eq!(
        minimist(&["--port", "80"], &opts),
        json!({"_": [], "port": 80, "host": "localhost", "H": "localhost", "a": {"b": 1}})
    );
}

// zx:test/goods.test.ts:291:5:registration (minimist stopEarly and --)
#[test]
fn minimist_stop_early_and_double_dash() {
    let opts = ArgvOptions::new().boolean(&["a"]).stop_early();
    assert_eq!(
        minimist(&["--a", "x", "script.mjs", "--b", "-c"], &opts),
        json!({"_": ["x", "script.mjs", "--b", "-c"], "a": true})
    );
    let args = ["--a", "1", "--", "--b", "c"];
    assert_eq!(
        minimist(&args, &ArgvOptions::new()),
        json!({"_": ["--b", "c"], "a": 1})
    );
    assert_eq!(
        minimist(&args, &ArgvOptions::new().double_dash()),
        json!({"_": [], "a": 1, "--": ["--b", "c"]})
    );
}

static SEEN: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn reject_unknown(arg: &str) -> bool {
    SEEN.lock().unwrap().push(arg.to_string());
    false
}

// zx:test/goods.test.ts:291:5:registration (minimist unknown callback)
#[test]
fn minimist_unknown_drops_undeclared() {
    let opts = ArgvOptions::new()
        .string(&["known"])
        .unknown(reject_unknown);
    assert_eq!(
        minimist(&["--known", "v", "--other=1", "pos"], &opts),
        json!({"_": [], "known": "v"})
    );
    assert_eq!(*SEEN.lock().unwrap(), ["--other=1", "pos"]);
}

// zx:test/goods.test.ts:291:5:registration (minimist unsafe keys)
#[test]
fn minimist_ignores_prototype_keys() {
    assert_eq!(
        minimist(
            &["--__proto__.polluted=1", "--constructor=x"],
            &ArgvOptions::new()
        ),
        json!({"_": []})
    );
}

// zx:test/goods.test.ts:291:5:registration (zx cli options)
#[test]
fn zx_cli_options() {
    let opts = zx_cli_opts();
    let argv = minimist(&["script.mjs", "--foo", "bar"], &opts);
    assert_eq!(argv["_"], json!(["script.mjs", "--foo", "bar"]));
    for key in [
        "help",
        "h",
        "version",
        "v",
        "install",
        "i",
        "prefer-local",
        "l",
    ] {
        assert_eq!(argv[key], json!(false), "{key}");
    }

    let argv = minimist(&["-i", "-l", "script.mjs", "-v"], &opts);
    for key in ["install", "i", "prefer-local", "l"] {
        assert_eq!(argv[key], json!(true), "{key}");
    }
    assert_eq!(argv["v"], json!(false));
    assert_eq!(argv["_"], json!(["script.mjs", "-v"]));

    let argv = minimist(&["-e", "1 + 1", "--env-file=.env.local"], &opts);
    assert_eq!(argv["eval"], "1 + 1");
    assert_eq!(argv["e"], "1 + 1");
    assert_eq!(argv["env"], ".env.local");
    assert_eq!(argv["env-file"], ".env.local");
}
