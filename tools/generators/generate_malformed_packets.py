#!/usr/bin/env python3
"""Generate deterministic malformed packet seeds for fuzzing."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
VALIDATOR_DIR = ROOT_DIR / "validation" / "python" / "validators"
if str(VALIDATOR_DIR) not in sys.path:
    sys.path.append(str(VALIDATOR_DIR))

import fuzz_harness  # type: ignore  # noqa: E402

CORPUS = ROOT_DIR / "tests/common/adversarial/malformed_packets.json"
OUTPUT_DIR = ROOT_DIR / "tests/common/adversarial/seeds"


def main() -> None:
    with CORPUS.open("r", encoding="utf-8") as handle:
        corpus = json.load(handle)
    seeds = corpus.get("seeds", [])
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = []
    for seed in seeds:
        base = fuzz_harness.load_seed_base(seed["base_vector"])
        mutated, logs = fuzz_harness.apply_mutations(base, seed["mutations"])
        payload = {
            "message_type": seed["message_type"],
            "vector": mutated,
            "mutations": logs,
        }
        target_path = OUTPUT_DIR / f"{seed['seed_id']}.json"
        with target_path.open("w", encoding="utf-8") as out:
            json.dump(payload, out, indent=2)
        manifest.append({"seed_id": seed["seed_id"], "path": target_path.name})

    manifest_path = OUTPUT_DIR / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as manifest_file:
        json.dump({"generated": len(manifest), "seeds": manifest}, manifest_file, indent=2)

    print(f"Generated {len(manifest)} malformed packet seeds in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
