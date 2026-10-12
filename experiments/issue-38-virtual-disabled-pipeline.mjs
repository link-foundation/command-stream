#!/usr/bin/env bun
// Issue #38 investigation: why `exit 19 | cat` reports ENOENT instead of 19.
//
// With virtual commands disabled, a parsed pipeline is handed to Bun.spawn one
// command at a time, so the shell builtin `exit` is looked up in $PATH and the
// spawn fails with ENOENT. Test files leak that disabled flag (see
// experiments/issue-38-test-helper-hook-scope.mjs), which is how the CI failure
// on macOS was produced.
import {
  $,
  shell,
  disableVirtualCommands,
  enableVirtualCommands,
} from '../js/src/$.mjs';

shell.errexit(true);
shell.pipefail(true);

for (const virtual of [true, false]) {
  if (virtual) {
    enableVirtualCommands();
  } else {
    disableVirtualCommands();
  }

  const error = await $`exit 19 | cat`.catch((thrown) => thrown);
  console.log(
    `virtualCommands=${virtual ? 'enabled' : 'disabled'} ->`,
    JSON.stringify({
      code: error?.code,
      exitCode: error?.exitCode,
      message: error?.message,
    })
  );
}

enableVirtualCommands();
