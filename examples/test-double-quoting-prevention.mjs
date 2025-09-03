#!/usr/bin/env node

// Test: Prevent double-quoting when user provides quotes on strings that need quoting
import { $ } from '../src/$.mjs';

console.log('=== Double-Quoting Prevention Test ===\n');

async function testDoubleQuoting() {
  console.log('Scenario 1: User quotes a path with spaces');
  console.log('-------------------------------------------');
  
  // User provides quotes around a path with spaces
  const pathWithSpaces = '/path with spaces/command';
  const userQuoted1 = `'${pathWithSpaces}'`;
  const userQuoted2 = `"${pathWithSpaces}"`;
  
  console.log('Original path:', pathWithSpaces);
  console.log('\nUser provides single quotes:', userQuoted1);
  const cmd1 = $({ mirror: false })`${userQuoted1} --test`;
  console.log('Generated:', cmd1.spec.command);
  console.log('Expected: Already quoted, should not double-quote');
  
  console.log('\nUser provides double quotes:', userQuoted2);
  const cmd2 = $({ mirror: false })`${userQuoted2} --test`;
  console.log('Generated:', cmd2.spec.command);
  console.log('Expected: Preserve double quotes (wrap in single quotes)');
  
  console.log('\n\nScenario 2: User quotes a string with special characters');
  console.log('----------------------------------------------------------');
  
  // User provides quotes around dangerous strings
  const dangerous = 'test; echo HACKED';
  const userQuotedDanger1 = `'${dangerous}'`;
  const userQuotedDanger2 = `"${dangerous}"`;
  
  console.log('Dangerous string:', dangerous);
  console.log('\nUser provides single quotes:', userQuotedDanger1);
  const cmd3 = $({ mirror: false })`echo ${userQuotedDanger1}`;
  console.log('Generated:', cmd3.spec.command);
  console.log('Expected: Already single-quoted, should not double-quote');
  
  console.log('\nUser provides double quotes:', userQuotedDanger2);
  const cmd4 = $({ mirror: false })`echo ${userQuotedDanger2}`;
  console.log('Generated:', cmd4.spec.command);
  console.log('Expected: Preserve double quotes (wrap in single quotes)');
  
  console.log('\n\nScenario 3: User quotes safe strings (unnecessary)');
  console.log('----------------------------------------------------');
  
  const safe = 'hello';
  const userQuotedSafe1 = `'${safe}'`;
  const userQuotedSafe2 = `"${safe}"`;
  
  console.log('Safe string:', safe);
  console.log('\nUser unnecessarily single-quotes:', userQuotedSafe1);
  const cmd5 = $({ mirror: false })`echo ${userQuotedSafe1}`;
  console.log('Generated:', cmd5.spec.command);
  console.log('Expected: Preserve user\'s quotes even if unnecessary');
  
  console.log('\nUser unnecessarily double-quotes:', userQuotedSafe2);
  const cmd6 = $({ mirror: false })`echo ${userQuotedSafe2}`;
  console.log('Generated:', cmd6.spec.command);
  console.log('Expected: Preserve user\'s quotes (wrap in single quotes)');
  
  console.log('\n\nScenario 4: Complex edge cases');
  console.log('--------------------------------');
  
  // User quotes a string that contains quotes
  const withQuotes = "it's a test";
  const userQuotedComplex = `"${withQuotes}"`;
  
  console.log('String with internal quotes:', withQuotes);
  console.log('User wraps in double quotes:', userQuotedComplex);
  const cmd7 = $({ mirror: false })`echo ${userQuotedComplex}`;
  console.log('Generated:', cmd7.spec.command);
  console.log('Expected: Preserve double quotes, wrap in single quotes');
  
  // User provides escaped quotes
  const alreadyEscaped = "\\'test\\'";
  console.log('\nAlready escaped string:', alreadyEscaped);
  const cmd8 = $({ mirror: false })`echo ${alreadyEscaped}`;
  console.log('Generated:', cmd8.spec.command);
  console.log('Expected: Handle escaped quotes properly');
  
  console.log('\n\n=== Verification Tests ===\n');
  
  // Test that the commands actually work
  console.log('Testing actual execution:');
  
  try {
    // Test with user-quoted path with spaces
    const testPath = '"/test path/cmd"';
    const testCmd = $({ capture: true, mirror: false })`echo ${testPath}`;
    const result = await testCmd;
    console.log('\nInput:', testPath);
    console.log('Command:', testCmd.spec.command);
    console.log('Output:', (result.stdout || String(result)).trim());
    console.log('Verification:', 
      (result.stdout || String(result)).trim() === '"/test path/cmd"' 
        ? '✅ Quotes preserved correctly' 
        : '❌ Quotes not preserved');
    
    // Test with user-quoted dangerous string
    const testDanger = "'test; echo BAD'";
    const dangerCmd = $({ capture: true, mirror: false })`echo ${testDanger}`;
    const dangerResult = await dangerCmd;
    console.log('\nInput:', testDanger);
    console.log('Command:', dangerCmd.spec.command);
    console.log('Output:', (dangerResult.stdout || String(dangerResult)).trim());
    console.log('Verification:', 
      !(dangerResult.stdout || String(dangerResult)).includes('BAD') 
        ? '✅ No injection occurred' 
        : '❌ INJECTION!');
        
  } catch (error) {
    console.error('Execution error:', error.message);
  }
  
  console.log('\n\n=== Double-Quote Prevention Rules ===\n');
  console.log('1. If string starts and ends with single quotes: preserve as-is (no double-quoting)');
  console.log('2. If string starts and ends with double quotes: wrap in single quotes to preserve');
  console.log('3. If string has no quotes but needs them: add single quotes');
  console.log('4. If string has no quotes and doesn\'t need them: leave unquoted');
}

testDoubleQuoting().catch(console.error);