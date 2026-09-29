import { allCases } from '../../conformance/bun-shell/corpus.mjs';
const cs = allCases();
const keys = {};
const vk = {};
const ek = {};
for (const c of cs) {
  for (const k of Object.keys(c)) {
    keys[k] = (keys[k] || 0) + 1;
  }
  for (const k of Object.keys(c.expect || {})) {
    ek[k] = (ek[k] || 0) + 1;
  }
  const walk = (v) => {
    for (const k of Object.keys(v)) {
      vk[k] = (vk[k] || 0) + 1;
      if (k === 'array') {
        v.array.forEach(walk);
      }
    }
  };
  (c.values || []).forEach(walk);
}
console.log(cs.length, keys, vk, ek);
const byFile = {};
for (const c of cs) {
  byFile[c.file] = (byFile[c.file] || 0) + 1;
}
console.log(byFile);
