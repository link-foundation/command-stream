import { $ } from '../src/$.mjs';

console.log('=== Command Builder Demo ===\n');

// Example from the GitHub issue
console.log('1. Issue example:');
const result1 = await $.command("cat", "./README.md").pipe(
  $.command.stdout("inherit"),
  $.command.exitCode
).run();

console.log('\n2. Basic usage:');
const result2 = await $.command('echo', 'hello world').run();
console.log('Output:', result2.stdout.trim());
console.log('Exit code:', result2.code);

console.log('\n3. With arguments that need escaping:');
const result3 = await $.command('echo', 'hello "world"', 'file with spaces.txt').run();
console.log('Output:', result3.stdout.trim());

console.log('\n4. Environment variables:');
const result4 = await $.command('env')
  .env({ DEMO_VAR: 'demo_value', ANOTHER: 'variable' })
  .run({ capture: true, mirror: false });
console.log('Environment includes DEMO_VAR:', result4.stdout.includes('DEMO_VAR=demo_value'));

console.log('\n5. Working directory:');
const result5 = await $.command('pwd')
  .cwd('/tmp')
  .run({ capture: true, mirror: false });
console.log('Working directory:', result5.stdout.trim());

console.log('\n6. stdin input:');
const result6 = await $.command('cat')
  .stdin('Hello from stdin!')
  .run({ capture: true, mirror: false });
console.log('Cat output:', result6.stdout.trim());

console.log('\n7. Safety - preventing shell injection:');
const malicious = 'hello; rm -rf /'
const result7 = await $.command('echo', malicious).run({ capture: true, mirror: false });
console.log('Safe output (not executed):', result7.stdout.trim());

console.log('\n8. Method chaining:');
const result8 = await $.command('echo', 'test')
  .arg('additional', 'arguments')
  .stdout('inherit')
  .capture(true)
  .run();

console.log('\n=== All examples completed successfully! ===');