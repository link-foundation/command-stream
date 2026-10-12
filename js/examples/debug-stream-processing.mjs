import { command } from '../src/$.mjs';

// Raw iteration preserves stdout/stderr/exit chunks; transforms consume lines.
const input = () =>
  command(process.execPath, '-e', "console.log('1\\n2\\n3')").with({
    capture: false,
    mirror: false,
  });
for await (const chunk of input().stream()) {
  console.log('Raw chunk:', chunk);
}
console.log(
  'Mapped values:',
  await input()
    .stream()
    .map((line) => Number(line) * 2)
    .toArray()
);
