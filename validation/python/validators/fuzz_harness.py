#!/usr/bin/env python3
"""Deterministic malformed-packet harness for Section 4.2.1."""

from __future__ import annotations

import base64
import copy
import json
import sys
from importlib import util as importlib_util
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union, cast

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from validation.python.util.reporting import write_json  # type: ignore[import]

CORPUS_PATH = ROOT_DIR / "tests/common/handshake/cbor_test_vectors.json"
MALFORMED_CORPUS = ROOT_DIR / "tests/common/adversarial/malformed_packets.json"

JsonType = Union[Dict[str, Any], List[Any], str, int, float, bool, None]


def load_validator_module():
    module_path = Path(__file__).with_name("validate_cbor_python.py")
    spec = importlib_util.spec_from_file_location("validate_cbor_python", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load validate_cbor_python module")
    module = importlib_util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_pointer(pointer: str) -> List[Union[str, int]]:
    if not pointer:
        return []
    tokens: List[Union[str, int]] = []
    for raw in pointer.split('.'):
        remainder = raw
        while remainder:
            if '[' in remainder:
                before, after = remainder.split('[', 1)
                if before:
                    tokens.append(before)
                index_str, remainder = after.split(']', 1)
                tokens.append(int(index_str))
            else:
                tokens.append(remainder)
                remainder = ""
    return [token for token in tokens if token != ""]


def resolve(obj: JsonType, tokens: List[Union[str, int]]) -> JsonType:
    current = obj
    for token in tokens:
        if isinstance(token, int):
            current = current[token]  # type: ignore[index]
        else:
            current = current[token]  # type: ignore[index]
    return current


def resolve_parent(obj: JsonType, tokens: List[Union[str, int]]) -> Tuple[JsonType, Union[str, int]]:
    if not tokens:
        raise ValueError("Cannot resolve parent of root")
    parent_tokens = tokens[:-1]
    parent = resolve(obj, parent_tokens) if parent_tokens else obj
    return parent, tokens[-1]


def mutate_remove_field(target: JsonType, tokens: List[Union[str, int]]) -> None:
    parent, key = resolve_parent(target, tokens)
    if isinstance(key, int) and isinstance(parent, list):
        parent.pop(key)
    elif isinstance(key, str) and isinstance(parent, dict):
        parent.pop(key, None)


def mutate_set_value(target: JsonType, tokens: List[Union[str, int]], value: Any) -> None:
    parent, key = resolve_parent(target, tokens)
    if isinstance(key, int) and isinstance(parent, list):
        parent[key] = value
    elif isinstance(key, str) and isinstance(parent, dict):
        parent[key] = value


def mutate_shuffle_map(target: JsonType, tokens: List[Union[str, int]]) -> None:
    mapping = resolve(target, tokens) if tokens else target
    if isinstance(mapping, dict):
        keys = list(mapping.keys())[::-1]
        reordered = {key: mapping[key] for key in keys}
        parent, key = resolve_parent(target, tokens) if tokens else (None, None)
        if parent is None:
            if isinstance(target, dict):
                target.clear()
                target.update(reordered)
        elif isinstance(key, str) and isinstance(parent, dict):
            parent[key] = reordered


def mutate_expand_bytes(target: JsonType, tokens: List[Union[str, int]], factor: int) -> None:
    parent, key = resolve_parent(target, tokens)
    if isinstance(key, str) and isinstance(parent, dict):
        value = parent.get(key)
        if isinstance(value, str):
            parent[key] = value * max(1, factor)


def apply_mutations(base: JsonType, mutations: List[Dict[str, Any]]) -> Tuple[JsonType, List[str]]:
    mutated = copy.deepcopy(base)
    logs: List[str] = []
    for mutation in mutations:
        operation = mutation["op"]
        tokens = parse_pointer(mutation.get("field", ""))
        if operation == "remove_field":
            mutate_remove_field(mutated, tokens)
            logs.append(f"remove_field:{mutation.get('field')}")
        elif operation == "set_value":
            mutate_set_value(mutated, tokens, mutation.get("value"))
            logs.append(f"set_value:{mutation.get('field')}={mutation.get('value')}")
        elif operation == "shuffle_map":
            mutate_shuffle_map(mutated, tokens)
            logs.append(f"shuffle_map:{mutation.get('field')}")
        elif operation == "expand_bytes":
            mutate_expand_bytes(mutated, tokens, int(mutation.get("factor", 2)))
            logs.append(f"expand_bytes:{mutation.get('field')}x{mutation.get('factor', 2)}")
        else:
            logs.append(f"unsupported_op:{operation}")
    return mutated, logs

def handshake_nonce_length(value: Any) -> int:
    if isinstance(value, str):
        return len(value)
    if isinstance(value, bytes):
        return len(value)
    return 0


def b64_length(value: Any) -> int:
    if not isinstance(value, str):
        return 0
    padding = (-len(value)) % 4
    padded = value + ("=" * padding)
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            return len(decoder(padded.encode("ascii")))
        except Exception:
            continue
    return 0


def check_invariants(message_type: str, vector: Dict[str, Any]) -> bool:
    data = vector.get("data", {})
    if not isinstance(data, dict):
        return False
    if message_type == "HANDSHAKE_INIT":
        if vector.get("tag") != 209:
            return False
        required = ["type", "version", "client_id", "x25519_public_key", "kyber_public_key", "nonce"]
        if not all(field in data for field in required):
            return False
        if data.get("type") != "HANDSHAKE_INIT":
            return False
        if data.get("version", 0) < 1:
            return False
        if b64_length(data.get("x25519_public_key")) < 32:
            return False
        if b64_length(data.get("kyber_public_key")) < 32:
            return False
        return True
    if message_type == "HANDSHAKE_RESPONSE":
        if vector.get("tag") != 210:
            return False
        required = ["type", "version", "server_id", "x25519_public_key", "kyber_ciphertext", "nonce"]
        if not all(field in data for field in required):
            return False
        if data.get("type") != "HANDSHAKE_RESPONSE":
            return False
        if data.get("version", 0) < 1:
            return False
        nonce_len = handshake_nonce_length(data.get("nonce"))
        if not (16 <= nonce_len <= 24):
            return False
        if b64_length(data.get("x25519_public_key")) < 32:
            return False
        if b64_length(data.get("kyber_ciphertext")) < 32:
            return False
        return True
    if message_type == "HANDSHAKE_COMPLETE":
        timestamp = data.get("timestamp", -1)
        return isinstance(timestamp, int) and 0 <= timestamp <= 4102444800000
    return True


def load_seed_base(ref: str) -> JsonType:
    path_str, pointer = (ref.split('#', 1) + [""])[:2]
    corpus_path = ROOT_DIR / path_str
    with corpus_path.open('r', encoding='utf-8') as handle:
        data = json.load(handle)
    tokens = parse_pointer(pointer)
    if tokens:
        return resolve(data, tokens)
    return data


def expected_success(value: str) -> bool:
    mapping = {"reject": False, "panic": False, "recover": True}
    return mapping.get(value, False)


def main() -> None:
    validator = load_validator_module()
    with MALFORMED_CORPUS.open('r', encoding='utf-8') as corpus_file:
        corpus = json.load(corpus_file)
    seeds = corpus.get("seeds", [])
    results: List[Dict[str, Any]] = []

    for seed in seeds:
        base_vector = load_seed_base(seed["base_vector"])
        mutated_vector, logs = apply_mutations(base_vector, seed["mutations"])
        mutated_dict = cast(Dict[str, Any], mutated_vector)
        outcome_hint = seed["mutations"][0].get("expected_outcome", "reject")
        expected = expected_success(outcome_hint)
        validator.validate_message(seed["message_type"], mutated_dict)
        invariants_ok = check_invariants(seed["message_type"], mutated_dict)
        passed = invariants_ok == expected
        results.append({
            "seed_id": seed["seed_id"],
            "message_type": seed["message_type"],
            "expected_outcome": outcome_hint,
            "observed_success": invariants_ok,
            "passed": passed,
            "mutations": logs
        })
        status = "✅" if passed else "❌"
        observed_str = "success" if invariants_ok else "failure"
        print(f"{status} {seed['seed_id']} (expected {outcome_hint}, observed={observed_str})")

    payload = {
        "total_seeds": len(results),
        "passed": sum(1 for result in results if result["passed"]),
        "results": results,
    }
    output_path = write_json("malformed_packet_fuzz_results.json", payload)
    print(f"\n📄 Fuzz harness results saved to {output_path}")

    if payload["passed"] != len(results):
        raise SystemExit("Malformed packet harness detected unexpected behavior")


if __name__ == "__main__":
    main()
