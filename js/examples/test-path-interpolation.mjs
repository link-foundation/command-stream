import { $ } from '../src/$.mjs';

console.log('=== Testing Path Interpolation Issues ===\n');

async function testPathInterpolation() {
  // Test 1: Simple path with no spaces
  console.log('1. Testing simple path interpolation:');
  const simplePath = '/bin/echo';
  try {
    const result1 = await $`${simplePath} "simple test"`;
    console.log('✅ Simple path works:', result1.stdout.trim());
  } catch (error) {
    console.log('❌ Simple path failed:', error.message);
  }

  // Test 2: Path with spaces (like the .claude directory)
  console.log('\n2. Testing path with spaces:');
  const pathWithSpaces = '/usr/bin/env';
  try {
    const result2 = await $`${pathWithSpaces} echo "space test"`;
    console.log('✅ Path with env works:', result2.stdout.trim());
  } catch (error) {
    console.log('❌ Path with env failed:', error.message);
  }

  // Test 3: Simulate the exact issue - path that might have quotes
  console.log('\n3. Testing problematic path structure:');
  const problematicPath = '/nonexistent/path/to/claude';
  try {
    const result3 = await $`${problematicPath} --version`;
    console.log('✅ Problematic path works:', result3.stdout.trim());
  } catch (error) {
    console.log('❌ Problematic path failed:', error.message);
    console.log('Error details:', error);
  }

  // Test 4: Check what command gets built
  console.log('\n4. Testing command building:');
  const testPath = '/Users/test/.claude/local/claude';
  console.log('Variable value:', JSON.stringify(testPath));

  try {
    // Create command but don't execute
    const cmd = $`${testPath} --help`;
    console.log('Command spec:', cmd.spec);
  } catch (error) {
    console.log('❌ Command building failed:', error.message);
  }

  // Test 5: Environment variable usage
  console.log('\n5. Testing environment variable:');
  process.env.TEST_CLAUDE_PATH = '/usr/bin/echo';
  const claudeFromEnv = process.env.TEST_CLAUDE_PATH;
  console.log('Env var value:', JSON.stringify(claudeFromEnv));

  try {
    const result5 = await $`${claudeFromEnv} "env test"`;
    console.log('✅ Env var path works:', result5.stdout.trim());
  } catch (error) {
    console.log('❌ Env var path failed:', error.message);
  }

  // Test 6: Test with stdin like the failing script
  console.log('\n6. Testing with stdin (like failing script):');
  try {
    const result6 = await $({ stdin: 'test input\n', mirror: false })`/bin/cat`;
    console.log('✅ Stdin test works:', result6.stdout.trim());
  } catch (error) {
    console.log('❌ Stdin test failed:', error.message);
  }

  // Test 7: Check raw command string
  console.log('\n7. Checking command string generation:');
  const testCmd = '/usr/bin/which';
  console.log('Raw variable:', JSON.stringify(testCmd));
  try {
    const cmd = $`${testCmd} node`;
    console.log('Generated command:', cmd.spec?.command || 'Not available');
    const result = await cmd;
    console.log('✅ Command string test works');
  } catch (error) {
    console.log('❌ Command string test failed:', error.message);
  }
}

testPathInterpolation().catch(console.error);
