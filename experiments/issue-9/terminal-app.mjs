// A finite interactive fixture shared by shell and multiplexer probes.
process.stdin.setRawMode(true);
process.stdin.resume();
const render = (status) => {
  process.stdout.write(
    `\x1b[2J\x1b[H\x1b[32mREADY\x1b[0m ${process.stdout.columns}x${process.stdout.rows}\r\n${status}`
  );
};
render('waiting');
process.on('SIGWINCH', () => render('resized'));
process.stdin.on('data', (data) => {
  if (data.toString().includes('n')) {
    render('input received');
  }
  if (data.toString().includes('q')) {
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 5000).unref();
