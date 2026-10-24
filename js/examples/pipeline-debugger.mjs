import { PipelineDebugger, stream } from '../src/$.mjs';
const debugger_ = new PipelineDebugger({ paused: true });
const view = await debugger_.serve();
console.log(`Open ${view.url} and press Step or Resume.`);
const input = debugger_.stage(
  'Requests',
  stream([
    { status: 200, latency: 10 },
    { status: 500, latency: 80 },
    { status: 200, latency: 20 },
  ])
);
const errors = debugger_.stage(
  'Errors',
  input.filter((record) => record.status >= 400)
);
const alerts = debugger_.stage(
  'Alerts',
  errors.map((record) => `HTTP ${record.status}: ${record.latency} ms`)
);
const work = alerts.forEach((alert) => console.log(alert));
work.catch((error) => console.error(error));
let stopping = false;
process.on('SIGINT', async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  debugger_.resume();
  await work.catch(() => {});
  await view.close();
});
