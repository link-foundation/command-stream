#!/usr/bin/env node

// Test to find the correct GitHub CLI format
import { execSync } from 'child_process';

async function testCorrectFormat() {
  console.log('Testing correct GitHub CLI format...\n');
  
  // What we're trying to achieve
  const owner = "nodejs";
  const repo = "node";
  const label = "help wanted";
  
  console.log('--- Method 1: Using execSync with single quotes around whole query ---');
  try {
    const query1 = `repo:${owner}/${repo} is:issue is:open label:"${label}"`;
    const cmd1 = `gh search issues '${query1}' --limit 1 --json url,title`;
    console.log(`Command: ${cmd1}`);
    
    const result1 = execSync(cmd1, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: ${result1.slice(0, 200)}`);
  } catch (error) {
    console.log(`Failed: ${error.message}`);
  }
  
  console.log('\n--- Method 2: Using execSync with escaped quotes ---');
  try {
    const cmd2 = `gh search issues "repo:${owner}/${repo} is:issue is:open label:\\"${label}\\"" --limit 1 --json url,title`;
    console.log(`Command: ${cmd2}`);
    
    const result2 = execSync(cmd2, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: ${result2.slice(0, 200)}`);
  } catch (error) {
    console.log(`Failed: ${error.message}`);
  }
  
  console.log('\n--- Method 3: Using execSync with no quotes around label ---');
  try {
    const cmd3 = `gh search issues "repo:${owner}/${repo} is:issue is:open label:${label.replace(' ', '+')}" --limit 1 --json url,title`;
    console.log(`Command: ${cmd3}`);
    
    const result3 = execSync(cmd3, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: ${result3.slice(0, 200)}`);
  } catch (error) {
    console.log(`Failed: ${error.message}`);
  }
  
  console.log('\n--- Method 4: Using URL encoding ---');
  try {
    const encodedLabel = encodeURIComponent(label);
    const cmd4 = `gh search issues "repo:${owner}/${repo} is:issue is:open label:${encodedLabel}" --limit 1 --json url,title`;
    console.log(`Command: ${cmd4}`);
    
    const result4 = execSync(cmd4, { encoding: 'utf8', timeout: 10000 });
    console.log(`Success: ${result4.slice(0, 200)}`);
  } catch (error) {
    console.log(`Failed: ${error.message}`);
  }
}

testCorrectFormat().catch(console.error);