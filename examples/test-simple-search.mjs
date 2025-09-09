#!/usr/bin/env node

// Test simple GitHub CLI searches to understand correct syntax
import { execSync } from 'child_process';

async function testSimpleSearch() {
  console.log('Testing simple GitHub CLI search syntax...\n');
  
  console.log('--- Test 1: Simple search without labels ---');
  try {
    const cmd1 = `gh search issues "repo:nodejs/node is:open" --limit 1 --json url,title`;
    console.log(`Command: ${cmd1}`);
    const result1 = execSync(cmd1, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: Found issues`);
  } catch (error) {
    console.log(`Failed: ${error.message.slice(0, 200)}`);
  }
  
  console.log('\n--- Test 2: Search with known label ---');
  try {
    const cmd2 = `gh search issues "repo:nodejs/node is:open label:bug" --limit 1 --json url,title`;
    console.log(`Command: ${cmd2}`);
    const result2 = execSync(cmd2, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: Found issues with bug label`);
  } catch (error) {
    console.log(`Failed: ${error.message.slice(0, 200)}`);
  }
  
  console.log('\n--- Test 3: Search with label containing spaces (correct format) ---');
  try {
    // Use actual label from nodejs/node repo - let's check what labels exist first
    const cmd3 = `gh search issues "repo:nodejs/node is:open" --limit 5 --json url,title,labels`;
    const result3 = execSync(cmd3, { encoding: 'utf8', timeout: 10000 });
    const issues = JSON.parse(result3);
    console.log(`Found ${issues.length} issues`);
    if (issues.length > 0 && issues[0].labels) {
      console.log(`Example labels:`, issues[0].labels.map(l => l.name).slice(0, 5));
    }
  } catch (error) {
    console.log(`Failed: ${error.message.slice(0, 200)}`);
  }
  
  console.log('\n--- Test 4: Direct command line test ---');
  try {
    // Test what actually happens with real gh command
    const cmd4 = `gh search issues repo:nodejs/node is:open --limit 1`;
    console.log(`Command: ${cmd4}`);
    const result4 = execSync(cmd4, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success - raw output exists`);
  } catch (error) {
    console.log(`Failed: ${error.message.slice(0, 200)}`);
  }
}

testSimpleSearch().catch(console.error);