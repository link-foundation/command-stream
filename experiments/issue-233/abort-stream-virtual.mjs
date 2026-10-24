// Does an external AbortSignal on a streamed virtual `sleep` reject too (pre-existing)?
import { $ } from '../../js/src/$.mjs';
const ac = new AbortController();
setTimeout(() => ac.abort(), 200);
const runner = $({ mirror: false, signal: ac.signal })`sleep 3`;
try {
  for await (const chunk of runner.stream()) {
    console.log('chunk', String(chunk));
  }
  console.log('stream done', runner.result?.code);
} catch (e) {
  console.log('stream threw', e.message);
}
