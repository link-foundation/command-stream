import { beforeEach } from 'bun:test';

// Registering the hook while this module is evaluated binds it to the scope of
// the test file that imported it *first*. ES module caching means the body
// never runs again, so no other file gets the hook.
globalThis.__hookRuns = 0;
beforeEach(() => {
  globalThis.__hookRuns += 1;
});
