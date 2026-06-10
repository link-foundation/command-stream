//! Regression test for issue #44: "getcwd() failed" error.
//!
//! When the current working directory has been deleted or becomes inaccessible
//! (common in CI/CD with temporary directories), inheriting it would make the
//! OS-level spawn fail. Command execution must degrade gracefully by falling
//! back to a valid directory instead of crashing.
//!
//! This test lives in its own integration-test binary so that mutating the
//! process-global working directory cannot race with other tests.

use command_stream::commands::{disable_virtual_commands, enable_virtual_commands};
use command_stream::run;
use std::env;
use std::fs;

#[tokio::test]
async fn command_runs_even_when_working_directory_was_deleted() {
    let start_dir = env::current_dir().expect("should have a valid start dir");

    // Force a real OS-level spawn instead of an in-process virtual command, so
    // the test exercises the code path that breaks when the working directory
    // has been deleted.
    disable_virtual_commands();

    // Create a temporary directory, switch into it, then delete it so the
    // process is left with a working directory that no longer exists.
    let tmp = env::temp_dir().join(format!("getcwd-test-{}", std::process::id()));
    fs::create_dir_all(&tmp).expect("create temp dir");
    env::set_current_dir(&tmp).expect("chdir into temp dir");

    // Some platforms (notably Windows) lock the current working directory and
    // refuse to delete it. In that case the "deleted working directory"
    // scenario cannot be reproduced, so restore state and skip the test rather
    // than report a spurious failure.
    if fs::remove_dir_all(&tmp).is_err() {
        let _ = env::set_current_dir(&start_dir);
        enable_virtual_commands();
        eprintln!("skipping: platform does not allow deleting the current working directory");
        return;
    }

    // Running a command must still succeed even though the inherited working
    // directory is gone.
    let result = run("echo deleted dir").await;

    // Restore a valid directory and the default virtual-command state before
    // asserting so a panic does not leave the process stranded.
    let _ = env::set_current_dir(&start_dir);
    enable_virtual_commands();

    let result = result.expect("command should run despite deleted working dir");
    assert!(result.is_success(), "exit code should be 0: {:?}", result);
    assert!(
        result.stdout.contains("deleted dir"),
        "unexpected stdout: {:?}",
        result.stdout
    );
}
