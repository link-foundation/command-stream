import { $ } from '../src/$.mjs';
const runner = $({ stdin: 'test input\n' })`sleep 10`;
const promise = runner.start();
await new Promise((r) => setTimeout(r, 200));
runner.kill();
const result = await promise;
console.log('RESULT CODE:', result.code, 'cancelled:', runner._cancelled);
