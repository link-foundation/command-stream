import { $ } from '../src/$.mjs';

const cmd = $`echo hello`;
const types = [];
for await (const chunk of cmd.stream()) {
  types.push(chunk.type);
  console.log(
    'chunk:',
    chunk.type,
    chunk.code ?? '',
    (chunk.data?.toString?.() ?? '').trim()
  );
}
console.log('TYPES:', JSON.stringify(types));
console.log('Has exit chunk?', types.includes('exit'));
