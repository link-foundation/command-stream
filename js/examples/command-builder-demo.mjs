import { command } from '../src/$.mjs';

// Run from any working directory with Node.js or Bun.
const node = command.with({ mirror: false });
const base = node(process.execPath, ['-e', 'console.log(process.argv[1])']);
const literal = base.arg("spaces; $HOME and 'quotes'");
console.log('Literal output:', (await (await literal).text()).trim());
console.log('POSIX argv:', String(literal));
console.log('Sync status:', literal.exitCode().sync());
const configured = literal.pipe(command.stdout('inherit'), command.exitCode);
console.log('Inherited output status:', await configured.run());
const lines = await node(
  process.execPath,
  '-e',
  'console.log("first\\nsecond")'
)
  .capture(false)
  .stream()
  .map((line) => line.toUpperCase())
  .toArray();
console.log('Streamed lines:', lines);
