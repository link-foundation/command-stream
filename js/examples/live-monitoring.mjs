import $, { TerminalBuffer } from '../src/$.mjs';
const screen = new TerminalBuffer({ cols: 80, rows: 4 });
// A bot may forward frame.screen.join('\n') only when a frame changes.
screen.on('frame', (frame) => console.log(frame.screen.join('\n')));
$.create('sample-server-logs', async function* () {
  for (const [level, latency] of [
    ['info', 10],
    ['error', 30],
    ['info', 20],
  ]) {
    yield `${JSON.stringify({ level, latency })}\n`;
  }
});
try {
  await $({ mirror: false, capture: false })`sample-server-logs`
    .stream()
    .map(JSON.parse)
    .analyze({
      errorRate: (record) => record.level === 'error',
      responseTime: (record) => record.latency,
      onUpdate: async (stats) => {
        await screen.write(
          `\r\x1b[2KRequests: ${stats.count}; error rate: ${(stats.errorRate * 100).toFixed(1)}%; mean: ${stats.responseTime.mean} ms`
        );
        await screen.flush();
      },
    });
} finally {
  $.unregister('sample-server-logs');
  screen.dispose();
}
