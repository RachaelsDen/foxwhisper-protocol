#!/bin/bash
set -e

echo "🟢 Node.js Validation Job"
echo "========================="

# Base directories
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."   # adjust if this script is in a subdir
VALIDATOR_DIR="$ROOT_DIR/validation/nodejs/validators"
RESULTS_DIR="$ROOT_DIR/results"

mkdir -p "$RESULTS_DIR"

run_nodejs_validation() {
    local name=$1
    local script=$2         # relative to VALIDATOR_DIR
    local args="$3"
    local full_script="$VALIDATOR_DIR/$script"
    local log_file="$RESULTS_DIR/nodejs_${name,,}_results.log"
    local status_file="$RESULTS_DIR/nodejs_${name,,}_status.json"

    echo "Running $name..."

    if node "$full_script" $args > "$log_file" 2>&1; then
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
    echo "Starting Node.js validation tests..."
    
    total_tests=0
    passed_tests=0

    run_and_track() {
        local name=$1
        local script=$2
        local args=$3
        total_tests=$((total_tests + 1))
        if run_nodejs_validation "$name" "$script" "$args"; then
            passed_tests=$((passed_tests + 1))
        fi
    }
    
    # Run CBOR validation tests
    run_and_track "cbor_validation" "validate_cbor_node.js" ""
    run_and_track "cbor_validation_fixed" "validate_cbor_node_fixed.js" ""
    run_and_track "cbor_crosslang" "validate_cbor_crosslang.js" ""
    run_and_track "cbor_final" "validate_cbor_final.js" ""
    
    # Run multi-device sync validation
    run_and_track "multi_device_sync" "validate_multi_device_sync.js" "$ROOT_DIR/tests/common/handshake/multi_device_sync_test_vectors.json"
    run_and_track "replay_poisoning" "validate_replay_poisoning.js" "$ROOT_DIR/tests/common/handshake/replay_poisoning_test_vectors.json"
    
    echo ""
    echo "Node.js Validation Summary:"
    echo "=========================="
    echo "Total tests: $total_tests"
    echo "Passed: $passed_tests"
    echo "Failed: $((total_tests - passed_tests))"
    echo "Success rate: $(awk "BEGIN {printf \"%.1f%%\", $passed_tests * 100 / $total_tests}")"

    cat > "$RESULTS_DIR/nodejs_validation_job.json" << EOF
{
  "job": "validate-nodejs",
  "status": "$([ $passed_tests -eq $total_tests ] && echo "success" || echo "failed")",
  "total_tests": $total_tests,
  "passed_tests": $passed_tests,
  "failed_tests": $((total_tests - passed_tests)),
  "success_rate": $(awk "BEGIN {printf \"%.1f\", $passed_tests * 100 / $total_tests}"),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "nodejs_cbor_validation_results.log",
    "nodejs_cbor_validation_fixed_results.log",
    "nodejs_cbor_crosslang_results.log",
    "nodejs_cbor_final_results.log",
    "nodejs_multi_device_sync_results.log",
    "nodejs_replay_poisoning_results.log"
  ]
}
EOF
    
    echo ""
    echo "Node.js validation complete!"
    echo "Results saved to: $RESULTS_DIR"
    
    if [ $passed_tests -eq $total_tests ]; then
        echo "🎉 Node.js validation job completed successfully!"
    else
        echo "❌ Node.js validation job failed!"
        exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
