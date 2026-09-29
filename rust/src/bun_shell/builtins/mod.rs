//! Builtin dispatch: Bun's `Builtin::call_impl` switch
//! (`src/runtime/shell/Builtin.rs`; MIT, Copyright (c) Oven-sh / Jarred
//! Sumner), ported by way of the `SMALL_BUILTINS` table in
//! `js/src/bun-shell/builtin.mjs` and `js/src/bun-shell/builtins/*.mjs`.
//!
//! # Adding a builtin
//!
//! Every builtin is an async function
//!
//! ```ignore
//! pub(crate) async fn my_builtin(b: &mut Builtin<'_>) -> i32
//! ```
//!
//! that reads `b.args` (the arguments after argv\[0\]), `b.shell` (cwd and
//! environment) and `b.stdin`, writes with `b.write(Which::Stdout, ..)` /
//! [`Builtin::write_failing_error`] / [`Builtin::fail_parse`], and returns
//! the exit code. To register one (e.g. `ls`):
//!
//! 1. put it in `builtins/ls.rs` and add `mod ls;` below;
//! 2. route its [`BuiltinKind`] to it in [`run`];
//! 3. return `true` for it from [`implemented`].
//!
//! Kinds that are not implemented yet are still recognised by
//! [`BuiltinKind::from_argv0`]; the interpreter checks [`implemented`] and
//! runs the external command of the same name instead.

use super::builtin::{Builtin, BuiltinKind};
use super::io::Which;

mod cat;
mod cp;
pub(crate) mod small;

/// Whether the Rust port implements `kind` (see the module docs).
pub(crate) fn implemented(kind: BuiltinKind) -> bool {
    !matches!(
        kind,
        BuiltinKind::Ls
            | BuiltinKind::Rm
            | BuiltinKind::Mkdir
            | BuiltinKind::Touch
            | BuiltinKind::Mv
    )
}

/// Run the builtin and return its exit code. Its stdout/stderr writers are
/// left open; the caller drops the [`Builtin`] (closing its references) once
/// this resolves.
pub(crate) async fn run(b: &mut Builtin<'_>) -> i32 {
    match b.kind {
        BuiltinKind::Echo => small::echo(b).await,
        BuiltinKind::Exit => small::exit(b).await,
        BuiltinKind::True => 0,
        BuiltinKind::False => 1,
        BuiltinKind::Pwd => small::pwd(b).await,
        BuiltinKind::Cd => small::cd(b).await,
        BuiltinKind::Export => small::export(b).await,
        BuiltinKind::Basename => small::basename(b).await,
        BuiltinKind::Dirname => small::dirname(b).await,
        BuiltinKind::Yes => small::yes(b).await,
        BuiltinKind::Seq => small::seq(b).await,
        BuiltinKind::Which => small::which(b).await,
        BuiltinKind::Cat => cat::cat(b).await,
        BuiltinKind::Cp => cp::cp(b).await,
        BuiltinKind::Ls
        | BuiltinKind::Rm
        | BuiltinKind::Mkdir
        | BuiltinKind::Touch
        | BuiltinKind::Mv => {
            let msg = b.fmt_err("not implemented\n");
            let _ = b.write(Which::Stderr, msg).await;
            1
        }
    }
}
