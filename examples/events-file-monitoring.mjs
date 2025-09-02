#!/usr/bin/env node

// File monitoring simulation with events

import { $ } from '../src/$.mjs';

console.log('File monitoring simulation:');
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
        
        console.log(`${emoji} ${filename}: ${action.toLowerCase()}`);
      }
    }
  });
  
  runner.on('close', (code) => {
    console.log(`📊 File activity summary:`);
    for (const [filename, events] of fileEvents) {
      console.log(`  ${filename}: ${events.join(' → ')}`);
    }
  });
  
  await runner;
} catch (error) {
  console.log(`Error: ${error.message}`);
}