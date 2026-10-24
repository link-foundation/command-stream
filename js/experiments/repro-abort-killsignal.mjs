import { $ } from '../src/$.mjs';
const ac = new AbortController();
const running = $({
  mirror: false,
  signal: ac.signal,
  killSignal: 'SIGINT',
})`sh -c 'i=0; while true; do echo a-$i; i=$((i+1)); sleep 0.05; done'`;
setTimeout(() => {
  console.log('aborting');
  ac.abort();
}, 200);
try {
  const result = await running;
  console.log('resolved exit code:', result.code);
} catch (e) {
  console.log(
    'threw:',
    e.constructor.name,
    e.message,
    'code=',
    e.code,
    'result.code=',
    e.result?.code
  );
}
console.log('END');
