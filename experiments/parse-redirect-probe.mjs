// What does the enhanced shell parser produce for simple commands with redirects?
import { parseShellCommand } from '../js/src/shell-parser.mjs';

for (const cmd of [
  'echo hello > /tmp/a.txt',
  'echo hello >> /tmp/a.txt',
  'echo "a > b"',
  "echo 'a > b' > /tmp/a.txt",
  'cat < /tmp/a.txt',
  'echo hi 2> /tmp/err.txt',
  'echo a | cat > /tmp/a.txt',
]) {
  console.log(cmd, '=>', JSON.stringify(parseShellCommand(cmd)));
}
