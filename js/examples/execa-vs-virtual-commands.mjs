// The native registry composes built-ins, a real process and a JS handler.
import { $, register, unregister } from '../src/$.mjs';
import { execa } from '../src/execa/index.mjs';

register('project-greet', async ({ args }) => ({
  stdout: `Hello, ${args[0]}!\n`,
  code: 0,
}));
try {
  const script = 'process.stdin.pipe(process.stdout)';
  const result = await $({
    mirror: false,
  })`project-greet world | ${process.execPath} -e ${script} | cat`;
  console.log('Native mixed pipeline:', result.stdout.toString().trim());
  const missing = await execa('project-greet', ['world'], { reject: false });
  console.log('Execa executable lookup:', missing.code); // ENOENT: no OS executable
} finally {
  unregister('project-greet');
}
