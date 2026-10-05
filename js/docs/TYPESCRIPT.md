# TypeScript

command-stream ships its own declarations, so you don't need a `@types`
package. They cover the whole public API of the ES module entry
(`import`), the CommonJS entry (`require`) and `command-stream/process-runner`.

| File                        | Used for                                                        |
| --------------------------- | --------------------------------------------------------------- |
| `types/api.d.cts`           | The API, shared by both entry points                            |
| `types/index.d.ts`          | `import $ from 'command-stream'`                                |
| `types/index.d.cts`         | `const $ = require('command-stream')`                           |
| `types/process-runner.d.ts` | `import { ProcessRunner } from 'command-stream/process-runner'` |

The declarations are checked with `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess` and `skipLibCheck: false`. They also compile
for consumers on TypeScript 5.0 and later with `node16`, `nodenext` and
`bundler` resolution (see `experiments/typescript-consumer-compat.sh`).

## Commands and results

```ts
import $, {
  exec,
  type ProcessOptions,
  type StreamResult,
} from 'command-stream';

const options: ProcessOptions = { mirror: false };
const result: StreamResult = await $(options)`echo ${'hello'}`;
result.stdout?.trim(); // string methods work on captured output
result.code; // number

const version = await exec(process.execPath, ['--version'], options);
```

The option keys, `stdin` values and `killSignal` names are all checked:

```ts
// @ts-expect-error - 'yes' is not a boolean
$({ capture: 'yes' });
```

## Streaming

`stream()` and `for await` yield a discriminated union. Narrowing on
`chunk.type` gives Buffer data for output chunks and a numeric code for the
final `exit` chunk:

```ts
for await (const chunk of $`npm test`.stream()) {
  if (chunk.type === 'exit') {
    console.log('exit code', chunk.code); // number
  } else {
    process.stdout.write(chunk.data); // Buffer, chunk.type is 'stdout' | 'stderr'
  }
}
```

## Events

`on`, `once`, `off` and `emit` are typed per event name
(`ProcessRunnerEvents`), and unknown event names are rejected:

```ts
$`npm run build`
  .on('stdout', (chunk) => chunk.toString()) // Buffer
  .on('data', (chunk) => chunk.type) // 'stdout' | 'stderr'
  .on('end', (result) => result.code) // CommandResult
  .on('exit', (code) => code); // number
```

## Virtual commands

A handler is either a function returning `{ code?, stdout?, stderr? }` or an
async generator that yields strings or bytes. `args`, `stdin`, `cwd`, `env`
and `isCancelled` are typed on the context:

```ts
import { register, type VirtualCommandHandler } from 'command-stream';

const greet: VirtualCommandHandler = async ({ args }) => ({
  stdout: `Hello, ${args[0] ?? 'world'}!\n`,
});
register('greet', greet);

register('count', async function* ({ args, isCancelled }) {
  for (let i = Number(args[0] ?? 3); i > 0 && !isCancelled?.(); i--) {
    yield `${i}\n`;
  }
});
```

## Pipelines

Template pipelines (`` $`a | b` ``) and `.pipe()` chains both return a
`ProcessRunner`, so the result type is `StreamResult` all the way through:

```ts
const sorted = await $`printf 'b\na\n' | sort`;
const piped = await $`echo hi`.pipe($`tr a-z A-Z`);
```

## Examples

Each example is type checked by `npm run check:types` and executed in CI:

- `examples/typescript-basics.ts`
- `examples/typescript-streaming.ts`
- `examples/typescript-virtual-commands.ts`
- `examples/typescript-pipelines.ts`

## Rust mapping

The Rust crate provides the same concepts with native types. Each row pairs
a TypeScript declaration with its Rust counterpart, and
`tests/typescript-declarations.test.mjs` checks that every identifier named
here still exists on both sides.

| Concept                 | TypeScript                                               | Rust                                                            |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Command runner          | `ProcessRunner`                                          | `ProcessRunner`                                                 |
| Child process handle    | `ProcessChild`                                           | `ProcessChild`                                                  |
| Run options             | `ProcessOptions`                                         | `RunOptions`                                                    |
| Stdin option            | `StdinOption`                                            | `StdinOption`                                                   |
| Result                  | `CommandResult`                                          | `CommandResult`                                                 |
| Failure                 | `CommandError`                                           | `Error`                                                         |
| Tagged template / macro | `$`                                                      | `cmd!`                                                          |
| Run a shell string      | `sh`                                                     | `run`                                                           |
| Run with options        | `exec`                                                   | `exec`                                                          |
| Create a lazy runner    | `create`                                                 | `create`                                                        |
| Streaming chunk         | `StreamChunk`                                            | `OutputChunk`                                                   |
| Chunk stream            | `stream`                                                 | `OutputStream`                                                  |
| Event names             | `ProcessRunnerEvents`                                    | `EventType`                                                     |
| Event emitter           | `StreamEmitter`                                          | `StreamEmitter`                                                 |
| Pipelines               | `pipe`                                                   | `Pipeline`                                                      |
| Virtual command context | `VirtualCommandContext`                                  | `CommandContext`                                                |
| Virtual command handler | `VirtualCommandHandler`                                  | `VirtualCommandHandler`                                         |
| Register a command      | `register`                                               | `VirtualCommandRegistry`                                        |
| Toggle virtual commands | `enableVirtualCommands`, `disableVirtualCommands`        | `enable_virtual_commands`, `disable_virtual_commands`           |
| Quoting                 | `quote`, `quoteForContext`, `QuoteContext`               | `quote`, `quote_for_context`, `QuoteContext`                    |
| Quote feature flags     | `isQuoteContextEnabled`, `isPreQuotedPassthroughEnabled` | `is_quote_context_enabled`, `is_pre_quoted_passthrough_enabled` |
| Shell settings          | `ShellSettings`, `set`, `unset`                          | `ShellSettings`, `set_shell_option`, `unset_shell_option`       |
| Reset state             | `resetGlobalState`                                       | `reset_global_state`                                            |
| ANSI handling           | `AnsiConfig`, `AnsiUtils`                                | `AnsiConfig`, `AnsiUtils`                                       |
| Terminal capture        | `captureTerminal`, `openTerminal`, `TerminalSession`     | `capture_terminal`, `open_terminal`, `TerminalSession`          |
| Terminal artifacts      | `readAsciicast`, `unrollTerminalFrames`, `TerminalFrame` | `read_asciicast`, `unroll_terminal_frames`, `TerminalFrame`     |
| Terminal errors         | `TerminalCaptureError`, `TerminalInteraction`            | `TerminalCaptureError`, `TerminalInteraction`                   |

JavaScript `register`/`unregister`/`listCommands` act on one global
registry. In Rust the same operations are methods on
`VirtualCommandRegistry` (`register`, `unregister`, `list`).
