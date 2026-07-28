#!/usr/bin/env node

import { $ } from '../src/$.mjs';

console.log('=== Test stdin timing with proper flow ===');

async function testStdinTiming() {
  console.log('Test 1: Access stdin immediately and write quickly');

  const cmd1 = $`cat`;

  // Get stdin immediately, which should auto-start the process
  const stdin1 = cmd1.streams.stdin;
  console.log('Stdin available immediately?', !!stdin1);
  console.log('Command started?', cmd1.started);

  if (stdin1) {
    // Write immediately before the process might finish
    stdin1.write('Quick input\\n');
    stdin1.end();
  }

  const result1 = await cmd1;
  console.log('Result 1:', JSON.stringify(result1.stdout));
  console.log('Exit code 1:', result1.code);

  console.log(
    '\\nTest 2: Create test with Node.js script that definitely reads stdin'
  );

  const nodeScript = `
    process.stdin.setEncoding('utf8');
    let input = '';
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      process.stdout.write('Received: ' + input);
    });
  `;

  const cmd2 = $`node -e "${nodeScript}"`;
  const stdin2 = cmd2.streams.stdin;

  console.log('Node script stdin available?', !!stdin2);

  if (stdin2) {
    stdin2.write('Node.js input test\\n');
    stdin2.end();
  }

  const result2 = await cmd2;
  console.log('Node result:', JSON.stringify(result2.stdout));
  console.log('Exit code 2:', result2.code);

  console.log('\\nTest 3: Test with sleep to ensure process stays alive');

  const cmd3 = $`sh -c 'cat && echo "Done"'`;
  const stdin3 = cmd3.streams.stdin;

  console.log('Shell cat stdin available?', !!stdin3);

  if (stdin3) {
    // Send data and then close stdin
    stdin3.write('Shell script input\\n');
    stdin3.end();
  }

  const result3 = await cmd3;
  console.log('Shell result:', JSON.stringify(result3.stdout));
  console.log('Exit code 3:', result3.code);
}

testStdinTiming().catch(console.error);
