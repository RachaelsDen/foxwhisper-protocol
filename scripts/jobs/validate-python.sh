#!/bin/bash
set -e

echo "🐍 Python Validation Job"
echo "========================"

# Base directories
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."   # adjust if this script is in a subdir
VALIDATOR_DIR="$ROOT_DIR/validation/python/validators"
RESULTS_DIR="$ROOT_DIR/results"

mkdir -p "$RESULTS_DIR"

run_python_validation() {
    local name=$1
    local script=$2         # relative to VALIDATOR_DIR
    local args="$3"
    local full_script="$VALIDATOR_DIR/$script"
    local log_file="$RESULTS_DIR/python_${name,,}_results.log"
    local status_file="$RESULTS_DIR/python_${name,,}_status.json"

    echo "Running $name..."

    if python3 "$full_script" $args > "$log_file" 2>&1; then
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
    echo "Installing Python dependencies..."
    python3 -m pip install --upgrade pip 2>/dev/null || true
    pip3 install cbor2 2>/dev/null || echo "⚠️  cbor2 installation failed, using built-in implementation"

    echo ""
    echo "Running Python validations..."
    echo ""

    total_tests=0
    passed_tests=0

    # CBOR Validation
    total_tests=$((total_tests + 1))
    if run_python_validation "cbor_validation" "validate_cbor_python.py" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # CBOR Schema Validation  
    total_tests=$((total_tests + 1))
    if run_python_validation "cbor_schema" "validate_cbor_schema.py" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Multi-Device Sync Validation
    total_tests=$((total_tests + 1))
    if run_python_validation "multi_device_sync" "validate_multi_device_sync.py" "$ROOT_DIR/tests/common/handshake/multi_device_sync_test_vectors.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay/Poisoning Validation
    total_tests=$((total_tests + 1))
    if run_python_validation "replay_poisoning" "validate_replay_poisoning.py" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Malformed Packet Fuzz Harness
    total_tests=$((total_tests + 1))
    if run_python_validation "malformed_fuzz" "fuzz_harness.py" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay Storm Simulation
    total_tests=$((total_tests + 1))
    if run_python_validation "replay_storm" "replay_storm_simulation.py" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Epoch Fork Simulation (Python coordinator + Go shim)
    total_tests=$((total_tests + 1))
    stress_flag=""
    if [ "${EPOCH_FORK_STRESS:-0}" != "0" ]; then
        stress_flag="--stress"
    fi
    epoch_args="--corpus $ROOT_DIR/tests/common/adversarial/epoch_forks.json --summary-out $RESULTS_DIR/epoch_fork_summary.json --envelope-out $RESULTS_DIR/epoch_fork_envelopes.jsonl --go-shim go --node-shim node --rust-shim cargo $stress_flag"
    if run_python_validation "epoch_fork" "epoch_fork_fuzzer.py" "$epoch_args"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Generate job summary
    echo ""
    echo "Python Validation Summary:"
    echo "========================="
    echo "Total tests: $total_tests"
    echo "Passed: $passed_tests"
    echo "Failed: $((total_tests - passed_tests))"
    echo "Success rate: $(awk "BEGIN {printf \"%.1f%%\", $passed_tests * 100 / $total_tests}")"

    # Create job result file
    cat > "$RESULTS_DIR/python_validation_job.json" << EOF
{
  "job": "validate-python",
  "status": "$([ $passed_tests -eq $total_tests ] && echo "success" || echo "failed")",
  "total_tests": $total_tests,
  "passed_tests": $passed_tests,
  "failed_tests": $((total_tests - passed_tests)),
  "success_rate": $(awk "BEGIN {printf \"%.1f\", $passed_tests * 100 / $total_tests}"),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "python_cbor_validation_results.log",
    "python_cbor_schema_results.log", 
    "python_multi_device_sync_results.log",
    "python_replay_poisoning_results.log",
    "python_malformed_fuzz_results.log",
    "python_replay_storm_results.log",
    "python_epoch_fork_results.log"
  ]
}
EOF

    echo ""
    echo "Python validation complete!"
    echo "Results saved to: $RESULTS_DIR"

    if [ $passed_tests -eq $total_tests ]; then
        echo "🎉 Python validation job completed successfully!"
        exit 0
    else
        echo "❌ Python validation job failed!"
        exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi