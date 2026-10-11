#!/usr/bin/env python3
"""Does a POSIX shell reliably run its trap when the signal reaches the group?

The Rust signal tests failed intermittently for SIGINT only (~13% of runs),
which points at shell semantics rather than at the library. This reproduces the
library's exact delivery - spawn `sh -c` in its own process group, then signal
both the pid and the group - without any command-stream code in the picture.

The second half adds the library's SIGKILL escalation, to tell "the shell never
runs its trap" apart from "the escalation arrived before the trap could".

Usage: experiments/issue-15/sh-trap-race.py [ATTEMPTS]
"""
import os
import signal
import subprocess
import sys
import tempfile
import time

ATTEMPTS = int(sys.argv[1]) if len(sys.argv) > 1 else 30

SCRIPT = (
    "trap 'echo handled >> {marker}; exit 0' {name}; "
    "echo ready; while true; do sleep 0.05; done"
)


def attempt(name, sig, group, escalate_ms=None):
    """Run one child, signal it, and report whether its trap ran."""
    fd, marker = tempfile.mkstemp()
    os.close(fd)
    try:
        # start_new_session=True is what the library does with process_group(0):
        # the shell is the group leader, its `sleep` is in the same group.
        child = subprocess.Popen(
            ["sh", "-c", SCRIPT.format(marker=marker, name=name)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        time.sleep(0.3)
        os.kill(child.pid, sig)
        if group:
            os.kill(-child.pid, sig)
        if escalate_ms is not None:
            time.sleep(escalate_ms / 1000)
            for target in (child.pid, -child.pid):
                try:
                    os.kill(target, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        time.sleep(0.4)
        try:
            os.kill(-child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        with open(marker) as handle:
            return "handled" in handle.read()
    finally:
        os.unlink(marker)


for name, sig in (("TERM", signal.SIGTERM), ("INT", signal.SIGINT)):
    for group in (True, False):
        for escalate_ms in (None, 100):
            ran = sum(
                attempt(name, sig, group, escalate_ms) for _ in range(ATTEMPTS)
            )
            target = "pid + group" if group else "pid only"
            escalation = "no escalation" if escalate_ms is None else f"SIGKILL +{escalate_ms}ms"
            print(
                f"SIG{name:<4} to {target:<11} ({escalation:<15}): "
                f"trap ran in {ran}/{ATTEMPTS} runs"
            )
