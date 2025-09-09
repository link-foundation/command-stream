#!/usr/bin/env node

// Test: GitHub CLI complex markdown body issue
// Based on: https://github.com/link-foundation/command-stream/issues/40

import { $ } from '../src/$.mjs';
import fs from 'fs/promises';

console.log('=== GitHub CLI Complex Markdown Body Issue Test ===\n');

async function testGitHubCliBodyIssue() {
  // Complex markdown content with problematic characters
  const complexMarkdownBody = `## 🐛 Bug Description
GitHub CLI commands fail when trying to pass complex markdown content through the --body parameter due to shell escaping issues with backticks, quotes, and special characters.

## 🔴 Impact
- Can't create GitHub issues/PRs with code examples programmatically
- Markdown documentation can't be passed through CLI
- CI/CD workflows that create issues fail with complex content

## 📝 Problem Details
When using \`gh issue create --body\` with markdown containing:
- Code blocks with triple backticks
- Inline code with single backticks  
- Dollar signs with variables (\${var})
- Mixed quotes types
- Multi-line content

The shell interprets these special characters causing command failure.

## 🔧 Workaround
Use \`--body-file\` parameter instead:
\`\`\`javascript
// Write content to temp file first
await fs.writeFile(tempFile, markdownContent);
// Use --body-file instead of --body
await $\`gh issue create --body-file \${tempFile}\`;
\`\`\`

## 🔗 References
- Full test: https://github.com/deep-assistant/hive-mind/blob/main/command-stream-issues/issue-04-github-cli-body.mjs`;

  console.log('Complex markdown content length:', complexMarkdownBody.length);
  console.log('Contains problematic characters:');
  console.log('- Backticks:', complexMarkdownBody.includes('`'));
  console.log('- Dollar signs with curlies:', complexMarkdownBody.includes('${'));
  console.log('- Single quotes:', complexMarkdownBody.includes("'"));
  console.log('- Double quotes:', complexMarkdownBody.includes('"'));
  console.log('- Newlines:', complexMarkdownBody.includes('\n'));

  console.log('\n--- Testing Direct Body Parameter (Problematic) ---');
  
  // This is the problematic approach that should fail or produce incorrect results
  try {
    const directCmd = $({ mirror: false })`echo "Testing direct body interpolation: ${complexMarkdownBody}"`;
    console.log('Direct command generated successfully');
    console.log('Command preview (first 200 chars):', directCmd.spec.command.substring(0, 200) + '...');
    
    // Don't actually execute - just test command generation
    console.log('✅ Command generation succeeded (but may contain shell injection risks)');
  } catch (error) {
    console.log('❌ Direct command generation failed:', error.message);
  }

  console.log('\n--- Testing Body File Parameter (Recommended Solution) ---');
  
  // This is the recommended approach using temporary file
  try {
    const tempFile = `/tmp/gh-issue-body-${Date.now()}.md`;
    console.log('Creating temporary file:', tempFile);
    
    // Write content to temp file
    await fs.writeFile(tempFile, complexMarkdownBody);
    console.log('✅ Temporary file created successfully');
    
    // Create command using body-file parameter
    const bodyFileCmd = $({ mirror: false })`echo "Testing body-file approach with: ${tempFile}"`;
    console.log('Body-file command:', bodyFileCmd.spec.command);
    
    // Execute to test it works
    const result = await $`echo "Body-file approach works with: ${tempFile}"`;
    console.log('✅ Body-file command executed successfully:', result.stdout.trim());
    
    // Clean up
    await fs.unlink(tempFile);
    console.log('✅ Temporary file cleaned up');
    
  } catch (error) {
    console.log('❌ Body-file approach failed:', error.message);
  }

  console.log('\n--- Testing Command-Stream Solution ---');
  
  // Test if command-stream can handle this with proper escaping
  try {
    // Create a safer version using command-stream's quoting
    const safeCmd = $({ mirror: false })`echo "Command-stream escaped content:" ${complexMarkdownBody}`;
    console.log('Command-stream command generated');
    console.log('First 200 chars of generated command:', safeCmd.spec.command.substring(0, 200) + '...');
    
    // Test actual execution with a smaller sample to verify escaping works
    const testSample = 'Test with `backticks` and ${variables} and "quotes"';
    const testResult = await $`echo ${testSample}`;
    console.log('Test execution result:', testResult.stdout.trim());
    
    if (testResult.stdout.trim() === testSample) {
      console.log('✅ Command-stream properly escapes special characters');
    } else {
      console.log('⚠️  Escaping may have issues');
    }
    
  } catch (error) {
    console.log('❌ Command-stream solution failed:', error.message);
  }

  console.log('\n--- Analysis of the Problem ---');
  console.log('1. Direct string interpolation with --body parameter fails because:');
  console.log('   - Shell interprets backticks as command substitution');
  console.log('   - ${var} syntax triggers variable expansion');
  console.log('   - Quotes break shell parsing');
  console.log('   - Newlines cause command parsing issues');
  
  console.log('2. Body-file parameter works because:');
  console.log('   - File content is not interpreted by shell');
  console.log('   - Only the filename needs to be safely quoted');
  console.log('   - GitHub CLI reads file content directly');
  
  console.log('3. Command-stream\'s role:');
  console.log('   - Can properly quote/escape values for shell safety');
  console.log('   - But cannot solve fundamental GitHub CLI design limitation');
  console.log('   - Best approach is to facilitate body-file pattern');
}

testGitHubCliBodyIssue().catch(console.error);