"""Preserve issue-209 CI evidence without exposing authentication credentials."""

import concurrent.futures
import gzip
import json
from pathlib import Path
import subprocess
import sys
import time
import zipfile
import io


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "dev/log/issues/209/pulls/210"
REPO = "link-foundation/command-stream"


def api(endpoint):
    separator = "&" if "?" in endpoint else "?"
    return subprocess.check_output(["gh", "api", endpoint + separator + f"evidence_refresh={time.time_ns()}", "--paginate"])


def collect(run):
    run_id = run["id"]
    metadata = api(f"repos/{REPO}/actions/runs/{run_id}")
    original = EVIDENCE / f"github/run-{run_id}.json"
    if not original.exists():
        original.write_bytes(metadata)
    (EVIDENCE / f"github/run-{run_id}-current.json").write_bytes(metadata)
    jobs = api(f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100")
    (EVIDENCE / f"github/jobs-{run_id}.json").write_bytes(jobs)
    current = json.loads(metadata)
    if current["status"] != "completed":
        return f"{run_id}: {current['status']} (collect logs after completion)"
    attempt = current.get("run_attempt", 1)
    suffix = f"-attempt-{attempt}" if attempt > 1 else ""
    (EVIDENCE / f"github/run-{run_id}{suffix}.json").write_bytes(metadata)
    target = EVIDENCE / f"ci-logs/run-{run_id}{suffix}.log.gz"
    if not target.exists():
        result = subprocess.run(
            ["gh", "run", "view", str(run_id), "--repo", REPO, "--log"],
            capture_output=True,
        )
        if result.returncode:
            (EVIDENCE / f"ci-logs/run-{run_id}-download-error.txt").write_bytes(
                result.stderr
            )
            # The CLI can see stale status/job data while the direct archive
            # endpoint is already available. Preserve its original ZIP too.
            archive = subprocess.run(["gh", "api", f"repos/{REPO}/actions/runs/{run_id}/logs?evidence_refresh={time.time_ns()}"], capture_output=True)
            if archive.returncode == 0 and zipfile.is_zipfile(io.BytesIO(archive.stdout)):
                (EVIDENCE / f"ci-logs/run-{run_id}{suffix}.zip").write_bytes(archive.stdout)
                with zipfile.ZipFile(io.BytesIO(archive.stdout)) as files:
                    names = [name for name in files.namelist() if "/" not in name and name.endswith(".txt")]
                    content = b"\n".join(name.encode() + b"\n" + files.read(name) for name in names)
                    target.write_bytes(gzip.compress(content, mtime=0))
                return f"{run_id}: direct archive preserved ({len(names)} available job logs; inspect ZIP for missing jobs)"
            # GitHub may retain completed jobs while losing a cancelled job's
            # archive. Preserve every available job instead of losing the run.
            available = 0
            for job in json.loads(jobs)["jobs"]:
                if job["status"] != "completed":
                    continue
                job_id = job["id"]
                result_job = subprocess.run(
                    ["gh", "api", f"repos/{REPO}/actions/jobs/{job_id}/logs?evidence_refresh={time.time_ns()}"],
                    capture_output=True,
                )
                job_target = EVIDENCE / f"ci-logs/run-{run_id}-job-{job_id}.log.gz"
                if result_job.returncode:
                    job_target.with_suffix(".error.txt").write_bytes(result_job.stderr)
                else:
                    job_target.write_bytes(gzip.compress(result_job.stdout, mtime=0))
                    available += 1
            return f"{run_id}: full archive unavailable; preserved {available} job logs"

        target.write_bytes(gzip.compress(result.stdout, mtime=0))
    return f"{run_id}: {current['conclusion']}, logs preserved"


if __name__ == "__main__":
    recent = json.loads(
        (EVIDENCE / "github/recent-runs-initial.json").read_text()
    )["workflow_runs"]
    # All issue-time main runs, initial PR runs, and immediate predecessor
    # failures explain the current state without mixing in superseded PR work.
    selected = [
        run
        for run in recent
        if run["head_branch"] in {"main", "issue-209-4043f0c126d5"}
    ]
    if len(sys.argv) > 1:
        selected = [
            json.loads(api(f"repos/{REPO}/actions/runs/{run_id}"))
            for run_id in sys.argv[1:]
        ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for message in pool.map(collect, selected):
            print(message, flush=True)
