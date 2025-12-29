#!/usr/bin/env node
// Test comprehensive resource cleanup
// This runs in a subprocess for isolation

import { $ } from '../src/$.mjs';

process.env.COMMAND_STREAM_VERBOSE = 'true';

console.log('TEST: Starting cleanup verification');

// Test 1: Virtual command cleanup
console.log('TEST: Virtual command cleanup');
const v1 = $`echo "test1"`;
await v1;
console.log(`RESULT: virtual_finished=${v1.finished}`);

// Test 2: Real process cleanup
console.log('TEST: Real process cleanup');
const r1 = $`/bin/echo "test2"`;
await r1;
console.log(`RESULT: real_finished=${r1.finished}`);

// Test 3: Error cleanup
console.log('TEST: Error cleanup');
const e1 = $`exit 1`;
try {
  await e1;
} catch (e) {
  // Expected
}
console.log(`RESULT: error_finished=${e1.finished}`);

// Test 4: Kill cleanup
console.log('TEST: Kill cleanup');
const k1 = $`sleep 10`;
const kp = k1.start();
setTimeout(() => k1.kill(), 10);
try {
  await kp;
} catch (e) {
  // Expected
}
console.log(`RESULT: kill_finished=${k1.finished}`);

// Test 5: Pipeline cleanup
console.log('TEST: Pipeline cleanup');
const p1 = await $`echo "test" | /bin/cat | /bin/cat`;
console.log(
  `RESULT: pipeline_output=${p1.stdout ? p1.stdout.trim() : 'no_output'}`
);

// Test 6: Event listener cleanup
console.log('TEST: Event listener cleanup');
const ev1 = $`echo "test"`;
ev1.on('data', () => {});
ev1.on('end', () => {});
await ev1;
console.log(`RESULT: event_listeners_size=${ev1.listeners.size}`);

// Test 7: Concurrent command cleanup
console.log('TEST: Concurrent command cleanup');
const concurrent = [$`echo "c1"`, $`echo "c2"`, $`echo "c3"`];
await Promise.all(concurrent);
console.log(
  `RESULT: concurrent_finished=${concurrent.every((c) => c.finished)}`
);

// Test 8: Not awaited cleanup
console.log('TEST: Not awaited cleanup');
const na1 = $`echo "not awaited"`;
na1.start(); // Start but don't await
await new Promise((resolve) => setTimeout(resolve, 100));
console.log(`RESULT: not_awaited_finished=${na1.finished}`);

// Test 9: Stream iterator break cleanup
console.log('TEST: Stream iterator break cleanup');
const si1 = $`for i in 1 2 3; do echo $i; sleep 0.01; done`;
let iterations = 0;
for await (const chunk of si1.stream()) {
  iterations++;
  if (iterations >= 2) {
    break;
  }
}
console.log(`RESULT: stream_iterator_finished=${si1.finished}`);

// Test 10: AbortController cleanup
console.log('TEST: AbortController cleanup');
const ac1 = $`sleep 10`;
const acp = ac1.start();
const hadController = ac1._abortController !== null;
ac1.kill();
try {
  await acp;
} catch (e) {
  // Expected
}
console.log(`RESULT: had_abort_controller=${hadController}`);
console.log(
  `RESULT: abort_controller_cleaned=${ac1._abortController === null}`
);

// Final check: No lingering SIGINT handlers
const finalListeners = process.listeners('SIGINT').filter((l) => {
  const str = l.toString();
  return (
    str.includes('activeProcessRunners') ||
    str.includes('ProcessRunner') ||
    str.includes('activeChildren')
  );
});
console.log(`RESULT: final_sigint_handlers=${finalListeners.length}`);

console.log('TEST: Complete');
process.exit(0);
