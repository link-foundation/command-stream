import { $ } from '../src/$.mjs';

const start = Date.now();
// sh exits immediately but backgrounds a sleep that inherits stdout, keeping pipe open
const cmd = $`sh -c 'sleep 3 & echo done'`;
const types = [];
const timer = setTimeout(() => {
  console.log('STILL HANGING after 1.5s, elapsed', Date.now() - start);
}, 1500);
for await (const chunk of cmd.stream()) {
  types.push(chunk.type);
  console.log(
    'chunk:',
    chunk.type,
    chunk.code ?? '',
    (chunk.data?.toString?.() ?? '').trim(),
    'at',
    Date.now() - start,
    'ms'
  );
}
clearTimeout(timer);
console.log(
  'DONE. elapsed',
  Date.now() - start,
  'ms, types:',
  JSON.stringify(types)
);
