//! Runs the language-neutral Bun Shell conformance corpus
//! (`conformance/bun-shell/cases/*.json`) against `command_stream::bun_shell`.
//!
//! The corpus helpers (`corpus.mjs`) and the runner flow (`runner.mjs`) are
//! ported in `bun_shell_conformance/`. Run the whole corpus with
//!
//! ```sh
//! cargo test --test bun_shell_conformance -- --ignored --nocapture
//! BUN_SHELL_FILE=commands-echo BUN_SHELL_FILTER=basic \
//!     cargo test --test bun_shell_conformance -- --ignored --nocapture
//! ```
//!
//! (see `bun_shell_conformance/runner.rs` for all environment variables).
//! The checker itself is covered by the non-ignored unit tests.

#[path = "bun_shell_conformance/corpus.rs"]
mod corpus;
#[path = "bun_shell_conformance/runner.rs"]
mod runner;
#[path = "bun_shell_conformance/unit.rs"]
mod unit;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "bun_shell interpreter not complete yet"]
async fn bun_shell_conformance_corpus() {
    let counts = runner::run_corpus(runner::Options::from_env()).await;
    assert_eq!(
        counts.fail, 0,
        "{} conformance case(s) failed (see the FAIL lines above)",
        counts.fail
    );
}
