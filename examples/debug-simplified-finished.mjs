#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

console.log('=== Simplified Finished Field Test ===');

function getSigintHandlerCount() {
  const sigintListeners = process.listeners('SIGINT');
  const commandStreamListeners = sigintListeners.filter((l) => {
    const str = l.toString();
    return (
      str.includes('activeProcessRunners') ||
      str.includes('ProcessRunner') ||
      str.includes('activeChildren')
    );
  });
  return commandStreamListeners.length;
}

const tests = [
  {
    name: 'Normal completion with cleanup',
    test: async () => {
      console.log('  Before:', getSigintHandlerCount(), 'handlers');
      const result = await $`echo "test"`;
      console.log('  After:', getSigintHandlerCount(), 'handlers');
      return {
        stdout: result.stdout.trim(),
        finished: result.constructor.name === 'Object', // This means it completed normally
      };
    },
  },

  {
    name: 'Multiple finish() calls (idempotent)',
    test: async () => {
      const runner = $`echo "idempotent"`;
      await runner;

      console.log('  finished after normal completion:', runner.finished);

      // Try to finish again
      const result2 = runner.finish({
        code: 999,
        stdout: 'should not overwrite',
        stderr: '',
        stdin: '',
      });

      return {
        finished: runner.finished,
        stdout: runner.result.stdout.trim(),
        returnedStdout: result2.stdout.trim(),
        sameResult: runner.result.stdout === result2.stdout,
      };
    },
  },

  {
    name: 'Kill scenario with cleanup',
    test: async () => {
      console.log('  Before kill:', getSigintHandlerCount(), 'handlers');

      const runner = $`sleep 0.1`;
      const promise = runner.start();

      console.log('  During execution:', getSigintHandlerCount(), 'handlers');

      await new Promise((resolve) => setTimeout(resolve, 10));
      runner.kill('SIGTERM');

      try {
        await promise;
      } catch (error) {
        // Expected
      }

      console.log('  After kill:', getSigintHandlerCount(), 'handlers');

      return {
        finished: runner.finished,
        code: runner.result.code,
        killed: runner.result.stderr.includes('killed'),
      };
    },
  },
];

console.log('\nTesting simplified finished field design...\n');

for (const { name, test } of tests) {
  console.log(`🧪 ${name}:`);
  try {
    const result = await test();
    console.log('  ✅ Result:', JSON.stringify(result, null, 4));
  } catch (error) {
    console.log('  ❌ Error:', error.message);
  }
  console.log('');
}

console.log('=== Test completed ===');
