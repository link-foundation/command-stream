import { $ } from '../src/$.mjs';

// Default SIGTERM -> 143
{
  const cmd = $({
    mirror: false,
  })`sh -c 'i=0; while true; do echo t-$i; i=$((i+1)); sleep 0.05; done'`;
  let n = 0,
    code;
  for await (const ch of cmd.stream()) {
    if (ch.type === 'stdout' && ++n >= 2) {
      cmd.kill();
    } else if (ch.type === 'exit') {
      code = ch.code;
    }
  }
  console.log('default kill exit code:', code, '(expect 143)');
}

// Configured SIGINT -> 130
{
  const cmd = $({
    mirror: false,
    killSignal: 'SIGINT',
  })`sh -c 'i=0; while true; do echo t-$i; i=$((i+1)); sleep 0.05; done'`;
  let n = 0,
    code;
  for await (const ch of cmd.stream()) {
    if (ch.type === 'stdout' && ++n >= 2) {
      cmd.kill();
    } // no arg -> uses killSignal
    else if (ch.type === 'exit') {
      code = ch.code;
    }
  }
  console.log('configured SIGINT exit code:', code, '(expect 130)');
}

// Explicit signal arg overrides -> SIGKILL 137
{
  const cmd = $({
    mirror: false,
  })`sh -c 'i=0; while true; do echo t-$i; i=$((i+1)); sleep 0.05; done'`;
  let n = 0,
    code;
  for await (const ch of cmd.stream()) {
    if (ch.type === 'stdout' && ++n >= 2) {
      cmd.kill('SIGKILL');
    } else if (ch.type === 'exit') {
      code = ch.code;
    }
  }
  console.log('explicit SIGKILL exit code:', code, '(expect 137)');
}
console.log('DONE');
