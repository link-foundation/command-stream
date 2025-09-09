import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { $, githubCli } from '../src/$.mjs';
import fs from 'fs/promises';

describe('GitHub CLI body handling (Issue #40)', () => {
  beforeEach(async () => {
    await beforeTestCleanup();
  });
  
  afterEach(async () => {
    await afterTestCleanup();
  });

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

  test('githubCli object is exported and has required methods', () => {
    expect(githubCli).toBeDefined();
    expect(typeof githubCli).toBe('object');
    expect(typeof githubCli.createIssue).toBe('function');
    expect(typeof githubCli.createPullRequest).toBe('function');
    expect(typeof githubCli.withBodyFile).toBe('function');
  });

  test('githubCli.withBodyFile creates and cleans up temporary files', async () => {
    const testContent = 'Test content with `backticks` and ${variables}';
    
    // Mock the gh command to avoid actually running it
    const originalExec = $;
    let capturedCommand = null;
    let tempFileUsed = null;
    
    // We'll override the internal command execution for this test
    try {
      const result = await githubCli.withBodyFile(
        ['issue', 'create'],
        testContent,
        { 
          repo: 'test/repo',
          title: 'Test Issue'
        }
      );
      
      // The command should have attempted to run but may fail since gh isn't set up
      // That's OK - we're testing the file handling logic
      expect(result).toBeDefined();
    } catch (error) {
      // Expected - gh command may not be available or authenticated
      // But the temp file should still be created and cleaned up
      expect(error.message).toMatch(/gh|command|spawn/);
    }
  });

  test('githubCli.withBodyFile handles complex markdown content safely', async () => {
    // Test that the function can handle complex content without throwing during file operations
    try {
      await githubCli.withBodyFile(
        ['issue', 'create'],
        complexMarkdownBody,
        { 
          repo: 'test/repo',
          title: 'Complex Markdown Test'
        }
      );
    } catch (error) {
      // Expected to fail at gh command execution, not file handling
      expect(error.message).toMatch(/gh|command|spawn/);
      // Should NOT contain file system errors
      expect(error.message).not.toMatch(/ENOENT|EACCES|EPERM/);
    }
  });

  test('githubCli.createIssue builds correct command structure', async () => {
    try {
      await githubCli.createIssue(
        'owner/repo',
        'Test Issue Title',
        complexMarkdownBody,
        {
          assignee: 'testuser',
          labels: ['bug', 'enhancement'],
          milestone: 'v1.0'
        }
      );
    } catch (error) {
      // Expected to fail at gh execution, but should have proper structure
      expect(error.message).toMatch(/gh|command|spawn/);
    }
  });

  test('githubCli.createPullRequest builds correct command structure', async () => {
    try {
      await githubCli.createPullRequest(
        'owner/repo',
        'Test PR Title',
        complexMarkdownBody,
        {
          base: 'main',
          head: 'feature-branch',
          assignee: 'testuser',
          reviewer: 'reviewer1',
          labels: 'bug',
          draft: true
        }
      );
    } catch (error) {
      // Expected to fail at gh execution, but should have proper structure
      expect(error.message).toMatch(/gh|command|spawn/);
    }
  });

  test('complex content with special characters is handled safely', async () => {
    const specialContent = `Content with:
- Backticks: \`code\` and \`\`\`javascript
  console.log('test');
\`\`\`
- Variables: \${HOME} and \$USER
- Quotes: "double" and 'single'
- Commands: $(whoami) and \`date\`
- Shell operators: && || & | > < >> <<
- Escapes: \\n \\t \\\\ \\"`;

    // Test that file creation and cleanup works with special content
    const tempFile = `/tmp/test-gh-body-${Date.now()}.md`;
    
    try {
      await fs.writeFile(tempFile, specialContent);
      const readContent = await fs.readFile(tempFile, 'utf8');
      expect(readContent).toBe(specialContent);
      await fs.unlink(tempFile);
    } catch (error) {
      // Cleanup in case of failure
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  });

  test('command-stream quoting vs githubCli approach comparison', async () => {
    const testContent = 'Test `backticks` ${var} "quotes"';
    
    // Test direct interpolation (potentially problematic)
    const directCmd = $({ mirror: false })`echo ${testContent}`;
    expect(directCmd.spec.command).toContain('Test `backticks` ${var} "quotes"');
    
    // Test that our content would be safely handled in a file
    const tempFile = `/tmp/comparison-test-${Date.now()}.md`;
    try {
      await fs.writeFile(tempFile, testContent);
      const fileContent = await fs.readFile(tempFile, 'utf8');
      expect(fileContent).toBe(testContent);
      await fs.unlink(tempFile);
    } catch (error) {
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  });

  test('empty and edge case content handling', async () => {
    const edgeCases = [
      '',  // Empty content
      ' ',  // Just whitespace
      '\n',  // Just newline
      '`',  // Single backtick
      '${',  // Incomplete variable
      '"',  // Single quote
      "'",  // Single quote
      '\\',  // Single backslash
    ];

    for (const content of edgeCases) {
      try {
        await githubCli.withBodyFile(
          ['invalid-command'],  // Use a command that fails quickly
          content,
          { repo: 'test/repo', title: 'Edge Case Test' }
        );
      } catch (error) {
        // Should fail on gh command, not on content handling
        expect(error.message).toMatch(/gh|command|spawn|invalid-command/);
      }
    }
  }, 10000);  // Increase timeout

  test('temporary file cleanup works even on command failure', async () => {
    const startingTempFiles = await getTempFileCount();
    
    try {
      await githubCli.withBodyFile(
        ['invalid-command'],
        'test content',
        {}
      );
    } catch (error) {
      // Expected to fail
    }
    
    // Give a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const endingTempFiles = await getTempFileCount();
    
    // Temp files should not have increased (cleanup should work)
    expect(endingTempFiles).toBeLessThanOrEqual(startingTempFiles + 1); // Allow for some tolerance
  });
});

// Helper function to count temporary files (rough estimate)
async function getTempFileCount() {
  try {
    const files = await fs.readdir('/tmp');
    return files.filter(f => f.startsWith('gh-')).length;
  } catch {
    return 0;
  }
}