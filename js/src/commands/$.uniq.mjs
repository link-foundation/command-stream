import { open } from 'node:fs/promises';
import { VirtualUtils } from '../$.utils.mjs';
import {
  checkCancelled,
  commandError,
  parseTextArgs,
  textLines,
} from './$.text-utils.mjs';

function formatGroup(line, count, flags) {
  if ((flags.has('d') && count === 1) || (flags.has('u') && count > 1)) {
    return '';
  }
  return `${flags.has('c') ? `${String(count).padStart(7)} ` : ''}${line}`;
}

async function* groups(context, file, flags) {
  let previous;
  let previousKey;
  let count = 0;
  for await (const line of textLines('uniq', file, context)) {
    const text = line.endsWith('\n') ? line.slice(0, -1) : line;
    const key = flags.has('i') ? text.toLowerCase() : text;
    if (count && key !== previousKey) {
      yield formatGroup(previous, count, flags);
      count = 0;
    }
    if (!count) {
      previous = line;
      previousKey = key;
    }
    count++;
  }
  if (count) {
    yield formatGroup(previous, count, flags);
  }
}

export default async function* uniq(context) {
  const { flags, files } = parseTextArgs('uniq', context.args);
  checkCancelled('uniq', context);
  let output;
  try {
    if (files[1] && files[1] !== '-') {
      output = await open(VirtualUtils.resolvePath(files[1], context.cwd), 'w');
    }
    for await (const group of groups(context, files[0] ?? '-', flags)) {
      checkCancelled('uniq', context);
      if (output) {
        await output.write(group);
      } else if (group) {
        yield group;
      }
    }
  } catch (error) {
    if (Number.isInteger(error.code)) {
      throw error;
    }
    throw commandError('uniq', `${files[1]}: ${error.message}`);
  } finally {
    await output?.close();
  }
}
