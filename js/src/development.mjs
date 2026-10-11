import { performance } from 'node:perf_hooks';
import repl from 'node:repl';
import { inspect } from 'node:util';
import { runInContext } from 'node:vm';
import { readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { command } from './command-builder.mjs';
import { stream } from './stream-processing.mjs';
import { trace } from './$.trace.mjs';
import { serveDebugger } from './debugger-view.mjs';
import { startRustRepl } from './rust-repl.mjs';

/** Preserve Node's JavaScript evaluator while also accepting bare shell commands. */
export function startRepl(
  api,
  {
    input = process.stdin,
    output = process.stdout,
    terminal = Boolean(output.isTTY),
    prompt = '> ',
  } = {}
) {
  const server = repl.start({
    input,
    output,
    terminal,
    prompt,
    preview: false,
    writer: (value) =>
      value?.stdout
        ? String(value.stdout).trimEnd()
        : inspect(value, { colors: terminal }),
  });
  Object.assign(server.context, api, { $: api.$ });
  server.on('reset', (context) => Object.assign(context, api, { $: api.$ }));
  server.defineCommand('commands', {
    help: 'List registered virtual commands',
    action() {
      output.write(
        `Registered virtual commands: ${api.listCommands().join(', ')}\n`
      );
      this.displayPrompt();
    },
  });
  const evaluate = server.eval;
  server.commandNames = () => api.listCommands();
  server.eval = (source, context, filename, callback) => {
    const trimmed = source.trim();
    if (['help', 'exit', 'clear'].includes(trimmed)) {
      server.commands[trimmed].action.call(server);
      callback(null);
      return;
    }
    if (isShellInput(trimmed, api.listCommands(), context)) {
      // Node's await evaluator pauses and queues subsequent input itself.
      evaluate.call(
        server,
        `await sh(${JSON.stringify(trimmed)}, { mirror: false })\n`,
        context,
        filename,
        callback
      );
      return;
    }
    evaluate.call(server, source, context, filename, (error, value) => {
      if (error) {
        callback(error);
        return;
      }
      if (value?.then) {
        Promise.resolve(value).then(
          (result) => callback(null, result),
          callback
        );
      } else {
        callback(null, value);
      }
    });
  };
  const complete = server.completer;
  server.completer = (line, callback) => {
    const shell = api.listCommands().filter((name) => name.startsWith(line));
    if (shell.length) {
      callback(null, [shell, line]);
    } else {
      complete.call(server, line, callback);
    }
  };
  return server;
}

function isShellInput(source, commands, context) {
  // Send declarations and expressions to Node's evaluator. Only shell-shaped
  // input uses command-stream; the public sh() API handles ambiguous input.
  const first = source.split(/\s/)[0];
  if (/^[a-zA-Z_$][\w$]*$/.test(first)) {
    try {
      if (runInContext(`typeof ${first}`, context) !== 'undefined') {
        return false;
      }
    } catch {
      // Keywords and uninitialized bindings belong to the JavaScript evaluator.
      return false;
    }
  }
  if (
    /^(await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|using|var|void|while|with|yield)$/.test(
      first
    )
  ) {
    return false;
  }
  if (/^[\w./-]+$/.test(source)) {
    return commands.includes(first);
  }
  return (
    commands.includes(first) ||
    /^[\w./-]+\s+(?:--?\w|[^=+*({[\s-])/.test(source)
  );
}

function matcher(pattern) {
  pattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        expression += '(?:.*/)?';
      } else {
        expression += '.*';
      }
    } else if (char === '*') {
      expression += '[^/]*';
    } else if (char === '?') {
      expression += '[^/]';
    } else {
      expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`);
}

async function watchSnapshot(cwd, patterns) {
  const entries = new Map();
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'target' ||
        entry.name === '.git' ||
        entry.name.startsWith('.command-stream-')
      ) {
        continue;
      }
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (
        entry.isFile() &&
        patterns.some((pattern) =>
          pattern.test(relative(cwd, file).replaceAll('\\', '/'))
        )
      ) {
        const info = await stat(file);
        entries.set(file, `${info.mtimeMs}:${info.size}`);
      }
    }
  };
  await visit(cwd);
  return entries;
}

/** Polling covers creation/deletion and glob matches consistently on all runtimes. */
export function dev(
  api,
  {
    watch,
    entry = process.argv[1],
    cwd = process.cwd(),
    repl: useRepl = false,
    packages = [],
    initial = false,
    interval = 100,
    debounce = 50,
    onRestart,
    onError = (error) => console.error(error),
    language = 'javascript',
  } = {}
) {
  validateWatchOptions(interval, debounce);
  watch = watchPatterns(watch, language);
  const patterns = watch.map((pattern) =>
    matcher(relative(cwd, resolve(cwd, pattern)))
  );
  let watchRoot;
  let previous;
  let timer;
  let busy = Promise.resolve();
  let polling = false;
  let pollWork = Promise.resolve();
  let closed = Boolean(process.env.COMMAND_STREAM_DEV_CHILD);
  let child;
  let changedAt = 0;
  const changes = new Set();
  const controller = {
    ready: null,
    repl:
      useRepl && !closed && language === 'javascript' ? startRepl(api) : null,
    async close() {
      closed = true;
      clearInterval(timer);
      await controller.repl?.close();
      child?.kill();
      await controller.ready.catch(() => {});
      await pollWork;
      await busy;
      if (child) {
        await child.catch(() => {});
      }
    },
    get child() {
      return child;
    },
  };
  const restart = async (files) => {
    for (const installed of packages) {
      if (files.includes(installed.file)) {
        await installed.reload();
      }
    }
    if (entry) {
      child?.kill();
      if (child) {
        await child.catch(() => {});
      }
      if (closed) {
        return;
      }
      const execute =
        language === 'rust'
          ? command('cargo', 'run', '--manifest-path', resolve(cwd, entry))
          : command(process.execPath, resolve(cwd, entry));
      child = execute
        .with({
          cwd,
          env: { ...process.env, COMMAND_STREAM_DEV_CHILD: '1' },
          mirror: true,
          capture: false,
          stdin: 'ignore',
        })
        .runner();
      child.start().catch(onError);
    }
    trace('Development', () => `Reloaded: ${files.join(', ')}`);
    await onRestart?.(files);
  };
  const poll = async () => {
    if (closed || polling) {
      return;
    }
    polling = true;
    try {
      const next = await watchSnapshot(watchRoot, patterns);
      for (const file of new Set([...previous.keys(), ...next.keys()])) {
        if (previous.get(file) !== next.get(file)) {
          changes.add(file);
          changedAt = Date.now();
        }
      }
      previous = next;
      if (changes.size && Date.now() - changedAt >= debounce) {
        const files = [...changes];
        changes.clear();
        busy = busy
          .then(() => (closed ? undefined : restart(files)))
          .catch(onError);
        await busy;
      }
    } catch (error) {
      onError(error);
    } finally {
      polling = false;
    }
  };
  controller.ready = (async () => {
    if (closed) {
      return;
    }
    // Package resolution canonicalizes symlinks (including macOS /var).
    // Use the same identity for watched files so reload matches their entry.
    watchRoot = await realpath(cwd);
    trace('Development', () => `Watching canonical directory: ${watchRoot}`);
    previous = await watchSnapshot(watchRoot, patterns);
    if (useRepl && language === 'rust' && !closed) {
      controller.repl = await startRustRepl();
      if (closed) {
        await controller.repl.close();
      }
    }
    if (initial && !closed) {
      await restart([]);
    }
    if (!closed) {
      timer = setInterval(() => {
        if (!polling && !closed) {
          pollWork = poll();
        }
      }, interval);
    }
  })();
  return controller;
}

/** Step gates sit between producer and consumer; only bounded previews are retained. */
export class PipelineDebugger {
  constructor({ paused = false, history = 1000, preview = 1000 } = {}) {
    if (
      !Number.isSafeInteger(history) ||
      history < 1 ||
      !Number.isSafeInteger(preview) ||
      preview < 1
    ) {
      throw new RangeError('Invalid debugger history or preview size');
    }
    this.paused = paused;
    this.history = history;
    this.preview = preview;
    this.timeline = [];
    this.stages = [];
    this.waiters = [];
    this.steps = 0;
    this.errors = [];
  }
  step() {
    if (this.waiters.length) {
      this.waiters.shift()();
    } else {
      this.steps++;
    }
  }
  resume() {
    this.paused = false;
    this.waiters.splice(0).forEach((wake) => wake());
  }
  pause() {
    this.paused = true;
  }
  serve(options) {
    return serveDebugger(this, options);
  }
  async gate() {
    if (!this.paused) {
      return;
    }
    if (this.steps) {
      this.steps--;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
  }
  stage(name, source) {
    if (!this.stages.includes(name)) {
      this.stages.push(name);
    }
    const debugger_ = this;
    return stream(
      (async function* () {
        const started = performance.now();
        let count = 0;
        try {
          for await (const value of source) {
            await debugger_.gate();
            const preview =
              typeof value === 'string'
                ? value.slice(0, debugger_.preview)
                : inspect(value, { depth: 2, maxArrayLength: 10 }).slice(
                    0,
                    debugger_.preview
                  );
            const event = {
              stage: name,
              count: ++count,
              time: performance.now(),
              duration: performance.now() - started,
              memory: process.memoryUsage().heapUsed,
              value: typeof value === 'number' ? value : preview,
            };
            debugger_.timeline.push(event);
            if (debugger_.timeline.length > debugger_.history) {
              debugger_.timeline.shift();
            }
            yield value;
          }
        } catch (error) {
          debugger_.errors.push(
            `${name}: ${error.message}`.slice(0, debugger_.preview)
          );
          if (debugger_.errors.length > debugger_.history) {
            debugger_.errors.shift();
          }
          throw error;
        }
      })()
    );
  }
  visualize() {
    return this.stages
      .map(
        (name, index) =>
          `${index + 1}. ${name} (${this.timeline.filter((event) => event.stage === name).length} observed)`
      )
      .join('\n   ↓\n');
  }
  profile() {
    return this.stages.map((name) => {
      const events = this.timeline.filter((event) => event.stage === name);
      return {
        stage: name,
        count: events.at(-1)?.count ?? 0,
        duration: events.at(-1)?.duration ?? 0,
        memory: events.at(-1)?.memory ?? 0,
      };
    });
  }
}

function validateWatchOptions(interval, debounce) {
  if (
    !Number.isFinite(interval) ||
    interval < 10 ||
    !Number.isFinite(debounce) ||
    debounce < 0
  ) {
    throw new RangeError('Invalid watch interval or debounce');
  }
}

function watchPatterns(watch, language) {
  if (!['javascript', 'rust'].includes(language)) {
    throw new TypeError('Unknown development language');
  }
  return (
    watch ??
    (language === 'rust'
      ? ['**/*.rs', '**/Cargo.toml', '**/Cargo.lock']
      : ['./scripts/*.mjs'])
  );
}
