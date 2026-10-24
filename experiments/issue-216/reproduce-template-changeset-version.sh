#!/usr/bin/env bash
# Reproduce issue 216 against a checkout of js-ai-driven-development-pipeline-template.
# Usage: reproduce-template-changeset-version.sh <template-dir> [format-override]
# Only data files are copied out of the (untrusted) template checkout into a
# fresh temp directory; the Changesets CLI comes from this repository's
# js/node_modules, and `deno` is hidden from PATH like on the hosted runner.
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
TEMPLATE=$(cd "$1" && pwd)
OVERRIDE=${2:-}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
for f in package.json package-lock.json deno.json deno.lock .prettierrc .prettierignore; do
  [ -f "$TEMPLATE/$f" ] && cp "$TEMPLATE/$f" "$WORK/$f"
done
mkdir "$WORK/.changeset"
cp "$TEMPLATE/.changeset/config.json" "$WORK/.changeset/config.json"
NAME=$(node -p 'require(process.argv[1]).name' "$WORK/package.json")
printf -- '---\n"%s": patch\n---\n\nCheck the release versioning step.\n' "$NAME" > "$WORK/.changeset/release-check.md"
printf '# %s\n' "$NAME" > "$WORK/CHANGELOG.md"
ln -s "$ROOT/js/node_modules" "$WORK/node_modules"
cd "$WORK"
if [ -n "$OVERRIDE" ]; then
  node -e 'const f=".changeset/config.json";const c=JSON.parse(require("fs").readFileSync(f));c.format=JSON.parse(process.argv[1]);require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$OVERRIDE"
fi
echo "template commit: $(git -C "$TEMPLATE" rev-parse HEAD)"
echo "files: $(ls -A | tr '\n' ' ')"
echo "devEngines: $(node -p 'JSON.stringify(require("./package.json").devEngines ?? null)')"
echo "config.format = $(node -p 'JSON.stringify(require("./.changeset/config.json").format ?? "(unset: auto)")')"
CLEAN_PATH=$(echo "$PATH" | tr ':' '\n' | while read -r d; do [ -x "$d/deno" ] || echo "$d"; done | paste -sd: -)
echo "deno on PATH: $(PATH=$CLEAN_PATH command -v deno || echo none)"
set +e
PATH=$CLEAN_PATH node_modules/.bin/changeset version
STATUS=$?
set -e
echo "changeset version exit status: $STATUS"
echo "pending changesets left: $(ls .changeset | grep -c '\.md$' || true)"
cat CHANGELOG.md
exit $STATUS
