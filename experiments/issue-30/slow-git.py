#!/usr/bin/env python3
"""Reproduce the example test's shared deadline with two finite Git delays.

Each Git process waits three seconds before executing the real binary. Run from
the repository root; the original combined test fails its five-second budget,
while separate per-operation deadlines preserve the same assertions and pass.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

git = shutil.which("git")
if not git or os.name != "posix":
    sys.exit("This bounded latency experiment requires POSIX and Git")

with tempfile.TemporaryDirectory(prefix="command-stream-slow-git-") as directory:
    wrapper = Path(directory) / "git"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os, sys, time\n"
        "time.sleep(3)\n"
        f"os.execv({git!r}, [{git!r}, *sys.argv[1:]])\n"
    )
    wrapper.chmod(0o755)
    environment = dict(
        os.environ,
        PATH=directory + os.pathsep + os.environ["PATH"],
    )
    for name, value in {
        "CARGO_BUILD_JOBS": "1",
        "CARGO_PROFILE_DEV_DEBUG": "0",
        "CARGO_PROFILE_TEST_DEBUG": "0",
    }.items():
        environment.setdefault(name, value)
    result = subprocess.run(
        [
            "cargo",
            "test",
            "--manifest-path",
            "rust/Cargo.toml",
            "--test",
            "example_packages",
            "git_helpers_use_a_real_repository",
            "--",
            "--nocapture",
        ],
        env=environment,
        check=False,
    )
    sys.exit(result.returncode)
