import fs from 'fs';
import { trace, VirtualUtils } from '../$.utils.mjs';

/**
 * Translate a file system error into the message GNU tee prints.
 * @param {string} file - File operand as written by the caller
 * @param {Error & { code?: string }} error - Error thrown by the write
 * @returns {string} Newline-terminated stderr line
 */
function fileErrorMessage(file, error) {
  if (error.code === 'ENOENT') {
    return `tee: ${file}: No such file or directory\n`;
  }
  if (error.code === 'EISDIR') {
    return `tee: ${file}: Is a directory\n`;
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return `tee: ${file}: Permission denied\n`;
  }
  return `tee: ${file}: ${error.message}\n`;
}

/**
 * Parse tee operands.
 *
 * Supports `-a`/`--append`, `-i`/`--ignore-interrupts`, clustered short
 * options such as `-ai`, and `--` to end option parsing. Everything else is an
 * operand, including a bare `-`, which GNU tee treats as a file named `-`.
 *
 * @param {string[]} args - Raw arguments
 * @returns {{append: boolean, ignoreInterrupts: boolean, files: string[], error?: string}}
 */
function parseArgs(args) {
  const parsed = { append: false, ignoreInterrupts: false, files: [] };
  let optionsEnded = false;

  for (const arg of args) {
    if (optionsEnded || arg === '-' || !arg.startsWith('-')) {
      parsed.files.push(arg);
      continue;
    }

    if (arg === '--') {
      optionsEnded = true;
      continue;
    }

    if (arg === '--append') {
      parsed.append = true;
      continue;
    }

    if (arg === '--ignore-interrupts') {
      parsed.ignoreInterrupts = true;
      continue;
    }

    if (arg.startsWith('--')) {
      return { ...parsed, error: `tee: unrecognized option '${arg}'\n` };
    }

    for (const flag of arg.slice(1)) {
      if (flag === 'a') {
        parsed.append = true;
      } else if (flag === 'i') {
        parsed.ignoreInterrupts = true;
      } else {
        return { ...parsed, error: `tee: invalid option -- '${flag}'\n` };
      }
    }
  }

  return parsed;
}

/**
 * Virtual implementation of the Unix `tee` command.
 *
 * Reads stdin, copies it to stdout so the pipeline keeps flowing, and writes
 * the same bytes to every file operand. File operands are truncated unless
 * `-a` is given. A file that cannot be written reports an error and sets the
 * exit code to 1, but the remaining files and stdout are still written, which
 * is what GNU tee does.
 *
 * @param {object} context - Virtual command context
 * @param {string[]} context.args - Command arguments
 * @param {string} [context.stdin] - Buffered stdin contents
 * @param {string} [context.cwd] - Working directory for relative paths
 * @param {function} [context.isCancelled] - Cancellation probe
 * @param {AbortSignal} [context.abortSignal] - Abort signal
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export default async function tee({
  args,
  stdin,
  cwd,
  isCancelled,
  abortSignal,
}) {
  const { append, ignoreInterrupts, files, error } = parseArgs(args);

  if (error) {
    trace('VirtualCommand', () => `tee: ${error.trim()}`);
    return VirtualUtils.error(error);
  }

  const input = stdin === undefined || stdin === null ? '' : String(stdin);

  trace(
    'VirtualCommand',
    () =>
      `tee: starting | ${JSON.stringify(
        { append, ignoreInterrupts, files, stdinLength: input.length },
        null,
        2
      )}`
  );

  let stderr = '';
  let code = 0;

  for (const file of files) {
    if (!ignoreInterrupts && (isCancelled?.() || abortSignal?.aborted)) {
      trace('VirtualCommand', () => 'tee: cancelled while writing files');
      // SIGINT exit code, with the input still forwarded to stdout.
      return { code: 130, stdout: input, stderr };
    }

    const resolvedPath = VirtualUtils.resolvePath(file, cwd);
    trace(
      'VirtualCommand',
      () =>
        `tee: writing file | ${JSON.stringify(
          { file: resolvedPath, append, bytes: input.length },
          null,
          2
        )}`
    );

    try {
      if (append) {
        fs.appendFileSync(resolvedPath, input);
      } else {
        fs.writeFileSync(resolvedPath, input);
      }
    } catch (writeError) {
      // GNU tee keeps copying to the remaining files and to stdout after a
      // failed target, and exits with 1 at the end.
      stderr += fileErrorMessage(file, writeError);
      code = 1;
    }
  }

  trace(
    'VirtualCommand',
    () =>
      `tee: finished | ${JSON.stringify(
        { filesWritten: files.length, code, stdoutBytes: input.length },
        null,
        2
      )}`
  );

  return { code, stdout: input, stderr };
}
