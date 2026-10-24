use std::path::PathBuf;
use std::sync::OnceLock;

pub fn fixture() -> PathBuf {
    static FIXTURE: OnceLock<PathBuf> = OnceLock::new();
    FIXTURE
        .get_or_init(|| {
            let dir = tempfile::tempdir().unwrap().keep();
            let path = dir.join(if cfg!(windows) {
                "fixture.exe"
            } else {
                "fixture"
            });
            let status = std::process::Command::new("rustc")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/execa/fixture.rs"
                ))
                .arg("-o")
                .arg(&path)
                .status()
                .unwrap();
            assert!(status.success());
            path
        })
        .clone()
}
