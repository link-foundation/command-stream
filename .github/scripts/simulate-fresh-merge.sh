#!/usr/bin/env bash
#
# Fresh merge simulation.
#
# A pull-request run checks out GitHub's merge preview, refs/pull/N/merge. That
# ref is computed when the pull request is opened or synchronised, so a run that
# starts after main has moved can still be validating an old merge base: the
# checks pass, the merge lands, and main breaks on code no job ever saw
# together. Merging the current base branch into the checkout before the checks
# run removes that window, and a merge conflict fails the job with a clear
# message instead of surfacing as a conflict at merge time.
#
# This is principle #7 ("Validate the actual merge result") of
# https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md
#
# The merge is local to the runner: nothing is pushed, and the jobs that call
# this check out with persist-credentials: false.
#
# Requirements: the calling job must check out with `fetch-depth: 0`, otherwise
# the shallow clone has no merge base to work from.
#
# Environment:
#   BASE_REF - the base branch to merge in (default: main). In GitHub Actions
#              this is github.base_ref, which is set only for pull_request
#              events; the calling step is guarded accordingly.
#
# Usage (locally, on a branch):
#   BASE_REF=main bash .github/scripts/simulate-fresh-merge.sh
set -euo pipefail

BASE_REF="${BASE_REF:-main}"

# An identity is required for `git merge` to be able to write a merge commit.
# The 41898282+ prefix is the one that attributes a commit to github-actions[bot];
# the commit never leaves the runner, but using the right identity keeps it out
# of the "unattributed" bucket if it ever does.
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git config user.name 'github-actions[bot]'

git fetch --no-tags origin "${BASE_REF}"

behind="$(git rev-list --count "HEAD..origin/${BASE_REF}")"
if [ "${behind}" -eq 0 ]; then
  echo "Merge preview already contains every commit on ${BASE_REF}; nothing to simulate."
  exit 0
fi

echo "${BASE_REF} has ${behind} commit(s) that the merge preview does not contain."
echo "Merging origin/${BASE_REF} so the checks below run against the real merge result."

if ! git merge "origin/${BASE_REF}" --no-edit; then
  echo "::error::Merge conflict with ${BASE_REF}. Update this branch before it can be merged."
  exit 1
fi

echo "Fresh merge succeeded; the checks below run against the merged tree."
