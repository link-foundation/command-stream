#!/usr/bin/env node

import { $ } from '../js/src/$.mjs';

async function debugChildState() {
  const cmd = $`cat`;

  console.log('0ms - Initial state:');
  console.log(
    '  started:',
    cmd.started,
    'finished:',
    cmd.finished,
    'child:',
    !!cmd.child
  );

  // Trigger start
  cmd.streams.stdout;

  console.log('0ms - After triggering start:');
  console.log(
    '  started:',
    cmd.started,
    'finished:',
    cmd.finished,
    'child:',
    !!cmd.child
  );

  // Check state every 25ms
  for (let i = 1; i <= 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    console.log(`${i * 25}ms - state:`, {
      started: cmd.started,
      finished: cmd.finished,
      child: !!cmd.child,
      stdin: !!(cmd.child && cmd.child.stdin),
    });

    if (cmd.finished) {
      console.log('Process finished early!');
      break;
    }
  }

  // Try one final time
  const stdin = cmd.streams.stdin;
  console.log('Final stdin check:', !!stdin);

  const result = await cmd;
  console.log('Final result:', result.stdout, 'code:', result.code);
}

debugChildState().catch(console.error);
