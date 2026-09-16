#!/usr/bin/env bash
# Show that the grandchild regression tests catch the macOS failure mode.
#
# macOS resolves `getpgid(pid)` through XNU's `proc_find`, which skips zombie
# processes, so the lookup fails with ESRCH once the `sh` wrapper has exited -
# and the code that used it then skipped the group delivery entirely, leaving
# the grandchild running. Linux answers `getpgid` for a zombie, so the bug is
# invisible here.
#
# This script restores the `getpgid` guard *and* emulates the macOS behaviour by
# treating a zombie as "not found" (via /proc/<pid>/stat), then runs the signal
# tests. Expected: the orphaned-grandchild test fails. It reverts the patch on
# exit, so it can be run repeatedly.
set -uo pipefail
cd "$(dirname "$0")/../../rust" || exit 1

backup="$(mktemp)"

# Restore from a copy rather than with `git checkout`, which would also discard
# any uncommitted work in this file.
cp src/signal.rs "$backup"
trap 'cp "$backup" src/signal.rs; rm -f "$backup"' EXIT

python3 - <<'PY'
import pathlib
p = pathlib.Path('src/signal.rs')
s = p.read_text()
old = """    // Signal the whole process group (negative pid) first, so grandchildren are
    // reached even if the group leader dies on the signal we send it next.
    if delivery == Delivery::ProcessAndGroup {"""
new = """    // Signal the whole process group (negative pid) first, so grandchildren are
    // reached even if the group leader dies on the signal we send it next.
    if delivery == Delivery::ProcessAndGroup && macos_style_getpgid(pid) == Some(pid) {"""
assert s.count(old) == 1, "anchor not found - has send_signal_to_process changed?"
s = s.replace(old, new)
s += '''
/// `getpgid` as macOS answers it: ESRCH for a process that is already a zombie.
#[cfg(unix)]
fn macos_style_getpgid(pid: u32) -> Option<u32> {
    use nix::unistd::{getpgid, Pid};

    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let state = stat.rsplit_once(')')?.1.split_whitespace().next()?.to_string();
    if state == "Z" {
        return None;
    }
    getpgid(Some(Pid::from_raw(pid as i32))).ok().map(|p| p.as_raw() as u32)
}
'''
p.write_text(s)
print("patched: group delivery gated behind a macOS-style getpgid")
PY

cargo test --test signals --all-features 2>&1 | tail -20
