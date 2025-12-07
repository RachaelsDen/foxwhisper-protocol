"""Deterministic epoch-fork simulator and corpus parser."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class EpochNode:
    node_id: str
    epoch_id: int
    eare_hash: str
    previous_epoch_hash: Optional[str]
    membership_digest: Optional[str]
    parent_id: Optional[str]
    issued_by: str
    timestamp_ms: int


@dataclass
class EpochEdge:
    source: str
    target: str
    edge_type: str


@dataclass
class Event:
    t: int
    event: str
    controller: Optional[str] = None
    epoch_id: Optional[int] = None
    node_id: Optional[str] = None
    participants: Optional[List[str]] = None
    reconcile_strategy: Optional[str] = None
    count: Optional[int] = None
    faults: List[str] = field(default_factory=list)


@dataclass
class AllowReplayGap:
    max_messages: int
    max_ms: int


@dataclass
class Expectations:
    detected: bool
    detection_reference: str
    max_detection_ms: int
    max_reconciliation_ms: int
    reconciled_epoch: Tuple[int, str]
    allow_replay_gap: AllowReplayGap
    expected_error_categories: List[str]
    healing_required: bool


@dataclass
class Scenario:
    scenario_id: str
    group_context: Dict[str, Any]
    nodes: Dict[str, EpochNode]
    edges: List[EpochEdge]
    events: List[Event]
    expectations: Expectations
    tags: List[str]


@dataclass
class SimulationResult:
    detection: bool
    detection_ms: Optional[int]
    reconciliation_ms: Optional[int]
    winning_epoch_id: Optional[int]
    winning_hash: Optional[str]
    winning_node_id: Optional[str]
    messages_dropped: int
    healing_actions: List[str]
    errors: List[str]
    false_positives: Dict[str, int]
    notes: List[str]


class CorpusError(ValueError):
    pass


def _parse_faults(raw: Optional[List[str]]) -> List[str]:
    if not raw:
        return []
    return [str(item) for item in raw]


def load_corpus(path: str) -> List[Scenario]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise CorpusError("Corpus root must be a list of scenarios")
    return [parse_scenario(obj) for obj in data]


def parse_scenario(data: Dict[str, Any]) -> Scenario:
    scenario_id = str(data.get("scenario_id", ""))
    if not scenario_id:
        raise CorpusError("scenario_id is required")

    tags = [str(t) for t in data.get("tags", [])]

    raw_nodes = data.get("graph", {}).get("nodes", [])
    nodes: Dict[str, EpochNode] = {}
    for node_data in raw_nodes:
        node_id = str(node_data["node_id"])
        if node_id in nodes:
            raise CorpusError(f"Duplicate node_id {node_id} in scenario {scenario_id}")
        nodes[node_id] = EpochNode(
            node_id=node_id,
            epoch_id=int(node_data["epoch_id"]),
            eare_hash=str(node_data["eare_hash"]),
            previous_epoch_hash=node_data.get("previous_epoch_hash"),
            membership_digest=node_data.get("membership_digest"),
            parent_id=node_data.get("parent_id"),
            issued_by=str(node_data.get("issued_by", "")),
            timestamp_ms=int(node_data.get("timestamp_ms", 0)),
        )

    raw_edges = data.get("graph", {}).get("edges", [])
    edges: List[EpochEdge] = []
    for edge in raw_edges:
        src = edge.get("from")
        tgt = edge.get("to")
        if src not in nodes or tgt not in nodes:
            raise CorpusError(f"Edge references unknown node in scenario {scenario_id}")
        edges.append(EpochEdge(source=str(src), target=str(tgt), edge_type=str(edge.get("type", "linear"))))

    raw_events = data.get("event_stream", [])
    events: List[Event] = []
    for ev in raw_events:
        events.append(
            Event(
                t=int(ev.get("t", 0)),
                event=str(ev.get("event")),
                controller=ev.get("controller"),
                epoch_id=ev.get("epoch_id"),
                node_id=ev.get("node_id"),
                participants=ev.get("participants"),
                reconcile_strategy=ev.get("reconcile_strategy"),
                count=ev.get("count"),
                faults=_parse_faults(ev.get("faults")),
            )
        )

    exp_raw = data.get("expectations", {})
    allow = exp_raw.get("allow_replay_gap", {})
    expectations = Expectations(
        detected=bool(exp_raw.get("detected", False)),
        detection_reference=str(exp_raw.get("detection_reference", "fork_created")),
        max_detection_ms=int(exp_raw.get("max_detection_ms", 0)),
        max_reconciliation_ms=int(exp_raw.get("max_reconciliation_ms", 0)),
        reconciled_epoch=(
            int(exp_raw.get("reconciled_epoch", {}).get("epoch_id", 0)),
            str(exp_raw.get("reconciled_epoch", {}).get("eare_hash", "")),
        ),
        allow_replay_gap=AllowReplayGap(
            max_messages=int(allow.get("max_messages", 0)),
            max_ms=int(allow.get("max_ms", 0)),
        ),
        expected_error_categories=[str(err) for err in exp_raw.get("expected_error_categories", [])],
        healing_required=bool(exp_raw.get("healing_required", False)),
    )

    # Validate parent references
    for node in nodes.values():
        if node.parent_id and node.parent_id not in nodes:
            raise CorpusError(f"Node {node.node_id} references unknown parent {node.parent_id}")

    return Scenario(
        scenario_id=scenario_id,
        group_context=dict(data.get("group_context", {})),
        nodes=nodes,
        edges=edges,
        events=events,
        expectations=expectations,
        tags=tags,
    )


def _depth(node_id: str, nodes: Dict[str, EpochNode]) -> int:
    depth = 0
    cursor = nodes.get(node_id)
    seen: set[str] = set()
    while cursor and cursor.parent_id:
        if cursor.node_id in seen:
            break
        seen.add(cursor.node_id)
        depth += 1
        cursor = nodes.get(cursor.parent_id)
    return depth


def _fault_delay_ms(faults: List[str]) -> int:
    for fault in faults:
        if fault.startswith("delay_validation:"):
            try:
                return int(fault.split(":", 1)[1])
            except ValueError:
                return 0
    return 0


def _fault_drop(faults: List[str]) -> bool:
    return any(f == "drop_next_eare" for f in faults)


def simulate(scenario: Scenario) -> SimulationResult:
    # Sort events deterministically
    events = sorted(enumerate(scenario.events), key=lambda kv: (kv[1].t, kv[0]))

    observed_hashes: Dict[int, List[Tuple[str, str]]] = {}
    children_by_parent: Dict[str, List[Tuple[int, str, str]]] = {}
    detection_time: Optional[int] = None
    detection = False
    errors: List[str] = []
    messages_dropped = 0
    fork_created_time: Optional[int] = None
    winning_node_id: Optional[str] = None

    for _, ev in events:
        if ev.event == "epoch_issue":
            if _fault_drop(ev.faults):
                continue
            if ev.node_id not in scenario.nodes:
                raise CorpusError(f"Unknown node_id {ev.node_id} in scenario {scenario.scenario_id}")
            node = scenario.nodes[ev.node_id]
            epoch_entries = observed_hashes.setdefault(node.epoch_id, [])
            known_hashes = {h for _, h in epoch_entries}
            parent_children = children_by_parent.setdefault(node.parent_id or "", [])
            parent_hashes = {(e_id, h) for e_id, _, h in parent_children}

            fork_detected = False
            # Fork on same epoch_id with differing hashes
            if node.eare_hash not in known_hashes and len(epoch_entries) >= 1:
                fork_detected = True
            # Fork on divergent children from same parent even if epoch_id differs
            if node.parent_id is not None:
                already = {(e_id, h) for e_id, _, h in parent_children}
                if (node.epoch_id, node.eare_hash) not in already and len(parent_children) >= 1:
                    fork_detected = True

            epoch_entries.append((node.node_id, node.eare_hash))
            parent_children.append((node.epoch_id, node.node_id, node.eare_hash))

            if fork_detected:
                fork_created_time = fork_created_time or ev.t
                if detection_time is None:
                    detection_time = ev.t + _fault_delay_ms(ev.faults)
                    detection = True
                    if "EPOCH_FORK_DETECTED" not in errors:
                        errors.append("EPOCH_FORK_DETECTED")

            # Hash-chain integrity check
            if node.previous_epoch_hash and node.parent_id:
                parent = scenario.nodes.get(node.parent_id)
                if parent and parent.eare_hash != node.previous_epoch_hash:
                    if "HASH_CHAIN_BREAK" not in errors:
                        errors.append("HASH_CHAIN_BREAK")
        elif ev.event == "replay_attempt" and ev.count:
            messages_dropped += int(ev.count)

    # Choose winning branch (prefer longest depth, then earliest timestamp)
    winning_epoch_id = None
    winning_hash = None
    if observed_hashes:
        def key_fn(entry: Tuple[str, str]) -> Tuple[int, int, int, str]:
            node_id, e_hash = entry
            node = scenario.nodes[node_id]
            return (_depth(node_id, scenario.nodes), node.epoch_id, -node.timestamp_ms, e_hash)

        all_entries: List[Tuple[str, str]] = []
        for _, entries in observed_hashes.items():
            all_entries.extend(entries)
        if all_entries:
            all_entries.sort(key=key_fn, reverse=True)
            winning_node_id, winning_hash = all_entries[0]
            winning_epoch_id = scenario.nodes[winning_node_id].epoch_id

    detection_reference_time = None
    if scenario.expectations.detection_reference == "fork_observable":
        detection_reference_time = detection_time if detection_time is not None else None
    else:  # fork_created or default
        detection_reference_time = fork_created_time if fork_created_time is not None else detection_time

    detection_ms = None
    if detection_time is not None and detection_reference_time is not None:
        detection_ms = max(0, detection_time - detection_reference_time)

    # Reconciliation
    reconciliation_ms: Optional[int] = None
    merge_event_time = next((ev.t for _, ev in events if ev.event == "merge"), None)
    if detection_time is not None and merge_event_time is not None:
        reconciliation_ms = max(0, merge_event_time - detection_time)

    false_positives = {"warnings": 0, "hard_errors": 0}
    healing_actions: List[str] = []
    notes: List[str] = []

    return SimulationResult(
        detection=detection,
        detection_ms=detection_ms,
        reconciliation_ms=reconciliation_ms,
        winning_epoch_id=winning_epoch_id,
        winning_hash=winning_hash,
        winning_node_id=winning_node_id,
        messages_dropped=messages_dropped,
        healing_actions=healing_actions,
        errors=errors,
        false_positives=false_positives,
        notes=notes,
    )


def evaluate_expectations(scenario: Scenario, result: SimulationResult) -> Tuple[str, List[str]]:
    exp = scenario.expectations
    failures: List[str] = []

    if result.detection != exp.detected:
        failures.append("detection_mismatch")
    if exp.detected:
        if result.detection_ms is None:
            failures.append("missing_detection_ms")
        elif exp.max_detection_ms and result.detection_ms > exp.max_detection_ms:
            failures.append("detection_sla")
    else:
        if result.detection_ms not in (None, 0):
            failures.append("unexpected_detection_ms")

    # Compare reconciled epoch using hash identity
    expected_epoch_id, expected_hash = exp.reconciled_epoch
    if expected_hash and result.winning_hash and expected_hash != result.winning_hash:
        failures.append("winning_hash_mismatch")
    if expected_epoch_id and result.winning_epoch_id and expected_epoch_id != result.winning_epoch_id:
        failures.append("winning_epoch_mismatch")

    if exp.healing_required:
        if result.reconciliation_ms is None:
            failures.append("missing_reconciliation")
        elif exp.max_reconciliation_ms and result.reconciliation_ms > exp.max_reconciliation_ms:
            failures.append("reconciliation_sla")
    # allow missing reconciliation when healing is not required

    # replay gap checks
    if exp.allow_replay_gap.max_messages and result.messages_dropped > exp.allow_replay_gap.max_messages:
        failures.append("replay_gap_messages")
    # Time-based replay gap enforcement would require timestamps; skipped for now.

    # error categories
    missing_errors = [err for err in exp.expected_error_categories if err not in result.errors]
    if missing_errors:
        failures.append("missing_error_categories")

    status = "pass" if not failures else "fail"
    return status, failures


__all__ = [
    "Scenario",
    "SimulationResult",
    "load_corpus",
    "simulate",
    "evaluate_expectations",
    "CorpusError",
]
