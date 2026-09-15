process.stdin.setRawMode?.(true);
process.stdin.resume();

let typed = '';
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString()) {
    if (character === '\r') {
      process.stdout.write(`\r\nlogged-in:${typed}\r\n`);
      setTimeout(() => process.exit(0), 20);
      typed = '';
    } else {
      typed += character;
    }
  }
});

process.stdout.write('auth-url: https://example.test/device?code=42\r\n');
setTimeout(() => process.stdout.write('waiting for code\r\n'), 20);
