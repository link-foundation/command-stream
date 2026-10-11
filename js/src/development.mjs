import { performance } from 'node:perf_hooks';
import repl from 'node:repl';
import { inspect } from 'node:util';
import { readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { command } from './command-builder.mjs';
import { stream } from './stream-processing.mjs';
import { trace } from './$.trace.mjs';
import { serveDebugger } from './debugger-view.mjs';

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
  const evaluate = server.eval;
  server.commandNames = () => api.listCommands();
  server.eval = (source, context, filename, callback) => {
    const first = source.trim().split(/\s/)[0];
    const shell =
      api.listCommands().includes(first) ||
      /^[\w./-]+\s+(?:--?\w|[^=+({])/.test(source.trim());
    if (
      shell &&
      !/^(await|const|let|var|function|import|throw|return)\b/.test(
        source.trim()
      )
    ) {
      api
        .sh(source.trim(), { mirror: false })
        .then((value) => callback(null, value), callback);
      return;
    }
    evaluate.call(server, source, context, filename, (error, value) => {
      if (error) {
        if (
          error.name === 'ReferenceError' &&
          /^[\w./-]+$/.test(source.trim())
        ) {
          api
            .sh(source.trim(), { mirror: false })
            .then((result) => callback(null, result), callback);
        } else {
          callback(error);
        }
        return;
      }
      Promise.resolve(value).then((result) => callback(null, result), callback);
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
    watch = ['./scripts/*.mjs'],
    entry = process.argv[1],
    cwd = process.cwd(),
    repl: useRepl = false,
    packages = [],
    initial = false,
    interval = 100,
    debounce = 50,
    onRestart,
    onError = (error) => console.error(error),
  } = {}
) {
  validateWatchOptions(interval, debounce);
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
    repl: useRepl && !closed ? startRepl(api) : null,
    async close() {
      closed = true;
      clearInterval(timer);
      controller.repl?.close();
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
      child = command(process.execPath, resolve(cwd, entry))
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
