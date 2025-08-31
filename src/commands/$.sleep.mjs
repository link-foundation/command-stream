import { trace } from '../$.utils.mjs';

export default async function sleep({ args }) {
  const seconds = parseFloat(args[0] || 0);
  trace('VirtualCommand', () => `sleep: starting | ${JSON.stringify({ seconds }, null, 2)}`);
  
  if (isNaN(seconds) || seconds < 0) {
    return { stderr: `sleep: invalid time interval '${args[0]}'`, code: 1 };
  }
  
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  trace('VirtualCommand', () => `sleep: completed | ${JSON.stringify({ seconds }, null, 2)}`);
  
  return { stdout: '', code: 0 };
}