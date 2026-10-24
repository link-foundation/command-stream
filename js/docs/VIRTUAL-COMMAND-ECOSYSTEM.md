# Virtual command ecosystem

Virtual commands are JavaScript handlers registered in command-stream's shared
registry. They participate in shell templates and pipelines alongside built-in
and system commands. All APIs below are available through ESM and CommonJS.
The [Rust ecosystem guide](../../rust/docs/VIRTUAL-COMMAND-ECOSYSTEM.md) documents
the equivalent typed, manifest/npm, streaming, discovery and hot-reload APIs.
The [ecosystem comparison](../../docs/VIRTUAL-COMMAND-COMPARISON.md) credits
competing implementations and maps the complete issue #30 workflow to tests.

## Create, inherit, and compose

```js
import $, { compose } from 'command-stream';

const hello = $.create('hello', ({ args }) => ({
  code: 0,
  stdout: `Hello, ${args.join(' ')}!\n`,
}));
$.inherit('greet', 'hello', { args: ['developer'] });
$.create(
  'loud-greeting',
  compose(hello, ({ stdin }) => ({ code: 0, stdout: stdin.toUpperCase() }))
);
console.log(await (await $({ mirror: false })`loud-greeting Alice`).text());
```

`$.create(name, handler, metadata?)` returns the registered handler. A name must
be a string matching `[A-Za-z_][\w:.-]*`; invalid names or non-callable handlers
throw `TypeError` before registration. Creating the same name replaces its
handler. `$.unregister(name)` removes it and its metadata. Metadata may contain
`description` and application-specific fields.

`$.create(options)` retains the existing configured-shell-tag API. Supplying a
handler selects command registration, so `$.create(null, handler)` is rejected
instead of silently creating a configured shell tag.

Inheritance prepends default arguments and merges context defaults. It captures
the parent handler at creation; subsequent changes to the parent do not mutate
an existing child. `compose(...handlers)` returns a handler, pipes each captured
stdout to the next stdin, and stops at the first nonzero code. Register that
handler with `$.create` to name it. An empty composition or a non-function stage
throws `TypeError`. For a sequence that retains every stage's output, use an
async-generator handler that explicitly runs and yields each stage in order.

## Middleware and streaming

```js
$.extend('hello', async (context, next) => {
  const result = await next({ ...context, args: context.args.map(String) });
  return { ...result, stdout: `[greeting] ${result.stdout}` };
});

$.create('records', async function* ({ args }) {
  for (const value of args) {
    yield `${value}\n`;
  }
});
$.extend('records', (context, next) => next(context));
await $({ mirror: false, capture: false })`records one two`
  .stream()
  .forEach((line) => console.log(line));
```

Middleware receives `(context, next)`. Code before `next` implements a pre-hook;
code after it implements a post-hook. It can change the context, transform a
result, return an iterable, or reject execution by throwing. Multiple extensions
nest, with the most recently installed layer outermost. A missing command or
non-function middleware throws. To add colors to `ls`, extend its handler and
transform the returned stdout; see the [color example](../examples/ls-color-middleware.mjs).

Handlers may return `{code, stdout, stderr}` or synchronous/asynchronous iterables
of string or buffer chunks, including an iterable wrapped in a promise. No
`streaming:true` option is needed. Wrapped generators remain incremental through
middleware, inheritance, and mixed shell pipelines. Use `capture:false` to avoid
retaining the full output. Result-returning handlers receive a complete stdin
string, and `compose` collects generator output between stages; use shell
pipelines or stream operators for incremental processing.

## Package installation and lifecycle

A package's entry module exports a definition, for example:

```js
/** @type {import('command-stream').CommandPackage} */
const definition = {
  name: '@my-org/greetings',
  version: '1.0.0',
  descriptions: { hello: 'Greet the supplied names' },
  commands: {
    hello: ({ args }) => ({ code: 0, stdout: args.join(' ') }),
  },
};
export default definition;
```

```js
const installed = await $.install('@my-org/greetings', { cwd: process.cwd() });
console.log(installed.name, installed.version, [...installed.handlers.keys()]);
await installed.reload();
installed.uninstall();
```

Installation resolves local modules or installed npm packages. If a bare npm
package name cannot resolve, command-stream runs `npm install` in `cwd` with
lifecycle scripts disabled. Set `{install:false}` to require an existing package
and avoid installation. File paths resolve relative to `cwd`; absolute paths are
also accepted. Install errors reject the promise. The returned handle has
`name`, `version`, `file`, `handlers`, `reload()`, and `uninstall()`.

A nonempty `commands` object is required. Every name, handler, and collision is
validated before changing the registry. Reinstalling the same file returns its
existing handle. `{replace:true}` permits replacing existing commands, and
uninstall restores displaced handlers and metadata. Uninstall does not remove
handlers replaced externally since installation. `{reload:true}` or
`installed.reload()` loads a fresh entry module; invalid reloads preserve the
working package. Reload preserves relative imports, while imported dependencies
retain the runtime cache. Restart to reload the entire dependency graph.

