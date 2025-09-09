#!/usr/bin/env node

// Debug shell argument construction
import fs from 'fs';

// Recreate the findAvailableShell logic
function findAvailableShell() {
  const shellsToTry = [
    { cmd: '/bin/sh', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/bin/sh', args: ['-l', '-c'], checkPath: true },
    { cmd: '/bin/bash', args: ['-l', '-c'], checkPath: true },
    { cmd: '/usr/bin/bash', args: ['-l', '-c'], checkPath: true },
  ];

  for (const shell of shellsToTry) {
    if (shell.checkPath) {
      if (fs.existsSync(shell.cmd)) {
        console.log(`Found shell at absolute path: ${shell.cmd}`);
        return { cmd: shell.cmd, args: shell.args };
      }
    }
  }

  return { cmd: '/bin/sh', args: ['-l', '-c'] };
}

const shell = findAvailableShell();
const commandStr = 'echo hello';

console.log('Shell detection result:');
console.log(`  cmd: ${shell.cmd}`);
console.log(`  args: ${JSON.stringify(shell.args)}`);

console.log('\nOriginal spawn args:');
const spawnArgs1 = [shell.cmd, ...shell.args.filter(arg => arg !== '-l'), commandStr];
console.log(`  ${JSON.stringify(spawnArgs1)}`);

console.log('\nCorrected spawn args (should include -c):');
const spawnArgs2 = [shell.cmd, '-c', commandStr];
console.log(`  ${JSON.stringify(spawnArgs2)}`);

console.log('\nTesting both approaches:');

const isBun = typeof globalThis.Bun !== 'undefined';
console.log(`Runtime: ${isBun ? 'Bun' : 'Node.js'}`);

if (isBun) {
  console.log('\nTesting with original args:');
  try {
    const proc1 = Bun.spawn(spawnArgs1, { stdout: 'pipe', stderr: 'pipe' });
    const stdout1 = await new Response(proc1.stdout).text();
    const stderr1 = await new Response(proc1.stderr).text();
    const code1 = await proc1.exited;
    console.log(`  Exit code: ${code1}`);
    console.log(`  Stdout: "${stdout1.trim()}"`);
    console.log(`  Stderr: "${stderr1.trim()}"`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  console.log('\nTesting with corrected args:');
  try {
    const proc2 = Bun.spawn(spawnArgs2, { stdout: 'pipe', stderr: 'pipe' });
    const stdout2 = await new Response(proc2.stdout).text();
    const stderr2 = await new Response(proc2.stderr).text();
    const code2 = await proc2.exited;
    console.log(`  Exit code: ${code2}`);
    console.log(`  Stdout: "${stdout2.trim()}"`);
    console.log(`  Stderr: "${stderr2.trim()}"`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
} else {
  const cp = await import('child_process');
  
  console.log('\nTesting with original args:');
  try {
    const result1 = cp.spawnSync(spawnArgs1[0], spawnArgs1.slice(1), { encoding: 'utf-8' });
    console.log(`  Exit code: ${result1.status}`);
    console.log(`  Stdout: "${result1.stdout?.trim() || ''}"`);
    console.log(`  Stderr: "${result1.stderr?.trim() || ''}"`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  console.log('\nTesting with corrected args:');
  try {
    const result2 = cp.spawnSync(spawnArgs2[0], spawnArgs2.slice(1), { encoding: 'utf-8' });
    console.log(`  Exit code: ${result2.status}`);
    console.log(`  Stdout: "${result2.stdout?.trim() || ''}"`);
    console.log(`  Stderr: "${result2.stderr?.trim() || ''}"`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
}