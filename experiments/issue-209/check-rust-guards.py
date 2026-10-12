"""Isolated Git regressions for the Rust PR guards (no registry/network)."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def probe(script, *, base="main", version="1.0.0", indent="", branch="test", code=False):
    with tempfile.TemporaryDirectory(prefix="rust-guard-") as directory:
        cwd = Path(directory) / "working"
        cwd.mkdir()
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=cwd, stderr=subprocess.DEVNULL)
        git("init", "--initial-branch=main")
        git("config", "user.name", "Test")
        git("config", "user.email", "test@example.com")
        (cwd / "Cargo.toml").write_text('[package]\nname = "test"\nversion = "1.0.0"\n')
        (cwd / "changelog.d").mkdir()
        (cwd / "changelog.d/existing.md").write_text("### Fixed\nExisting fragment\n")
        git("add", ".")
        git("commit", "-m", "base")
        remote = Path(directory) / "remote.git"
        git("clone", "--bare", str(cwd), str(remote))
        git("remote", "add", "origin", str(remote))
        git("fetch", "origin")
        (cwd / "Cargo.toml").write_text(f'[package]\nname = "test"\n{indent}version = "{version}"\n')
        (cwd / "changelog.d/existing.md").write_text("### Fixed\nEdited existing fragment\n")
        if code:
            (cwd / "src").mkdir()
            (cwd / "src/lib.rs").write_text("pub fn test() {}\n")
        git("add", ".")
        git("commit", "--allow-empty", "-m", "change")
        return subprocess.run(["rust-script", str(Path(os.environ.get("RUST_GUARD_SCRIPTS", ROOT / "rust/scripts")) / script)], cwd=cwd,
            env={**os.environ, "GITHUB_EVENT_NAME": "pull_request", "GITHUB_BASE_REF": base,
                 "GITHUB_HEAD_REF": branch, "GITHUB_BASE_SHA": "", "GITHUB_HEAD_SHA": "HEAD"},
            capture_output=True, text=True)


class Guards(unittest.TestCase):
    def test_missing_version_base(self):
        self.assertNotEqual(probe("check-version-modification.rs", base="missing").returncode, 0)

    def test_version_formatting(self):
        self.assertEqual(probe("check-version-modification.rs", indent="  ").returncode, 0)

    def test_release_named_branch_cannot_bypass_version_guard(self):
        self.assertNotEqual(probe("check-version-modification.rs", version="2.0.0", branch="release/test").returncode, 0)

    def test_missing_changelog_base(self):
        self.assertNotEqual(probe("check-changelog-fragment.rs", base="missing", code=True).returncode, 0)

    def test_editing_old_fragment_is_not_a_new_fragment(self):
        self.assertNotEqual(probe("check-changelog-fragment.rs", code=True).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
