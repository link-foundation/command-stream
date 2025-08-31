#!/usr/bin/env node

// Build process simulation with events

import { $ } from '../src/$.mjs';

console.log('Build process simulation:');
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
        console.log(`[${elapsed}s] ✅ ${line.substring(2)}`);
      } else if (line.includes('Build started')) {
        console.log(`[${elapsed}s] 🚀 ${line}`);
      } else if (line.includes('Build finished')) {
        console.log(`[${elapsed}s] 🎉 ${line}`);
      }
    }
  });
  
  runner.on('stderr', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] ⏳ ${line}`);
    }
  });
  
  runner.on('close', (code) => {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🏁 Build completed in ${totalTime}s with ${buildSteps.length} successful steps`);
  });
  
  await runner;
} catch (error) {
  console.log(`Error: ${error.message}`);
}