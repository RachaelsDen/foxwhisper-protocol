from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from validation.common.simulators.corrupted_eare import (  # type: ignore[import]
    CorpusError,
    evaluate_expectations,
    load_corpus,
    simulate,
)
from validation.python.util.reporting import write_json  # type: ignore[import]

DEFAULT_CORPUS = ROOT_DIR / "tests/common/adversarial/corrupted_eare.json"
SUMMARY_FILENAME = "corrupted_eare_summary.json"


def run_simulation(corpus_path: Path, summary_out: str, fail_fast: bool = False) -> int:
    scenarios = load_corpus(str(corpus_path))
    results = []
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
    print(f"Corrupted EARE simulation summary written to {output_path}")
    if failed:
        print(f"❌ {failed} scenario(s) failed expectations")
    else:
        print("✅ All corrupted EARE scenarios passed")

    return 0 if failed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run corrupted EARE simulations")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS, help="Path to corrupted EARE corpus JSON")
    parser.add_argument("--summary-out", default=SUMMARY_FILENAME, help="Summary filename (written to results/)")
    parser.add_argument("--fail-fast", action="store_true", help="Stop after first failing scenario")
    args = parser.parse_args()

    try:
        return run_simulation(args.corpus, args.summary_out, fail_fast=args.fail_fast)
    except CorpusError as exc:
        print(f"Corpus error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
