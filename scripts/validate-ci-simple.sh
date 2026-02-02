#!/bin/bash

# FoxWhisper Protocol - Simple CI Validation Script
# Runs core validations for CI/CD integration

set -euo pipefail

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
    
    # Run command in subshell to preserve directory.
    # Temporarily disable `-e` so we can record failures and continue.
    set +e
    (eval "$cmd")
    local exit_code=$?
    set -e
    
    if [ $exit_code -eq 0 ]; then
        echo "✅ $name PASSED"
        passed=$((passed + 1))
        return 0
    else
        echo "❌ $name FAILED (exit code: $exit_code)"
        # Don't fail-fast; collect all results.
        return 0
    fi
}

# Core validations
echo ""
echo "🔍 Running Core Validations"
echo "========================="

run_test "Python Validators" "bash scripts/jobs/validate-python.sh"
run_test "Node.js Validators" "bash scripts/jobs/validate-nodejs.sh"

if command -v go >/dev/null 2>&1; then
    run_test "Go Validators" "bash scripts/jobs/validate-go.sh"
else
    echo "⏭️  Go Validators SKIPPED (missing: go)"
fi

if command -v cargo >/dev/null 2>&1; then
    run_test "Rust Validators" "bash scripts/jobs/validate-rust.sh"
else
    echo "⏭️  Rust Validators SKIPPED (missing: cargo)"
fi

if command -v mix >/dev/null 2>&1; then
    run_test "Elixir/Erlang Validators" "bash scripts/jobs/validate-erlang.sh"
else
    echo "⏭️  Elixir/Erlang Validators SKIPPED (missing: mix)"
fi

run_test "Minimal Node Harness" "bash scripts/validate-node-minimal.sh"
 
 echo ""


echo "🔗 Cross-Language Compatibility"
echo "=============================="

if command -v go >/dev/null 2>&1; then
    run_test "Cross-Language Validation" "cd validation/common/validators && go run validate_cbor_crosslang.go"
else
    echo "⏭️  Cross-Language Validation SKIPPED (missing: go)"
fi

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
