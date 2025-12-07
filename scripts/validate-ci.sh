#!/bin/bash

# FoxWhisper Protocol - Local CI/CD Validation Script
# This script replicates the GitHub Actions workflow for local testing

set -e

echo "🦊 FoxWhisper Protocol - Local CI/CD Validation"
echo "=================================================="

# Create results directory
mkdir -p ci-results

# Function to run validation and capture results
run_validation() {
    local language=$1
    local command=$2
    local result_file=$3
    
    echo "Running $language validation..."
    
    # Ensure ci-results directory exists
    mkdir -p ci-results
    
    if eval "$command" > "ci-results/${result_file}.log" 2>&1; then
        echo "✅ $language validation PASSED"
        echo "{\"language\": \"$language\", \"status\": \"success\", \"log_file\": \"${result_file}.log\"}" > "ci-results/${result_file}.json"
        return 0
    else
        echo "❌ $language validation FAILED"
        echo "{\"language\": \"$language\", \"status\": \"failed\", \"log_file\": \"${result_file}.log\"}" > "ci-results/${result_file}.json"
        return 1
    fi
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command_exists python3; then
    echo "❌ Python 3 not found"
    exit 1
fi

if ! command_exists node; then
    echo "❌ Node.js not found"
    exit 1
fi

if ! command_exists go; then
    echo "❌ Go not found"
    exit 1
fi

if ! command_exists cargo; then
    echo "❌ Rust/Cargo not found"
    exit 1
fi

if ! command_exists elixir; then
    echo "❌ Elixir not found"
    exit 1
fi

echo "✅ All prerequisites found"

# Install Python dependencies
echo "Installing Python dependencies..."
pip3 install cbor2 2>/dev/null || echo "⚠️  Python cbor2 installation failed, using built-in implementation"

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
cd tools
npm install cbor 2>/dev/null || echo "⚠️  Node.js cbor installation failed, using built-in implementation"
cd ..

# Install Go dependencies
echo "Installing Go dependencies..."
go mod tidy 2>/dev/null || echo "⚠️  Go mod tidy failed"

# Install Rust dependencies
echo "Installing Rust dependencies..."
cargo fetch 2>/dev/null || echo "⚠️  Cargo fetch failed"

# Install Elixir dependencies
if [ -d "validation/erlang" ]; then
    echo "Installing Elixir dependencies..."
    (cd validation/erlang && mix deps.get 2>/dev/null) || echo "⚠️  Mix deps.get failed"
fi

echo ""
echo "Running validations..."
echo ""

# Track success/failure
total_validations=0
successful_validations=0

# Python validations
echo "🐍 Python Validations"
echo "-------------------"

total_validations=$((total_validations + 1))
if run_validation "Python CBOR" "cd tools && python3 validate_cbor_python.py" "python_cbor"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Python Schema" "cd tools && python3 validate_cbor_schema.py" "python_schema"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Python Multi-Device" "cd tools && python3 validate_multi_device_sync.py test-vectors/handshake/multi_device_sync_test_vectors.json" "python_multidevice"; then
    successful_validations=$((successful_validations + 1))
fi

echo ""

# Node.js validations
echo "🟢 Node.js Validations"
echo "--------------------"

total_validations=$((total_validations + 1))
if run_validation "Node.js CBOR" "cd tools && node validate_cbor_node.js" "nodejs_cbor"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Node.js Cross-Language" "cd tools && node validate_cbor_crosslang.js" "nodejs_crosslang"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Node.js Multi-Device" "cd tools && node validate_multi_device_sync.js test-vectors/handshake/multi_device_sync_test_vectors.json" "nodejs_multidevice"; then
    successful_validations=$((successful_validations + 1))
fi

echo ""

# Go validations
echo "🐹 Go Validations"
echo "---------------"

total_validations=$((total_validations + 1))
if run_validation "Go CBOR" "cd tools && go run validate_cbor_go.go" "go_cbor"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Go Cross-Language" "cd tools && go run validate_cbor_crosslang.go" "go_crosslang"; then
    successful_validations=$((successful_validations + 1))
fi

echo ""

# Rust validations
echo "🦀 Rust Validations"
echo "-----------------"

total_validations=$((total_validations + 1))
if run_validation "Rust CBOR" "cargo run --bin validate_cbor_rust" "rust_cbor"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Rust Cross-Language" "cargo run --bin validate_cbor_crosslang" "rust_crosslang"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Rust Schema" "cargo run --bin validate_cbor_schema" "rust_schema"; then
    successful_validations=$((successful_validations + 1))
fi

total_validations=$((total_validations + 1))
if run_validation "Rust Multi-Device" "cargo run --bin validate_multi_device_sync_rust -- test-vectors/handshake/multi_device_sync_test_vectors.json" "rust_multidevice"; then
    successful_validations=$((successful_validations + 1))
fi

# Elixir validations
echo "💧 Elixir Validations"
echo "------------------"

total_validations=$((total_validations + 1))
if run_validation "Elixir" "bash scripts/jobs/validate-erlang.sh" "elixir"; then
    successful_validations=$((successful_validations + 1))
fi

echo ""
echo "=================================================="
echo "🦊 FoxWhisper Protocol - Validation Summary"
echo "=================================================="

echo "Total Validations: $total_validations"
echo "Successful: $successful_validations"
echo "Failed: $((total_validations - successful_validations))"
echo "Success Rate: $(python3 -c "print(f'{successful_validations * 100 / total_validations:.1f}%')")
echo ""

# Generate summary report
cat > ci-results/validation-summary.json << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total_validations": $total_validations,
  "successful_validations": $successful_validations,
  "failed_validations": $((total_validations - successful_validations)),
  "success_rate": $(python3 -c "print(f'{successful_validations * 100 / total_validations:.1f}')"),
  "platform": "$(uname -a)",
  "results_directory": "ci-results"
}
EOF

# Show detailed results
echo "Detailed Results:"
echo "----------------"

for json_file in ci-results/*.json; do
    if [ -f "$json_file" ]; then
        language=$(basename "$json_file" .json | sed 's/_/ /g')
        status=$(python3 -c "import json; print(json.load(open('$json_file'))['status'])")
        
        if [ "$status" = "success" ]; then
            echo "✅ $language: PASSED"
        else
            echo "❌ $language: FAILED"
            echo "   Log: $json_file.log"
        fi
    fi
done

echo ""
echo "📁 Results saved to: ci-results/"
echo "📄 Summary report: ci-results/validation-summary.json"

# Final status
if [ $successful_validations -eq $total_validations ]; then
    echo ""
    echo "🎉 ALL VALIDATIONS PASSED!"
    echo "✅ FoxWhisper Protocol is ready for production"
    exit 0
else
    echo ""
    echo "⚠️  SOME VALIDATIONS FAILED"
    echo "❌ Please review the logs and fix issues before proceeding"
    exit 1
fi