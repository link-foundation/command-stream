import { command, merge } from '../src/$.mjs';

function monitor(service) {
  return command(
    process.execPath,
    '-e',
    `
    for (let i = 0; i < 4; i++) {
      console.log('${service}: ' + (i === 2 ? 'ERROR timeout' : 'INFO healthy'));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  `
  )
    .with({ capture: false, mirror: false })
    .stream()
    .lines()
    .map((line) => ({ service, line }));
}

// Tag values before merging to retain source identity without modifying chunks.
const stats = await merge(monitor('api'), monitor('worker')).analyze({
  errorRate: (entry) => entry.line.includes('ERROR'),
  onUpdate: (stats) => {
    console.log({ messages: stats.count, errors: stats.errors });
  },
});
console.log('Combined error rate:', stats.errorRate);
