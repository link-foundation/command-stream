import ptyModule from 'node-pty';
import { createInterface } from 'node:readline';

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
    terminal.kill(message.signal);
  }
});

messages.on('close', () => {
  terminal?.kill('SIGTERM');
});
