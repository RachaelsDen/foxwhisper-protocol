"""Corpus-driven corrupted EARE simulator (structural oracle)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


class CorpusError(ValueError):
    pass


@dataclass
class GroupContext:
    group_id: str
    membership_version: int
    epoch_size_limit: int


@dataclass
class Node:
    node_id: str
    epoch_id: int
    eare_hash: str
    issued_by: str
    previous_epoch_hash: str
    membership_digest: str
    payload: Optional[Dict[str, Any]]


@dataclass
class Corruption:
    type: str
    target_node: Optional[str] = None
    fields: Optional[Dict[str, Any]] = None
    payload_patch: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None


@dataclass
class Expectations:
    should_detect: bool
    expected_errors: List[str]
    max_detection_ms: int
    allow_partial_accept: bool
    residual_divergence_allowed: bool


@dataclass
class Scenario:
    scenario_id: str
    tags: List[str]
    group_context: GroupContext
    nodes: List[Node]
    corruptions: List[Corruption]
    expectations: Expectations


@dataclass
class SimulationResult:
    detection: bool
    detection_ms: Optional[int]
    errors: List[str]
    metrics: Dict[str, Any]
    notes: List[str]


_ERROR_CODES = {
    "INVALID_SIGNATURE",
    "INVALID_POP",
    "HASH_CHAIN_BREAK",
    "TRUNCATED_EARE",
    "EXTRA_FIELDS",
    "PAYLOAD_TAMPERED",
    "STALE_EPOCH_REF",
}


def _schema_error(scenario_id: str, detail: str) -> CorpusError:
    return CorpusError(f"[{scenario_id}] {detail}")


def _validate_group_context(data: Any, scenario_id: str) -> GroupContext:
    if not isinstance(data, dict):
        raise _schema_error(scenario_id, "group_context must be an object")
    for field in ("group_id", "membership_version", "epoch_size_limit"):
        if field not in data:
            raise _schema_error(scenario_id, f"group_context missing {field}")
    if not isinstance(data["group_id"], str):
        raise _schema_error(scenario_id, "group_context.group_id must be string")
    if not isinstance(data["membership_version"], int):
        raise _schema_error(scenario_id, "group_context.membership_version must be int")
    if not isinstance(data["epoch_size_limit"], int):
        raise _schema_error(scenario_id, "group_context.epoch_size_limit must be int")
    return GroupContext(
        group_id=data["group_id"],
        membership_version=int(data["membership_version"]),
        epoch_size_limit=int(data["epoch_size_limit"]),
    )


def _validate_nodes(data: Any, scenario_id: str) -> List[Node]:
    if not isinstance(data, list) or not data:
        raise _schema_error(scenario_id, "nodes must be a non-empty array")
    nodes: List[Node] = []
    for entry in data:
        if not isinstance(entry, dict):
            raise _schema_error(scenario_id, "node entry must be an object")
        for field in ("node_id", "epoch_id", "eare_hash", "issued_by", "previous_epoch_hash", "membership_digest"):
            if field not in entry:
                raise _schema_error(scenario_id, f"node missing {field}")
        payload = entry.get("payload")
        if payload is not None and not isinstance(payload, dict):
            raise _schema_error(scenario_id, "node.payload must be object if present")
        nodes.append(
            Node(
                node_id=str(entry["node_id"]),
                epoch_id=int(entry["epoch_id"]),
                eare_hash=str(entry["eare_hash"]),
                issued_by=str(entry["issued_by"]),
                previous_epoch_hash=str(entry["previous_epoch_hash"]),
                membership_digest=str(entry["membership_digest"]),
                payload=payload,
            )
        )
    return sorted(nodes, key=lambda n: n.epoch_id)


def _validate_corruptions(data: Any, scenario_id: str) -> List[Corruption]:
    if data is None:
        return []
    if not isinstance(data, list):
        raise _schema_error(scenario_id, "corruptions must be an array")
    corruptions: List[Corruption] = []
    for entry in data:
        if not isinstance(entry, dict) or "type" not in entry:
            raise _schema_error(scenario_id, "corruption entry must be object with type")
        corruptions.append(
            Corruption(
                type=str(entry["type"]),
                target_node=entry.get("target_node"),
                fields=entry.get("fields"),
                payload_patch=entry.get("payload_patch"),
                reason=entry.get("reason"),
            )
        )
    return corruptions


def _validate_expectations(data: Any, scenario_id: str) -> Expectations:
    if not isinstance(data, dict):
        raise _schema_error(scenario_id, "expectations must be object")
    required = [
        "should_detect",
        "expected_errors",
        "max_detection_ms",
        "allow_partial_accept",
        "residual_divergence_allowed",
    ]
    for field in required:
        if field not in data:
            raise _schema_error(scenario_id, f"expectations missing {field}")
    if not isinstance(data["expected_errors"], list):
        raise _schema_error(scenario_id, "expectations.expected_errors must be array")
    return Expectations(
        should_detect=bool(data["should_detect"]),
        expected_errors=[str(e) for e in data.get("expected_errors", [])],
        max_detection_ms=int(data["max_detection_ms"]),
        allow_partial_accept=bool(data["allow_partial_accept"]),
        residual_divergence_allowed=bool(data["residual_divergence_allowed"]),
    )


def parse_scenario(raw: Dict[str, Any]) -> Scenario:
    scenario_id = str(raw.get("scenario_id", "")).strip()
    if not scenario_id:
        raise CorpusError("scenario_id is required")
    tags = [str(t) for t in raw.get("tags", [])]
    group_context = _validate_group_context(raw.get("group_context"), scenario_id)
    nodes = _validate_nodes(raw.get("nodes"), scenario_id)
    corruptions = _validate_corruptions(raw.get("corruptions"), scenario_id)
    expectations = _validate_expectations(raw.get("expectations", {}), scenario_id)
    return Scenario(
        scenario_id=scenario_id,
        tags=tags,
        group_context=group_context,
        nodes=nodes,
        corruptions=corruptions,
        expectations=expectations,
    )


def load_corpus(path: str) -> List[Scenario]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise CorpusError("corpus root must be an array")
    return [parse_scenario(entry) for entry in data]


def simulate(scenario: Scenario) -> SimulationResult:
    errors: List[str] = []
    notes: List[str] = []

    def add_error(code: str) -> None:
        if code not in errors:
            errors.append(code)

    corruptions_by_target: Dict[str, List[Corruption]] = {}
    for c in scenario.corruptions:
        target = c.target_node or "*"
        corruptions_by_target.setdefault(target, []).append(c)
        if c.type.upper() not in _ERROR_CODES:
            notes.append(f"unknown corruption type {c.type}")

    last_hash: Optional[str] = None
    hash_breaks = 0
    accepted = 0
    rejected = 0

    for node in scenario.nodes:
        # hash chain check
        if last_hash is not None and node.previous_epoch_hash != last_hash:
            add_error("HASH_CHAIN_BREAK")
            hash_breaks += 1
            rejected += 1
        else:
            accepted += 1
        last_hash = node.eare_hash

        # apply corruptions for this node
        for corr in corruptions_by_target.get(node.node_id, []) + corruptions_by_target.get("*", []):
            ctype = corr.type.upper()
            if ctype == "INVALID_SIGNATURE":
                add_error("INVALID_SIGNATURE")
            elif ctype == "INVALID_POP":
                add_error("INVALID_POP")
            elif ctype == "HASH_CHAIN_BREAK":
                add_error("HASH_CHAIN_BREAK")
                hash_breaks += 1
            elif ctype == "TRUNCATED_EARE":
                add_error("TRUNCATED_EARE")
                rejected += 1
            elif ctype == "EXTRA_FIELDS":
                add_error("EXTRA_FIELDS")
            elif ctype == "PAYLOAD_TAMPERED":
                add_error("PAYLOAD_TAMPERED")
            elif ctype == "STALE_EPOCH_REF":
                add_error("STALE_EPOCH_REF")
            elif ctype == "TAMPER_PAYLOAD":
                add_error("PAYLOAD_TAMPERED")
            elif ctype == "EXTRA_FIELDS" and corr.fields:
                add_error("EXTRA_FIELDS")
            else:
                notes.append(f"unhandled corruption {ctype}")

    detection = len(errors) > 0
    detection_ms: Optional[int] = 0 if detection else None

    metrics = {
        "chain_length": len(scenario.nodes),
        "hash_chain_breaks": hash_breaks,
        "corruptions_applied": len(scenario.corruptions),
        "accepted_nodes": accepted,
        "rejected_nodes": rejected,
    }

    return SimulationResult(
        detection=detection,
        detection_ms=detection_ms,
        errors=errors,
        metrics=metrics,
        notes=notes,
    )


def evaluate_expectations(scenario: Scenario, result: SimulationResult) -> Tuple[str, List[str]]:
    exp = scenario.expectations
    failures: List[str] = []

    if result.detection != exp.should_detect:
        failures.append("detection_mismatch")
    if exp.should_detect:
        if result.detection_ms is None:
            failures.append("missing_detection_ms")
        elif exp.max_detection_ms and result.detection_ms is not None and result.detection_ms > exp.max_detection_ms:
            failures.append("detection_sla")
    else:
        if result.detection_ms not in (None, 0):
            failures.append("unexpected_detection_ms")

    missing_errors = [code for code in exp.expected_errors if code not in result.errors]
    if missing_errors:
        failures.append("missing_expected_errors")

    if not exp.allow_partial_accept and result.metrics.get("rejected_nodes", 0) > 0:
        failures.append("partial_accept_not_allowed")

    if not exp.residual_divergence_allowed and result.metrics.get("hash_chain_breaks", 0) > 0:
        failures.append("residual_divergence")

    status = "pass" if not failures else "fail"
    return status, failures


__all__ = [
    "Scenario",
    "SimulationResult",
    "Expectations",
    "GroupContext",
    "Node",
    "Corruption",
    "load_corpus",
    "parse_scenario",
    "simulate",
    "evaluate_expectations",
    "CorpusError",
]
