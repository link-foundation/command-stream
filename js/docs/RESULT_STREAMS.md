# Result streams

Completed command results expose `stdout` and `stderr` as Node.js `Readable`
streams containing captured output. `stdin` is a `Writable` record of input
sent to the command. The output streams are one-shot: iterate or pipe them once.
`toString()` returns the saved text without consuming the stream.
`result.text()` and `command.strings.stdout` return strings. If capture is
disabled, `stdout` and `stderr` remain `undefined`.

To write to a running child, use `command.streams.stdin` before awaiting the
command. Writes to the completed result's `stdin` update only its local record.

```javascript
import { $ } from 'command-stream';

const command = $`cat`;
const liveStdin = await command.streams.stdin;
liveStdin.end('hello\n');

const result = await command;
result.stdout.pipe(process.stdout); // Readable replay of "hello\n"
console.log(result.stdout.toString().trim()); // "hello"
console.log(await result.text()); // "hello\n"
```
