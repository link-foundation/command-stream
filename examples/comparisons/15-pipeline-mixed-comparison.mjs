#!/usr/bin/env node
/**
 * Mixed Pipeline Support: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates advanced pipeline mixing system, built-in, 
 * and virtual commands working identically in both runtimes.
 */

import { $, register, unregister } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function pipelineMixedComparison() {
  try {
    console.log('1️⃣  System → Built-in Pipeline:');
    
    const result1 = await $`echo -e "file1.txt\nfile2.js\nfile3.py" | cat`;
    console.log(`   System to built-in: ${result1.stdout.trim().replace(/\n/g, ', ')}`);

    console.log('\n2️⃣  Built-in → System Pipeline:');
    
    const result2 = await $`seq 1 3 | wc -l`;
    console.log(`   Built-in to system: ${result2.stdout.trim()} lines`);

    console.log('\n3️⃣  Setting up Virtual Commands:');
    
    // Register virtual commands for mixed pipelines
    register('multiply', async ({ args, stdin }) => {
      const multiplier = parseInt(args[0]) || 2;
      const lines = stdin.split('\n').filter(line => line.trim());
      const results = lines.map(line => {
        const num = parseInt(line.trim());
        return isNaN(num) ? line : (num * multiplier).toString();
      });
      return { stdout: results.join('\n') + '\n', code: 0 };
    });
    
    register('prefix', async ({ args, stdin }) => {
      const prefix = args[0] || 'Item';
      const lines = stdin.split('\n').filter(line => line.trim());
      const results = lines.map((line, index) => `${prefix}-${index + 1}: ${line}`);
      return { stdout: results.join('\n') + '\n', code: 0 };
    });
    
    register('filter-even', async ({ stdin }) => {
      const lines = stdin.split('\n').filter(line => line.trim());
      const results = lines.filter(line => {
        const num = parseInt(line.trim());
        return !isNaN(num) && num % 2 === 0;
      });
      return { stdout: results.join('\n') + '\n', code: 0 };
    });

    console.log('   ✅ Virtual commands registered: multiply, prefix, filter-even');

    console.log('\n4️⃣  Built-in → Virtual → System Pipeline:');
    
    const result4 = await $`seq 1 6 | multiply 3 | wc -l`;
    console.log(`   Built-in→Virtual→System: ${result4.stdout.trim()} lines`);

    console.log('\n5️⃣  System → Virtual → Built-in Pipeline:');
    
    const result5 = await $`echo -e "10\n20\n15\n30" | filter-even | cat`;
    console.log(`   System→Virtual→Built-in: ${result5.stdout.trim().replace(/\n/g, ', ')}`);

    console.log('\n6️⃣  Complex Multi-stage Virtual Pipeline:');
    
    const result6 = await $`seq 1 8 | multiply 2 | filter-even | prefix "Even"`;
    const stages = result6.stdout.trim().split('\n');
    console.log(`   Multi-stage pipeline (${stages.length} results):`);
    stages.forEach(stage => console.log(`     ${stage}`));

    console.log('\n7️⃣  Mixing All Three Types:');
    
    const result7 = await $`echo -e "1\n2\n3\n4\n5" | multiply 10 | filter-even | sort -nr | cat`;
    console.log(`   All types mixed: ${result7.stdout.trim().replace(/\n/g, ', ')}`);

    console.log('\n8️⃣  Error Handling in Mixed Pipelines:');
    
    register('fail-sometimes', async ({ args, stdin }) => {
      const shouldFail = args[0] === 'fail';
      if (shouldFail) {
        return { stderr: 'Virtual command failed as requested\n', code: 1 };
      }
      return { stdout: stdin.toUpperCase(), code: 0 };
    });
    
    try {
      await $`echo "test" | fail-sometimes fail | cat`;
    } catch (error) {
      console.log(`   ✅ Caught pipeline error: Code ${error.code}`);
    }

    console.log('\n9️⃣  Performance Test - Large Pipeline:');
    
    const start = Date.now();
    const result9 = await $`seq 1 100 | multiply 2 | filter-even | prefix "Item" | wc -l`;
    const elapsed = Date.now() - start;
    
    console.log(`   Large pipeline processed ${result9.stdout.trim()} items in ${elapsed}ms`);

    console.log('\n🔟  Real-world Example - Data Processing:');
    
    register('json-extract', async ({ args, stdin }) => {
      const field = args[0] || 'value';
      const lines = stdin.split('\n').filter(line => line.trim());
      const results = [];
      
      lines.forEach(line => {
        try {
          const obj = JSON.parse(line);
          if (obj[field] !== undefined) {
            results.push(obj[field].toString());
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      });
      
      return { stdout: results.join('\n') + '\n', code: 0 };
    });
    
    const jsonData = '{"name":"Alice","value":10}\n{"name":"Bob","value":20}\n{"name":"Charlie","value":15}';
    const result10 = await $({ stdin: jsonData })`cat | json-extract value | multiply 2 | sort -n`;
    console.log(`   Data processing result: ${result10.stdout.trim().replace(/\n/g, ', ')}`);

    // Cleanup
    ['multiply', 'prefix', 'filter-even', 'fail-sometimes', 'json-extract'].forEach(unregister);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All mixed pipeline patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

pipelineMixedComparison();