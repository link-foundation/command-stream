#!/usr/bin/env node

// Cross-spawn migration examples showing command-stream's advantages
import $ from '../src/$.mjs';

console.log('Cross-spawn migration examples\n');
console.log('==============================\n');

// Example 1: Basic cross-spawn replacement
console.log('1. Basic cross-spawn compatibility');
console.log('Before (cross-spawn):');
console.log('  const spawn = require("cross-spawn");');
console.log('  const result = spawn.sync("echo", ["hello"], { stdio: "inherit" });');
console.log('After (command-stream):');
console.log('  import $ from "command-stream";');
console.log('  const result = $.spawn.sync("echo", ["hello"], { stdio: "inherit" });');

const result1 = $.spawn.sync('echo', ['hello from command-stream!'], { stdio: 'inherit' });
console.log(`  -> Exit code: ${result1.status}\n`);

// Example 2: Output capture comparison
console.log('2. Output capture');
console.log('Before (cross-spawn): Only buffered output');
console.log('After (command-stream): Get the same result, but streaming is available too');

const result2 = $.spawn.sync('echo', ['Captured output example'], { encoding: 'utf8' });
console.log(`  -> Captured: "${result2.stdout.trim()}"`);
console.log(`  -> Exit code: ${result2.status}\n`);

// Example 3: Error handling
console.log('3. Error handling');
console.log('Cross-spawn compatibility with better error messages:');

const errorResult = $.spawn.sync('nonexistent-command', [], { stdio: 'pipe' });
if (errorResult.error) {
  console.log(`  -> Error: ${errorResult.error.message}`);
} else {
  console.log(`  -> Unexpected success`);
}
console.log();

// Example 4: Show streaming advantage 
console.log('4. Streaming advantage (only in command-stream)');
console.log('Cross-spawn only does buffered I/O. Command-stream offers streaming:');
console.log('  // Stream large command output in real-time');
console.log('  for await (const chunk of $`find /usr -name "*.so" | head -10`.stream()) {');
console.log('    process.stdout.write(chunk);');
console.log('  }');
console.log();

// Example 5: Template literals advantage
console.log('5. Template literal syntax (command-stream exclusive)');
console.log('Cross-spawn: spawn("git", ["commit", "-m", message])');
console.log('Command-stream: $`git commit -m ${message}` (with proper escaping)');

const message = 'Hello "world" & more';
console.log(`  -> Example with message: ${message}`);
console.log(`     Cross-spawn requires manual array: ["git", "commit", "-m", "${message}"]`);
console.log(`     Command-stream handles escaping: \`git commit -m \${message}\``);
console.log();

// Example 6: Virtual commands
console.log('6. Virtual commands (command-stream exclusive)');
console.log('Command-stream includes built-in cross-platform commands:');

const lsResult = $.spawn.sync('$.ls', ['-la'], { encoding: 'utf8' });
if (lsResult.stdout) {
  const lines = lsResult.stdout.trim().split('\n');
  console.log(`  -> $.ls found ${lines.length} items in current directory`);
} else {
  console.log('  -> $.ls output captured (add { stdio: "inherit" } to see)');
}
console.log();

console.log('Migration complete! Command-stream provides cross-spawn compatibility');
console.log('PLUS streaming, template literals, and virtual commands.');