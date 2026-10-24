"""Repeat one finite reference-shell case without weakening its assertions."""

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
failures = 0
for attempt in range(1, 21):
    result = subprocess.run(
        [
            "bun",
            "conformance/bun-shell/run-bun-reference.mjs",
            "--filter",
            "deno-broken-pipe-subproc",
            "--concurrency",
            "1",
            "--verbose",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    print(f"Attempt {attempt}/20: exit {result.returncode}", flush=True)
    print(result.stdout, end="", flush=True)
    print(result.stderr, end="", flush=True)
    failures += result.returncode != 0
print(f"Observed failures: {failures}/20", flush=True)
