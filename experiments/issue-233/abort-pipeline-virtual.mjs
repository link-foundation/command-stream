// Pipeline with virtual `sleep` first stage: external abort vs timeout.
import { $ } from '../../js/src/$.mjs';
const mode = process.argv[2] ?? 'signal';
const ac = new AbortController();
if (mode === 'signal') {
  setTimeout(() => ac.abort(), 200);
}
const opts = mode === 'signal' ? { signal: ac.signal } : { timeout: 200 };
const started = Date.now();
try {
  const r = await $({ mirror: false, ...opts })`sleep 3 | cat`;
  console.log(
    mode,
    'resolved',
    r.code,
    r.signal,
    r.timedOut,
    Date.now() - started
  );
} catch (e) {
  console.log(mode, 'rejected', e.message, Date.now() - started);
}
