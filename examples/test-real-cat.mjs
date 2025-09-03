import { $ } from '../src/$.mjs';

async function testRealCat() {
  console.log('Testing real cat (not virtual) with streams.stdin...');
  
  // Force bypass of virtual command by using /bin/cat
  const catCmd = $`/bin/cat`;
  const stdin = await catCmd.streams.stdin;
  
  console.log('stdin available:', !!stdin);
  console.log('stdin writable:', stdin ? stdin.writable : 'N/A');
  
  if (stdin) {
    stdin.write('Hello from streams.stdin!\n');
    stdin.write('Multiple lines work\n');
    stdin.end();
  }
  
  const result = await catCmd;
  console.log('Result code:', result.code);
  console.log('Result stdout:', JSON.stringify(result.stdout));
  console.log('Expected content present:', result.stdout.includes('Hello from streams.stdin!'));
}

testRealCat().catch(console.error);