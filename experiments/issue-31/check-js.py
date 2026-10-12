"""Run every JS test file, isolating the existing wall-clock sleep assertions."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
timing = "js/tests/parallel-sleep.test.mjs"
files = subprocess.check_output(
    ["rg", "--files", "js/tests", "-g", "*.test.mjs", "-g", "*.test.js",
     "-g", "*.test.cjs", "-g", "*.test.ts"], cwd=root, text=True
).splitlines()
assert timing in files
groups = [[file for file in files if file != timing], [timing]]
for group in groups:
    result = subprocess.run(
        ["bun", "test", *group, "--timeout", "10000"], cwd=root, check=False
    )
    if result.returncode:
        raise SystemExit(result.returncode)
