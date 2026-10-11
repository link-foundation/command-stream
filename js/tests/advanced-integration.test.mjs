import { test, expect, beforeEach, afterEach } from 'bun:test';
import { beforeTestCleanup, afterTestCleanup } from './test-cleanup.mjs';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import $, {
  command,
  fy,
  dev,
  install,
  PipelineDebugger,
  stream,
  testing,
  startRepl,
} from '../src/$.mjs';

beforeEach(beforeTestCleanup);
afterEach(afterTestCleanup);

test('translated scripts preserve arguments, heredocs, stdin, and exit status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'command-fy-'));
  try {
    const file = join(dir, 'script.mjs');
    const source =
      'cat\nprintf "%s\\n" "$1"\ncat <<\'EOF\'\n${danger} `literal`\nEOF\nexit 7';
    await writeFile(
      file,
      fy(source, {
        module: pathToFileURL(join(import.meta.dir, '../src/$.mjs')).href,
      })
    );
    const translated = await command(process.execPath, file, "a; 'b'").with({
      stdin: 'input\n',
    });
    const original = await command(
      'sh',
      '-c',
      source,
      'translated.sh',
      "a; 'b'"
    ).with({ stdin: 'input\n' });
    expect(translated.code).toBe(7);
    expect(await translated.text()).toBe(await original.text());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test('slow consumers retain all native output after the process exits', async () => {
  const runner = command(
    process.execPath,
    '-e',
    "process.stdout.write('x'.repeat(500000))"
  )
    .with({ capture: false, exitPumpGrace: 5 })
    .runner();
  let size = 0;
  for await (const chunk of runner.stream({
    highWaterMark: 1,
    highWaterBytes: 4096,
  })) {
    if (chunk.type === 'stdout') {
      size += chunk.data.length;
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
  expect(size).toBe(500000);
  expect(runner.result.code).toBe(0);
}, 10000);

test('virtual generators stop pulling while a stream consumer is paused', async () => {
  let produced = 0;
  $.create('pressure-fixture', async function* () {
    for (let i = 0; i < 100; i++) {
      produced++;
      yield `${i}\n`;
    }
  });
  try {
    const runner = $({ mirror: false, capture: false })`pressure-fixture`;
    const output = runner.stream({ highWaterMark: 2 });
    await output.next();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(produced).toBeLessThanOrEqual(3);
    await output.return();
    expect(runner.finished).toBe(true);
  } finally {
    $.unregister('pressure-fixture');
  }
});

test('split can cancel an unread branch without blocking the retained branch', async () => {
  const [even, odd] = stream([1, 2, 3, 4, 5, 6]).split((x) => x % 2 === 0, {
    highWaterMark: 1,
  });
  await odd.return();
  expect(await even.toArray()).toEqual([2, 4, 6]);
});

test('merge cancellation interrupts a pending read from an idle command', async () => {
  const runner = command(
    process.execPath,
    '-e',
    'setTimeout(() => {}, 600)'
  ).runner();
  const values = await $.merge(runner.stream().lines(), stream(['ready']))
    .take(1)
    .toArray();
  expect(values).toEqual(['ready']);
  expect(runner.result.signal).toBe('SIGTERM');
}, 5000);

test('watch mode reloads package edits and stops watching on close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'command-watch-'));
  let controller;
  let installed;
  try {
    const file = join(dir, 'commands.mjs');
    await writeFile(
      file,
      "export default {name:'watch-fixture',commands:{'watch-fixture':()=>({code:0,stdout:'before'})}}"
    );
    installed = await install(file);
    let done;
    const changed = new Promise((resolve) => {
      done = resolve;
    });
    controller = dev({
      cwd: dir,
      entry: null,
      watch: ['**/*.mjs'],
      packages: [installed],
      interval: 10,
      debounce: 0,
      onRestart: done,
    });
    await controller.ready;
    await writeFile(
      join(dir, 'next.tmp'),
      "export default {name:'watch-fixture',commands:{'watch-fixture':()=>({code:0,stdout:'after-longer'})}}"
    );
    // Model an editor's atomic save so debounce:0 cannot read a partial write.
    await rename(join(dir, 'next.tmp'), file);
    await changed;
    expect(await (await $({ mirror: false })`watch-fixture`).text()).toBe(
      'after-longer'
    );
    await controller.close();
    controller = null;
  } finally {
    await controller?.close();
    installed?.uninstall();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test('snapshot assertions detect mismatches and require explicit updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'command-snapshot-'));
  try {
    const file = join(dir, 'snapshot.json');
    await testing.snapshot(file, [1], { update: true });
    await testing.snapshot(file, [1]);
    await expect(testing.snapshot(file, [2])).rejects.toThrow(
      'Snapshot differs'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser debugger requires its token and controls step gates', async () => {
  const debugger_ = new PipelineDebugger({ paused: true });
  const view = await debugger_.serve();
  try {
    const url = new URL(view.url);
    const token = url.searchParams.get('token');
    expect((await fetch(`${url.origin}/api/state`)).status).toBe(403);
    const output = debugger_.stage('input', [1]);
    const pending = output.next();
    const response = await fetch(`${url.origin}/api/step`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect((await pending).value).toBe(1);
    const state = await (
      await fetch(`${url.origin}/api/state`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(state.timeline[0].value).toBe(1);
    debugger_.resume();
    await output.return();
  } finally {
    await view.close();
  }
});

test('VS Code commands, completion contexts, and shell diagnostics', () => {
  const extension = createRequire(import.meta.url)(
    '../../extensions/vscode-command-stream/src/extension.cjs'
  );
  const text = "$.create('hello-world', () => ({}));\n$`echo 'unfinished`";
  const document = { getText: () => text, lineAt: () => ({ text: '$`hel' }) };
  expect(extension.commands(document)['hello-world']).toContain(
    'Virtual command'
  );
  expect(extension.shellPrefix(document, { line: 0, character: 5 })).toBe(true);
  expect(extension.shellErrors(document)[0].message).toContain('Unclosed');
  expect(
    extension.shellErrors({ getText: () => "$`echo '${value}'`" })
  ).toEqual([]);
});

test('all ten example packages install and participate in command pipelines', async () => {
  const installed = [];
  try {
    for (const name of [
      'git-tools',
      'deploy',
      'files',
      'json',
      'text',
      'http',
      'logs',
      'time',
      'env',
      'math',
    ]) {
      // Local ignored files can otherwise make this pass while a fresh CI
      // checkout or source archive is missing an advertised package.
      execFileSync(
        'git',
        [
          'ls-files',
          '--error-unmatch',
          `js/examples/packages/${name}/index.mjs`,
          `js/examples/packages/${name}/package.json`,
        ],
        {
          cwd: join(import.meta.dir, '../..'),
          stdio: 'pipe',
        }
      );
      installed.push(
        await install(
          join(import.meta.dir, '../examples/packages', name, 'index.mjs')
        )
      );
    }
    expect(installed.length).toBe(10);
    expect(await (await $({ mirror: false })`add 2 3`).text()).toBe('5\n');
    expect(await (await $({ mirror: false })`echo hello | upper`).text()).toBe(
      'HELLO\n'
    );
    expect(
      await $({ mirror: false })`deploy-plan staging v1`.stream().toArray()
    ).toHaveLength(4);
    const stats = await $({ mirror: false })`log-records OK ERROR`
      .stream()
      .analyze({ errorRate: (line) => JSON.parse(line).level === 'error' });
    expect(stats.errorRate).toBe(0.5);
  } finally {
    installed.reverse().forEach((package_) => package_.uninstall());
  }
});

test('dev restarts a live process and awaits its shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'command-restart-'));
  let controller;
  const record = join(dir, 'started.txt');
  const entry = join(dir, 'app.mjs');
  const script = (revision) =>
    `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(record)},${JSON.stringify(`${revision}\n`)}); setInterval(()=>{},1000);`;
  const waitFor = async (text) => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await readFile(record, 'utf8')).includes(text)) {
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Process did not start: ${text}`);
  };
  try {
    await writeFile(entry, script('first'));
    controller = dev({
      cwd: dir,
      entry,
      watch: ['app.mjs'],
      initial: true,
      interval: 10,
      debounce: 0,
    });
    await controller.ready;
    await waitFor('first');
    const previous = controller.child;
    await writeFile(entry, script('second'));
    await waitFor('second');
    expect(previous.finished).toBe(true);
    const current = controller.child;
    await controller.close();
    expect(current.finished).toBe(true);
    controller = null;
  } finally {
    await controller?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test('paused native pipelines apply backpressure in Node and Bun', async () => {
  for (const runtime of ['node', process.execPath]) {
    const result = await command(
      runtime,
      join(import.meta.dir, '../../experiments/issue-224/pipeline-pressure.mjs')
    );
    expect(result.code).toBe(0);
    const report = JSON.parse(await result.text());
    expect(report.pausedAt).toBeLessThan(200);
    expect(report.bytes).toBe(200 * 16384);
  }
}, 10000);

test('mixed pipeline cancellation terminates native stage trees in Node and Bun', async () => {
  for (const runtime of ['node', process.execPath]) {
    const result = await command(
      runtime,
      join(
        import.meta.dir,
        '../../experiments/issue-224/pipeline-cancellation.mjs'
      )
    );
    expect(result.code).toBe(0);
    if (process.platform !== 'win32') {
      expect(JSON.parse(await result.text()).survived).toBe(false);
    }
  }
}, 10000);

test('capture:false emits regular virtual command output without retaining it', async () => {
  $.create('uncaptured-fixture', () => ({
    code: 0,
    stdout: 'output\n',
    stderr: 'diagnostic\n',
  }));
  try {
    const runner = $({ mirror: false, capture: false })`uncaptured-fixture`;
    const values = await runner.stream().lines().toArray();
    expect(values).toEqual(['output']);
    expect(runner.result.stdout).toBeUndefined();
  } finally {
    $.unregister('uncaptured-fixture');
  }
});

test('editor diagnostics finish scanning escaped text with an unclosed template', async () => {
  const result = await command(
    'node',
    join(import.meta.dir, '../../experiments/issue-224/editor-escapes.mjs')
  );
  expect(result.code).toBe(0);
  expect(await result.text()).toContain('editor escape scan completed');
}, 5000);

test('VS Code activation wires completion, docs, diagnostics, and the REPL command', () => {
  const extension = createRequire(import.meta.url)(
    '../../extensions/vscode-command-stream/src/extension.cjs'
  );
  const registrations = {};
  const disposable = () => ({ dispose() {} });
  const document = {
    languageId: 'javascript',
    uri: 'fixture.mjs',
    getText: (range) => (range ? 'echo' : "$`echo 'broken`"),
    lineAt: () => ({ text: '$`ec' }),
    positionAt: (offset) => offset,
    getWordRangeAtPosition: () => ({ start: 0, end: 4 }),
  };
  const diagnostic = {
    set: (uri, values) => {
      registrations.errors = values;
    },
    delete() {},
    dispose() {},
  };
  class Item {
    constructor(label) {
      this.label = label;
    }
  }
  class Diagnostic {
    constructor(range, message) {
      this.range = range;
      this.message = message;
    }
  }
  class Hover {
    constructor(description) {
      this.description = description;
    }
  }
  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }
  const vscode = {
    CompletionItem: Item,
    CompletionItemKind: { Function: 1 },
    Diagnostic,
    Hover,
    Range,
    DiagnosticSeverity: { Error: 1 },
    languages: {
      createDiagnosticCollection: () => diagnostic,
      registerCompletionItemProvider: (selector, provider) => {
        registrations.completion = provider;
        return disposable();
      },
      registerHoverProvider: (selector, provider) => {
        registrations.hover = provider;
        return disposable();
      },
    },
    workspace: {
      textDocuments: [document],
      onDidOpenTextDocument: disposable,
      onDidChangeTextDocument: disposable,
      onDidCloseTextDocument: disposable,
    },
    commands: {
      registerCommand: (name, callback) => {
        registrations.command = callback;
        return disposable();
      },
    },
    window: {
      createTerminal: () => ({
        show() {},
        sendText: (text) => {
          registrations.terminal = text;
        },
      }),
    },
  };
  const context = { subscriptions: [] };
  extension.activate(context, vscode);
  expect(registrations.errors[0].message).toContain('Unclosed');
  expect(
    registrations.completion
      .provideCompletionItems(document, { line: 0, character: 4 })
      .map((item) => item.label)
  ).toContain('echo');
  expect(registrations.hover.provideHover(document, {}).description).toContain(
    'Print arguments'
  );
  registrations.command();
  expect(registrations.terminal).toBe('npx command-stream repl');
  context.subscriptions.forEach((item) => item.dispose());
});

test('inherited stdin stops waiting when a child exits before its parent stdin closes', async () => {
  const module = pathToFileURL(join(import.meta.dir, '../src/$.mjs')).href;
  const source = `import {command} from ${JSON.stringify(module)}; const result=await command(process.execPath,'-e',"console.log('done')").with({stdin:'inherit'}); console.log(await result.text());`;
  const child = spawn('node', ['--input-type=module', '-e', source], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const closed = once(child, 'close');
  let watchdog;
  try {
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        watchdog = setTimeout(
          () => reject(new Error('stdin pump did not stop after child exit')),
          2000
        );
      }),
    ]);
    expect(result[0]).toBe(0);
    expect(output).toContain('done');
  } finally {
    clearTimeout(watchdog);
    child.kill();
    child.stdin.end();
    await closed;
  }
}, 10000);
