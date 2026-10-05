# Issue 24 regression evidence

The original draft at `f7b5f596` converted argv to a shell command string and
returned a plain promise. Run `reproduce.mjs` with its archived `src/$.mjs`:
exact argv fails, the returned value has no `kill` or readable stdout, and
input is not delivered. The same finite probe against
`js/src/execa/index.mjs` passes all three checks. Automated regressions live in
`js/tests/execa-compat.test.mjs`; the broader isolated/general API contracts
and production-only package installation are in `js/tests/execa/`.

The Rust duplex fixture writes 256 KiB before reading 256 KiB of input. Its
three-second watchdog exited with code 90 before the shared runner fix;
`rust/tests/execa_duplex.rs` passes after stdin writing and output reading run
concurrently. `rust/tests/execa.rs` also reproduced empty output from a buffered
pipe with source capture disabled; the pipe now explicitly captures its input.
The fixtures use finite data and waits.

The factory declaration tests additionally reproduce incorrect string output
types for bound `lines: true` and `encoding: buffer`. Generic factories now
retain these options and their inferred output types in ESM and CommonJS.
Nested factories also reproduced dropped environment defaults under a shallow
merge. Rebinding upstream presets now preserves Execa's nested option merging.

The previous failing workflow run 17593573896 was created on
2025-09-09T19:31:03Z for `f7b5f5961921db897c824dd68ac4de7dad658a44`.
Its latest-Node job failed, while Node 20/22/24 passed. GitHub returns HTTP 410
for the expired logs, so no original error can be established from those logs.
Fresh branch runs are required to validate this implementation.

Execa 9.6.1 is a production dependency. We preserve its complete Node API
rather than translating it through the shell. Bun lacks the counted channel
references used by upstream IPC: the IPC contract runs under Node, with this
Bun limitation recorded in the migration guide. Rust exposes portable process
counterparts and explicitly documents unimplemented JavaScript-specific APIs.

`bundle-size.json` records measured sizes from the existing benchmark suite.
The standalone streaming example compares native streaming, Execa streaming
and explicit buffering using the same finite producer. Results do not support
a universal performance win or the old draft's zero-dependency/60%-smaller
claims.
