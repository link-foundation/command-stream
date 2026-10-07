import ptyModule from 'node-pty';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import {
  prepareSpawnHelper,
  stopTerminal,
} from './terminal-pty-host-platform.mjs';

if (process.platform === 'darwin') {
  const require = createRequire(import.meta.url);
  // Match the binding selected by node-pty, including locally built binaries.
  const native = require('node-pty/lib/utils.js').loadNativeModule('pty');
  const helper = resolve(
    dirname(require.resolve('node-pty')),
    native.dir,
    'spawn-helper'
  )
    .replace('app.asar', 'app.asar.unpacked')
    .replace('node_modules.asar', 'node_modules.asar.unpacked');
  prepareSpawnHelper(helper);
}

const send = (message, callback) => {
  process.stdout.write(`${JSON.stringify(message)}\n`, callback);
};

let terminal;
const messages = createInterface({ input: process.stdin });

messages.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'spawn') {
    terminal = ptyModule.spawn(message.file, message.args, message.options);
    terminal.onData((data) => send({ type: 'data', data }));
    terminal.onExit(({ exitCode, signal }) => {
      send({ type: 'exit', exitCode, signal }, () => process.exit(0));
    });
    send({ type: 'ready' });
  } else if (message.type === 'input') {
    terminal.write(message.data);
  } else if (message.type === 'resize') {
    terminal.resize(message.cols, message.rows);
  } else if (message.type === 'kill') {
    stopTerminal(terminal, message.signal);
  }
});

messages.on('close', () => {
  stopTerminal(terminal);
});
