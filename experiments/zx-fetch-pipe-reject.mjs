// Does `fetch(url).pipe` settle when the request fails (connection refused)?
import { fetch, $ } from '../js/src/zx/index.mjs';
const t = setTimeout(() => {
  console.log('HANG: pipe never settled');
  process.exit(1);
}, 3000);
try {
  await fetch('http://127.0.0.1:1/').pipe`cat`;
  console.log('resolved?!');
} catch (e) {
  console.log('rejected:', e.message);
}
clearTimeout(t);
