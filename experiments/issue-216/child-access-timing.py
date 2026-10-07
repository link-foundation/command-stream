"""Summarise the child_access probe timings in Windows Rust job logs (#216).

Usage: python3 -I child-access-timing.py LOG...
For each log: when the child_access binary started, each probe's
"finished in" time, and how the two parallel tests ended.
"""
import re
import sys

for path in sys.argv[1:]:
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    start = next((i for i, l in enumerate(lines) if "child_access-" in l and "Running" in l), None)
    if start is None:
        print(path, "no child_access run")
        continue
    times, verdicts = [], []
    for l in lines[start:]:
        m = re.search(r"3 filtered out; finished in ([\d.]+)s", l)
        if m:
            times.append(float(m.group(1)))
        m = re.search(r"test (child_handle_can_stop_the_process|child_exposes_the_native_process_after_start) \.\.\. (\w+)", l)
        if m:
            verdicts.append(m.group(2))
        m = re.search(r"test result: (\w+)\..* 0 filtered out; finished in ([\d.]+)s", l)
        if m:
            print(f"{path.rsplit('/', 1)[-1]}: probes={times} binary={m.group(1)} {m.group(2)}s")
            break
