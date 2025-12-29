import { $ } from '../js/src/$.mjs';

async function debugStackOverflow() {
  console.log('Testing simple echo command...');

  try {
    const result = await $`echo "test"`;
    console.log('Success! Result:', JSON.stringify(result.stdout.trim()));
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Stack:', error.stack?.slice(0, 500));
  }

  console.log('\nTesting with strings.stdout access...');
  try {
    const cmd = $`echo "String test"`;
    const str = await cmd.strings.stdout;
    console.log('Success! String result:', JSON.stringify(str.trim()));
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Stack:', error.stack?.slice(0, 500));
  }
}

debugStackOverflow().catch(console.error);
