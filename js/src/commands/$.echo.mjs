import { trace, VirtualUtils } from '../$.utils.mjs';

export default async function echo({ args }) {
  trace(
    'VirtualCommand',
    () =>
      `echo: processing | ${JSON.stringify({ argsCount: args.length }, null, 2)}`
  );

  let output = args.join(' ');
  if (args.includes('-n')) {
    // Don't add newline
    trace(
      'VirtualCommand',
      () => `BRANCH: echo => NO_NEWLINE | ${JSON.stringify({}, null, 2)}`
    );
    output = args.filter((arg) => arg !== '-n').join(' ');
  } else {
    output += '\n';
  }
  return VirtualUtils.success(output);
}
