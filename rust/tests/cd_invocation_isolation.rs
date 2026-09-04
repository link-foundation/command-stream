use command_stream::{run, Pipeline};
use std::ffi::OsString;
use std::path::Path;

fn restore_env(name: &str, value: Option<OsString>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

#[tokio::test]
async fn standalone_cd_restores_the_host_process_context() {
    let original_cwd = std::env::current_dir().unwrap();
    let original_pwd = std::env::var_os("PWD");
    let original_oldpwd = std::env::var_os("OLDPWD");
    let temp_dir = tempfile::Builder::new()
        .prefix("cd-isolation-")
        .tempdir_in(&original_cwd)
        .unwrap();
    let cd_target = temp_dir.path().file_name().unwrap().to_string_lossy();

    std::env::set_var("PWD", "host-pwd-sentinel");
    std::env::set_var("OLDPWD", "host-oldpwd-sentinel");

    let result = run(format!("cd {cd_target}")).await.unwrap();
    let observed_cwd = std::env::current_dir().unwrap();
    let observed_pwd = std::env::var_os("PWD");
    let observed_oldpwd = std::env::var_os("OLDPWD");

    std::env::set_current_dir(&original_cwd).unwrap();
    std::env::set_var("PWD", "host-pwd-sentinel");
    std::env::set_var("OLDPWD", "host-oldpwd-sentinel");

    let pipeline_result = Pipeline::new()
        .add(format!("cd {cd_target}"))
        .add("pwd")
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let pipeline_cwd = std::env::current_dir().unwrap();
    let pipeline_pwd = std::env::var_os("PWD");
    let pipeline_oldpwd = std::env::var_os("OLDPWD");

    std::env::set_current_dir(&original_cwd).unwrap();
    restore_env("PWD", original_pwd);
    restore_env("OLDPWD", original_oldpwd);

    assert!(result.is_success());
    assert_eq!(observed_cwd, original_cwd);
    assert_eq!(
        observed_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        observed_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
    assert!(pipeline_result.is_success());
    assert_eq!(
        pipeline_result.stdout.trim(),
        temp_dir.path().to_string_lossy()
    );
    assert_eq!(pipeline_cwd, original_cwd);
    assert_eq!(
        pipeline_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        pipeline_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
}
