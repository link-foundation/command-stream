import { checkCancelled, parseTextArgs, textLines } from './$.text-utils.mjs';

export default async function* tail(context) {
  const { count, files } = parseTextArgs('tail', context.args);
  checkCancelled('tail', context);
  const inputs = files.length ? files : ['-'];
  for (const [index, file] of inputs.entries()) {
    if (inputs.length > 1) {
      yield `${index ? '\n' : ''}==> ${file === '-' ? 'standard input' : file} <==\n`;
    }
    const ring = [];
    let received = 0;
    for await (const line of textLines('tail', file, context)) {
      if (count) {
        ring[received++ % count] = line;
      }
    }
    const start = received > count ? received % count : 0;
    for (let offset = 0; offset < ring.length; offset++) {
      checkCancelled('tail', context);
      yield ring[(start + offset) % ring.length];
    }
  }
}
