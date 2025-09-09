#!/usr/bin/env node

// Test script to reproduce the GitHub search escaping issue with labels containing spaces
// This reproduces the issue described in: https://github.com/link-foundation/command-stream/issues/48

import { $ } from '../src/$.mjs';

async function testGitHubLabelEscaping() {
  console.log('Testing GitHub CLI label escaping with command-stream...\n');
  
  const labelWithSpaces = "help wanted";
  const owner = "nodejs";
  const repo = "node";
  
  console.log(`Label to search for: "${labelWithSpaces}"`);
  console.log(`Repository: ${owner}/${repo}\n`);
  
  try {
    // This should fail due to escaping issues according to the bug report
    console.log('--- Test 1: Direct label parameter (expected to fail) ---');
    const searchQuery1 = `repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"`;
    console.log(`Search query: ${searchQuery1}`);
    
    const result1 = await $`gh search issues ${searchQuery1} --limit 1 --json url,title 2>&1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result1.code}`);
    console.log(`Output: ${result1.stdout.trim()}`);
    
    if (result1.code !== 0) {
      console.log('✗ Failed as expected due to escaping issues');
    } else {
      console.log('✓ Unexpectedly succeeded');
    }
    
  } catch (error) {
    console.log(`✗ Exception caught: ${error.message}`);
  }
  
  console.log('\n--- Test 2: Alternative approach with templated query ---');
  try {
    const result2 = await $`gh search issues "repo:${owner}/${repo} is:issue is:open label:${labelWithSpaces}" --limit 1 --json url,title 2>&1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result2.code}`);
    console.log(`Output: ${result2.stdout.trim()}`);
    
    if (result2.code !== 0) {
      console.log('✗ Failed due to escaping issues');
    } else {
      console.log('✓ Succeeded');
    }
    
  } catch (error) {
    console.log(`✗ Exception caught: ${error.message}`);
  }
  
  console.log('\n--- Test 3: Manual escaping test ---');
  try {
    // Show what the quote function would do
    const { quote } = await import('../src/$.mjs');
    const quotedLabel = quote(labelWithSpaces);
    console.log(`Quoted label: ${quotedLabel}`);
    
    const result3 = await $`gh search issues "repo:${owner}/${repo} is:issue is:open label:${quotedLabel}" --limit 1 --json url,title 2>&1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result3.code}`);
    console.log(`Output: ${result3.stdout.trim()}`);
    
    if (result3.code !== 0) {
      console.log('✗ Failed even with manual quoting');
    } else {
      console.log('✓ Succeeded with manual quoting');
    }
    
  } catch (error) {
    console.log(`✗ Exception caught: ${error.message}`);
  }
}

testGitHubLabelEscaping().catch(console.error);