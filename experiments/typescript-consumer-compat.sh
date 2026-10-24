#!/usr/bin/env bash
# Type checks the packed command-stream tarball from scratch consumer projects
# across TypeScript versions and module resolution modes.
#
#   experiments/typescript-consumer-compat.sh [work-dir]
#
# Each consumer imports the package (ESM and CommonJS where the mode allows
# it) and must compile with `strict` and `skipLibCheck: false`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
TARBALL="$(cd "$ROOT/js" && npm pack --silent --pack-destination "$WORK" | tail -1)"
echo "packed $TARBALL into $WORK"

check() {
  local ts="$1" types_node="$2" module="$3" resolution="$4" pkg_type="$5"
  local dir="$WORK/ts-$ts-$module-$resolution-$pkg_type"
  mkdir -p "$dir"
  cat > "$dir/package.json" <<JSON
{ "name": "consumer", "private": true, "type": "$pkg_type" }
JSON
  cat > "$dir/tsconfig.json" <<JSON
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": false,
    "noEmit": true,
    "target": "es2022",
    "lib": ["es2022"],
    "types": ["node"],
    "module": "$module",
    "moduleResolution": "$resolution"
  }
}
JSON
  cat > "$dir/esm.ts" <<'TS'
import $, { ProcessRunner, register, type StreamResult } from 'command-stream';
import { ProcessRunner as SubpathRunner } from 'command-stream/process-runner';

export async function main(): Promise<StreamResult> {
  register('hello', async ({ args }) => ({ stdout: `hi ${args[0] ?? ''}` }));
  const runner: ProcessRunner = $({ mirror: false })`echo ${'x'}`;
  const sub: SubpathRunner = runner;
  for await (const chunk of sub.stream()) {
    if (chunk.type === 'exit') {
      const code: number = chunk.code;
      void code;
    }
  }
  return runner;
}
TS
  if [ "$pkg_type" = commonjs ] && [ "$resolution" != bundler ]; then
    cat > "$dir/cjs.cts" <<'TS'
import $ = require('command-stream');
export const runner: $.ProcessRunner = $.$`echo hi`;
export const quiet: $.CommandTag = $({ mirror: false });
TS
  fi
  (
    cd "$dir"
    npm install --silent --no-audit --no-fund \
      "typescript@$ts" "@types/node@$types_node" "$WORK/$TARBALL" >/dev/null 2>&1
    if npx --no-install tsc -p . >"$dir/tsc.log" 2>&1; then
      echo "PASS ts=$ts module=$module resolution=$resolution type=$pkg_type"
    else
      echo "FAIL ts=$ts module=$module resolution=$resolution type=$pkg_type"
      sed 's/^/    /' "$dir/tsc.log"
    fi
  )
}

for ts in 5.0 5.4 5.8; do
  check "$ts" 20 node16 node16 module
  check "$ts" 20 node16 node16 commonjs
  check "$ts" 20 esnext bundler module
done
check 5.8 22 nodenext nodenext module
check 5.8 22 nodenext nodenext commonjs
check 5.8 22 preserve bundler module
