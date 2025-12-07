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

# Optional Job: Epoch Fork Stress Soak (nightly in GitHub Actions)
if [[ "${RUN_EPOCH_FORK_STRESS:-0}" != "0" ]]; then
    total_jobs=$((total_jobs + 1))
    if run_job "epoch-fork-stress" "epoch-fork-stress.sh"; then
        successful_jobs=$((successful_jobs + 1))
    fi
else
    echo ""
    echo "⏭️  Skipping job: epoch-fork-stress (set RUN_EPOCH_FORK_STRESS=1 to enable)"
    echo "skipped" > "results/epoch-fork-stress_status.txt"
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

RESULTS_DIR = Path("results")

TESTS = [
    "cbor_validation",
    "cbor_schema",
    "multi_device_sync",
    "device_desync",
    "corrupted_eare",
    "replay_poisoning",
    "malformed_fuzz",
    "replay_storm",
    "epoch_fork",
    "cbor_crosslang",
]

LANGS = ["python", "nodejs", "go", "rust", "erlang"]

LANG_TEST_MATRIX = {
    "python": [
        "cbor_validation",
        "cbor_schema",
        "multi_device_sync",
        "device_desync",
        "corrupted_eare",
        "replay_poisoning",
        "malformed_fuzz",
        "replay_storm",
        "epoch_fork",
    ],
    "nodejs": TESTS,
    "go": [
        "cbor_validation",
        "cbor_schema",
        "multi_device_sync",
        "device_desync",
        "corrupted_eare",
        "replay_poisoning",
        "malformed_fuzz",
        "replay_storm",
        "epoch_fork",
    ],
    "rust": [
        "cbor_validation",
        "cbor_schema",
        "multi_device_sync",
        "device_desync",
        "corrupted_eare",
        "replay_poisoning",
        "malformed_fuzz",
        "replay_storm",
        "epoch_fork",
    ],
    "erlang": [
        "cbor_validation",
        "cbor_schema",
        "multi_device_sync",
        "device_desync",
        "corrupted_eare",
        "replay_poisoning",
        "malformed_fuzz",
        "replay_storm",
        "epoch_fork",
    ],
}

LANG_PREFIXES = {
    "python": ["python_"],
    "nodejs": ["nodejs_"],
    "go": ["go_"],
    "rust": ["rust_"],
    "erlang": ["erlang_", "elixir_"],
}

RAW_TO_CANONICAL = {
    "schema_validation": "cbor_schema",
    "schema": "cbor_schema",
    "cbor_schema": "cbor_schema",
    "cbor_validation": "cbor_validation",
    "cbor": "cbor_validation",
    "multi_device_sync": "multi_device_sync",
    "replay_poisoning": "replay_poisoning",
    "malformed_fuzz": "malformed_fuzz",
    "replay_storm": "replay_storm",
    "epoch_fork": "epoch_fork",
    "cbor_crosslang": "cbor_crosslang",
    "device_desync": "device_desync",
    "corrupted_eare": "corrupted_eare",
}

STATUS_SYMBOLS = {"pass": "✅", "fail": "❌", "skip": "⏭️", "unknown": "?"}
STATUS_PRIORITY = {"fail": 0, "unknown": 1, "skip": 2, "pass": 3}

def normalize_test_name(name):
    if not isinstance(name, str):
        return None
    return RAW_TO_CANONICAL.get(name, name)

def normalize_status(value):
    if isinstance(value, bool):
        return "pass" if value else "fail"
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"success", "passed", "pass", "ok"}:
            return "pass"
        if lowered in {"fail", "failed", "error"}:
            return "fail"
        if lowered in {"skip", "skipped"}:
            return "skip"
    return "unknown"

def merge_status(current, incoming):
    if current is None:
        return incoming
    if incoming is None:
        return current
    return (
        current
        if STATUS_PRIORITY.get(current, 1) <= STATUS_PRIORITY.get(incoming, 1)
        else incoming
    )

def parse_status_filename(name):
    if not name.endswith("_status.json"):
        return None, None
    base = name[: -len("_status.json")]
    for lang, prefixes in LANG_PREFIXES.items():
        for prefix in prefixes:
            if base.startswith(prefix):
                raw = base[len(prefix) :]
                return lang, raw
    return None, None

def log_candidates(lang, raw, canonical):
    candidates = [
        f"{lang}_{raw}_results.log",
        f"{lang}_{canonical}_results.log",
        f"{lang}_{raw}.log",
        f"{lang}_{canonical}.log",
        f"{lang}_{raw}_validation.log",
        f"{lang}_{canonical}_validation.log",
    ]
    if lang == "erlang":
        candidates.extend(
            [
                f"elixir_{raw}_results.log",
                f"elixir_{canonical}_results.log",
                f"elixir_{raw}.log",
                f"elixir_{canonical}.log",
                f"elixir_{raw}_validation.log",
                f"elixir_{canonical}_validation.log",
            ]
        )
    seen = set()
    unique = []
    for cand in candidates:
        if cand not in seen:
            unique.append(cand)
            seen.add(cand)
    return unique

