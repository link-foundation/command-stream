import { $ } from '../src/$.mjs';

async function testResult() {
  const result = await $.command('echo', 'hello').run();
  console.log('Result keys:', Object.keys(result));
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('exitCode:', result.exitCode);
  console.log('exit_code:', result.exit_code);
  console.log('code:', result.code);
  console.log('result instanceof:', result.constructor.name);
}

testResult().catch(console.error);