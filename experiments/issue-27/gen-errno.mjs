// Generates js/src/bun-shell/errno.mjs from Bun's coreutils_error_map
// (bun_core/result.rs at the pinned commit).
import fs from 'node:fs';
const src = fs.readFileSync(
  process.argv[2] || '/tmp/upstream/bun_core_result.rs',
  'utf8'
);
function table(name) {
  const start = src.indexOf(`static ${name}:`);
  const end = src.indexOf('};', start);
  const out = [];
  for (const m of src
    .slice(start, end)
    .matchAll(/"(E[A-Z0-9]+)" => "((?:[^"\\]|\\.)*)"/g)) {
    out.push([m[1], m[2]]);
  }
  return out;
}
const base = table('BASE');
const darwinStart = src.indexOf(
  '#[cfg(target_os = "macos")]\n    crate::comptime_string_map!'
);
const darwinSrc = src.slice(darwinStart);
const darwin = [
  ...darwinSrc
    .slice(0, darwinSrc.indexOf('};'))
    .matchAll(/"(E[A-Z0-9]+)" => "((?:[^"\\]|\\.)*)"/g),
].map((m) => [m[1], m[2]]);
const fmt = (rows) =>
  rows.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync(
  'js/src/bun-shell/errno.mjs',
  `// GNU-coreutils-style errno messages, generated from Bun's
// \`coreutils_error_map\` (src/bun_core/result.rs) by
// experiments/issue-27/gen-errno.mjs. Do not edit by hand.

const BASE = {
${fmt(base)}
};

const DARWIN = {
${fmt(darwin)}
};

/** The message Bun prints for an errno code name such as \`ENOENT\`. */
export function errnoMessage(code, platform = process.platform) {
  if (platform === 'darwin' && Object.hasOwn(DARWIN, code)) {
    return DARWIN[code];
  }
  return Object.hasOwn(BASE, code) ? BASE[code] : null;
}
`
);
console.log(base.length, darwin.length);
