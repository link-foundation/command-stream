#!/usr/bin/env node

// One-time, reproducible semantic review of every decision that had been filed
// as `competitor-api-shape`. Observable process behavior always takes priority
// over the API used by an upstream project to expose or assert that behavior.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

const ported = (id) => ({ kind: 'ported', id });
const missing = (id) => ({ kind: 'missing', id });
const inapplicable = (id) => ({ kind: 'inapplicable', id });

function rustDisposition({ source, path, line, label }) {
  if (source === 'rust-std-process') {
    return line <= 338 ? missing('try-wait-and-shared-child-handle') : null;
  }

  if (source === 'async-process') {
    if (path === 'tests/sleep.rs' || line === 9) {
      return ported('direct-exact-argv');
    }
    if (line === 23) {
      return inapplicable('competitor-internals');
    }
    if (line === 42) {
      return ported('spawn-error-propagation');
    }
    if (line === 49) {
      return ported('nonzero-exit');
    }
    if (line === 100) {
      return ported('stdout-stderr-separation');
    }
    if (line === 115) {
      return ported('cwd-string');
    }
    if ([245, 257, 270, 398].includes(line)) {
      return missing('try-wait-and-shared-child-handle');
    }
    if (line === 319) {
      return missing('environment-clear-and-remove');
    }
    if (line === 341) {
      return ported('environment');
    }
    if (line === 448) {
      return missing('custom-stdio-and-file-handles');
    }
  }

  if (source === 'assert-cmd') {
    if (path === 'tests/testsuite/main.rs') {
      return inapplicable('platform-fixture-mechanics');
    }
    if (path === 'tests/cargo.rs' || label === 'append_context_example') {
      return null;
    }
    if (path === 'tests/examples.rs') {
      return ported('direct-exact-argv');
    }
    if (/failure|code/.test(label)) {
      return ported('nonzero-exit');
    }
    if (/stdout|stderr/.test(label)) {
      return ported('stdout-stderr-separation');
    }
    return ported('sync-execution');
  }

  if (source === 'duct') {
    if (label === 'test_cmd') {
      return ported('direct-exact-argv');
    }
    if (label === 'test_sh') {
      return missing('shell-expression-composition-and-redirection');
    }
    if (label === 'test_start' || label === 'test_multiple_threads') {
      return ported('concurrent-execution');
    }
    if (/error|unchecked/.test(label)) {
      return ported('nonzero-exit');
    }
    if (/nonblocking_waits|pids|zombies/.test(label)) {
      return missing('try-wait-and-shared-child-handle');
    }
    if (/stderr|path$|swapping|file$|before_spawn/.test(label)) {
      return missing('custom-stdio-and-file-handles');
    }
    if (/dir|path_sanitization/.test(label)) {
      return ported('cwd-string');
    }
    if (label === 'test_full_env') {
      return missing('environment-clear-and-remove');
    }
    if (/env/.test(label)) {
      return ported('environment');
    }
    if (label === 'test_silly') {
      return inapplicable('competitor-internals');
    }
    return null;
  }

  if (source === 'xshell') {
    if (path.includes('compile_') || path.includes('/tidy.rs')) {
      return inapplicable('platform-fixture-mechanics');
    }
    if (label === 'into_command') {
      return null;
    }
    if (/copy|exists|write|remove/.test(label)) {
      return inapplicable('unrelated-utilities');
    }
    if (label === 'recovers_from_panics') {
      return inapplicable('competitor-internals');
    }
    if (/push_dir|change_dir|current_directory/.test(label)) {
      return ported('cwd-string');
    }
    if (/env/.test(label)) {
      return ported('environment');
    }
    if (label === 'program_concatenation') {
      return ported('safe-template-interpolation');
    }
    if (label === 'ignore_status') {
      return ported('nonzero-exit');
    }
    if (label === 'read_stderr') {
      return ported('stdout-stderr-separation');
    }
    if (label === 'args_with_spaces') {
      return ported('argument-edge-cases');
    }
    if (label === 'no_deadlock') {
      return ported('large-output');
    }
    return ported('direct-exact-argv');
  }

  if (source === 'subprocess') {
    if (path.endsWith('/mod.rs')) {
      return null;
    }
    if (/merge_err_to_out_file|swapped_fds/.test(label)) {
      return missing('custom-stdio-and-file-handles');
    }
    if (/size_limit/.test(label)) {
      return missing('max-buffer-policy');
    }
    if (
      /stdout|stderr|output|capture|interleaved|exec_to_string|checked_capture_ok/.test(
        label
      )
    ) {
      if (/file|swapped_fds/.test(label)) {
        return missing('custom-stdio-and-file-handles');
      }
      return ported('stdout-stderr-separation');
    }
    if (/stdin_data/.test(label)) {
      return ported('stdin-string');
    }
    if (/multiple_reads|partial_read/.test(label)) {
      return ported('streamed-before-exit');
    }
    if (/very_long/.test(label)) {
      return ported('large-output');
    }
    if (/quick_exit/.test(label)) {
      return ported('direct-exact-argv');
    }
    if (/terminate/.test(label)) {
      return ported('stream-kill');
    }
    if (/pid|poll|wait|detach/.test(label)) {
      return missing('try-wait-and-shared-child-handle');
    }
    if (/env_set_all/.test(label)) {
      return missing('environment-clear-and-remove');
    }
    if (/arg0/.test(label)) {
      return ported('argument-edge-cases');
    }
    return null;
  }

  if (source === 'rust-cmd-lib') {
    if (label === 'test_tls_set') {
      return inapplicable('competitor-internals');
    }
    if (/run_cmds|run_fun|export_cmd/.test(label)) {
      return missing('shell-expression-composition-and-redirection');
    }
    if (/args|non_string/.test(label)) {
      return ported('argument-edge-cases');
    }
    if (/non_eng/.test(label)) {
      return ported('unicode-output');
    }
    if (/vars_in_str/.test(label)) {
      return ported('safe-template-interpolation');
    }
    if (/proc_env|env_var/.test(label)) {
      return ported('environment');
    }
    if (/current_dir|path_as_var|cd_fails/.test(label)) {
      return ported('cwd-string');
    }
    if (/vector/.test(label)) {
      return missing('array-and-splat-interpolation');
    }
    return ported('direct-exact-argv');
  }

  if (source === 'run-script') {
    if (path === 'src/types_test.rs') {
      return null;
    }
    if (/create_script|modify_script/.test(label)) {
      return inapplicable('competitor-internals');
    }
    if (/error_code/.test(label)) {
      return ported('nonzero-exit');
    }
    if (/invocation_error/.test(label)) {
      return ported('spawn-error-propagation');
    }
    if (/append_env/.test(label)) {
      return ported('environment');
    }
    if (/args/.test(label)) {
      return ported('argument-edge-cases');
    }
    return missing('shell-expression-composition-and-redirection');
  }

  if (source === 'bkt') {
    return missing('subprocess-result-caching');
  }
  if (source === 'shellfn') {
    if (line <= 34) {
      return missing('shell-expression-composition-and-redirection');
    }
    if (line === 51) {
      return ported('environment');
    }
    return missing('typed-script-return-adapters');
  }
  if (source === 'rexpect' || source === 'expectrl') {
    return missing('expect-and-pty-session');
  }
  return null;
}

function jsDisposition({ source, path, line, label }) {
  if (source === 'node-child-process') {
    return null;
  }

  if (source === 'bun-shell') {
    if (/\/(lex|parse)\.test\.ts$/.test(path)) {
      return inapplicable('competitor-internals');
    }
    if (/leak|sentinel|worker-terminate/.test(path)) {
      return inapplicable('runtime-only-behavior');
    }
    if (path.endsWith('shell-seq-condexpr.test.ts')) {
      return missing('shell-builtin-breadth');
    }
    if (path.endsWith('file-io.test.ts')) {
      return missing('custom-stdio-descriptors');
    }
    if (path.endsWith('shell-hang.test.ts')) {
      return ported('concurrent-execution');
    }
    if (path.endsWith('shell-load.test.ts')) {
      return ported('direct-exact-argv');
    }
    if (path.endsWith('shelloutput.test.ts')) {
      if (line === 37) {
        return missing('max-buffer-policy');
      }
      return line === 7
        ? ported('result-text')
        : missing('rich-error-and-timing-metadata');
    }
    if (path.endsWith('throw.test.ts')) {
      return ported('nonzero-exit');
    }
    if (path.endsWith('bunshell-default.test.ts')) {
      return ported('nonzero-exit');
    }
    if (path.endsWith('bunshell-file.test.ts')) {
      return ported('safe-template-interpolation');
    }
    if (path.endsWith('bunshell-instance.test.ts')) {
      if (line === 39) {
        return ported('environment');
      }
      if ([60, 64, 68].includes(line)) {
        return missing('output-transforms-and-line-iteration');
      }
      return missing('iterable-and-stream-input-options');
    }
    if (path.endsWith('bunshell.test.ts')) {
      if (line === 95) {
        return inapplicable('platform-fixture-mechanics');
      }
      if (line >= 3123 && line <= 3132) {
        return missing('rich-error-and-timing-metadata');
      }
      if (/big_data/.test(label)) {
        return ported('large-output');
      }
      if (/redirect/.test(label)) {
        return missing('custom-stdio-descriptors');
      }
      if (/var|export/.test(label)) {
        return ported('environment');
      }
      if (/js_obj|raw|surrogate|compound word/.test(label)) {
        return ported('safe-template-interpolation');
      }
      return missing('shell-builtin-breadth');
    }
    return null;
  }

  if (source === 'deno-command') {
    return missing('timeout-option');
  }

  if (source === 'execa') {
    if (
      path.startsWith('test/convert/duplex') ||
      path.startsWith('test/convert/writable')
    ) {
      return missing('iterable-and-stream-input-options');
    }
    if (
      path.startsWith('test/convert/readable') ||
      path === 'test/io/iterate.js'
    ) {
      return missing('output-transforms-and-line-iteration');
    }
    if (path === 'test/convert/shared.js') {
      return missing('iterable-and-stream-input-options');
    }
    if (path === 'test/io/output-async.js') {
      return inapplicable('competitor-internals');
    }
    if (path === 'test/methods/bind.js') {
      if (line <= 33) {
        return ported('bound-options');
      }
      if ([85, 86, 87].includes(line)) {
        return missing('custom-stdio-descriptors');
      }
      return missing('layered-bound-option-merging');
    }
    if (path === 'test/methods/override-promise.js') {
      return null;
    }
    if (path === 'test/methods/create.js') {
      return ported('safe-template-interpolation');
    }
    if (path === 'test/methods/node.js') {
      if (line <= 37) {
        return ported('direct-exact-argv');
      }
      if (line <= 79) {
        return null;
      }
      if (line <= 255) {
        return missing('local-binary-resolution');
      }
      if (line >= 299) {
        return missing('shell-builtin-breadth');
      }
      return missing('ipc-and-fork');
    }
    if (path === 'test/methods/parameters-options.js') {
      return ported('argument-edge-cases');
    }
    if (
      path === 'test/methods/promise.js' ||
      path === 'test/methods/script.js'
    ) {
      return null;
    }
    if (path === 'test/methods/template.js') {
      return [47, 48, 49].includes(line)
        ? ported('array-interpolation')
        : ported('safe-template-interpolation');
    }
    if (path === 'test/resolve/all.js') {
      return missing('combined-all-output');
    }
    if (path === 'test/resolve/exit.js') {
      return missing('rich-error-and-timing-metadata');
    }
    if (path === 'test/resolve/no-buffer.js') {
      return missing('output-transforms-and-line-iteration');
    }
    if (path === 'test/resolve/wait-epipe.js') {
      return missing('custom-stdio-descriptors');
    }
    if (path.startsWith('test/return/')) {
      if (path.endsWith('/reject.js')) {
        return ported('nonzero-exit');
      }
      if (path.endsWith('/output.js') && line <= 27) {
        return ported('stdout-stderr-separation');
      }
      return missing('rich-error-and-timing-metadata');
    }
    if (path === 'test/terminate/cleanup.js') {
      return missing('graceful-termination');
    }
  }

  if (source === 'cross-spawn') {
    if ([267, 377, 387].includes(line)) {
      return ported('spawn-error-result');
    }
    if (line === 307) {
      return ported('nonzero-exit');
    }
    if (line === 347) {
      return missing('windows-shebang-and-pathext-resolution');
    }
    return missing('shell-builtin-breadth');
  }

  if (source === 'david-shell' && line === 783) {
    return ported('safe-template-interpolation');
  }

  if (source === 'nano-spawn') {
    if (path === 'test/index.js') {
      if (line === 27) {
        return missing('child-process-handle-lifecycle');
      }
      if (line === 36) {
        return ported('concurrent-execution');
      }
      return null;
    }
    if (path === 'test/options.js') {
      if ([45, 46].includes(line)) {
        return ported('argument-edge-cases');
      }
      if ([64, 65, 75, 76].includes(line)) {
        return missing('custom-stdio-descriptors');
      }
      return ported('direct-exact-argv');
    }
    if (path === 'test/result.js') {
      if ([93, 100, 114, 123].includes(line)) {
        return ported('stdout-stderr-separation');
      }
      if ([107, 132].includes(line)) {
        return missing('combined-all-output');
      }
      return missing('rich-error-and-timing-metadata');
    }
    if (path === 'test/windows.js') {
      return missing('windows-shebang-and-pathext-resolution');
    }
  }

  return null;
}

