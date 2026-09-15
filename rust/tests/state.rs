//! Integration tests for the state module

use command_stream::state::{GlobalState, ShellSettings};

#[test]
fn test_shell_settings_default() {
    let settings = ShellSettings::new();
    assert!(!settings.errexit);
    assert!(!settings.verbose);
    assert!(!settings.xtrace);
    assert!(!settings.pipefail);
    assert!(!settings.nounset);
    assert!(!settings.noglob);
    assert!(!settings.allexport);
}

#[test]
fn test_shell_settings_set_short_flags() {
    let mut settings = ShellSettings::new();

    settings.set("e", true);
    assert!(settings.errexit);

    settings.set("v", true);
    assert!(settings.verbose);

    settings.set("x", true);
    assert!(settings.xtrace);

    settings.set("u", true);
    assert!(settings.nounset);

    settings.set("f", true);
    assert!(settings.noglob);

    settings.set("a", true);
    assert!(settings.allexport);
}

#[test]
fn test_shell_settings_set_long_names() {
    let mut settings = ShellSettings::new();

    settings.set("errexit", true);
    assert!(settings.errexit);

    settings.set("verbose", true);
    assert!(settings.verbose);

    settings.set("xtrace", true);
    assert!(settings.xtrace);

    settings.set("nounset", true);
    assert!(settings.nounset);

    settings.set("pipefail", true);
    assert!(settings.pipefail);
}

#[test]
fn test_shell_settings_enable_disable() {
    let mut settings = ShellSettings::new();

    settings.enable("errexit");
    assert!(settings.errexit);

    settings.disable("errexit");
    assert!(!settings.errexit);
}

#[test]
fn test_shell_settings_reset() {
    let mut settings = ShellSettings::new();

    settings.enable("errexit");
    settings.enable("verbose");
    settings.enable("pipefail");

    settings.reset();

    assert!(!settings.errexit);
    assert!(!settings.verbose);
    assert!(!settings.pipefail);
}

#[tokio::test]
async fn test_global_state_shell_settings() {
    let state = GlobalState::new();

    // Default settings
    let settings = state.get_shell_settings().await;
    assert!(!settings.errexit);

    // Enable option
    state.enable_shell_option("errexit").await;
    let settings = state.get_shell_settings().await;
    assert!(settings.errexit);

    // Disable option
    state.disable_shell_option("errexit").await;
    let settings = state.get_shell_settings().await;
    assert!(!settings.errexit);
}

#[tokio::test]
async fn test_global_state_runner_registration() {
    let state = GlobalState::new();

    assert_eq!(state.active_runner_count().await, 0);

    let id1 = state.register_runner().await;
    assert_eq!(state.active_runner_count().await, 1);

    let id2 = state.register_runner().await;
    assert_eq!(state.active_runner_count().await, 2);

    // IDs should be unique
    assert!(id1 != id2);

    state.unregister_runner(id1).await;
    assert_eq!(state.active_runner_count().await, 1);

    state.unregister_runner(id2).await;
    assert_eq!(state.active_runner_count().await, 0);
}

#[tokio::test]
async fn test_global_state_virtual_commands() {
    let state = GlobalState::new();

    // Enabled by default
    assert!(state.are_virtual_commands_enabled());

    state.disable_virtual_commands();
    assert!(!state.are_virtual_commands_enabled());

    state.enable_virtual_commands();
    assert!(state.are_virtual_commands_enabled());
}

#[tokio::test]
async fn test_global_state_signal_handlers() {
    let state = GlobalState::new();

    // Not installed by default
    assert!(!state.are_signal_handlers_installed());

    state.set_signal_handlers_installed(true);
    assert!(state.are_signal_handlers_installed());

    state.set_signal_handlers_installed(false);
    assert!(!state.are_signal_handlers_installed());
}

#[tokio::test]
async fn test_global_state_reset() {
    let state = GlobalState::new();

    // Modify state
    state.enable_shell_option("errexit").await;
    state.enable_shell_option("pipefail").await;
    state.register_runner().await;
    state.register_runner().await;
    state.disable_virtual_commands();

    // Reset
    state.reset().await;

    // Verify reset
    let settings = state.get_shell_settings().await;
    assert!(!settings.errexit);
    assert!(!settings.pipefail);
    assert_eq!(state.active_runner_count().await, 0);
    assert!(state.are_virtual_commands_enabled());
}

#[tokio::test]
async fn test_global_state_with_shell_settings() {
    let state = GlobalState::new();

    state
        .with_shell_settings(|settings| {
            settings.errexit = true;
            settings.verbose = true;
        })
        .await;

    let settings = state.get_shell_settings().await;
    assert!(settings.errexit);
    assert!(settings.verbose);
}

#[tokio::test]
async fn test_global_state_initial_cwd() {
    let state = GlobalState::new();

    let cwd = state.get_initial_cwd().await;
    // Should have an initial cwd
    assert!(cwd.is_some());
}

#[test]
fn test_global_state_default() {
    let state = GlobalState::default();
    assert!(state.are_virtual_commands_enabled());
    assert!(!state.are_signal_handlers_installed());
}
