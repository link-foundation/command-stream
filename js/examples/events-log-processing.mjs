#!/usr/bin/env node

// Real-time log processing with events

import { $ } from '../js/src/$.mjs';

console.log('Real-time log processing:');
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
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    for (const line of lines) {
      if (line.includes('INFO:')) {
        logStats.info++;
        console.log(`ℹ️  ${line}`);
      } else if (line.includes('DEBUG:')) {
        logStats.debug++;
        console.log(`🐛 ${line}`);
      }
    }
  });

  runner.on('stderr', (data) => {
    const lines = data
      .toString()
      .split('\n')
      .filter((line) => line.trim());
    for (const line of lines) {
      if (line.includes('WARN:')) {
        logStats.warn++;
        console.log(`⚠️  ${line}`);
      } else if (line.includes('ERROR:')) {
        logStats.error++;
        console.log(`❌ ${line}`);
      }
    }
  });

  runner.on('close', (code) => {
    console.log(
      `📊 Log summary: ${logStats.info} info, ${logStats.debug} debug, ${logStats.warn} warnings, ${logStats.error} errors`
    );
  });

  await runner;
} catch (error) {
  console.log(`Error: ${error.message}`);
}
