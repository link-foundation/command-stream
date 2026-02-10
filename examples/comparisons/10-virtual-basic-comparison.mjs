#!/usr/bin/env node
/**
 * Virtual Commands Basic: Node.js vs Bun.js Comparison
 * 
 * This example demonstrates custom JavaScript functions as shell commands
 * working identically in both Node.js and Bun.js runtimes.
 */

import { $, register, unregister, listCommands } from '../../src/$.mjs';

// Runtime detection
const runtime = typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node.js';
console.log(`🚀 Running with ${runtime}`);
console.log('=' .repeat(50));

async function virtualBasicComparison() {
  try {
    console.log('1️⃣  Basic Virtual Command Registration:');
    
    // Register a simple greeting command
    register('greet', async ({ args, stdin }) => {
      const name = args[0] || 'World';
      return { stdout: `Hello, ${name}! (from ${runtime})\n`, code: 0 };
    });
    
    const result1 = await $`greet ${runtime}`;
    console.log(`   Output: ${result1.stdout.trim()}`);

    console.log('\n2️⃣  Virtual Command with Input Processing:');
    
    // Register an uppercase converter
    register('uppercase', async ({ args, stdin }) => {
      const input = stdin || args.join(' ') || '';
      return { stdout: input.toUpperCase() + '\n', code: 0 };
    });
    
    const result2 = await $`uppercase "hello from virtual command"`;
    console.log(`   Output: ${result2.stdout.trim()}`);

    console.log('\n3️⃣  Virtual Command in Pipeline:');
    
    // Use virtual command in pipeline
    const result3 = await $`echo "pipeline test" | uppercase`;
    console.log(`   Pipeline output: ${result3.stdout.trim()}`);

    console.log('\n4️⃣  Virtual Command with Arguments:');
    
    // Register a math command
    register('math', async ({ args }) => {
      if (args.length < 3) {
        return { stderr: 'Usage: math <num1> <op> <num2>\n', code: 1 };
      }
      
      const [num1, op, num2] = args;
      const a = parseFloat(num1);
      const b = parseFloat(num2);
      let result;
      
      switch (op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/': result = a / b; break;
        default: return { stderr: `Unknown operator: ${op}\n`, code: 1 };
      }
      
      return { stdout: `${result}\n`, code: 0 };
    });
    
    const result4 = await $`math 15 + 27`;
    console.log(`   Math result: ${result4.stdout.trim()}`);

    console.log('\n5️⃣  Virtual Command Error Handling:');
    
    try {
      await $`math invalid syntax`;
    } catch (error) {
      console.log(`   ✅ Caught expected error: ${error.message.trim()}`);
    }

    console.log('\n6️⃣  Complex Virtual Command:');
    
    // Register a data formatter
    register('format-data', async ({ args, stdin }) => {
      const format = args[0] || 'json';
      const data = {
        runtime: runtime,
        timestamp: new Date().toISOString(),
        input: stdin || 'no input',
        processed: true
      };
      
      let output;
      switch (format) {
        case 'json':
          output = JSON.stringify(data, null, 2) + '\n';
          break;
        case 'csv':
          output = Object.entries(data).map(([k, v]) => `${k},${v}`).join('\n') + '\n';
          break;
        default:
          output = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
      }
      
      return { stdout: output, code: 0 };
    });
    
    const result6 = await $`echo "test input" | format-data json`;
    const formatted = JSON.parse(result6.stdout);
    console.log(`   Formatted data runtime: ${formatted.runtime}`);
    console.log(`   Formatted data input: ${formatted.input.trim()}`);

    console.log('\n7️⃣  Command Management:');
    
    const commands = listCommands();
    console.log(`   Registered commands: ${commands.filter(c => ['greet', 'uppercase', 'math', 'format-data'].includes(c)).join(', ')}`);
    
    // Clean up
    unregister('greet');
    unregister('uppercase');
    unregister('math');
    unregister('format-data');
    
    const afterCleanup = listCommands();
    console.log(`   After cleanup: ${afterCleanup.filter(c => ['greet', 'uppercase', 'math', 'format-data'].includes(c)).length === 0 ? '✅ All cleaned up' : '❌ Some remained'}`);

    console.log('\n' + '=' .repeat(50));
    console.log(`✅ All virtual command patterns work perfectly in ${runtime}!`);
    
  } catch (error) {
    console.error(`❌ Error in ${runtime}:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

virtualBasicComparison();