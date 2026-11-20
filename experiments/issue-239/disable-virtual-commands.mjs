import { disableVirtualCommands } from '../../js/src/$.state.mjs';

// Run with `bun test --preload ./experiments/issue-239/disable-virtual-commands.mjs js/tests/core-entry.test.mjs`.
// This reproduces the shared state left by earlier tests in the Bun suite.
disableVirtualCommands();
