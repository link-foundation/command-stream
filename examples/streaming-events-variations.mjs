#!/usr/bin/env node

// Various event-based streaming patterns using $({ options }) syntax

import { $ } from '../src/$.mjs';

console.log('=== Event-Based Streaming Variations ===\n');

// Example 1: Real-time log processing with events
console.log('1. Real-time log processing:');
const $logProcessor = $({ mirror: false });

try {
  const logScript = `
echo "INFO: Application starting"
sleep 0.2
echo "DEBUG: Loading configuration"
sleep 0.2
echo "WARN: Deprecated API usage detected" >&2
sleep 0.2
echo "INFO: Server listening on port 3000"
sleep 0.2
echo "ERROR: Database connection failed" >&2
sleep 0.2
echo "INFO: Retrying database connection"
sleep 0.2
echo "INFO: Application ready"
`;

  const runner = $logProcessor`bash -c '${logScript}'`;
  
  const logStats = { info: 0, debug: 0, warn: 0, error: 0 };
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (line.includes('INFO:')) {
        logStats.info++;
        console.log(`   ℹ️  ${line}`);
      } else if (line.includes('DEBUG:')) {
        logStats.debug++;
        console.log(`   🐛 ${line}`);
      }
    }
  });
  
  runner.on('stderr', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (line.includes('WARN:')) {
        logStats.warn++;
        console.log(`   ⚠️  ${line}`);
      } else if (line.includes('ERROR:')) {
        logStats.error++;
        console.log(`   ❌ ${line}`);
      }
    }
  });
  
  runner.on('close', (code) => {
    console.log(`   📊 Log summary: ${logStats.info} info, ${logStats.debug} debug, ${logStats.warn} warnings, ${logStats.error} errors`);
  });
  
  await runner;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 2: File monitoring with events
console.log('2. File monitoring simulation:');
const $fileMonitor = $({ mirror: false, capture: true });

try {
  const monitorScript = `
echo "File: config.json - CREATED"
sleep 0.3
echo "File: config.json - MODIFIED"
sleep 0.3
echo "File: app.log - CREATED"
sleep 0.3
echo "File: temp.txt - CREATED"
sleep 0.3
echo "File: temp.txt - DELETED"
sleep 0.3
echo "File: config.json - MODIFIED"
`;

  const runner = $fileMonitor`bash -c '${monitorScript}'`;
  
  const fileEvents = new Map();
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const match = line.match(/File: (.+) - (.+)/);
      if (match) {
        const [, filename, action] = match;
        
        if (!fileEvents.has(filename)) {
          fileEvents.set(filename, []);
        }
        fileEvents.get(filename).push(action);
        
        const emoji = {
          'CREATED': '📄',
          'MODIFIED': '✏️',
          'DELETED': '🗑️'
        }[action] || '📋';
        
        console.log(`   ${emoji} ${filename}: ${action.toLowerCase()}`);
      }
    }
  });
  
  runner.on('close', (code) => {
    console.log(`   📊 File activity summary:`);
    for (const [filename, events] of fileEvents) {
      console.log(`     ${filename}: ${events.join(' → ')}`);
    }
  });
  
  await runner;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 3: Build process with events
console.log('3. Build process simulation:');
const $buildProcess = $({ mirror: false });

try {
  const buildScript = `
echo "Build started"
echo "Compiling TypeScript..." >&2
sleep 0.5
echo "✓ TypeScript compilation complete"
echo "Running tests..." >&2
sleep 0.8
echo "✓ All tests passed (15/15)"
echo "Bundling assets..." >&2
sleep 0.6
echo "✓ Assets bundled successfully"
echo "Optimizing..." >&2
sleep 0.4
echo "✓ Optimization complete"
echo "Build finished successfully"
`;

  const runner = $buildProcess`bash -c '${buildScript}'`;
  
  const buildSteps = [];
  let startTime = Date.now();
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (line.startsWith('✓')) {
        buildSteps.push(line);
        console.log(`   [${elapsed}s] ✅ ${line.substring(2)}`);
      } else if (line.includes('Build started')) {
        console.log(`   [${elapsed}s] 🚀 ${line}`);
      } else if (line.includes('Build finished')) {
        console.log(`   [${elapsed}s] 🎉 ${line}`);
      }
    }
  });
  
  runner.on('stderr', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   [${elapsed}s] ⏳ ${line}`);
    }
  });
  
  runner.on('close', (code) => {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   🏁 Build completed in ${totalTime}s with ${buildSteps.length} successful steps`);
  });
  
  await runner;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 4: Interactive command with events
console.log('4. Interactive command simulation:');
const $interactive = $({ stdin: 'John\n25\nDeveloper\ny\n', mirror: false });

try {
  const interactiveScript = `
echo "Please enter your name:"
read name
echo "Hello $name!"
echo "Please enter your age:"
read age
echo "You are $age years old."
echo "Please enter your job:"
read job
echo "So you work as a $job."
echo "Is this correct? (y/n):"
read confirm
if [ "$confirm" = "y" ]; then
  echo "Profile saved successfully!"
else
  echo "Profile cancelled."
fi
`;

  const runner = $interactive`bash -c '${interactiveScript}'`;
  
  let questionCount = 0;
  let responseCount = 0;
  
  runner.on('stdout', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (line.includes('Please enter') || line.includes('Is this correct')) {
        questionCount++;
        console.log(`   ❓ Question #${questionCount}: ${line}`);
      } else if (line.includes('Hello') || line.includes('You are') || line.includes('So you work')) {
        responseCount++;
        console.log(`   💬 Response #${responseCount}: ${line}`);
      } else if (line.includes('Profile saved') || line.includes('Profile cancelled')) {
        console.log(`   ✅ Result: ${line}`);
      }
    }
  });
  
  runner.on('close', (code) => {
    console.log(`   📝 Interactive session completed: ${questionCount} questions, ${responseCount} responses`);
  });
  
  await runner;
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// Example 5: Network monitoring with events
console.log('5. Network monitoring with multiple hosts:');

const hosts = ['google.com', 'github.com', 'stackoverflow.com'];
const $networkMonitors = hosts.map(() => $({ mirror: false }));

try {
  console.log('   Starting network monitoring...');
  
  const hostResults = new Map();
  const promises = [];
  
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const monitor = $networkMonitors[i];
    const runner = monitor`ping -c 3 ${host}`;
    
    hostResults.set(host, { packets: 0, avgTime: 0, times: [] });
    
    runner.on('stdout', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.includes('bytes from')) {
          const timeMatch = line.match(/time=([0-9.]+)/);
          if (timeMatch) {
            const time = parseFloat(timeMatch[1]);
            const result = hostResults.get(host);
            result.packets++;
            result.times.push(time);
            console.log(`   🌐 ${host}: packet #${result.packets} (${time}ms)`);
          }
        }
      }
    });
    
    runner.on('close', (code) => {
      const result = hostResults.get(host);
      if (result.times.length > 0) {
        result.avgTime = (result.times.reduce((a, b) => a + b, 0) / result.times.length).toFixed(2);
      }
      console.log(`   ✅ ${host}: monitoring complete (avg: ${result.avgTime}ms)`);
    });
    
    promises.push(runner);
  }
  
  await Promise.all(promises);
  
  console.log('\n   📊 Network monitoring summary:');
  for (const [host, result] of hostResults) {
    const status = result.packets > 0 ? '🟢' : '🔴';
    console.log(`   ${status} ${host}: ${result.packets} packets, avg ${result.avgTime}ms`);
  }
  
} catch (error) {
  console.log(`   Error: ${error.message}`);
}

console.log('\n=== Event-based streaming variations completed ===');