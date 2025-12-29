import { $, shell } from '../js/src/$.mjs';

const originalLog = console.log;
const capturedLogs = [];
console.log = (...args) => {
  capturedLogs.push(args.join(' '));
  originalLog('LOG:', ...args); // Also output to see what's happening
};

shell.verbose(true);
const result = await $`echo "verbose test"`;
console.log('Result stdout:', result.stdout);

console.log = originalLog;
console.log('Captured logs:', capturedLogs);
console.log('Looking for: "echo \\"verbose test\\""');
console.log(
  'Found verbatim:',
  capturedLogs.some((log) => log === 'echo "verbose test"')
);
console.log(
  'Found without quotes:',
  capturedLogs.some((log) => log === 'echo verbose test')
);
console.log(
  'Contains echo:',
  capturedLogs.some((log) => log.includes('echo'))
);
console.log(
  'Contains verbose test:',
  capturedLogs.some((log) => log.includes('verbose test'))
);
