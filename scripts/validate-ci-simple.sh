#!/bin/bash

# FoxWhisper Protocol - Simple CI Validation Script
# Runs core validations for CI/CD integration

set -e

echo "🦊 FoxWhisper Protocol - CI Validation"
echo "===================================="

# Create results directory
mkdir -p ci-results

# Track results
total=0
passed=0

run_test() {
    local name=$1
    local cmd=$2
    
    total=$((total + 1))
    echo "Testing $name..."
    
    # Run command in subshell to preserve directory
    (eval "$cmd")
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo "✅ $name PASSED"
        passed=$((passed + 1))
        return 0
    else
        echo "❌ $name FAILED (exit code: $exit_code)"
        return 1
    fi
}

# Core validations
echo ""
echo "🔍 Running Core Validations"
echo "========================="

run_test "Python CBOR" "cd validation/python/validators && python3 validate_cbor_python.py"
run_test "Python Schema" "cd validation/python/validators && python3 validate_cbor_schema.py"
run_test "Node.js CBOR" "cd validation/nodejs/validators && node validate_cbor_node.js"
run_test "Go CBOR" "cd validation/go/validators && go run validate_cbor_go.go"
run_test "Rust CBOR" "cd validation/rust/validators && cargo run --bin validate_cbor_rust"
run_test "Elixir" "bash scripts/jobs/validate-erlang.sh"
run_test "Device Desync (Python)" "cd validation/python/validators && python3 device_desync_sim.py"
run_test "Corrupted EARE (Python)" "cd validation/python/validators && python3 corrupted_eare_sim.py"

echo ""
echo "🔗 Cross-Language Compatibility"
echo "=============================="

run_test "Cross-Language Validation" "cd validation/common/validators && go run validate_cbor_crosslang.go"

echo ""
echo "📊 Results Summary"
echo "=================="
echo "Total tests: $total"
echo "Passed: $passed"
echo "Failed: $((total - passed))"
echo "Success rate: $(python3 -c "print(f'{$passed * 100 / $total:.1f}%')")"

echo ""
if [ $passed -eq $total ]; then
    echo "🎉 ALL VALIDATIONS PASSED!"
    echo "✅ FoxWhisper Protocol CI validation successful"
    exit 0
else
    echo "⚠️  SOME VALIDATIONS FAILED"
    echo "❌ Please check the failed validations"
    exit 1
fi