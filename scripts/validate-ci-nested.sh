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

# Job 4: Rust Validation
total_jobs=$((total_jobs + 1))
if run_job "validate-rust" "validate-rust.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 5: Cross-Language Compatibility (depends on previous jobs)
total_jobs=$((total_jobs + 1))
if run_job "cross-language-compatibility" "cross-language-compatibility.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 6: Performance Benchmarks
total_jobs=$((total_jobs + 1))
if run_job "performance-benchmarks" "performance-benchmarks.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 7: Security Validation
total_jobs=$((total_jobs + 1))
if run_job "security-validation" "security-validation.sh"; then
    successful_jobs=$((successful_jobs + 1))
fi

# Job 8: Final Report (always runs, like in GitHub workflow with if: always())
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

# Show job status summary
echo "Job Status Summary:"
echo "------------------"
for job in validate-python validate-nodejs validate-go validate-rust cross-language-compatibility performance-benchmarks security-validation final-report; do
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
                echo "❓ $job: UNKNOWN"
                ;;
        esac
    else
        echo "❓ $job: NO STATUS"
    fi
done

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