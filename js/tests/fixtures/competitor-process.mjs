import { appendFileSync } from 'node:fs';

const [mode, ...args] = process.argv.slice(2);

switch (mode) {
  case 'argv':
    process.stdout.write(JSON.stringify(args));
    break;

  case 'cwd':
    process.stdout.write(process.cwd());
    break;

  case 'env': {
    const selected = Object.fromEntries(
      args.map((name) => [name, process.env[name] ?? null])
    );
    process.stdout.write(JSON.stringify(selected));
    break;
  }

  case 'stdio':
    process.stdout.write(args[0] ?? '');
    process.stderr.write(args[1] ?? '');
    break;

  case 'stdin': {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    process.stdout.write(Buffer.concat(chunks));
    break;
  }

  case 'output':
    process.stdout.write((args[1] ?? 'x').repeat(Number(args[0])));
    break;

  case 'exit':
    process.exit(Number(args[0]));
    break;

  case 'delayed':
    process.stdout.write(args[0] ?? 'first');
    setTimeout(
      () => process.stdout.write(args[1] ?? 'second'),
      Number(args[2])
    );
    break;

  case 'touch':
    appendFileSync(args[0], args[1] ?? 'started');
    break;

  default:
    process.stderr.write(`Unknown fixture mode: ${mode ?? '<missing>'}`);
    process.exitCode = 64;
}
