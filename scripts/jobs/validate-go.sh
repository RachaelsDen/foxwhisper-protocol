#!/bin/bash
set -e

echo "🐹 Go Validation Job"
echo "===================="

# Base directories
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."   # adjust if this script is in a subdir
VALIDATOR_DIR="$ROOT_DIR/validation/go/validators"
RESULTS_DIR="$ROOT_DIR/results"

mkdir -p "$RESULTS_DIR"

run_go_validation() {
    local name=$1
    local script=$2         # relative to VALIDATOR_DIR
    local args="$3"
    local full_script="$VALIDATOR_DIR/$script"
    local log_file="$RESULTS_DIR/go_${name,,}_results.log"
    local status_file="$RESULTS_DIR/go_${name,,}_status.json"

    echo "Running $name..."

    # Run from validator directory
    cd "$VALIDATOR_DIR"
    if go run "$script" $args > "$log_file" 2>&1; then
        echo "✅ $name PASSED"
        echo "{\"test\": \"$name\", \"status\": \"success\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$status_file"
        return 0
    else
        echo "❌ $name FAILED"
        echo "{\"test\": \"$name\", \"status\": \"failed\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$status_file"
        return 1
    fi
}

main() {
    echo "Installing Go dependencies..."
    cd "$ROOT_DIR"
    go mod tidy 2>/dev/null || echo "⚠️  Go mod tidy failed"

    echo ""
    echo "Running Go validations..."
    echo ""

    total_tests=0
    passed_tests=0

    # CBOR Validation
    total_tests=$((total_tests + 1))
    if run_go_validation "cbor_validation" "validate_cbor_go.go" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Multi-Device Sync Validation
    total_tests=$((total_tests + 1))
    if run_go_validation "multi_device_sync" "multi_device_sync/main.go" "$ROOT_DIR/tests/common/handshake/multi_device_sync_test_vectors.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay & Poisoning Validation
    total_tests=$((total_tests + 1))
    if run_go_validation "replay_poisoning" "replay_poisoning/main.go" "$ROOT_DIR/tests/common/handshake/replay_poisoning_test_vectors.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # CBOR Schema Validation
    total_tests=$((total_tests + 1))
    if run_go_validation "cbor_schema" "schema/main.go" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Malformed Packet Fuzz Harness
    total_tests=$((total_tests + 1))
    if run_go_validation "malformed_fuzz" "malformed_fuzz/main.go" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay Storm Simulation
    total_tests=$((total_tests + 1))
    if run_go_validation "replay_storm" "replay_storm/main.go" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Generate job summary
    echo ""
    echo "Go Validation Summary:"
    echo "====================="
    echo "Total tests: $total_tests"
    echo "Passed: $passed_tests"
    echo "Failed: $((total_tests - passed_tests))"
    echo "Success rate: $(awk "BEGIN {printf \"%.1f%%\", $passed_tests * 100 / $total_tests}")"

    # Create job result file
    cat > "$RESULTS_DIR/go_validation_job.json" << EOF
{
  "job": "validate-go",
  "status": "$([ $passed_tests -eq $total_tests ] && echo "success" || echo "failed")",
  "total_tests": $total_tests,
  "passed_tests": $passed_tests,
  "failed_tests": $((total_tests - passed_tests)),
  "success_rate": $(awk "BEGIN {printf \"%.1f\", $passed_tests * 100 / $total_tests}"),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "go_cbor_validation_results.log",
    "go_multi_device_sync_results.log",
    "go_replay_poisoning_results.log",
    "go_cbor_schema_results.log",
    "go_malformed_fuzz_results.log",
    "go_replay_storm_results.log"
  ]
}
EOF

    echo ""
    echo "Go validation complete!"
    echo "Results saved to: $RESULTS_DIR"

    if [ $passed_tests -eq $total_tests ]; then
        echo "🎉 Go validation job completed successfully!"
        exit 0
    else
        echo "❌ Go validation job failed!"
        exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi