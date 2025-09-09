#!/usr/bin/env node

// Comprehensive test demonstrating the GitHub search escaping solution
import { $ } from '../src/$.mjs';

async function testGitHubSearchSolution() {
  console.log('='.repeat(60));
  console.log('GitHub Search Escaping Issue #48 - Solution Demonstration');
  console.log('='.repeat(60));
  console.log();
  
  const owner = "nodejs";
  const repo = "node";
  const labelWithSpaces = "help wanted";
  
  console.log(`Target repository: ${owner}/${repo}`);
  console.log(`Label with spaces: "${labelWithSpaces}"`);
  console.log();
  
  console.log('❌ PROBLEMATIC APPROACHES (what users tried before)');
  console.log('-'.repeat(50));
  
  // Problem 1: Quoted search query
  console.log('Problem 1: Putting quotes around the entire search query');
  try {
    const searchQuery = `repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"`;
    const result = await $`gh search issues "${searchQuery}" --limit 1 --json url,title 2>&1`.run({ capture: true, mirror: false });
    console.log(`  Command: gh search issues "${searchQuery}" --limit 1`);
    console.log(`  Exit code: ${result.code}`);
    if (result.code !== 0) {
      console.log(`  ❌ Failed: ${result.stdout.split('\n')[0]}`);
    }
  } catch (error) {
    console.log(`  ❌ Exception: ${error.message}`);
  }
  console.log();
  
  // Problem 2: Template literal with quotes
  console.log('Problem 2: Using template literals with nested quotes');
  try {
    const result = await $`gh search issues "repo:${owner}/${repo} is:open label:${labelWithSpaces}" --limit 1 2>&1`.run({ capture: true, mirror: false });
    console.log(`  Command: gh search issues "repo:${owner}/${repo} is:open label:${labelWithSpaces}" --limit 1`);
    console.log(`  Exit code: ${result.code}`);
    if (result.code !== 0) {
      console.log(`  ❌ Failed: ${result.stdout.split('\n')[0]}`);
    }
  } catch (error) {
    console.log(`  ❌ Exception: ${error.message}`);
  }
  console.log();
  
  console.log('✅ WORKING SOLUTIONS');
  console.log('-'.repeat(50));
  
  // Solution 1: No quotes around search query
  console.log('Solution 1: Remove quotes around the search query');
  try {
    const result = await $`gh search issues repo:${owner}/${repo} is:open --limit 1 --json url,title`.run({ capture: true, mirror: false });
    console.log(`  Command: gh search issues repo:${owner}/${repo} is:open --limit 1`);
    console.log(`  Exit code: ${result.code}`);
    if (result.code === 0) {
      const issues = JSON.parse(result.stdout);
      console.log(`  ✅ Success: Found ${issues.length} issue(s)`);
    }
  } catch (error) {
    console.log(`  ❌ Exception: ${error.message}`);
  }
  console.log();
  
  // Solution 2: Handle spaces with URL encoding
  console.log('Solution 2: Handle spaces in labels with + replacement');
  try {
    const encodedLabel = labelWithSpaces.replace(/\s+/g, '+');
    const result = await $`gh search issues repo:${owner}/${repo} is:open label:${encodedLabel} --limit 1 --json url,title`.run({ capture: true, mirror: false });
    console.log(`  Command: gh search issues repo:${owner}/${repo} is:open label:${encodedLabel} --limit 1`);
    console.log(`  Exit code: ${result.code}`);
    if (result.code === 0) {
      const issues = JSON.parse(result.stdout);
      console.log(`  ✅ Success: Found ${issues.length} issue(s) with label "${labelWithSpaces}"`);
    }
  } catch (error) {
    console.log(`  ❌ Exception: ${error.message}`);
  }
  console.log();
  
  // Solution 3: Using separate variables for better control
  console.log('Solution 3: Build query components separately');
  try {
    const repoQuery = `repo:${owner}/${repo}`;
    const statusQuery = 'is:open';
    const encodedLabel = labelWithSpaces.replace(/\s+/g, '+');
    const labelQuery = `label:${encodedLabel}`;
    
    const result = await $`gh search issues ${repoQuery} ${statusQuery} ${labelQuery} --limit 1 --json url,title`.run({ capture: true, mirror: false });
    console.log(`  Command: gh search issues ${repoQuery} ${statusQuery} ${labelQuery} --limit 1`);
    console.log(`  Exit code: ${result.code}`);
    if (result.code === 0) {
      const issues = JSON.parse(result.stdout);
      console.log(`  ✅ Success: Found ${issues.length} issue(s) using component approach`);
    }
  } catch (error) {
    console.log(`  ❌ Exception: ${error.message}`);
  }
  console.log();
  
  console.log('📋 SUMMARY');
  console.log('-'.repeat(50));
  console.log('The root cause of GitHub search escaping issues:');
  console.log('  • GitHub CLI expects search terms as SEPARATE ARGUMENTS');
  console.log('  • NOT as a single quoted string');
  console.log('  • Spaces in label names should be replaced with + or URL encoded');
  console.log('  • command-stream\'s quote() function was over-quoting the queries');
  console.log();
  console.log('The fix applied to command-stream:');
  console.log('  • Modified quote() to prefer double quotes for simple spaced strings');
  console.log('  • This reduces nested quoting issues in template literals');
  console.log('  • Users should avoid quoting entire search queries');
  console.log();
}

testGitHubSearchSolution().catch(console.error);