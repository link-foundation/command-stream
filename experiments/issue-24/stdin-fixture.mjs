// Bound the old facade's unclosed or ignored stdin to a finite probe.
const watchdog = setTimeout(() => process.exit(90), 2000);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > 16_384) {
    process.exit(91);
  }
});
process.stdin.on('end', () => {
  clearTimeout(watchdog);
  process.stdout.write(input);
});
