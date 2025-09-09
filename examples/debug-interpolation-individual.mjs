#!/usr/bin/env node

// Debug script to understand the interpolation and escaping behavior
import { $ } from '../src/$.mjs';

async function debugInterpolation() {
  console.log('Testing individual interpolation behavior...\n');
  
  const label = "help wanted";
  
  // Test direct interpolation
  console.log('--- Direct interpolation ---');
  console.log(`Label variable: "${label}"`);
  
  // Test how the buildShellCommand function handles this
  const testCommand1 = `gh search issues "repo:test/test label:${label}"`;
  console.log(`Template result: ${testCommand1}`);
  
  // Test with just echo to see what gets passed
  console.log('\n--- Echo test ---');
  try {
    const result1 = await $`echo "repo:test/test label:${label}"`.run({ capture: true, mirror: false });
    console.log(`Echo result: ${result1.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test with printf to see what gets passed 
  console.log('\n--- Printf test ---');
  try {
    const result2 = await $`printf 'repo:test/test label:%s\n' ${label}`.run({ capture: true, mirror: false });
    console.log(`Printf result: ${result2.stdout.trim()}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Show what quote function produces
  console.log('\n--- Quote function test ---');
  const { quote } = await import('../src/$.mjs');
  const quotedLabel = quote(label);
  console.log(`quote("${label}") = ${quotedLabel}`);
  
  // Test the full GitHub command structure
  console.log('\n--- Full GitHub command debug ---');
  const owner = "test";
  const repo = "test"; 
  
  try {
    // Enable verbose tracing
    process.env.COMMAND_STREAM_VERBOSE = 'true';
    
    const result3 = await $`echo gh search issues "repo:${owner}/${repo} label:${label}"`.run({ capture: true, mirror: false });
    console.log(`Command as seen by shell: ${result3.stdout.trim()}`);
    
    // Try with quotes around the whole query
    const query = `repo:${owner}/${repo} label:${label}`;
    const result4 = await $`echo gh search issues ${query}`.run({ capture: true, mirror: false });
    console.log(`Command with variable query: ${result4.stdout.trim()}`);
    
    process.env.COMMAND_STREAM_VERBOSE = 'false';
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

debugInterpolation().catch(console.error);