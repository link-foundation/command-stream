#!/usr/bin/env node

// Long-running process with progress events

import { $ } from '../js/src/$.mjs';

console.log('Long-running process with progress tracking:');
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
      const percent = ((progressCount / 10) * 100).toFixed(0);
      console.log(`📊 ${output} (${percent}%)`);
    } else if (output.includes('Complete')) {
      console.log(`✅ ${output}`);
    }
  });

  runner.on('stderr', (data) => {
    const output = data.toString().trim();
    if (output.includes('Status:')) {
      statusCount++;
      console.log(`🔄 ${output}`);
    }
  });

  runner.on('close', (code) => {
    console.log(`🏁 Process completed with code: ${code}`);
    console.log(
      `📈 Progress events: ${progressCount}, Status events: ${statusCount}`
    );
  });

  const result = await runner;
  console.log(`💾 Captured output length: ${result.stdout.length} chars`);
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}
