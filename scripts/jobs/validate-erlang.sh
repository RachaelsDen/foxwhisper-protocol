#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."
VALIDATION_DIR="$ROOT_DIR/validation/erlang"
VALIDATOR_CBOR="validators/validate_cbor_erlang.exs"
VALIDATOR_SCHEMA="validators/validate_schema_erlang.exs"
VALIDATOR_DEVICE_DESYNC="validators/validate_device_desync_erlang.exs"
RESULTS_DIR="$ROOT_DIR/results"
LOG_FILE_CBOR="$RESULTS_DIR/erlang_cbor_validation_results.log"
LOG_FILE_SCHEMA="$RESULTS_DIR/erlang_cbor_schema_results.log"
LOG_FILE_DEVICE_DESYNC="$RESULTS_DIR/erlang_device_desync_results.log"
JOB_STATUS_FILE="$RESULTS_DIR/validate_erlang_job.json"

mkdir -p "$RESULTS_DIR"

echo "🧪 Erlang Validation Job"
echo "======================="

pushd "$VALIDATION_DIR" >/dev/null

echo "Installing Elixir dependencies..."
MIX_ENV=dev mix deps.get

echo "Running CBOR validator..."
cbor_status="failed"
if MIX_ENV=dev mix run "$VALIDATOR_CBOR" | tee "$LOG_FILE_CBOR"; then
  cbor_status="success"
fi

echo "Running schema/protocol corpus checks..."
schema_status="failed"
if MIX_ENV=dev mix run "$VALIDATOR_SCHEMA" | tee "$LOG_FILE_SCHEMA"; then
  schema_status="success"
fi

echo "Running device desync shim..."
device_desync_status="failed"
if MIX_ENV=dev mix run "$VALIDATOR_DEVICE_DESYNC" | tee "$LOG_FILE_DEVICE_DESYNC"; then
  device_desync_status="success"
fi

RESULT_FILES=("$RESULTS_DIR/erlang_cbor_status.json" "$RESULTS_DIR/erlang_schema_status.json" "$RESULTS_DIR/erlang_device_desync_status.json")
TOTAL_TESTS=0
PASSED_TESTS=0
for rf in "${RESULT_FILES[@]}"; do
  if [ -f "$rf" ]; then
    read t p <<< "$(python3 - "$rf" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
items = data.get("results") or []
total = len(items)
passed = sum(1 for x in items if x.get("success"))
print(total, passed)
PY
)"
    TOTAL_TESTS=$((TOTAL_TESTS + t))
    PASSED_TESTS=$((PASSED_TESTS + p))
  fi
done
FAILED_TESTS=$((TOTAL_TESTS - PASSED_TESTS))
SUCCESS_RATE=0
if [ $TOTAL_TESTS -gt 0 ]; then
  SUCCESS_RATE=$(python3 - <<PY
print(f"{($PASSED_TESTS * 100 / $TOTAL_TESTS):.1f}")
PY
)
fi

popd >/dev/null

if [[ "$cbor_status" == "success" && "$schema_status" == "success" && "$device_desync_status" == "success" ]]; then
  JOB_STATUS="success"
else
  JOB_STATUS="failed"
fi

echo "Recording job status..."
cat > "$JOB_STATUS_FILE" <<EOF
{
  "job": "validate-erlang",
  "status": "$JOB_STATUS",
  "total_tests": $TOTAL_TESTS,
  "passed_tests": $PASSED_TESTS,
  "failed_tests": $FAILED_TESTS,
  "success_rate": $SUCCESS_RATE,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "$(basename "$LOG_FILE_CBOR")",
    "$(basename "$LOG_FILE_SCHEMA")",
    "$(basename "$LOG_FILE_DEVICE_DESYNC")",
    "erlang_multi_device_sync_results.log",
    "erlang_replay_poisoning_results.log",
    "erlang_malformed_fuzz_results.log",
    "erlang_replay_storm_results.log",
    "erlang_epoch_fork_results.log"
  ],
  "result_files": ["erlang_cbor_status.json", "erlang_schema_status.json", "erlang_device_desync_status.json"]
}
EOF

echo "Results saved under: $RESULTS_DIR"

echo "CBOR status: $cbor_status"
echo "Schema status: $schema_status"

if [[ "$JOB_STATUS" == "success" ]]; then
  exit 0
else
  exit 1
fi
