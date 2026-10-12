// Run after installing tmux and screen. All sessions are isolated and finite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openTerminal } from '../../js/src/$.mjs';

const fixture = fileURLToPath(new URL('terminal-app.mjs', import.meta.url));
const name = `command-stream-issue-9-${process.pid}`;
const backends = [
  ['node', [fixture]],
  ['sh', ['-c', 'exec node "$1"', 'probe', fixture]],
  ['bash', ['--noprofile', '--norc', '-c', 'exec node "$1"', 'probe', fixture]],
  ['tmux', ['-L', name, '-f', '/dev/null', 'new-session', 'node', fixture]],
  [
    'screen',
    ['-c', '/dev/null', '-S', name, '-T', 'xterm-256color', 'node', fixture],
  ],
];

try {
  for (const [file, args] of backends) {
    const session = await openTerminal({
      file,
      args,
      cols: 37,
      rows: 9,
      frameMode: 'writes',
      recording: false,
      timeoutMilliseconds: 6000,
    });
    try {
      // tmux reserves one row for its default status bar.
      const height = file === 'tmux' ? 8 : 9;
      await session.waitFor(`37x${height}`, {
        timeoutMilliseconds: 3000,
      });
      await session.send({ text: 'n' });
      await session.waitFor('input received', { timeoutMilliseconds: 2000 });
      assert.ok(session.text().includes('input received'));
      assert.ok(session.text({ color: true }).includes('38;2;0;205;0'));
      await session.send({ resize: { cols: 43, rows: 11 } });
      await session.waitFor(`43x${file === 'tmux' ? 10 : 11}`, {
        timeoutMilliseconds: 2000,
      });
      assert.equal(session.snapshot().cols, 43);
      await session.send({ text: 'q' });
      assert.equal((await session.finished()).exitCode, 0);
      console.log(`${file}: input, color and child dimensions verified`);
    } catch (error) {
      console.error(`${file} output: ${session.output}`);
      throw error;
    } finally {
      await session.dispose();
    }
  }
} finally {
  try {
    execFileSync('tmux', ['-L', name, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // A completed session may already have removed its server.
  }
}