The [ten standalone example packages](../examples/packages/README.md) cover Git,
files, deployment planning, JSON, text, HTTP, logs, time, environment, and math.
They can be installed locally before publication. Publish under a namespace you
own and retain the `command-stream-command` npm keyword for discovery. Installation
and discovery use real modules and registry responses rather than a bundled
catalog of simulated packages.

## Marketplace discovery

```js
const matches = await $.marketplace.search('git', { size: 20 });
for (const pkg of matches) {
  console.log(pkg.name, pkg.version, pkg.description);
}
```

Search returns an array of npm package metadata. It filters by the
`command-stream-command` keyword, encodes the query, and clamps `size` to 1–250.
Options include `registry`, an injectable `fetch` transport, and an AbortSignal
through `signal`. HTTP failures reject the promise. Keep installation handles in
your application to track installed packages; marketplace search is discovery.

## Hot reload in development

```js
const installed = await $.install('./commands.mjs', { install: false });
const controller = $.dev({
  cwd: process.cwd(),
  entry: null,
  repl: false,
  watch: ['commands.mjs'],
  packages: [installed],
  onError: console.error,
});
await controller.ready;
// Edit commands.mjs, then execute its registered commands again.
// On application shutdown:
await controller.close();
installed.uninstall();
```

`entry:null` enables package-only reload without restarting a script. Watch
snapshots use canonical file identities, including symlinked directories. Await
`ready` before editing files and `close()` to stop watching and finish outstanding
work. Use an atomic editor save to avoid loading partially written modules. The
[interactive development guide](INTERACTIVE-DEVELOPMENT.md) covers script
restarts, REPLs, and the equivalent Rust workflow.

## Types, examples, and acceptance coverage

Strict declarations cover command context/results, generator chunks, middleware,
package definitions and handles in ESM and CommonJS. In TypeScript, use
`CommandPackage` or `satisfies CommandPackage` to validate package exports. Runtime
validation remains necessary for ordinary JavaScript and dynamically loaded
packages. Rust uses typed closures and JSON manifests through
`CommandEnvironment` and `CommandPackage`; JavaScript modules are loaded by
the JavaScript implementation. Rust also installs npm packages shipping a
`command-stream.json` manifest, discovers registry packages with `Marketplace`,
and watches manifests in-process with `watch_package`. A provider can ship
both a JavaScript entry and a Rust manifest in the same npm package. JavaScript
module handlers need corresponding Rust closures or executable commands.

Run the offline demonstrations from the repository root:

```sh
node js/examples/virtual-ecosystem-demo.mjs
bun js/examples/enterprise-virtual-commands.mjs
cargo run --manifest-path rust/Cargo.toml --example virtual_ecosystem
cargo run --manifest-path rust/Cargo.toml --example enterprise_virtual_commands
```

The first combines real local packages, inheritance, middleware, and composition;
`--search` additionally queries npm. The enterprise example validates an
environment and streams a deployment plan with audit middleware. The
[reload fixture](../examples/test-hot-reload-cmd.mjs) is an installable package.

| Issue #30 requirement                             | Automated coverage                                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtual command packages and `$.install`          | [Package lifecycle tests](../tests/command-packages.test.mjs), [all ten packages](../tests/advanced-integration.test.mjs)                                                  |
| Composition and inheritance                       | [Package tests](../tests/command-packages.test.mjs), [ecosystem acceptance tests](../tests/virtual-ecosystem.test.mjs), [Rust tests](../../rust/tests/command_packages.rs) |
| Async generators and streaming                    | [Incremental-output acceptance test](../tests/virtual-ecosystem.test.mjs), [bounded pipeline tests](../tests/advanced-integration.test.mjs)                                |
| Middleware and plugins                            | [Wrapped generator tests](../tests/command-packages.test.mjs), [enterprise demo smoke test](../tests/virtual-ecosystem.test.mjs)                                           |
| Type-safe interfaces                              | [ESM declarations](../tests/types/esm.types.ts), [CommonJS declarations](../tests/types/cjs.types.cts), runtime validation tests                                           |
| Hot reload                                        | [Watcher, symlink and shutdown tests](../tests/advanced-integration.test.mjs), [atomic invalid reload tests](../tests/command-packages.test.mjs)                           |
| `$.create`, `$.extend`, marketplace search        | [Ecosystem acceptance tests](../tests/virtual-ecosystem.test.mjs), [registry transport test](../tests/command-packages.test.mjs)                                           |
| Git, colored ls, deployment, enterprise use cases | [Ten packages](../examples/packages/README.md), [color middleware](../examples/ls-color-middleware.mjs), [enterprise workflow](../examples/enterprise-workflow.mjs)        |

The [Rust requirement-to-test matrix](../../rust/docs/VIRTUAL-COMMAND-ECOSYSTEM.md#examples-and-acceptance-coverage)
covers the same planned capabilities. CI executes the expanded command-package
feature in Node, Bun and Rust, comparing name validation, streamed composition,
atomic reload, middleware/inheritance and registry discovery observations.

Ten example packages are ready for independent publication. Ten published
packages, external adoption, and enterprise usage are post-release success
metrics; tests and examples do not establish those outcomes.
