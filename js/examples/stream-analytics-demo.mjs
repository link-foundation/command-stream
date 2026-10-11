// Finite log-monitoring example; use tail -f as the source for a live monitor.
import { command } from '../src/$.mjs';

const logs = command(
  process.execPath,
  '-e',
  `
  for (let i = 1; i <= 8; i++) {
    console.log((i % 4 === 0 ? 'ERROR' : 'INFO') + ' request ' + i + ' ' + (100 + i * 20) + 'ms');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
`
).with({ capture: false, mirror: false });
const stats = await logs.stream().analyze({
  errorRate: (line) => line.startsWith('ERROR'),
  responseTime: (line) => Number(line.match(/(\d+)ms/)[1]),
  onUpdate: async (stats) => {
    if (stats.count % 4 === 0) {
      console.log({
        requests: stats.count,
        errorRate: stats.errorRate,
        meanMs: stats.responseTime.mean,
      });
    }
  },
});
console.log('Final statistics:', stats);
