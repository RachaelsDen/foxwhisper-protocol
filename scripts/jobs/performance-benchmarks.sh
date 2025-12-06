#!/bin/bash

# FoxWhisper Protocol - Performance Benchmarks Job
# Replicates performance-benchmarks job from GitHub workflow

set -e

echo "⚡ Performance Benchmarks Job"
echo "============================"

# Create results directory
mkdir -p results

echo "Running performance benchmarks..."
echo ""

python3 << 'EOF'
import time
import json
import os
import subprocess

# Simple performance benchmark for CBOR operations
print("🦊 FoxWhisper Protocol - Performance Benchmarks")
print("=" * 50)

benchmark_data = {
    "timestamp": time.time(),
    "platform": "local-$(uname -s)-$(uname -m)",
    "benchmarks": {}
}

# Benchmark Python CBOR validation
print("Benchmarking Python CBOR validation...")
start_time = time.time()
try:
    result = subprocess.run(['python3', 'validation/python/validators/validate_cbor_python.py'], 
                          capture_output=True, text=True, cwd='.')
    python_time = time.time() - start_time
    benchmark_data["benchmarks"]["python_cbor_validation"] = {
        "time_seconds": python_time,
        "success": result.returncode == 0
    }
    print(f"Python CBOR Validation: {python_time:.3f}s")
except Exception as e:
    benchmark_data["benchmarks"]["python_cbor_validation"] = {
        "time_seconds": None,
        "success": False,
        "error": str(e)
    }
    print(f"Python CBOR Validation: FAILED ({e})")

# Benchmark Node.js CBOR validation
print("Benchmarking Node.js CBOR validation...")
start_time = time.time()
try:
    result = subprocess.run(['node', 'validation/nodejs/validators/validate_cbor_node.js'], 
                          capture_output=True, text=True, cwd='.')
    nodejs_time = time.time() - start_time
    benchmark_data["benchmarks"]["nodejs_cbor_validation"] = {
        "time_seconds": nodejs_time,
        "success": result.returncode == 0
    }
    print(f"Node.js CBOR Validation: {nodejs_time:.3f}s")
except Exception as e:
    benchmark_data["benchmarks"]["nodejs_cbor_validation"] = {
        "time_seconds": None,
        "success": False,
        "error": str(e)
    }
    print(f"Node.js CBOR Validation: FAILED ({e})")

# Benchmark Go CBOR validation
print("Benchmarking Go CBOR validation...")
start_time = time.time()
try:
    result = subprocess.run(['go', 'run', 'validation/go/validators/validate_cbor_go.go'], 
                          capture_output=True, text=True, cwd='.')
    go_time = time.time() - start_time
    benchmark_data["benchmarks"]["go_cbor_validation"] = {
        "time_seconds": go_time,
        "success": result.returncode == 0
    }
    print(f"Go CBOR Validation: {go_time:.3f}s")
except Exception as e:
    benchmark_data["benchmarks"]["go_cbor_validation"] = {
        "time_seconds": None,
        "success": False,
        "error": str(e)
    }
    print(f"Go CBOR Validation: FAILED ({e})")

# Benchmark Rust CBOR validation
print("Benchmarking Rust CBOR validation...")
start_time = time.time()
try:
    result = subprocess.run(['cargo', 'run', '--bin', 'validate_cbor_rust'], 
                          capture_output=True, text=True, cwd='.')
    rust_time = time.time() - start_time
    benchmark_data["benchmarks"]["rust_cbor_validation"] = {
        "time_seconds": rust_time,
        "success": result.returncode == 0
    }
    print(f"Rust CBOR Validation: {rust_time:.3f}s")
except Exception as e:
    benchmark_data["benchmarks"]["rust_cbor_validation"] = {
        "time_seconds": None,
        "success": False,
        "error": str(e)
    }
    print(f"Rust CBOR Validation: FAILED ({e})")

# Calculate summary statistics
successful_benchmarks = sum(1 for b in benchmark_data["benchmarks"].values() if b.get("success", False))
total_benchmarks = len(benchmark_data["benchmarks"])

print(f"\nSummary: {successful_benchmarks}/{total_benchmarks} benchmarks completed successfully")

# Save benchmark results
with open('results/performance_benchmarks.json', 'w') as f:
    json.dump(benchmark_data, f, indent=2)

print("✅ Performance benchmarks completed")
EOF

# Create job result file
cat > results/performance_benchmarks_job.json << EOF
{
  "job": "performance-benchmarks",
  "status": "success",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "logs": [
    "performance_benchmarks.json"
  ]
}
EOF

echo ""
echo "🎉 Performance benchmarks job completed!"
echo "📊 Results saved to: results/performance_benchmarks.json"