// Execa uses exact argv, with isolated and general entry points.
import { $ } from '../../src/$.mjs';
import { execa } from '../../src/execa/index.mjs';
import { example } from './_harness.mjs';

await example(
  { id: 'execa-compat', title: 'Execa compatibility mode' },
  async ({ record }) => {
    record('isolated and general API', $.execa === execa);
    const script = 'process.stdout.write(process.argv.slice(1).join("|"))';
    record(
      'exact argv',
      (await $.execa(process.execPath, ['-e', script, 'hello world', '$HOME']))
        .stdout
    );
    const api = $.execaCompat({ stripFinalNewline: false });
    record(
      'preserved newline',
      (await api.execa(process.execPath, ['-e', 'console.log("hello")'])).stdout
    );
    record(
      'tolerated exit code',
      (
        await api.execa(process.execPath, ['-e', 'process.exit(3)'], {
          reject: false,
        })
      ).exitCode
    );
    record(
      'binary stdin',
      (
        await execa(
          process.execPath,
          ['-e', 'process.stdin.pipe(process.stdout)'],
          { input: 'input' }
        )
      ).stdout
    );
  }
);
