process.stdout.write(
  [
    '\u001b[2J\u001b[H',
    '\u001b[1;2;3;4;9;38;2;12;34;56;48;5;196m',
    '  styled ⠋表',
    '\u001b[0m\r\n',
    '┌────┐\r\n',
    '│ ok │\r\n',
    '└────┘',
  ].join('')
);

setTimeout(() => {
  process.stdout.write('\u001b[H\u001b[32msecond\u001b[0m');
}, 120);

setTimeout(() => process.exit(0), 180);
