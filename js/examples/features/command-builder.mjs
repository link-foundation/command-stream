import { command } from '../../src/$.mjs';
import { example } from './_harness.mjs';
await example(
  { id: 'command-builder', title: 'Build commands with literal arguments' },
  async ({ record }) => {
    const builder = command(
      process.execPath,
      '-e',
      'console.log(process.argv[1])',
      'hello ; $HOME'
    );
    record('literal argument', (await (await builder).text()).trim());
    record(
      'exit code',
      await command(process.execPath, '-e', 'process.exit(7)')
        .pipe(command.exitCode)
        .run()
    );
  }
);
