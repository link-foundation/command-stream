import $, {
  ProcessRunner,
  register,
  command,
  type Dollar,
} from 'command-stream/core';

const tag: Dollar = $;
const runner: ProcessRunner = tag`echo ${'typed core'}`;
const configured: ProcessRunner = tag({ mirror: false })`echo configured`;
register('typed-core', () => ({ code: 0, stdout: 'typed' }));
void [runner, configured, command('echo', 'builder')];

// @ts-expect-error Compatibility APIs belong to the full entry.
$.shelljs.echo('full only');
// @ts-expect-error Terminal rendering belongs to the full entry.
new $.TerminalBuffer();
