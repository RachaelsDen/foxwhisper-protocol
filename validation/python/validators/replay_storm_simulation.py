#!/usr/bin/env python3
"""Replay storm simulator harness for Section 4.2.2."""

from __future__ import annotations

import json
import sys
from importlib import util as importlib_util
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from validation.python.util.reporting import write_json  # type: ignore[import]


def load_simulator() -> Tuple[Any, Any]:
    module_path = ROOT_DIR / "validation/common/simulators/replay.py"
    module_name = "validation.common.simulators.replay"
    spec = importlib_util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load replay simulator module")
    module = importlib_util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module.ReplayProfile, module.ReplayStormSimulator


ReplayProfile, ReplayStormSimulator = load_simulator()

PROFILES_PATH = ROOT_DIR / "tests/common/adversarial/replay_storm_profiles.json"
SUMMARY_FILENAME = "replay_storm_summary.json"


def load_profiles() -> Dict[str, Any]:
    with PROFILES_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    data = load_profiles()
    tolerance = float(data.get("tolerance", 0.05))
    queue_limit_value = data.get("queue_limit")
    simulator = ReplayStormSimulator(
        window_size=int(data["window_size"]),
        capacity_per_ms=float(data["capacity_per_ms"]),
        queue_limit=float(queue_limit_value) if queue_limit_value is not None else None,
    )

    summary: Dict[str, Any] = {
        "window_size": data["window_size"],
        "capacity_per_ms": data["capacity_per_ms"],
        "queue_limit": data.get("queue_limit", simulator.queue_limit),
        "tolerance": tolerance,
        "profiles": [],
    }

    passed = 0
    profiles: List[Dict[str, Any]] = data.get("profiles", [])

    for profile_data in profiles:
        profile = ReplayProfile.from_dict(profile_data)
        metrics = simulator.simulate(profile)
        expected_drop = float(profile_data.get("expected_drop_ratio", 0.0))
        expected_alert = bool(profile_data.get("expected_alert", True))
        drop_delta = abs(metrics["drop_ratio"] - expected_drop)
        status = drop_delta <= tolerance and metrics["alert_triggered"] == expected_alert

        profile_summary = {
            **metrics,
            "expected_drop_ratio": expected_drop,
            "drop_ratio_delta": drop_delta,
            "expected_alert": expected_alert,
            "notes": profile_data.get("notes", ""),
            "status": "pass" if status else "fail",
        }
        summary["profiles"].append(profile_summary)

        indicator = "✅" if status else "❌"
        print(
            f"{indicator} {profile.profile_id} | drop_ratio={metrics['drop_ratio']:.2f} (target={expected_drop:.2f})"
            f" alert={'yes' if metrics['alert_triggered'] else 'no'}"
        )

        if status:
            passed += 1

    total = len(summary["profiles"])
    summary["passed"] = passed
    summary["failed"] = total - passed
    summary["status"] = "success" if passed == total else "failed"

    output_path = write_json(SUMMARY_FILENAME, summary)
    print(f"\n📄 Replay storm summary saved to {output_path}")

    if summary["failed"]:
        raise SystemExit("Replay storm simulator detected regressions")


if __name__ == "__main__":
    main()
