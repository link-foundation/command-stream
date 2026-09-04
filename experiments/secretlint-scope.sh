#!/usr/bin/env bash
# Does `secretlint "**/*"` reach dot-directories, and is .secretlintignore honoured?
#
# Both questions decide whether the secret-scan job in .github/workflows/security.yml
# is worth anything. A scan that silently skips .github/ or .changeset/ is a false
# negative, and one that cannot be scoped is too slow to keep.
#
# The probe is a *fake* GitHub token: `ghp_` followed by 36 random characters, which
# matches @secretlint/secretlint-rule-github's pattern without being a credential.
# (The AWS example key from the AWS documentation is deliberately not flagged by the
# recommended preset, so it cannot be used as a probe.)
#
# Result on 2026-09-04, secretlint 13.0.5:
#   plain file        -> reported
#   .github/ file     -> reported   (the glob does descend into dot-directories)
#   ignored directory -> not reported (.secretlintignore is picked up from the cwd)
#
# Usage: bash experiments/secretlint-scope.sh
set -uo pipefail
cd "$(dirname "$0")/.."

probes=('secretlint-probe.txt' '.github/secretlint-probe.txt' 'node_modules/secretlint-probe.txt')
cleanup() { rm -f "${probes[@]}"; }
trap cleanup EXIT

token="ghp_$(head -c 40 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 36)"
mkdir -p node_modules
for probe in "${probes[@]}"; do
  printf 'token = %s\n' "$token" > "$probe"
done

report="$(npx --yes -p secretlint@13.0.5 \
  -p @secretlint/secretlint-rule-preset-recommend@13.0.5 \
  secretlint '**/*' 2>&1 || true)"

for probe in "${probes[@]}"; do
  if grep -qF "$probe" <<<"$report"; then
    echo "reported:     $probe"
  else
    echo "not reported: $probe"
  fi
done
