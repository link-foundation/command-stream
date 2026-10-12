// A real SSH/PTY integration probe using disposable keys and a loopback server.
// Requires openssh-server; no host SSH configuration changes or root server.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTerminal } from '../../js/src/$.mjs';

const directory = await mkdtemp(join(tmpdir(), 'command-stream-ssh-'));
const fixture = fileURLToPath(new URL('terminal-app.mjs', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
let server;
let exited;
let deadline;
const stop = () => {
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // The isolated server may already have exited.
    }
  }
};

try {
  const identity = join(directory, 'identity');
  const hostKey = join(directory, 'host-key');
  for (const key of [identity, hostKey]) {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
  }
  const authorizedKeys = join(directory, 'authorized_keys');
  await writeFile(authorizedKeys, await readFile(`${identity}.pub`));
  const config = join(directory, 'sshd_config');
  await writeFile(
    config,
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKey}`,
      `AuthorizedKeysFile ${authorizedKeys}`,
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'UsePAM no',
      'StrictModes no',
      `AllowUsers ${userInfo().username}`,
    ].join('\n')
  );
  server = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  exited = once(server, 'exit');
  deadline = setTimeout(stop, 15000);
  await new Promise((resolve, reject) => {
    let diagnostic = '';
    server.once('error', reject);
    server.once('exit', () => reject(new Error(diagnostic)));
    server.stderr.on('data', (data) => {
      diagnostic += data.toString();
      if (diagnostic.includes('Server listening on')) {
        resolve();
      }
    });
  });
  const session = await openTerminal({
    file: 'ssh',
    args: [
      '-F',
      '/dev/null',
      '-tt',
      '-o',
      'BatchMode=yes',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'StrictHostKeyChecking=no',
      '-i',
      identity,
      '-p',
      String(port),
      `${userInfo().username}@127.0.0.1`,
      `exec ${quote(process.execPath)} ${quote(fixture)}`,
    ],
    cols: 37,
    rows: 9,
    frameMode: 'writes',
    recording: false,
    timeoutMilliseconds: 6000,
  });
  try {
    await session.waitFor('37x9', { timeoutMilliseconds: 3000 });
    await session.send({ text: 'n' });
    await session.waitFor('input received', { timeoutMilliseconds: 2000 });
    assert.ok(session.text().includes('input received'));
    assert.ok(session.text({ color: true }).includes('38;2;0;205;0'));
    await session.send({ resize: { cols: 43, rows: 11 } });
    await session.waitFor('43x11', { timeoutMilliseconds: 2000 });
    await session.send({ text: 'q' });
    assert.equal((await session.finished()).exitCode, 0);
    console.log('ssh: input, color and remote PTY dimensions verified');
  } catch (error) {
    console.error(session.output);
    throw error;
  } finally {
    await session.dispose();
  }
} finally {
  clearTimeout(deadline);
  stop();
  if (exited) {
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