function rewrite(language, decisionRelative, manifestRelative, classify) {
  const decisionPath = resolve(root, decisionRelative);
  const manifest = readFileSync(resolve(root, manifestRelative), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  const units = new Map(
    manifest
      .filter(({ record }) => record === 'unit')
      .map((unit) => [unit.id, unit])
  );
  const records = readFileSync(decisionPath, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  let reviewed = 0;
  let moved = 0;
  const retained = [];

  for (const record of records.slice(1)) {
    const unit = units.get(record.id);
    if (!unit) {
      throw new Error(`Missing ${language} manifest unit: ${record.id}`);
    }
    const normalizeWholeFamily =
      language === 'js' &&
      unit.source === 'execa' &&
      unit.path === 'test/methods/bind.js';
    if (
      !normalizeWholeFamily &&
      (record.disposition.kind !== 'inapplicable' ||
        record.disposition.id !== 'competitor-api-shape')
    ) {
      continue;
    }
    reviewed += 1;
    const next = classify(unit);
    if (next) {
      record.disposition = next;
      moved += 1;
    } else {
      retained.push(`${unit.source}\t${unit.path}:${unit.line}\t${unit.label}`);
    }
  }

  writeFileSync(decisionPath, `${records.map(JSON.stringify).join('\n')}\n`);
  console.log(
    `${language}: reviewed ${reviewed}, reclassified ${moved}, retained ${retained.length}`
  );
  for (const item of retained) {
    console.log(`  ${item}`);
  }
}

rewrite(
  'rust',
  'rust/tests/competitor_decisions.jsonl',
  'rust/tests/competitor_dispositions.jsonl',
  rustDisposition
);
rewrite(
  'js',
  'js/tests/competitor-decisions.jsonl',
  'js/tests/competitor-dispositions.jsonl',
  jsDisposition
);
