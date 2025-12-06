#!/usr/bin/env python3
"""FoxWhisper replay and poisoning scenario validator."""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List

ROOT_DIR = Path(__file__).resolve().parents[3]
VECTORS_FILE = ROOT_DIR / "tests/common/handshake/replay_poisoning_test_vectors.json"
RESULTS_DIR = ROOT_DIR / "results"


@dataclass
class ScenarioResult:
    scenario: str
    valid: bool
    details: List[str]


class ReplayPoisoningValidator:
    """Validates replay, poisoning, and epoch-fork scenarios."""

    def __init__(self, vectors: Dict[str, Any]) -> None:
        self.vectors = vectors
        self.results: List[ScenarioResult] = []

    def run(self) -> List[ScenarioResult]:
        self._validate_replay_cases()
        self._validate_replay_boundaries()
        self._validate_poisoning_vectors()
        self._validate_epoch_forks()
        self._validate_malformed_eare()
        self._validate_anti_poisoning_rules()
        self._validate_replay_storm_profiles()
        return self.results

    def _record(self, scenario: str, valid: bool, details: List[str]) -> None:
        self.results.append(ScenarioResult(scenario=scenario, valid=valid, details=details))

    @staticmethod
    def _detect_replay(sequence_numbers: List[int], window_size: int) -> bool:
        seen: List[int] = []
        detection = False
        for seq in sequence_numbers:
            cutoff = seq - window_size
            seen = [value for value in seen if value >= cutoff]
            if seq in seen:
                detection = True
            seen.append(seq)
        return detection

    def _validate_replay_cases(self) -> None:
        section = self.vectors["replay_attack_detection"]
        window = section["window_size"]
        for case in section["test_cases"]:
            detection = self._detect_replay(case["sequence_numbers"], window)
            expected = case["expected_detection"]
            valid = detection == expected
            details = [
                f"window={window}",
                f"detected={detection}",
                f"expected={expected}",
                case.get("notes", "")
            ]
            self._record(f"replay_attack::{case['case']}", valid, details)

    def _validate_replay_boundaries(self) -> None:
        section = self.vectors["replay_window_boundaries"]
        window = section["window_size"]
        for case in section["test_cases"]:
            detection = self._detect_replay(case["sequence_numbers"], window)
            expected = case["expected_detection"]
            valid = detection == expected
            details = [
                f"window={window}",
                f"detected={detection}",
                f"expected={expected}",
                case.get("notes", "")
            ]
            self._record(f"replay_window::{case['case']}", valid, details)

    def _validate_poisoning_vectors(self) -> None:
        section = self.vectors["poisoning_injection"]
        for attack in section["attack_vectors"]:
            violations = 0
            for field in attack["malicious_fields"]:
                for key, value in field.items():
                    if key.startswith("expected_"):
                        suffix = key.split("expected_", 1)[1]
                        actual_key = f"actual_{suffix}"
                        if actual_key in field and field[actual_key] != value:
                            violations += 1
            valid = violations > 0
            details = [
                f"attack={attack['attack_name']}",
                f"violations={violations}",
                f"expected_defense={attack['expected_defense']}"
            ]
            self._record(f"poisoning::{attack['attack_name']}", valid, details)

    def _validate_epoch_forks(self) -> None:
        section = self.vectors["epoch_fork_detection"]
        for scenario in section["scenarios"]:
            timeline = scenario["timeline"]
            children: Dict[str, List[str]] = {}
            for entry in timeline:
                parent = entry["parent"]
                if parent is None:
                    continue
                children.setdefault(parent, []).append(entry["epoch_id"])
            fork_detected = any(len(nodes) > 1 for nodes in children.values())
            expected = scenario["expected_fork_detected"]
            valid = fork_detected == expected
            details = [
                f"fork_detected={fork_detected}",
                f"expected={expected}",
                f"timeline_length={len(timeline)}"
            ]
            self._record(f"epoch_fork::{scenario['scenario']}", valid, details)

    def _validate_malformed_eare(self) -> None:
        section = self.vectors["malformed_eare"]
        for record in section["records"]:
            fields = record["fields"]
            required_fields = record.get("required_fields", [])
            missing = [field for field in required_fields if field not in fields]
            hash_bytes = record.get("hash_bytes")
            if hash_bytes is None:
                hash_bytes = self._safe_hex_len(fields.get("hash"))
            min_hash_bytes = record.get("min_hash_bytes", 32)
            length_ok = hash_bytes >= min_hash_bytes
            valid = not missing and length_ok
            expected_valid = record["expected_valid"]
            details = [
                f"missing_fields={missing}",
                f"hash_bytes={hash_bytes}",
                f"min_hash_bytes={min_hash_bytes}",
                f"expected_valid={expected_valid}"
            ]
            self._record(
                f"eare::{record['record_id']}",
                valid == expected_valid,
                details,
            )

    @staticmethod
    def _safe_hex_len(value: str | None) -> int:
        if not value:
            return 0
        try:
            return len(bytes.fromhex(value))
        except ValueError:
            return 0

    def _validate_anti_poisoning_rules(self) -> None:
        section = self.vectors["anti_poisoning_rules"]
        for rule in section["rules"]:
            conditions = rule["conditions"]
            sample = rule["sample_message"]
            enforced = True
            if "max_drift" in conditions:
                drift = sample["nonce_counter"] - sample["last_nonce_counter"]
                enforced = drift <= conditions["max_drift"]
            elif conditions.get("require_binding"):
                enforced = sample.get("sender_id") == sample.get("aad_sender")
            elif conditions.get("allow_missing_aad"):
                enforced = sample.get("aad") is None
            expected = rule["expected_enforced"]
            details = [
                f"rule={rule['rule_id']}",
                f"enforced={enforced}",
                f"expected={expected}"
            ]
            self._record(f"anti_poisoning::{rule['rule_id']}", enforced == expected, details)

    def _validate_replay_storm_profiles(self) -> None:
        section = self.vectors["replay_storm_simulation"]
        window = section["window_size"]
        capacity_rate = section["capacity_per_ms"]
        tolerance = 0.1
        for profile in section["profiles"]:
            burst_rate = profile["burst_rate"]
            duration = profile["duration_ms"]
            total_msgs = burst_rate * duration
            capacity = capacity_rate * duration + window
            drops = max(0.0, total_msgs - capacity)
            drop_ratio = 0.0 if total_msgs == 0 else min(1.0, drops / total_msgs)
            expected_ratio = profile["expected_drop_ratio"]
            valid = abs(drop_ratio - expected_ratio) <= tolerance
            details = [
                f"window={window}",
                f"drop_ratio={drop_ratio:.2f}",
                f"expected_ratio={expected_ratio}",
                f"burst_rate={burst_rate}",
                f"duration_ms={duration}"
            ]
            self._record(f"replay_storm::{profile['profile_id']}", valid, details)


def load_vectors(path: Path = VECTORS_FILE) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_results(results: List[ScenarioResult]) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RESULTS_DIR / "replay_poisoning_validation_results.json"
    payload = {
        "scenario_count": len(results),
        "results": [asdict(result) for result in results],
        "success": all(result.valid for result in results),
    }
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return output_path


def main() -> None:
    print("FoxWhisper Replay & Poisoning Validator")
    print("=" * 55)
    vectors = load_vectors()
    validator = ReplayPoisoningValidator(vectors)
    results = validator.run()

    success_count = sum(1 for result in results if result.valid)
    print(f"Validated {len(results)} scenarios: {success_count} passed")
    for result in results:
        status = "✅" if result.valid else "❌"
        print(f"{status} {result.scenario}")

    output_path = save_results(results)
    print(f"\n📄 Results saved to {output_path}")

    if any(not result.valid for result in results):
        raise SystemExit("Replay/poisoning validation failed")


if __name__ == "__main__":
    main()
