#!/usr/bin/env bash
set -euo pipefail

# Guard baseline artifact refresh behind explicit intent to avoid accidental drift commits.
if [[ "${BASELINE_REFRESH_CONFIRM:-}" != "true" ]]; then
  echo "Refusing baseline refresh: set BASELINE_REFRESH_CONFIRM=true to proceed." >&2
  echo "Example: BASELINE_REFRESH_CONFIRM=true npm run baseline:balance:refresh:guard" >&2
  exit 1
fi

baseline_root="packages/simulation/artifacts/baselines/balance"
inputs_dir="${baseline_root}/inputs"
reports_dir="${baseline_root}/reports"

require_clean_tree() {
  local dirty
  dirty="$(git status --porcelain -- "${inputs_dir}" "${reports_dir}")"
  if [[ -n "${dirty}" ]]; then
    echo "Baseline artifact directories are not clean:" >&2
    echo "${dirty}" >&2
    echo "Commit/stash/revert artifact changes before running refresh." >&2
    exit 1
  fi
}

require_clean_tree

npm run build
npm run baseline:balance:capture

# Capture should update tracked files deterministically.
post_capture_diff="$(git status --porcelain -- "${inputs_dir}" "${reports_dir}")"
if [[ -z "${post_capture_diff}" ]]; then
  echo "No baseline artifact changes produced by capture; refusing empty refresh." >&2
  exit 1
fi

npm run baseline:balance:diff:ci

echo "Baseline refresh guard completed successfully."
echo "Review and commit baseline artifact changes intentionally."
