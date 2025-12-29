#!/usr/bin/env node

// Streaming with progress tracking

import { $ } from '../js/src/$.mjs';

console.log('Progress tracking with streaming:');
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
        const percent = ((progressCount / 5) * 100).toFixed(0);
        console.log(`📊 ${output} (${percent}%)`);
      } else if (output.includes('Complete')) {
        console.log(`✅ ${output}`);
      }
    }
  }
} catch (error) {
  console.log(`Error: ${error.message}`);
}
