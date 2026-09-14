#!/usr/bin/env bash
#
# Cross-platform developer smoke workflow for macOS and Linux.
#
# WARNING: This script mutates the configured backend. It creates a workspace
# and submits three evaluations, which may be billable. The workspace and its
# evaluations are intentionally retained for inspection because the public CLI
# does not provide a workspace-delete command.
#
# Prerequisites:
#   - Node.js 22 and the `autoeval` command on PATH
#   - AUTOEVAL_API_BASE_URL set to the Autoeval API origin
#   - `autoeval login`, or AUTOEVAL_API_KEY in the environment
#   - JUDGE_MODEL_ID and PRIMARY_MODEL_ID from `autoeval models`
#
# Optional: set AUTOEVAL_CLI to the path of another Autoeval executable.

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
AUTOEVAL_CLI=${AUTOEVAL_CLI:-autoeval}

json_field() {
  node -e '
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { source += chunk; });
    process.stdin.on("end", () => {
      let value = JSON.parse(source);
      for (const key of process.argv[1].split(".")) value = value?.[key];
      if (value === undefined || value === null || value === "") process.exit(1);
      process.stdout.write(String(value));
    });
  ' "$1"
}

heading() {
  printf '\n== %s ==\n' "$1"
}

heading "Backend mutation warning"
printf '%s\n' \
  "This workflow creates a workspace and runs three potentially billable evaluations." \
  "Created resources are retained for inspection."

heading "1. Verify authentication"
if ! "$AUTOEVAL_CLI" whoami; then
  printf '%s\n' "Authentication failed. Run 'autoeval login' or set AUTOEVAL_API_KEY." >&2
  exit 1
fi

heading "2. Validate model overrides"
: "${JUDGE_MODEL_ID:?Set JUDGE_MODEL_ID to an enabled UUID from 'autoeval models'}"
: "${PRIMARY_MODEL_ID:?Set PRIMARY_MODEL_ID to an enabled UUID from 'autoeval models'}"

# `date -u` and this format work with both BSD date (macOS) and GNU date (Linux).
WORKSPACE_NAME="autoeval-public-smoke-$(date -u '+%Y%m%d-%H%M%S')-$$"

heading "3. Create workspace: $WORKSPACE_NAME"
workspace_output=$("$AUTOEVAL_CLI" --json workspace create --name "$WORKSPACE_NAME")
workspace_id=$(printf '%s' "$workspace_output" | json_field id)
printf 'Workspace ID: %s\n' "$workspace_id"

run_example() {
  local label=$1
  local input_file=$2
  local include_primary=$3
  local model_arguments=(--judge-model-id "$JUDGE_MODEL_ID")

  if [[ "$include_primary" == "yes" ]]; then
    model_arguments+=(--primary-model-id "$PRIMARY_MODEL_ID")
  fi

  heading "$label"
  local run_output evaluation_id run_id
  run_output=$("$AUTOEVAL_CLI" --json eval create-from \
    --workspace "$workspace_id" \
    --input "$input_file" \
    "${model_arguments[@]}" \
    --run)
  evaluation_id=$(printf '%s' "$run_output" | json_field created.0.evaluationId)
  run_id=$(printf '%s' "$run_output" | json_field created.0.runId)

  printf 'Evaluation ID: %s\nRun ID: %s\n' "$evaluation_id" "$run_id"

  heading "$label — human-readable results"
  "$AUTOEVAL_CLI" results "$evaluation_id" "$run_id"

  heading "$label — JSON results"
  "$AUTOEVAL_CLI" --json results "$evaluation_id" "$run_id"
}

run_example "4. Scenario evaluation" "$SCRIPT_DIR/fixtures/smoke-scenario.json" yes
run_example "5. Conversation evaluation" "$SCRIPT_DIR/fixtures/smoke-conversation.json" no
run_example "6. Agent Trace evaluation" "$SCRIPT_DIR/fixtures/smoke-agent-trace.json" no

heading "Smoke workflow complete"
printf 'Workspace retained for inspection: %s (%s)\n' "$WORKSPACE_NAME" "$workspace_id"
