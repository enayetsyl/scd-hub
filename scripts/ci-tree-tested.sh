#!/usr/bin/env bash
# D-#1651: has this exact source tree already passed the CI gate?
# CI's last job uploads an artifact named ci-pass-<tree sha> when every job is green. A deploy whose
# checked-out commit has the same tree (byte-identical code) can skip running the gate again.
#   usage (in a workflow step with GH_TOKEN set): scripts/ci-tree-tested.sh <owner/repo>
# Writes hit=true|false to $GITHUB_OUTPUT (or stdout when run by hand). Any API failure => hit=false,
# so the worst case is the full gate running, never an untested deploy.
set -uo pipefail
REPO="${1:?owner/repo}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
tree="$(git rev-parse 'HEAD^{tree}')" || { echo "hit=false" >> "$OUT"; exit 0; }
rid="$(gh api "repos/$REPO" --jq .id 2>/dev/null)" || rid=""
n=0
if [ -n "$rid" ]; then
  # Only passes recorded by runs from THIS repository count: the repo is public, and a fork's PR
  # run could otherwise upload a fake ci-pass artifact.
  n="$(gh api "repos/$REPO/actions/artifacts?name=ci-pass-$tree&per_page=100" \
        --jq "[.artifacts[] | select(.expired == false and .workflow_run.head_repository_id == $rid)] | length" 2>/dev/null)" || n=0
fi
if [ "${n:-0}" -gt 0 ] 2>/dev/null; then
  echo "hit=true" >> "$OUT"; echo "tree $tree already passed CI ($n record(s)) — skipping the gate"
else
  echo "hit=false" >> "$OUT"; echo "tree $tree has no CI pass yet — running the gate"
fi
