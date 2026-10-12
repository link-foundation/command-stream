use std::fs;
use std::path::PathBuf;

use command_stream::{ProcessRunner, RunOptions, StreamingRunner};

#[tokio::test]
async fn default_runner_resolves_project_local_command() {
    let dir = std::env::temp_dir().join(format!(
        "command-stream-local-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let bin = dir.join("node_modules").join(".bin");
    fs::create_dir_all(&bin).unwrap();
    let name = "command-stream-local-only";
    let executable = bin.join(if cfg!(windows) {
        format!("{name}.cmd")
    } else {
        name.to_string()
    });
    fs::write(
        &executable,
        if cfg!(windows) {
            "@echo off\r\necho local-command-found\r\n"
        } else {
            "#!/bin/sh\nprintf 'local-command-found\\n'\n"
        },
    )
    .unwrap();
    // npm installs a POSIX shim beside its .cmd shim on Windows. The default
    // and streaming runners use Git Bash; the Bun shell uses the .cmd shim.
    let posix_shim = bin.join(name);
    if cfg!(windows) {
        fs::write(&posix_shim, "#!/bin/sh\nprintf 'local-command-found\\n'\n").unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    }

    let options = RunOptions {
        cwd: Some(PathBuf::from(&dir)),
        prefer_local: command_stream::PreferLocal::Cwd,
        mirror: false,
        ..Default::default()
    };
    let result = ProcessRunner::new(name, options.clone())
        .run()
        .await
        .unwrap();
    assert_eq!(
        result.stdout.to_string().trim(),
        "local-command-found",
        "stderr: {}",
        result.stderr
    );
    let result = ProcessRunner::new(
        name,
        RunOptions {
            prefer_local: command_stream::PreferLocal::Dirs(vec![dir.clone()]),
            ..options
        },
    )
    .run()
    .await
    .unwrap();
    assert_eq!(result.stdout.to_string().trim(), "local-command-found");
    let result = StreamingRunner::new(name)
        .cwd(dir.clone())
        .prefer_local(command_stream::PreferLocal::Cwd)
        .collect()
        .await
        .unwrap();
    assert_eq!(result.stdout.trim(), "local-command-found");
    if cfg!(windows) {
        fs::remove_file(posix_shim).unwrap();
    }
    let result = command_stream::bun_shell::shell(&[name], vec![])
        .unwrap()
        .cwd(dir.clone())
        .prefer_local(command_stream::PreferLocal::Cwd)
        .quiet()
        .run()
        .await
        .unwrap();
    assert_eq!(result.text().trim(), "local-command-found");
    let mut bun = command_stream::bun_shell::Shell::new();
    bun.cwd(Some(dir.clone()))
        .prefer_local(command_stream::PreferLocal::Cwd);
    let result = bun
        .command(&[name], vec![])
        .unwrap()
        .quiet()
        .run()
        .await
        .unwrap();
    assert_eq!(result.text().trim(), "local-command-found");
    fs::remove_dir_all(dir).unwrap();
}
