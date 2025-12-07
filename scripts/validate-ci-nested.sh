#!/bin/bash

# FoxWhisper Protocol - Nested CI/CD Workflow Orchestrator
# Replicates the complete GitHub Actions workflow for local execution

set -e

echo "🦊 FoxWhisper Protocol - Nested CI/CD Workflow"
echo "=============================================="
echo "This script replicates the GitHub Actions workflow locally"
echo ""

# Create results directory
mkdir -p results

# Function to run a job and track its status
run_job() {
    local job_name=$1
    local job_script=$2
    local should_continue_on_failure=${3:-false}
    
    echo ""
    echo "🚀 Starting job: $job_name"
    echo "================================"
    
    if [ -f "scripts/jobs/$job_script" ]; then
        chmod +x "scripts/jobs/$job_script"
        
        if bash "scripts/jobs/$job_script"; then
            echo "✅ Job '$job_name' completed successfully"
            echo "success" > "results/${job_name}_status.txt"
            return 0
        else
            echo "❌ Job '$job_name' failed"
            echo "failed" > "results/${job_name}_status.txt"
            
            if [ "$should_continue_on_failure" = "true" ]; then
                echo "⚠️  Continuing despite failure (job marked as optional)"
                return 0
            else
                echo "🛑 Stopping workflow due to job failure"
                return 1
            fi
        fi
    else
        echo "❌ Job script not found: scripts/jobs/$job_script"
        echo "not_found" > "results/${job_name}_status.txt"
        return 1
    fi
}

