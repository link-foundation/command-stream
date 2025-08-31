#!/usr/bin/env node

// Ping streaming using event-based API with $({ options }) syntax

import { $ } from '../src/$.mjs';

console.log('=== Ping Streaming with Events ===\n');

// Example 1: Basic event-based ping with options
console.log('1. Basic event-based ping (silent mode):');
const $silent = $({ mirror: false });

try {
  const runner = $silent`ping -c 5 8.8.8.8`;
  
  let packetCount = 0;
  
  runner.on('stdout', (data) => {
    const output = data.toString().trim();
    if (output.includes('bytes from')) {
      packetCount++;
      const timeMatch = output.match(/time=([0-9.]+)/);
      const responseTime = timeMatch ? timeMatch[1] : 'unknown';
      console.log(`   📡 Packet #${packetCount}: ${responseTime}ms`);
    }
  });
  
  runner.on('stderr', (data) => {
    console.log(`   ⚠️  Error: ${data.toString().trim()}`);
  });
  
  runner.on('close', (code) => {
    console.log(`   ✅ Ping completed with exit code: ${code}`);
    console.log(`   📊 Total packets received: ${packetCount}`);
  });
  
  await runner;
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: Event-based with custom stdin
console.log('2. Event-based with custom stdin:');
const $withInput = $({ stdin: 'Hello\nWorld\nTest\n', mirror: false });

try {
  const runner = $withInput`cat -n`;
  
  let lineCount = 0;
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      lineCount++;
      console.log(`   📝 Line processed: ${line}`);
    }
  });
  
  runner.on('close', (code) => {
    console.log(`   ✅ Input processing completed`);
    console.log(`   📊 Total lines processed: ${lineCount}`);
  });
  
  await runner;
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Long-running process with progress events
console.log('3. Long-running process with progress tracking:');
const $progress = $({ mirror: false, capture: true });

try {
  const progressScript = `
for i in {1..10}; do
  echo "Progress: $i/10"
  echo "Status: Processing item $i" >&2
  sleep 0.3
done
echo "Complete!"
`;

  const runner = $progress`bash -c '${progressScript}'`;
  
  let progressCount = 0;
  let statusCount = 0;
  
  runner.on('stdout', (data) => {
    const output = data.toString().trim();
    if (output.includes('Progress:')) {
      progressCount++;
      const percent = (progressCount / 10 * 100).toFixed(0);
      console.log(`   📊 ${output} (${percent}%)`);
    } else if (output.includes('Complete')) {
      console.log(`   ✅ ${output}`);
    }
  });
  
  runner.on('stderr', (data) => {
    const output = data.toString().trim();
    if (output.includes('Status:')) {
      statusCount++;
      console.log(`   🔄 ${output}`);
    }
  });
  
  runner.on('close', (code) => {
    console.log(`   🏁 Process completed with code: ${code}`);
    console.log(`   📈 Progress events: ${progressCount}, Status events: ${statusCount}`);
  });
  
  const result = await runner;
  console.log(`   💾 Captured output length: ${result.stdout.length} chars`);
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Error handling with events
console.log('4. Error handling and recovery:');
const $errorTest = $({ mirror: false });

try {
  // First try a command that will fail
  console.log('   Testing error handling...');
  const failRunner = $errorTest`ping -c 2 invalid.host.name.that.does.not.exist`;
  
  let errorMessages = [];
  
  failRunner.on('stdout', (data) => {
    console.log(`   📤 Stdout: ${data.toString().trim()}`);
  });
  
  failRunner.on('stderr', (data) => {
    const error = data.toString().trim();
    errorMessages.push(error);
    console.log(`   🚨 Stderr: ${error}`);
  });
  
  failRunner.on('close', (code) => {
    console.log(`   🔚 Failed command exit code: ${code}`);
    console.log(`   📝 Error messages collected: ${errorMessages.length}`);
  });
  
  try {
    await failRunner;
  } catch (error) {
    console.log(`   ⚠️  Caught error: ${error.message}`);
  }
  
  // Then try a command that succeeds
  console.log('\n   Testing successful recovery...');
  const successRunner = $errorTest`ping -c 2 127.0.0.1`;
  
  let successCount = 0;
  
  successRunner.on('stdout', (data) => {
    const output = data.toString().trim();
    if (output.includes('bytes from')) {
      successCount++;
      console.log(`   ✅ Success #${successCount}: Local ping OK`);
    }
  });
  
  successRunner.on('close', (code) => {
    console.log(`   🎯 Recovery successful with code: ${code}`);
  });
  
  await successRunner;
  
} catch (error) {
  console.log(`   ❌ Unexpected error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 5: Multiple concurrent event streams
console.log('5. Multiple concurrent event streams:');

const $concurrent1 = $({ mirror: false });
const $concurrent2 = $({ mirror: false });
const $concurrent3 = $({ mirror: false });

try {
  console.log('   Starting concurrent ping streams...');
  
  const runners = [
    { runner: $concurrent1`ping -c 3 8.8.8.8`, name: 'Google DNS' },
    { runner: $concurrent2`ping -c 3 1.1.1.1`, name: 'Cloudflare DNS' },
    { runner: $concurrent3`ping -c 3 127.0.0.1`, name: 'Localhost' }
  ];
  
  const results = {};
  
  for (const { runner, name } of runners) {
    results[name] = { packets: 0, completed: false };
    
    runner.on('stdout', (data) => {
      const output = data.toString().trim();
      if (output.includes('bytes from')) {
        results[name].packets++;
        console.log(`   🌐 ${name}: packet #${results[name].packets}`);
      }
    });
    
    runner.on('close', (code) => {
      results[name].completed = true;
      console.log(`   ✅ ${name}: completed (${results[name].packets} packets)`);
    });
  }
  
  // Wait for all to complete
  await Promise.all(runners.map(({ runner }) => runner));
  
  console.log('\n   📊 Final results:');
  for (const [name, data] of Object.entries(results)) {
    const status = data.completed ? '✅' : '❌';
    console.log(`   ${status} ${name}: ${data.packets} packets received`);
  }
  
} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n=== Event-based streaming examples completed ===');