import { $ } from '../src/$.mjs';

console.log('=== Testing jq Color Output ===\n');

async function testJqColors() {
  const testJson =
    '{"message": "hello world", "number": 42, "active": true, "data": null}';

  console.log(
    '1. Testing jq with default options (should show colors if TTY):'
  );
  console.log('Input JSON:', testJson);
  console.log(
    '\n--- Output with pretty printing (should be colored in TTY) ---'
  );

  try {
    // Test 1: Default behavior - should show colors in TTY
    const result1 = await $`echo ${testJson} | jq .`;
    console.log('Result code:', result1.code);
    console.log('Stdout length:', result1.stdout.length);
    console.log('Contains ANSI codes:', /\u001b\[/.test(result1.stdout));
    console.log('Raw stdout:', JSON.stringify(result1.stdout));

    console.log('\n2. Testing jq with explicit color output:');
    const result2 = await $`echo ${testJson} | jq --color-output .`;
    console.log('Result code:', result2.code);
    console.log('Contains ANSI codes:', /\u001b\[/.test(result2.stdout));
    console.log('Raw stdout:', JSON.stringify(result2.stdout));

    console.log('\n3. Testing jq with no color output:');
    const result3 = await $`echo ${testJson} | jq --color-output=never .`;
    console.log('Result code:', result3.code);
    console.log('Contains ANSI codes:', /\u001b\[/.test(result3.stdout));
    console.log('Raw stdout:', JSON.stringify(result3.stdout));

    console.log('\n4. Testing jq with capture=false (pure mirror mode):');
    const $mirror = $({ capture: false, mirror: true });
    console.log('About to run jq with pure mirror mode (output below):');
    const result4 = await $mirror`echo ${testJson} | jq .`;
    console.log('Result code (mirror mode):', result4.code);

    console.log('\n5. Testing individual field extraction:');
    const result5 = await $`echo ${testJson} | jq -r .message`;
    console.log('Extracted message:', JSON.stringify(result5.stdout.trim()));
  } catch (error) {
    console.error('Error testing jq:', error.message);
  }
}

console.log('TTY Status:');
console.log('- process.stdout.isTTY:', process.stdout.isTTY);
console.log('- process.stderr.isTTY:', process.stderr.isTTY);
console.log('- process.stdin.isTTY:', process.stdin.isTTY);
console.log();

testJqColors().catch(console.error);