print_validation_details() {
    local job_name=$1
    local summary_file=$2
    if [ -f "$summary_file" ]; then
        python3 - "$job_name" "$summary_file" <<'PY'
import json, sys
job, path = sys.argv[1:3]
try:
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
except Exception as exc:  # pragma: no cover - runtime guard
    print(f" - {job}: unable to read summary ({exc})")
    raise SystemExit

status = data.get('status', 'unknown')
total = data.get('total_tests')
passed = data.get('passed_tests')
failed = data.get('failed_tests')
rate = data.get('success_rate')
rate_str = f"{rate}%" if isinstance(rate, (int, float)) else ""
if None in (total, passed, failed):
    print(f" - {job}: status={status}")
else:
    print(f" - {job}: {passed}/{total} tests passed ({status}{(' ' + rate_str) if rate_str else ''})")
logs = data.get('logs') or []
if logs:
    log_list = ', '.join(logs)
    print(f"   logs: {log_list}")
PY
    fi
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "Checking prerequisites..."
echo ""

missing_prereqs=false

if ! command_exists python3; then
    echo "❌ Python 3 not found"
    missing_prereqs=true
fi

if ! command_exists node; then
    echo "❌ Node.js not found"
    missing_prereqs=true
fi

if ! command_exists go; then
    echo "❌ Go not found"
    missing_prereqs=true
fi

if ! command_exists cargo; then
    echo "❌ Rust/Cargo not found"
    missing_prereqs=true
fi

if ! command_exists elixir; then
    echo "❌ Elixir not found"
    missing_prereqs=true
fi

if [ "$missing_prereqs" = "true" ]; then
    echo ""
    echo "❌ Missing prerequisites. Please install the required tools and try again."
    exit 1
fi

echo "✅ All prerequisites found"
echo ""

# Track overall workflow status
workflow_start_time=$(date +%s)
total_jobs=0
successful_jobs=0

declare -A JOB_SUMMARY_FILES=(
    ["validate-python"]="results/python_validation_job.json"
    ["validate-nodejs"]="results/nodejs_validation_job.json"
    ["validate-go"]="results/go_validation_job.json"
    ["validate-rust"]="results/rust_validation_job.json"
    ["validate-erlang"]="results/validate_erlang_job.json"
)
DETAILED_JOBS=("validate-python" "validate-nodejs" "validate-go" "validate-rust" "validate-erlang")

# Execute jobs in the same order as GitHub workflow
echo "📋 Executing workflow jobs..."
echo ""

# Job 1: Python Validation
total_jobs=$((total_jobs + 1))
if run_job "validate-python" "validate-python.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 2: Node.js Validation  
total_jobs=$((total_jobs + 1))
if run_job "validate-nodejs" "validate-nodejs.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 3: Go Validation
total_jobs=$((total_jobs + 1))
if run_job "validate-go" "validate-go.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 4: Elixir/Erlang Validation
total_jobs=$((total_jobs + 1))
if run_job "validate-erlang" "validate-erlang.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 5: Rust Validation
total_jobs=$((total_jobs + 1))
if run_job "validate-rust" "validate-rust.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 6: Cross-Language Compatibility (depends on previous jobs)
total_jobs=$((total_jobs + 1))
if run_job "cross-language-compatibility" "cross-language-compatibility.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 7: Performance Benchmarks
total_jobs=$((total_jobs + 1))
if run_job "performance-benchmarks" "performance-benchmarks.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 8: Security Validation
total_jobs=$((total_jobs + 1))
if run_job "security-validation" "security-validation.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 9: Final Report (always runs, like in GitHub workflow with if: always())
total_jobs=$((total_jobs + 1))
echo ""
echo "🚀 Starting job: final-report"
echo "================================"
if [ -f "scripts/jobs/final-report.sh" ]; then
    chmod +x "scripts/jobs/final-report.sh"
    # Final report always runs, even if previous jobs failed
    bash "scripts/jobs/final-report.sh" || echo "⚠️  Final report job had issues but workflow continues"
    echo "success" > "results/final-report_status.txt"
    successful_jobs=$((successful_jobs + 1))
else
    echo "❌ Final report script not found"
    echo "not_found" > "results/final-report_status.txt"
fi

# Calculate workflow duration
workflow_end_time=$(date +%s)
workflow_duration=$((workflow_end_time - workflow_start_time))

# Generate workflow summary
echo ""
echo "=================================================="
echo "🦊 FoxWhisper Protocol - Workflow Summary"
echo "=================================================="
echo "Total Jobs: $total_jobs"
echo "Successful: $successful_jobs"
echo "Failed: $((total_jobs - successful_jobs))"
echo "Duration: ${workflow_duration}s"
echo "Success Rate: $(awk "BEGIN {printf \"%.1f%%\", $successful_jobs * 100 / $total_jobs}")"
echo ""

# Build a grid of test results (tests as columns, languages as rows)
python3 - <<'PY'
import json
from pathlib import Path

languages = [
    ('validate-python', 'python'),
    ('validate-nodejs', 'nodejs'),
    ('validate-go', 'go'),
    ('validate-rust', 'rust'),
    ('validate-erlang', 'elixir'),
]
# Canonical tests by language (aligned with job scripts)
tests_by_lang = {
    'python': ['cbor_validation', 'cbor_schema', 'multi_device_sync', 'replay_poisoning', 'malformed_fuzz', 'replay_storm', 'epoch_fork'],
    'nodejs': ['cbor_validation', 'cbor_schema', 'cbor_crosslang', 'multi_device_sync', 'replay_poisoning', 'malformed_fuzz', 'replay_storm', 'epoch_fork'],
    'go': ['cbor_validation', 'cbor_schema', 'multi_device_sync', 'replay_poisoning', 'malformed_fuzz', 'replay_storm', 'epoch_fork'],
    'rust': ['cbor_validation', 'cbor_schema', 'multi_device_sync', 'replay_poisoning', 'malformed_fuzz', 'replay_storm', 'epoch_fork'],
    'elixir': ['cbor_validation', 'cbor_schema', 'multi_device_sync', 'replay_poisoning', 'malformed_fuzz', 'replay_storm', 'epoch_fork'],
}

summary_files = {
    'python': Path('results/python_validation_job.json'),
    'nodejs': Path('results/nodejs_validation_job.json'),
    'go': Path('results/go_validation_job.json'),
    'rust': Path('results/rust_validation_job.json'),
    'elixir': Path('results/validate_erlang_job.json'),
}

def job_status(lang):
    sf = summary_files.get(lang)
    if not sf or not sf.exists():
        return 'unknown'
    try:
        data = json.load(sf.open())
        return data.get('status', 'unknown')
    except Exception:
        return 'unknown'

# Build unified header
all_tests = []
for lst in tests_by_lang.values():
    for t in lst:
        if t not in all_tests:
            all_tests.append(t)

rows = []
for _job, lang in languages:
    status = job_status(lang)
    tests = tests_by_lang.get(lang, [])
    row = [lang]
    for t in all_tests:
        if t not in tests:
            row.append('')
        else:
            row.append('✅' if status == 'success' else ('❌' if status == 'failed' else ''))
    rows.append(row)

header = ['lang'] + all_tests
line = ' | '.join(header)
print("Test Grid (lang vs tests):")
print(line)
print('-' * len(line))
for r in rows:
    print(' | '.join(r))
PY

echo ""

# Show job status summary
echo "Job Status Summary:"
echo "------------------"
for job in validate-python validate-nodejs validate-go validate-erlang validate-rust cross-language-compatibility performance-benchmarks security-validation final-report; do
    if [ -f "results/${job}_status.txt" ]; then
        status=$(cat "results/${job}_status.txt")
        case $status in
            "success")
                echo "✅ $job: PASSED"
                ;;
            "failed")
                echo "❌ $job: FAILED"
                ;;
            "not_found")
                echo "❓ $job: NOT FOUND"
                ;;
            *)
                echo "❓ $job: $status"
                ;;
        esac
    else
        echo "❓ $job: status file not found"
    fi
done

# Show detailed validation results
for job in "${DETAILED_JOBS[@]}"; do
    summary_file=${JOB_SUMMARY_FILES[$job]}
    if [ -f "$summary_file" ]; then
        print_validation_details "$job" "$summary_file"
    fi
done


if [ ${#DETAILED_JOBS[@]} -gt 0 ]; then
    echo ""
    echo "Detailed Test Breakdown:"
    echo "------------------------"
    for job in "${DETAILED_JOBS[@]}"; do
        summary_file=${JOB_SUMMARY_FILES[$job]}
        print_validation_details "$job" "$summary_file"
    done
fi

echo ""
echo "📁 All results saved to: results/"
echo "📄 Final report: results/FINAL_VALIDATION_REPORT.md"

# Final workflow status
if [ $successful_jobs -eq $total_jobs ]; then
    echo ""
    echo "🎉 WORKFLOW COMPLETED SUCCESSFULLY!"
    echo "✅ FoxWhisper Protocol validation completed without errors"
    exit 0
else
    echo ""
    echo "⚠️  WORKFLOW COMPLETED WITH ISSUES"
    echo "❌ Some jobs failed - please review the detailed logs"
    exit 1
fi