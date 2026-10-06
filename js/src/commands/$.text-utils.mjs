import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { trace, VirtualUtils } from '../$.utils.mjs';

export function commandError(command, message, code = 1) {
  return Object.assign(new Error(`${command}: ${message}`), { code });
}

export function checkCancelled(command, context) {
  if (context.isCancelled?.() || context.abortSignal?.aborted) {
    throw commandError(command, 'cancelled', 130);
  }
}

/** Validate an input without consuming it, including head's zero-line case. */
export async function validateInput(command, file, context) {
  checkCancelled(command, context);
  if (file === '-') {
    return;
  }
  let handle;
  try {
    handle = await open(VirtualUtils.resolvePath(file, context.cwd));
    if ((await handle.stat()).isDirectory()) {
      throw commandError(command, `${file}: Is a directory`);
    }
  } catch (error) {
    if (Number.isInteger(error.code)) {
      throw error;
    }
    throw commandError(
      command,
      `${file}: ${error.code === 'ENOENT' ? 'No such file or directory' : error.message}`
    );
  } finally {
    await handle?.close();
  }
}

function parseCount(command, value) {
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) {
    throw commandError(command, `invalid number of lines: '${value ?? ''}'`);
  }
  return Number(value);
}

function lineOption(command, args, index) {
  const arg = args[index];
  if (arg === '-n' || arg === '--lines') {
    return { count: parseCount(command, args[index + 1]), skip: 1 };
  }
  if (arg.startsWith('--lines=')) {
    return { count: parseCount(command, arg.slice(8)), skip: 0 };
  }
  const match = arg.match(/^-(?:n)?(.*)$/);
  return { count: parseCount(command, match[1]), skip: 0 };
}

export function parseTextArgs(command, args) {
  const parsed = { count: 10, flags: new Set(), files: [] };
  let options = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (options && arg === '--') {
      options = false;
    } else if (options && arg.startsWith('-') && arg !== '-') {
      if (command === 'head' || command === 'tail') {
        const option = lineOption(command, args, index);
        parsed.count = option.count;
        index += option.skip;
      } else {
        parseFlags(command, arg, parsed.flags);
      }
    } else {
      parsed.files.push(arg);
    }
  }
  if (command === 'uniq' && parsed.files.length > 2) {
    throw commandError(command, 'extra operand');
  }
  if (parsed.flags.has('d') && parsed.flags.has('u')) {
    throw commandError(command, 'cannot combine -d and -u');
  }
  return parsed;
}

function parseFlags(command, arg, flags) {
  const aliases = {
    '--reverse': 'r',
    '--numeric-sort': 'n',
    '--unique': 'u',
    '--count': 'c',
    '--repeated': 'd',
    '--ignore-case': 'i',
  };
  const allowed = command === 'sort' ? 'rnu' : 'cdui';
  const value = aliases[arg] ?? arg.slice(1);
  for (const flag of value) {
    if (!allowed.includes(flag)) {
      throw commandError(command, `invalid option '${arg}'`);
    }
    flags.add(flag);
  }
}

/** Yield complete lines with their original LF/CRLF and final partial line. */
export async function* textLines(command, file, context) {
  checkCancelled(command, context);
  const input =
    file === '-'
      ? [context.stdin ?? '']
      : createReadStream(VirtualUtils.resolvePath(file, context.cwd), {
          encoding: 'utf8',
        });
  trace('VirtualCommand', () => `${command}: reading ${file}`);
  let pending = '';
  try {
    for await (const chunk of input) {
      checkCancelled(command, context);
      pending += chunk;
      let start = 0;
      let end;
      while ((end = pending.indexOf('\n', start)) !== -1) {
        checkCancelled(command, context);
        yield pending.slice(start, end + 1);
        start = end + 1;
      }
      pending = pending.slice(start);
    }
    if (pending) {
      yield pending;
    }
  } catch (error) {
    if (Number.isInteger(error.code)) {
      throw error;
    }
    const message =
      error.code === 'ENOENT'
        ? 'No such file or directory'
        : error.code === 'EISDIR'
          ? 'Is a directory'
          : error.message;
    throw commandError(command, `${file}: ${message}`);
  } finally {
    if (file !== '-') {
      input.destroy();
    }
  }
}

export function numericValue(line) {
  const match = line.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
  return match ? Number(match[1]) : 0;
}
