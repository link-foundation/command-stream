import path from 'path';
import { VirtualUtils } from '../$.utils.mjs';

export default async function dirname({ args }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'dirname');
  if (argError) {
    return argError;
  }

  const filePath = args[0];
  const result = path.dirname(filePath);

  return VirtualUtils.success(`${result}\n`);
}
