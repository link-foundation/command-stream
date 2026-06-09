#!/usr/bin/env bash
# Experiment 3: Bash behavior comparison
#
# Shows how bash behaves by default and with set -e,
# for comparison with command-stream's errexit setting.
#
# Related: https://github.com/link-foundation/command-stream/issues/156

echo "=== Experiment 3: Bash behavior comparison ==="
echo ""

# 1. Default bash (no set -e) — continues on error
echo "--- Default bash (no set -e): continues after error ---"
false
echo "✅ Continued after 'false' (exit code was $?)"
echo ""

# 2. bash with set -e — exits immediately
echo "--- Bash with set -e: exits on first error ---"
bash -c '
  set -e
  echo "Before false"
  false
  echo "❌ After false — should NOT print"
' 2>&1
echo "Exit code from set -e script: $?"
echo ""

# 3. try/catch pattern via subshell — always runs
echo "--- The try/catch anti-pattern in bash ---"
bash -c '
  # This is analogous to the command-stream bug:
  # "if command fails, take the else branch"
  if false; then
    echo "❌ No changes to commit (only if exit code 0)"
  else
    echo "✅ Changes detected (exit code 1)"
  fi
'
echo ""

# 4. git diff --cached --quiet semantics
echo "--- git diff --cached --quiet semantics ---"
echo "Exit code 0 = no staged changes"
echo "Exit code 1 = staged changes exist"
echo ""
echo "Correct pattern (bash):"
echo '  if git diff --cached --quiet; then'
echo '    echo "No changes"'
echo '  else'
echo '    echo "Changes detected — commit"'
echo '  fi'
echo ""
echo "Correct pattern (command-stream):"
echo '  const result = await $`git diff --cached --quiet`;'
echo '  if (result.code !== 0) {'
echo '    // Changes exist — proceed with commit'
echo '  }'
echo ""

# 5. set -o pipefail behavior
echo "--- set -o pipefail behavior ---"
bash -c '
  set -e
  set -o pipefail
  false | true   # Without pipefail: exits 0 (true succeeds)
                 # With pipefail: exits 1 (false failed in pipeline)
  echo "❌ Should not reach here with pipefail"
' 2>&1
echo "Exit code from pipefail test: $?"
echo ""

echo "=== Comparison complete ==="