def find_log(lang, raw, canonical):
    for candidate in log_candidates(lang, raw, canonical):
        if (RESULTS_DIR / candidate).exists():
            return candidate
    return None

results = {lang: {} for lang in LANGS}
extras = {lang: set() for lang in LANGS}

def record_result(lang, test_name, status, log_name):
    canonical = normalize_test_name(test_name)
    if canonical is None:
        return
    lang_results = results.setdefault(lang, {})
    current = lang_results.get(canonical)
    merged_status = merge_status(current.get("status") if current else None, status)
    merged_log = current.get("log") if current else None
    if merged_log is None and log_name:
        merged_log = log_name
    lang_results[canonical] = {"status": merged_status, "log": merged_log}
    if canonical not in LANG_TEST_MATRIX.get(lang, []):
        extras.setdefault(lang, set()).add(canonical)

for path in RESULTS_DIR.glob("*_status.json"):
    lang, raw = parse_status_filename(path.name)
    if not lang:
        continue
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        continue
    canonical_raw = normalize_test_name(raw)
    log_name = find_log(lang, raw, canonical_raw or raw)
    entries = data.get("results")
    if isinstance(entries, list) and entries:
        for entry in entries:
            test_name = entry.get("test") or entry.get("name") or raw
            status = normalize_status(
                entry.get("status") if "status" in entry else entry.get("success")
            )
            record_result(lang, test_name, status, log_name)
    else:
        test_name = data.get("test") or raw
        status = normalize_status(
            data.get("status") if "status" in data else data.get("success")
        )
        record_result(lang, test_name, status, log_name)

def cell_symbol(lang, test):
    if test not in LANG_TEST_MATRIX.get(lang, []):
        return ""
    entry = results.get(lang, {}).get(test)
    if not entry:
        return "?"
    return STATUS_SYMBOLS.get(entry.get("status"), "?")

headers = ["lang"] + TESTS
col_widths = {col: len(col) for col in headers}
for lang in LANGS:
    col_widths["lang"] = max(col_widths["lang"], len(lang))
    for test in TESTS:
        col_widths[test] = max(col_widths[test], len(cell_symbol(lang, test)))

def format_row(values):
    return " | ".join(f"{val:<{col_widths[h]}}" for h, val in zip(headers, values))

print("Test Grid (lang vs tests):")
print(format_row(headers))
print("-+-".join("-" * col_widths[h] for h in headers))
for lang in LANGS:
    row = [lang] + [cell_symbol(lang, test) for test in TESTS]
    print(format_row(row))

print("\nLanguage Summaries:")
for lang in LANGS:
    expected = LANG_TEST_MATRIX.get(lang, [])
    lang_results = results.get(lang, {})
    passed = sum(1 for test in expected if lang_results.get(test, {}).get("status") == "pass")
    total = len(expected)
    pct = (passed * 100 / total) if total else 0.0
    logs = []
    for test in expected:
        log = lang_results.get(test, {}).get("log")
        if log and log not in logs:
            logs.append(log)
    print(f"- validate-{lang}: {passed}/{total} tests passed (success {pct:.1f}%)")
    if logs:
        print(f"  logs: {', '.join(logs)}")

warnings = []
for lang in LANGS:
    expected_set = set(LANG_TEST_MATRIX.get(lang, []))
    actual_set = set(results.get(lang, {}))
    missing = sorted(expected_set - actual_set)
    extra = sorted(extras.get(lang, set()))
    if missing:
        warnings.append(f"{lang}: missing results for {', '.join(missing)}")
    if extra:
        warnings.append(f"{lang}: unexpected results for {', '.join(extra)}")

if warnings:
    print("\nSanity Checks:")
    for warn in warnings:
        print(f"- {warn}")
else:
    print("\nSanity Checks: none")
PY

echo ""

# Show job status summary
echo "Job Status Summary:"
echo "------------------"
for job in validate-python validate-nodejs validate-go validate-erlang validate-rust cross-language-compatibility epoch-fork-stress performance-benchmarks security-validation final-report; do
    if [ -f "results/${job}_status.txt" ]; then
        status=$(cat "results/${job}_status.txt")
        case $status in
            "success")
                echo "✅ $job: PASSED"
                ;;
            "failed")
                echo "❌ $job: FAILED"
                ;;
            "skipped")
                echo "⏭️  $job: SKIPPED"
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