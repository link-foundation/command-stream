import { $ } from '../src/$.mjs';

console.log('=== Individual Debugging for Quoting Issue ===\n');

// Let's trace exactly what happens in the command building process
async function debugIndividualSteps() {
  const claudePath = '/Users/konard/.claude/local/claude';

  console.log('1. Path value:', JSON.stringify(claudePath));

  // Step-by-step debugging
  console.log('\n2. Creating command with exact options from issue:');
  const options = { stdin: 'hi\n', mirror: false };
  console.log('Options:', JSON.stringify(options));

  // Create the command but don't execute yet
  const cmd = $({
    ...options,
  })`${claudePath} --output-format stream-json --verbose --model sonnet`;

  console.log('\n3. Command object details:');
  console.log('- Command spec:', JSON.stringify(cmd.spec, null, 2));
  console.log('- Command string:', cmd.spec?.command);
  console.log('- Options:', JSON.stringify(cmd.options, null, 2));

  // Check if there are any differences in how the template is being processed
  console.log('\n4. Manual template testing:');
  const manualTemplate = `${claudePath} --output-format stream-json --verbose --model sonnet`;
  console.log('Manual template result:', JSON.stringify(manualTemplate));

  // Test what happens if we try to access internal command processing
  console.log('\n5. Testing command processing internals:');
  try {
    // Let's see what the internal command string looks like
    if (cmd._command) {
      console.log('Internal _command:', cmd._command);
    }
    if (cmd.command) {
      console.log('Internal command:', cmd.command);
    }

    // Try to start the command to see exactly what gets passed to spawn
    console.log('\n6. Attempting command execution to see spawn details:');
    await cmd;
  } catch (error) {
    console.log('Execution error:', error.message);
    console.log('Error stack:', error.stack);

    // Check for the specific posix_spawn pattern mentioned in the issue
    const spawnMatch = error.message.match(/posix_spawn '([^']*)''/);
    if (spawnMatch) {
      console.log('🔍 Found posix_spawn with double quotes!');
      console.log('Captured path:', spawnMatch[1]);
    }

    // Also check for any double-quote patterns
    const doubleQuoteMatch = error.message.match(/''/g);
    if (doubleQuoteMatch) {
      console.log(
        '🔍 Found double-quote patterns:',
        doubleQuoteMatch.length,
        'instances'
      );
    }
  }

  console.log('\n7. Testing different path formats:');
  const testPaths = [
    '/Users/konard/.claude/local/claude',
    '"/Users/konard/.claude/local/claude"',
    "'/Users/konard/.claude/local/claude'",
    '/Users/user with spaces/.claude/local/claude',
    '/nonexistent/path',
  ];

  for (const testPath of testPaths) {
    console.log(`\nTesting path: ${JSON.stringify(testPath)}`);
    try {
      const testCmd = $({ mirror: false })`${testPath} --version`;
      console.log('Generated command:', testCmd.spec?.command);
      // Don't actually execute, just check the generated command
    } catch (error) {
      console.log('Command creation error:', error.message);
    }
  }
}

debugIndividualSteps().catch(console.error);
