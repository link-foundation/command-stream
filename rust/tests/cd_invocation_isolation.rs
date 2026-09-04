use command_stream::{run, Pipeline};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;

fn restore_env(name: &str, value: Option<OsString>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

#[tokio::test]
async fn cd_is_scoped_to_each_invocation() {
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
    std::env::set_var("PWD", "host-pwd-sentinel");
    std::env::set_var("OLDPWD", "host-oldpwd-sentinel");

    let other_temp_dir = tempfile::Builder::new()
        .prefix("cd-isolation-other-")
        .tempdir_in(&original_cwd)
        .unwrap();
    let inherited_home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap();
    let inherited_home = std::fs::canonicalize(inherited_home).unwrap();
    let partial_env = HashMap::from([("ISSUE_197_PARTIAL".to_string(), "present".to_string())]);
    let partial_home = Pipeline::new()
        .add("cd")
        .add("pwd")
        .env(partial_env.clone())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    std::env::set_var("OLDPWD", other_temp_dir.path());
    let partial_dash = Pipeline::new()
        .add("cd -")
        .add("pwd")
        .cwd(temp_dir.path())
        .env(partial_env.clone())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    std::env::set_var("OLDPWD", "host-oldpwd-sentinel");
    let partial_env_result = Pipeline::new()
        .add("env")
        .env(partial_env)
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let first_pipeline = Pipeline::new()
        .add(format!("cd {}", temp_dir.path().display()))
        .add("sleep 0.1")
        .add("pwd")
        .mirror_output(false)
        .run();
    let second_pipeline = Pipeline::new()
        .add(format!("cd {}", other_temp_dir.path().display()))
        .add("sleep 0.2")
        .add("pwd")
        .mirror_output(false)
        .run();
    let observer_pipeline = Pipeline::new()
        .add("sleep 0.05")
        .add("pwd")
        .mirror_output(false)
        .run();
    let (first_result, second_result, observer_result) =
        tokio::join!(first_pipeline, second_pipeline, observer_pipeline);
    let first_result = first_result.unwrap();
    let second_result = second_result.unwrap();
    let observer_result = observer_result.unwrap();
    let concurrent_cwd = std::env::current_dir().unwrap();
    let concurrent_pwd = std::env::var_os("PWD");
    let concurrent_oldpwd = std::env::var_os("OLDPWD");

    let active_pipeline = tokio::spawn(
        Pipeline::new()
            .add(format!("cd {}", temp_dir.path().display()))
            .add("sleep 0.2")
            .mirror_output(false)
            .run(),
    );
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let active_cwd = std::env::current_dir().unwrap();
    let active_pwd = std::env::var_os("PWD");
    let active_oldpwd = std::env::var_os("OLDPWD");
    let active_result = active_pipeline.await.unwrap().unwrap();

    std::env::set_current_dir(&original_cwd).unwrap();
    let configured_dir = tempfile::Builder::new()
        .prefix("cd-configured-cwd-")
        .tempdir_in(&original_cwd)
        .unwrap();
    let nested_dir = configured_dir.path().join("nested");
    std::fs::create_dir(&nested_dir).unwrap();
    std::fs::write(nested_dir.join("marker.txt"), "nested marker").unwrap();

    let configured_pwd = Pipeline::new()
        .add("pwd")
        .cwd(configured_dir.path())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let nested_pwd = Pipeline::new()
        .add("cd nested")
        .add("pwd")
        .cwd(configured_dir.path())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let nested_cat = Pipeline::new()
        .add("cd nested")
        .add("cat marker.txt")
        .cwd(configured_dir.path())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let nested_test = Pipeline::new()
        .add("cd nested")
        .add("test -f marker.txt")
        .cwd(configured_dir.path())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    #[cfg(unix)]
    let nested_real_command = Pipeline::new()
        .add("cd nested")
        .add("/bin/pwd")
        .cwd(configured_dir.path())
        .mirror_output(false)
        .run()
        .await
        .unwrap();

    let configured_env = HashMap::from([
        (
            "HOME".to_string(),
            other_temp_dir.path().to_string_lossy().to_string(),
        ),
        ("PWD".to_string(), "configured-pwd-sentinel".to_string()),
        (
            "OLDPWD".to_string(),
            other_temp_dir.path().to_string_lossy().to_string(),
        ),
    ]);
    let configured_home = Pipeline::new()
        .add("cd")
        .add("pwd")
        .env(configured_env.clone())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let configured_dash = Pipeline::new()
        .add("cd -")
        .add("pwd")
        .cwd(temp_dir.path())
        .env(configured_env.clone())
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    #[cfg(unix)]
    let configured_child_env = Pipeline::new()
        .add(format!("cd {}", other_temp_dir.path().display()))
        .add("/usr/bin/env")
        .cwd(temp_dir.path())
        .env(configured_env.clone())
        .mirror_output(false)
        .run()
        .await
        .unwrap();

    std::env::set_current_dir(&original_cwd).unwrap();
    std::env::set_var("PWD", "host-pwd-sentinel");
    std::env::set_var("OLDPWD", "host-oldpwd-sentinel");
    let failed_pipeline = Pipeline::new()
        .add(format!("cd {}", temp_dir.path().display()))
        .add("false")
        .mirror_output(false)
        .run()
        .await
        .unwrap();
    let failed_cwd = std::env::current_dir().unwrap();
    let failed_pwd = std::env::var_os("PWD");
    let failed_oldpwd = std::env::var_os("OLDPWD");

    let cancelled_pipeline = tokio::time::timeout(
        std::time::Duration::from_millis(25),
        Pipeline::new()
            .add(format!("cd {}", temp_dir.path().display()))
            .add("sleep 0.2")
            .mirror_output(false)
            .run(),
    )
    .await;
    let cancelled_cwd = std::env::current_dir().unwrap();
    let cancelled_pwd = std::env::var_os("PWD");
    let cancelled_oldpwd = std::env::var_os("OLDPWD");

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
    assert!(first_result.is_success());
    assert_eq!(
        first_result.stdout.trim(),
        temp_dir.path().to_string_lossy()
    );
    assert!(second_result.is_success());
    assert_eq!(
        second_result.stdout.trim(),
        other_temp_dir.path().to_string_lossy()
    );
    assert!(observer_result.is_success());
    assert_eq!(
        observer_result.stdout.trim(),
        original_cwd.to_string_lossy()
    );
    assert_eq!(concurrent_cwd, original_cwd);
    assert_eq!(
        concurrent_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        concurrent_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
    assert!(active_result.is_success());
    assert_eq!(active_cwd, original_cwd);
    assert_eq!(
        active_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        active_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
    assert!(partial_home.is_success());
    assert_eq!(partial_home.stdout.trim(), inherited_home.to_string_lossy());
    assert!(partial_dash.is_success());
    assert_eq!(
        partial_dash.stdout.trim(),
        other_temp_dir.path().to_string_lossy()
    );
    assert!(partial_env_result.is_success());
    assert!(partial_env_result
        .stdout
        .contains("ISSUE_197_PARTIAL=present\n"));
    assert!(partial_env_result.stdout.contains("HOME="));
    assert!(configured_pwd.is_success());
    assert_eq!(
        configured_pwd.stdout.trim(),
        configured_dir.path().to_string_lossy()
    );
    assert!(nested_pwd.is_success());
    assert_eq!(nested_pwd.stdout.trim(), nested_dir.to_string_lossy());
    assert!(nested_cat.is_success());
    assert_eq!(nested_cat.stdout, "nested marker");
    assert!(nested_test.is_success());
    #[cfg(unix)]
    {
        assert!(nested_real_command.is_success());
        assert_eq!(
            nested_real_command.stdout.trim(),
            nested_dir.to_string_lossy()
        );
    }
    assert!(configured_home.is_success());
    assert_eq!(
        configured_home.stdout.trim(),
        other_temp_dir.path().to_string_lossy()
    );
    assert!(configured_dash.is_success());
    assert_eq!(
        configured_dash.stdout.trim(),
        other_temp_dir.path().to_string_lossy()
    );
    #[cfg(unix)]
    {
        assert!(configured_child_env.is_success());
        assert!(configured_child_env
            .stdout
            .contains(&format!("PWD={}\n", other_temp_dir.path().display())));
        assert!(configured_child_env
            .stdout
            .contains(&format!("OLDPWD={}\n", temp_dir.path().display())));
    }
    assert_eq!(
        configured_env.get("PWD").map(String::as_str),
        Some("configured-pwd-sentinel")
    );
    assert_eq!(failed_pipeline.code, 1);
    assert_eq!(failed_cwd, original_cwd);
    assert_eq!(
        failed_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        failed_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
    assert!(cancelled_pipeline.is_err());
    assert_eq!(cancelled_cwd, original_cwd);
    assert_eq!(
        cancelled_pwd.as_deref(),
        Some(Path::new("host-pwd-sentinel").as_os_str())
    );
    assert_eq!(
        cancelled_oldpwd.as_deref(),
        Some(Path::new("host-oldpwd-sentinel").as_os_str())
    );
}
