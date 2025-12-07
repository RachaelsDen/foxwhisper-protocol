#!/bin/bash
set -e

echo "🦀 Rust Validation Job"
echo "====================="

# Base directories
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."   # adjust if this script is in a subdir
RESULTS_DIR="$ROOT_DIR/results"

mkdir -p "$RESULTS_DIR"

run_rust_validation() {
    local name=$1
    local binary=$2
    local args="$3"
    local log_file="$RESULTS_DIR/rust_${name,,}_results.log"
    local status_file="$RESULTS_DIR/rust_${name,,}_status.json"

    echo "Running $name..."

    cd "$ROOT_DIR"
    if cargo run --bin $binary -- $args > "$log_file" 2>&1; then
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
    echo "Installing Rust dependencies..."
    cd "$ROOT_DIR"
    cargo fetch 2>/dev/null || echo "⚠️  Cargo fetch failed"

    echo ""
    echo "Running Rust validations..."
    echo ""

    total_tests=0
    passed_tests=0

    # CBOR Validation
    total_tests=$((total_tests + 1))
    if run_rust_validation "cbor_validation" "validate_cbor_rust" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # CBOR Schema Validation
    total_tests=$((total_tests + 1))
    if run_rust_validation "cbor_schema" "validate_cbor_schema" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Multi-Device Sync Validation
    total_tests=$((total_tests + 1))
    if run_rust_validation "multi_device_sync" "validate_multi_device_sync_rust" "$ROOT_DIR/tests/common/handshake/multi_device_sync_test_vectors.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay & Poisoning Validation
    total_tests=$((total_tests + 1))
    if run_rust_validation "replay_poisoning" "validate_replay_poisoning_rust" "$ROOT_DIR/tests/common/handshake/replay_poisoning_test_vectors.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Malformed Packet Fuzz Harness
    total_tests=$((total_tests + 1))
    if run_rust_validation "malformed_fuzz" "validate_malformed_fuzz_rust" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Replay Storm Simulation
    total_tests=$((total_tests + 1))
    if run_rust_validation "replay_storm" "validate_replay_storm_rust" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Device Desync Simulation
    total_tests=$((total_tests + 1))
    if run_rust_validation "device_desync" "validate_device_desync_rust" ""; then
        passed_tests=$((passed_tests + 1))
    fi

    # Epoch Fork Simulation
    total_tests=$((total_tests + 1))
    if run_rust_validation "epoch_fork" "validate_epoch_fork_rust" "--corpus $ROOT_DIR/tests/common/adversarial/epoch_forks.json"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Generate job summary
    echo ""
    echo "Rust Validation Summary:"
    echo "======================"
    echo "Total tests: $total_tests"
    echo "Passed: $passed_tests"
    echo "Failed: $((total_tests - passed_tests))"
    echo "Success rate: $(awk "BEGIN {printf \"%.1f%%\", $passed_tests * 100 / $total_tests}")"

    # Create job result file
    cat > "$RESULTS_DIR/rust_validation_job.json" << EOF
{
  "job": "validate-rust",
  "status": "$([ $passed_tests -eq $total_tests ] && echo "success" || echo "failed")",
  "total_tests": $total_tests,
  "passed_tests": $passed_tests,
  "failed_tests": $((total_tests - passed_tests)),
  "success_rate": $(awk "BEGIN {printf \"%.1f\", $passed_tests * 100 / $total_tests}"),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "rust_cbor_validation_results.log",
    "rust_cbor_schema_results.log",
    "rust_multi_device_sync_results.log",
    "rust_replay_poisoning_results.log",
    "rust_malformed_fuzz_results.log",
    "rust_replay_storm_results.log",
    "rust_device_desync_results.log",
    "rust_epoch_fork_results.log"
  ]
}
EOF

    echo ""
    echo "Rust validation complete!"
    echo "Results saved to: $RESULTS_DIR"

    if [ $passed_tests -eq $total_tests ]; then
        echo "🎉 Rust validation job completed successfully!"
        exit 0
    else
        echo "❌ Rust validation job failed!"
        exit 1
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi

