import { command } from '../src/$.mjs';

const builder = command(process.execPath, '-e', 'console.log("hello")');
const result = await builder.run();
console.log('Output:', await result.text());
console.log('Exit code:', result.code);
console.log('Selected exit code:', await builder.pipe(command.exitCode));
