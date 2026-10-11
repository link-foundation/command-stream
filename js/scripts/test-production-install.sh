#!/usr/bin/env bash
# Run inside a clean Node slim container with a packed package at $1.
set -euo pipefail

archive="$(realpath "$1")"
mode="${2:-scripts-enabled}"
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for tool in make gcc g++ python3; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "Unexpected build tool in clean install environment: $tool" >&2
    exit 1
  fi
done

flags=(--omit=dev --no-audit --no-fund --foreground-scripts)
npm_version="$(npm --version)"
case "$mode" in
  scripts-enabled) ;;
  scripts-disabled) flags+=(--ignore-scripts) ;;
  omit-optional) flags+=(--omit=optional) ;;
  *) echo "Unknown install mode: $mode" >&2; exit 1 ;;
esac

directory="$(mktemp -d)"
trap 'rm -rf "$directory"' EXIT
for scope in local global; do
  consumer="$directory/$scope"
  mkdir -p "$consumer"
  cp "$script_directory/verify-production-install.mjs" "$consumer/check.mjs"
  cd "$consumer"
  # npm 12 requires explicit approval. Older npm versions already run scripts.
  # A project policy covers local installs; global installs use the CLI list.
  printf '%s\n' '{"private":true,"allowScripts":{"node-pty":true}}' > package.json
  if [ "$scope" = global ]; then
    global_flags=()
    if [ "${npm_version%%.*}" -ge 12 ]; then
      global_flags+=(--allow-scripts=node-pty)
    fi
    npm install --global --prefix "$consumer/prefix" "${flags[@]}" "${global_flags[@]}" "$archive"
    mkdir node_modules
    ln -s "$consumer/prefix/lib/node_modules/command-stream" node_modules/command-stream
    test -x "$consumer/prefix/bin/command-stream"
  else
    npm install "${flags[@]}" "$archive"
  fi
  if [ "$scope" = local ]; then
    # Audit the actual resolved consumer graph without repository exceptions.
    npm audit --omit=dev --audit-level=high
  fi
  node check.mjs
  echo "PASS: Node $(node --version), $scope production install, $mode, no build toolchain"
done

# The consumer has no upstream ShellJS types. Compile both export conditions
# with only the normal Node types and the compiler, isolated from repo tooling.
typescript_version="$(node -p 'require(process.argv[1]).devDependencies.typescript' "$script_directory/../package.json")"
node_types_version="$(node -p 'require(process.argv[1]).devDependencies["@types/node"]' "$script_directory/../package.json")"
npm install --prefix "$directory/type-tools" --ignore-scripts --no-audit --no-fund \
  "typescript@$typescript_version" "@types/node@$node_types_version"
for scope in local global; do
  consumer="$directory/$scope"
  ln -s "$directory/type-tools/node_modules/@types" "$consumer/node_modules/@types"
  cp "$script_directory/production-types.mts" "$script_directory/production-types.cts" "$consumer/"
  node "$directory/type-tools/node_modules/typescript/bin/tsc" \
    --noEmit --strict --skipLibCheck false --target es2022 \
    --module nodenext --moduleResolution nodenext \
    "$consumer/production-types.mts" "$consumer/production-types.cts"
  echo "PASS: $scope isolated ESM/CommonJS production declarations"
done
