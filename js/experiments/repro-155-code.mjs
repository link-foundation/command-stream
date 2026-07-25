import { $ } from '../src/$.mjs';
const cmd = $({ mirror: false })`sh -c 'echo out; echo err 1>&2; exit 7'`;
for await (const chunk of cmd.stream()) {
  console.log(
    'chunk:',
    chunk.type,
    'code=' + (chunk.code ?? ''),
    (chunk.data?.toString?.() ?? '').trim()
  );
}
