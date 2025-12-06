#!/usr/bin/env python3
"""STDIN-based entrypoint for AFL/LibFuzzer targeting FoxWhisper CBOR validators."""

from __future__ import annotations

import json
import sys
from importlib import util as importlib_util
from pathlib import Path
from typing import Any, Dict

ROOT_DIR = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = ROOT_DIR / "validation" / "python" / "validators" / "validate_cbor_python.py"


def load_validator():
    spec = importlib_util.spec_from_file_location("validate_cbor_python", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load validate_cbor_python module")
    module = importlib_util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def process_payload(payload: Dict[str, Any], validator) -> None:
    message_type = payload.get("message_type")
    vector = payload.get("vector")
    if not isinstance(message_type, str):
        return
    if not isinstance(vector, dict):
        return
    validator.validate_message(message_type, vector)


def main() -> None:
    data = sys.stdin.buffer.read()
    if not data:
        return
    try:
        payload = json.loads(data.decode("utf-8", errors="ignore"))
    except json.JSONDecodeError:
        return
    validator = load_validator()
    process_payload(payload, validator)


if __name__ == "__main__":
    main()
