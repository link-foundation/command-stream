// command-stream/bun - a Bun.$-compatible shell for Node.js, Bun and Deno.
//
// The same API as `import { $ } from 'bun'`, backed by a portable port of the
// Bun Shell interpreter (src/bun-shell/), so scripts written for Bun.$ run
// unchanged everywhere:
//
//   import { $ } from 'command-stream/bun';
//   const name = await $`echo ${'world'} | cat`.text();

export {
  $,
  Shell,
  ShellError,
  ShellFile,
  ShellOutput,
  ShellPromise,
} from './bun-shell/shell.mjs';
export { $ as default } from './bun-shell/shell.mjs';
