from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, TypeVar

ROOT_DIR = Path(__file__).resolve().parents[3]
RESULTS_DIR = ROOT_DIR / "results"

T = TypeVar("T")


def ensure_results_dir() -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    return RESULTS_DIR


DEFAULT_CRYPTO_PROFILE = "fw-hybrid-x25519-kyber1024"

def write_json(filename: str, payload: Dict[str, Any]) -> Path:
    output_dir = ensure_results_dir()
    output_path = output_dir / filename
    to_write = payload if "crypto_profile" in payload else {"crypto_profile": DEFAULT_CRYPTO_PROFILE, **payload}
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(to_write, handle, indent=2)
    return output_path


def input_path(relative: str) -> Path:
    return ROOT_DIR / relative


def load_json(relative: str) -> Any:
    path = input_path(relative)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)
