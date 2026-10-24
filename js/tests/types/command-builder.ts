import { $, command, CommandBuilder, create } from 'command-stream';
import { command as coreCommand } from 'command-stream/core';
import type { StreamResult } from '../../types/index.js';

const literal = command('echo', ['a b', 42, true, 4n] as const, {
  capture: true,
});
const fluent: CommandBuilder<number> = literal
  .arg('more')
  .stdout('ignore')
  .stderr('pipe')
  .env({ A: 'a' })
  .cwd('.')
  .capture(false)
  .mirror()
  .exitCode();
const sync: number = fluent.sync({ stdin: 'ignore' });
const run: Promise<number> = fluent.run({ timeout: 100 });
const configured: CommandBuilder = $({ mirror: false }).command(
  'echo',
  'preset'
);
const created: CommandBuilder = create({ capture: true }).command('echo');
const preset = coreCommand.with({ stdin: 'input' }).with({ mirror: false });
const result: StreamResult = preset('cat').sync();
const transformed: CommandBuilder<number> = literal.pipe(
  command.options({ timeout: 100 }),
  command.arg('extra'),
  command.capture(),
  command.mirror(false),
  command.exitCode
);
const inferred = literal.pipe(
  command.stdout('ignore'),
  command.capture(),
  command.exitCode
);
// @ts-expect-error Multi-transform pipelines retain exit-code selection.
const wrongSelection: string = inferred.sync();
void wrongSelection;
void [sync, run, configured, created, result, transformed];
// @ts-expect-error Objects are not command arguments.
command('echo', {});
// @ts-expect-error Stdio has a closed vocabulary.
literal.stdout('bad');
// @ts-expect-error Exit-code builders return a number.
const invalid: StreamResult = fluent.sync();
void invalid;
