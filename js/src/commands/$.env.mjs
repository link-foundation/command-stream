import { VirtualUtils } from '../$.utils.mjs';

export default async function env({ args, stdin: _stdin, env }) {
  if (args.length === 0) {
    // Use custom env if provided, otherwise use process.env
    const envVars = env || process.env;
    const output = `${Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`;
    return VirtualUtils.success(output);
  }
  // TODO: Support setting environment variables for subsequent command
  return VirtualUtils.error('env: setting variables not yet supported');
}
