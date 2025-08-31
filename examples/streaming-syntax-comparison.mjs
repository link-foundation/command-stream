#!/usr/bin/env node

// Side-by-side comparison of regular $ vs $({ options }) streaming syntax

import { $ } from '../src/$.mjs';

console.log('=== Streaming Syntax Comparison ===\n');

// Example 1: Basic streaming - both syntaxes
console.log('1. Basic streaming comparison:');
console.log('   Regular $ syntax:');

try {
  for await (const chunk of $`echo "Hello from regular $"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`   📝 Regular: ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   $({ options }) syntax with mirror: false:');
const $configured = $({ mirror: false });

try {
  for await (const chunk of $configured`echo "Hello from configured $"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`   ⚙️  Configured: ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Same command, different options
console.log('2. Same command, different configurations:');
const testCommand = 'echo -e "Line 1\\nLine 2\\nLine 3"';

console.log('   Default behavior:');
try {
  for await (const chunk of $`${testCommand}`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach(line => console.log(`   📄 Default: ${line}`));
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Silent mode:');
const $silent = $({ mirror: false });
try {
  for await (const chunk of $silent`${testCommand}`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach(line => console.log(`   🔇 Silent: ${line}`));
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Capture enabled:');
const $capture = $({ capture: true, mirror: false });
try {
  const runner = $capture`${testCommand}`;
  
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach(line => console.log(`   📦 Streaming: ${line}`));
    }
  }
  
  const result = await runner;
  console.log(`   💾 Final result: "${result.stdout.trim()}"`);
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Chaining and piping comparison  
console.log('3. Command chaining with different options:');

console.log('   Regular $ with pipes:');
try {
  for await (const chunk of $`echo "apple,banana,cherry" | tr ',' '\\n' | sort`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach(line => console.log(`   🔗 Piped: ${line}`));
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Configured $ with pipes:');
const $pipe = $({ mirror: false });
try {
  for await (const chunk of $pipe`echo "zebra,yak,xerus" | tr ',' '\\n' | sort -r`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().trim().split('\n');
      lines.forEach(line => console.log(`   ⚙️  Configured: ${line}`));
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Multiple reusable configurations
console.log('4. Multiple reusable streaming configurations:');

const $timestamped = $({ mirror: false });
const $numbered = $({ mirror: false });
const $verbose = $({ mirror: true });

const messages = ['First message', 'Second message', 'Third message'];

console.log('   Timestamped streaming:');
try {
  for (const [index, message] of messages.entries()) {
    for await (const chunk of $timestamped`echo "${message}"`.stream()) {
      if (chunk.type === 'stdout') {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`   ⏰ [${timestamp}] ${chunk.data.toString().trim()}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Numbered streaming:');
try {
  for (const [index, message] of messages.entries()) {
    for await (const chunk of $numbered`echo "${message}"`.stream()) {
      if (chunk.type === 'stdout') {
        console.log(`   📝 #${index + 1}: ${chunk.data.toString().trim()}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n   Verbose streaming (also shows in terminal):');
try {
  for (const [index, message] of messages.entries()) {
    for await (const chunk of $verbose`echo "${message} (verbose)"`.stream()) {
      if (chunk.type === 'stdout') {
        console.log(`   📢 Verbose #${index + 1}: processed`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== Syntax comparison completed ===');