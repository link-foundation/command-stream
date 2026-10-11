"""Run a Cargo check with one build job and report its peak resident memory."""
import os
import resource
import subprocess
import sys

env = os.environ | {
    "CARGO_BUILD_JOBS": "1",
    "CARGO_PROFILE_DEV_DEBUG": "0",
    "CARGO_PROFILE_TEST_DEBUG": "0",
}
result = subprocess.run(["cargo", *sys.argv[1:]], env=env, check=False)
print(f"Cargo peak child RSS: {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss} KiB", flush=True)
raise SystemExit(result.returncode)
