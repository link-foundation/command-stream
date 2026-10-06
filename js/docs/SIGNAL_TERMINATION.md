# Signal termination

When the spawned process dies from a signal, `code` and `exitCode` use the
shell-compatible `128 + signal number` status. The result's `signal` field
carries the signal name; ordinary exits and launch failures have `signal: null`.

| Signal    | Exit status |
| --------- | ----------- |
| `SIGTERM` | `143`       |
| `SIGKILL` | `137`       |
| `SIGINT`  | `130`       |

Other signals use the runtime's platform signal table. This applies to awaited
and synchronous execution under Node and Bun, including `ProcessRunner` shell
file/args specifications:

```javascript
import { ProcessRunner } from 'command-stream/process-runner';

// POSIX shell example: only the shell itself receives the signal.
const result = await new ProcessRunner(
  { mode: 'shell', file: 'kill -TERM $$', args: [] },
  { mirror: false, stdin: 'ignore' }
);
console.log(result.code, result.signal); // 143, SIGTERM
```

Async iteration ends with `{ type: 'exit', code, signal }`. Exit listeners receive
`(code, signal)`, preserving the first numeric argument for existing listeners.
The stored `runner.result` and the `end` event carry the same signal field.
In `errexit` mode, signal termination rejects and `error.result.signal` retains
that information.

An ordinary `exit 137` keeps `signal: null`; a status above 128 alone does not
identify signal termination. The metadata describes the process the runner
spawned. If a shell wrapper survives and reports a child's death as a numeric
exit, the runner reports that shell's status with `signal: null`.

Runner cancellation through `kill()` or an `AbortSignal` reports the requested
signal in `result.signal`, even when the process handles it or shutdown
escalates to `SIGKILL`. This preserves the existing cancellation status policy.
See [Sending Signals to a Running Command](../README.md#sending-signals-to-a-running-command)
for signal delivery and grace periods.
