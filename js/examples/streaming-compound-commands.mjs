import { $ } from '../src/$.mjs';

const startedAt = Date.now();
const command = $({
  mirror: false,
})`echo "build started"; sleep 0.25; echo "build finished"`;

for await (const chunk of command.stream()) {
  const elapsed = `${Date.now() - startedAt}ms`;

  if (chunk.type === 'stdout' || chunk.type === 'stderr') {
    process.stdout.write(`[${elapsed}] ${chunk.type}: ${chunk.data}`);
  } else if (chunk.type === 'exit') {
    console.log(`[${elapsed}] exit: ${chunk.code}`);
  }
}
