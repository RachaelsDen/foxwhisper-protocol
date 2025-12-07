from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Tuple

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from validation.common.simulators.desync import (  # type: ignore[import]
    CorpusError,
    evaluate_expectations,
    load_corpus,
    parse_scenario,
    simulate,
)
from validation.python.util.reporting import write_json  # type: ignore[import]

DEFAULT_CORPUS = ROOT_DIR / "tests/common/adversarial/device_desync.json"
SUMMARY_FILENAME = "device_desync_summary.json"


def run_simulation(corpus_path: Path, summary_out: str, fail_fast: bool = False) -> int:
    scenarios = load_corpus(str(corpus_path))
    results: List[dict] = []
    failed = 0

    for scenario in scenarios:
        try:
            sim_result = simulate(scenario)
            status, expectation_failures = evaluate_expectations(scenario, sim_result)
        except CorpusError as exc:
            failed += 1
            results.append(
                {
                    "scenario_id": getattr(scenario, "scenario_id", "unknown"),
                    "status": "fail",
                    "failures": [str(exc)],
                    "errors": [str(exc)],
                    "metrics": {},
                    "notes": [],
                }
            )
            if fail_fast:
                break
            continue

        if status != "pass":
            failed += 1

        results.append(
            {
                "scenario_id": scenario.scenario_id,
                "status": status,
                "failures": expectation_failures,
                "errors": sim_result.errors,
                "metrics": sim_result.metrics,
                "notes": sim_result.notes,
            }
        )

        if fail_fast and status != "pass":
            break

    summary = {
        "corpus": str(corpus_path),
        "total": len(results),
        "failed": failed,
        "passed": len(results) - failed,
        "scenarios": results,
    }

    output_path = write_json(summary_out, summary)
    print(f"Device desync simulation summary written to {output_path}")
    if failed:
        print(f"❌ {failed} scenario(s) failed expectations")
    else:
        print("✅ All device desync scenarios passed")

    return 0 if failed == 0 else 1


def _inline_sanity_check() -> Tuple[bool, str]:
    scenario_data = {
        "scenario_id": "inline_health_check",
        "devices": [
            {"device_id": "a", "dr_version": 1, "clock_ms": 0},
            {"device_id": "b", "dr_version": 1, "clock_ms": 0},
        ],
        "timeline": [
            {"t": 0, "event": "send", "from": "a", "to": ["b"], "msg_id": "m-inline", "dr_version": 2},
            {"t": 10, "event": "recv", "device": "b", "msg_id": "m-inline", "apply_dr_version": 2},
        ],
        "expectations": {
            "detected": True,
            "max_detection_ms": 10,
            "max_recovery_ms": 50,
            "healing_required": True,
            "residual_divergence_allowed": False,
            "max_dr_version_delta": 1,
            "max_clock_skew_ms": 100,
            "allow_message_loss_rate": 0.0,
            "allow_out_of_order_rate": 0.0,
            "expected_error_categories": ["DIVERGENCE_DETECTED"],
            "max_rollback_events": 0,
        },
    }
    scenario = parse_scenario(scenario_data)
    result = simulate(scenario)
    status, failures = evaluate_expectations(scenario, result)
    if status != "pass":
        return False, f"Inline sanity check failed: {failures}"
    return True, "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run device desynchronization simulations")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS, help="Path to device desync corpus JSON")
    parser.add_argument("--summary-out", default=SUMMARY_FILENAME, help="Summary filename (written to results/)")
    parser.add_argument("--fail-fast", action="store_true", help="Stop after first failing scenario")
    parser.add_argument("--self-test", action="store_true", help="Run inline sanity checks and exit")
    args = parser.parse_args()

    if args.self_test:
        ok, msg = _inline_sanity_check()
        print(msg)
        return 0 if ok else 1

    try:
        return run_simulation(args.corpus, args.summary_out, fail_fast=args.fail_fast)
    except CorpusError as exc:
        print(f"Corpus error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
