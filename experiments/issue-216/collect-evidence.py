"""Preserve issue-216 CI run metadata, job metadata, annotations and logs.

Usage: python3 -I experiments/issue-216/collect-evidence.py RUN_ID [RUN_ID ...]
Logs are stored gzip-compressed; nothing containing credentials is written.
"""

import concurrent.futures
import gzip
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "dev/log/issues/216/pulls/217"
REPO = "link-foundation/command-stream"


def api(endpoint, paginate=False):
    command = ["gh", "api", endpoint] + (["--paginate"] if paginate else [])
    return subprocess.check_output(command)


def collect(run_id):
    metadata = api(f"repos/{REPO}/actions/runs/{run_id}")
    run = json.loads(metadata)
    attempt = run.get("run_attempt", 1)
    suffix = f"-attempt-{attempt}" if attempt > 1 else ""
    (EVIDENCE / f"github/run-{run_id}{suffix}.json").write_bytes(metadata)
    jobs_raw = api(f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100")
    (EVIDENCE / f"github/jobs-{run_id}{suffix}.json").write_bytes(jobs_raw)
    if run["status"] != "completed":
        return f"{run_id}: {run['status']} (collect again after completion)"
    annotations = {}
    for job in json.loads(jobs_raw)["jobs"]:
        check = job.get("check_run_url", "").rsplit("/", 1)[-1]
        if check:
            found = json.loads(api(f"repos/{REPO}/check-runs/{check}/annotations", True) or b"[]")
            if found:
                annotations[job["name"]] = found
    (EVIDENCE / f"github/annotations-{run_id}{suffix}.json").write_text(
        json.dumps(annotations, indent=2) + "\n"
    )
    target = EVIDENCE / f"ci-logs/run-{run_id}{suffix}.log.gz"
    result = subprocess.run(
        ["gh", "run", "view", str(run_id), "--repo", REPO, "--log"],
        capture_output=True,
    )
    if result.returncode:
        (EVIDENCE / f"ci-logs/run-{run_id}{suffix}-download-error.txt").write_bytes(
            result.stderr
        )
        return f"{run_id}: log download failed (see error file)"
    target.write_bytes(gzip.compress(result.stdout, mtime=0))
    return (
        f"{run_id}: {run['name']} {run['conclusion']} at {run['head_sha'][:7]}, "
        f"{len(result.stdout.splitlines())} log lines, {sum(map(len, annotations.values()))} annotations"
    )


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for message in pool.map(collect, sys.argv[1:]):
            print(message, flush=True)
