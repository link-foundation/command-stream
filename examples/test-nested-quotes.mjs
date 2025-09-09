#!/usr/bin/env node

// Test to understand nested quote behavior
import { $ } from '../src/$.mjs';

async function testNestedQuotes() {
  console.log('Testing nested quote behavior...\n');
  
  const label = "help wanted";
  
  // Test 1: See what happens with different quote structures
  console.log('--- Test 1: Direct echo with nested quotes ---');
  try {
    const result1 = await $`echo "label:${label}"`.run({ capture: true, mirror: false });
    console.log(`Result: ${result1.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test 2: See what happens without outer quotes
  console.log('\n--- Test 2: Echo without outer quotes ---');
  try {
    const result2 = await $`echo label:${label}`.run({ capture: true, mirror: false });
    console.log(`Result: ${result2.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test 3: Use a variable for the whole thing
  console.log('\n--- Test 3: Full query as variable ---');
  try {
    const query = `repo:test/test is:issue is:open label:${label}`;
    const result3 = await $`echo gh search issues ${query}`.run({ capture: true, mirror: false });
    console.log(`Result: ${result3.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test 4: Show actual shell escaping
  console.log('\n--- Test 4: What does the shell actually see ---');
  const { quote } = await import('../src/$.mjs');
  console.log(`quote("help wanted") = ${quote("help wanted")}`);
  console.log(`quote("repo:test/test label:help wanted") = ${quote("repo:test/test label:help wanted")}`);
  
  // Test 5: Try different quote styles
  console.log('\n--- Test 5: Force single quotes ---');
  const labelSingleQuoted = "'help wanted'";
  try {
    const result5 = await $`echo "label:${labelSingleQuoted}"`.run({ capture: true, mirror: false });
    console.log(`Result: ${result5.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

testNestedQuotes().catch(console.error);