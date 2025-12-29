import { $, shell } from '../js/src/$.mjs';

const originalLog = console.log;
const capturedLogs = [];
console.log = (...args) => {
  capturedLogs.push(args.join(' '));
  originalLog(...args); // Also output to see what's happening
};

shell.verbose(true);
await $`echo "verbose test"`;

console.log = originalLog;
console.log('Captured logs:', capturedLogs);
console.log(
  'Has echo command:',
  capturedLogs.some((log) => log.includes('echo "verbose test"'))
);
