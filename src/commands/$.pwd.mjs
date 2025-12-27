import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function pwd({ args, stdin, cwd }) {
  // If cwd option is provided, return that instead of process.cwd()
  const dir = cwd || process.cwd();
  trace(
    'VirtualCommand',
    () => `pwd: getting directory | ${JSON.stringify({ dir }, null, 2)}`
  );
  return VirtualUtils.success(`${dir}\n`);
}
