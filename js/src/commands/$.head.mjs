import {
  checkCancelled,
  parseTextArgs,
  textLines,
  validateInput,
} from './$.text-utils.mjs';

export default async function* head(context) {
  const { count, files } = parseTextArgs('head', context.args);
  checkCancelled('head', context);
  const inputs = files.length ? files : ['-'];
  for (const [index, file] of inputs.entries()) {
    if (count === 0) {
      await validateInput('head', file, context);
    }
    if (inputs.length > 1) {
      yield `${index ? '\n' : ''}==> ${file === '-' ? 'standard input' : file} <==\n`;
    }
    if (count === 0) {
      continue;
    }
    let received = 0;
    for await (const line of textLines('head', file, context)) {
      yield line;
      if (++received === count) {
        break;
      }
    }
  }
}
