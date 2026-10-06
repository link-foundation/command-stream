import {
  checkCancelled,
  numericValue,
  parseTextArgs,
  textLines,
} from './$.text-utils.mjs';

export default async function* sort(context) {
  const { flags, files } = parseTextArgs('sort', context.args);
  checkCancelled('sort', context);
  const lines = [];
  for (const file of files.length ? files : ['-']) {
    for await (const line of textLines('sort', file, context)) {
      lines.push(line.endsWith('\n') ? line.slice(0, -1) : line);
    }
  }
  const compare = (left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right));
  lines.sort(
    (left, right) =>
      (flags.has('n') ? numericValue(left) - numericValue(right) : 0) ||
      compare(left, right)
  );
  if (flags.has('r')) {
    lines.reverse();
  }
  let previous;
  for (const line of lines) {
    checkCancelled('sort', context);
    const key = flags.has('n') ? numericValue(line) : line;
    if (!flags.has('u') || key !== previous) {
      yield `${line}\n`;
    }
    previous = key;
  }
}
