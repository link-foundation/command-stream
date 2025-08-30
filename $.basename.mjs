import path from 'path';
import { VirtualUtils } from './$.utils.mjs';

export default async function basename({ args }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'basename');
  if (argError) return argError;

  const filePath = args[0];
  const suffix = args[1];
  
  let result = path.basename(filePath);
  
  // Remove suffix if provided and it matches
  if (suffix && result.endsWith(suffix)) {
    result = result.slice(0, -suffix.length);
  }
  
  return VirtualUtils.success(result + '\n');
}