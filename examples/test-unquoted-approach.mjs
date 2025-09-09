#!/usr/bin/env node

// Test the unquoted approach with command-stream
import { $ } from '../src/$.mjs';

async function testUnquotedApproach() {
  console.log('Testing unquoted approach with command-stream...\n');
  
  const owner = "nodejs";
  const repo = "node";
  const label = "help wanted";
  
  console.log('--- Test 1: No quotes around search query ---');
  try {
    const result1 = await $`gh search issues repo:${owner}/${repo} is:open --limit 1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result1.code}`);
    if (result1.code === 0) {
      console.log(`✓ Success: ${result1.stdout.slice(0, 100)}`);
    } else {
      console.log(`✗ Failed: ${result1.stdout.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`✗ Exception: ${error.message}`);
  }
  
  console.log('\n--- Test 2: No quotes with label ---');
  try {
    const result2 = await $`gh search issues repo:${owner}/${repo} is:open label:bug --limit 1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result2.code}`);
    if (result2.code === 0) {
      console.log(`✓ Success: ${result2.stdout.slice(0, 100)}`);
    } else {
      console.log(`✗ Failed: ${result2.stdout.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`✗ Exception: ${error.message}`);
  }
  
  console.log('\n--- Test 3: No quotes with spaced label ---');
  try {
    // Using the old + replacement trick for spaces
    const labelWithPlus = label.replace(/\s+/g, '+');
    const result3 = await $`gh search issues repo:${owner}/${repo} is:open label:${labelWithPlus} --limit 1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result3.code}`);
    console.log(`Query was: repo:${owner}/${repo} is:open label:${labelWithPlus}`);
    if (result3.code === 0) {
      console.log(`✓ Success: ${result3.stdout.slice(0, 100)}`);
    } else {
      console.log(`✗ Failed: ${result3.stdout.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`✗ Exception: ${error.message}`);
  }
  
  console.log('\n--- Test 4: Check if + works for spaces ---');
  try {
    // Try with a known working repository and label
    const result4 = await $`gh search issues repo:microsoft/vscode is:open label:bug --limit 1`.run({ capture: true, mirror: false });
    console.log(`Exit code: ${result4.code}`);
    if (result4.code === 0) {
      console.log(`✓ Success with microsoft/vscode`);
    } else {
      console.log(`✗ Failed: ${result4.stdout.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`✗ Exception: ${error.message}`);
  }
}

testUnquotedApproach().catch(console.error);