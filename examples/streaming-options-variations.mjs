#!/usr/bin/env node

// Various streaming patterns using $({ options }) syntax

import { $ } from '../src/$.mjs';

console.log('=== Streaming with Options Variations ===\n');

// Example 1: Long-running command with silent capture
console.log('1. Long-running with silent capture:');
const $longSilent = $({ mirror: false, capture: true });

try {
  const startTime = Date.now();
  for await (const chunk of $longSilent`sleep 2 && echo "Task completed"`.stream()) {
    if (chunk.type === 'stdout') {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ⏱️  [${elapsed}s] ${chunk.data.toString().trim()}`);
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Interactive-style streaming with custom stdin
console.log('2. Interactive streaming with pre-filled input:');
const commands = 'ls -la\necho "Current directory listing"\nexit\n';
const $interactive = $({ stdin: commands, mirror: false });

try {
  for await (const chunk of $interactive`bash`.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`   🖥️  ${line}`);
        }
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Stream processing with filtering
console.log('3. Filtered streaming (only error-like output):');
const $filtered = $({ mirror: false });

try {
  const testScript = `
echo "INFO: Starting process"
echo "WARNING: This is a warning" >&2
echo "DEBUG: Processing data"
echo "ERROR: Something went wrong" >&2
echo "INFO: Process completed"
`;

  for await (const chunk of $filtered`bash -c '${testScript}'`.stream()) {
    const output = chunk.data.toString().trim();
    
    if (chunk.type === 'stderr' || output.includes('ERROR') || output.includes('WARNING')) {
      const prefix = chunk.type === 'stderr' ? '🚨' : '⚠️';
      console.log(`   ${prefix} ${output}`);
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Streaming with progress tracking
console.log('4. Progress tracking with streaming:');
const $progress = $({ mirror: false });

try {
  let progressCount = 0;
  const progressScript = `
for i in {1..5}; do
  echo "Progress: $i/5"
  sleep 0.5
done
echo "Complete!"
`;

  for await (const chunk of $progress`bash -c '${progressScript}'`.stream()) {
    if (chunk.type === 'stdout') {
      const output = chunk.data.toString().trim();
      if (output.includes('Progress:')) {
        progressCount++;
        const percent = (progressCount / 5 * 100).toFixed(0);
        console.log(`   📊 ${output} (${percent}%)`);
      } else if (output.includes('Complete')) {
        console.log(`   ✅ ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 5: Reusable configurations
console.log('5. Reusable streaming configurations:');

// Create different "profiles" for streaming
const $json = $({ mirror: false });
const $quiet = $({ mirror: false, capture: true });
const $verbose = $({ mirror: true });

try {
  // JSON-like structured output
  console.log('   JSON-style output:');
  for await (const chunk of $json`echo '{"status":"running","progress":50}'`.stream()) {
    if (chunk.type === 'stdout') {
      try {
        const data = JSON.parse(chunk.data.toString());
        console.log(`   📋 Status: ${data.status}, Progress: ${data.progress}%`);
      } catch {
        console.log(`   📋 Raw: ${chunk.data.toString().trim()}`);
      }
    }
  }

  // Quiet mode with post-processing
  console.log('\n   Quiet mode with result capture:');
  const runner = $quiet`echo "Result: $(date)"`;
  
  let streamOutput = '';
  for await (const chunk of runner.stream()) {
    if (chunk.type === 'stdout') {
      streamOutput += chunk.data.toString();
    }
  }
  
  const result = await runner;
  console.log(`   🤫 Streamed: "${streamOutput.trim()}"`);
  console.log(`   💾 Captured: "${result.stdout.trim()}"`);

  // Verbose mode (will show in terminal too)
  console.log('\n   Verbose mode (also shows in terminal):');
  for await (const chunk of $verbose`echo "This appears both in terminal and here"`.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`   📢 Processed: ${chunk.data.toString().trim()}`);
    }
  }

} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== All streaming options variations completed ===');