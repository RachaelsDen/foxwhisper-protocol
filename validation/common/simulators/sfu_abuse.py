"""Corpus-driven SFU abuse simulator (Python oracle)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple


class CorpusError(ValueError):
    pass


@dataclass
class Participant:
    pid: str
    role: str
    tokens: List[str]
    tracks: List[Dict[str, Any]]


@dataclass
class SFUContext:
    sfu_id: str
    room_id: str
    expected_participants: List[str]
    auth_mode: str


@dataclass
class Event:
    t: int
    event: str
    raw: Dict[str, Any]


@dataclass
class Expectations:
    should_detect: bool
    expected_errors: List[str]
    max_detection_ms: int
    allow_partial_accept: bool
    residual_routing_allowed: bool
    max_hijacked_tracks: int
    max_unauthorized_tracks: int
    max_key_leak_attempts: int
    max_extra_latency_ms: int
    max_false_positive_blocks: int
    max_false_negative_leaks: int


@dataclass
class Scenario:
    scenario_id: str
    tags: List[str]
    sfu_context: SFUContext
    participants: Dict[str, Participant]
    events: List[Event]
    expectations: Expectations


@dataclass
class SimulationResult:
    detection: bool
    detection_ms: Optional[int]
    errors: List[str]
    metrics: Dict[str, Any]
    notes: List[str]


ERROR_CODES = {
    "UNAUTHORIZED_SUBSCRIBE",
    "IMPERSONATION",
    "KEY_LEAK_ATTEMPT",
    "STALE_KEY_REUSE",
    "DUPLICATE_ROUTE",
    "REPLAY_TRACK",
    "HIJACKED_TRACK",
    "SIMULCAST_SPOOF",
    "BITRATE_ABUSE",
}


def _schema_error(scenario_id: str, detail: str) -> CorpusError:
    return CorpusError(f"[{scenario_id}] {detail}")


def _validate_participants(data: Any, scenario_id: str) -> Dict[str, Participant]:
    if not isinstance(data, list) or not data:
        raise _schema_error(scenario_id, "participants must be a non-empty array")
    out: Dict[str, Participant] = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise _schema_error(scenario_id, "participant entry must be object")
        pid = entry.get("id")
        if not isinstance(pid, str) or not pid:
            raise _schema_error(scenario_id, "participant id must be string")
        role = entry.get("role", "subscriber")
        tokens = entry.get("authz_tokens", [])
        tracks = entry.get("tracks", [])
        if not isinstance(tokens, list):
            raise _schema_error(scenario_id, f"participant {pid} tokens must be array")
        if not isinstance(tracks, list):
            raise _schema_error(scenario_id, f"participant {pid} tracks must be array")
        out[pid] = Participant(pid=pid, role=str(role), tokens=[str(t) for t in tokens], tracks=tracks)
    return out


def _validate_sfu_context(data: Any, scenario_id: str) -> SFUContext:
    if not isinstance(data, dict):
        raise _schema_error(scenario_id, "sfu_context must be object")
    required = ["sfu_id", "room_id", "expected_participants", "auth_mode"]
    for field in required:
        if field not in data:
            raise _schema_error(scenario_id, f"sfu_context missing {field}")
    if not isinstance(data.get("expected_participants"), list):
        raise _schema_error(scenario_id, "expected_participants must be array")
    return SFUContext(
        sfu_id=str(data["sfu_id"]),
        room_id=str(data["room_id"]),
        expected_participants=[str(p) for p in data["expected_participants"]],
        auth_mode=str(data["auth_mode"]),
    )


def _validate_events(data: Any, scenario_id: str) -> List[Event]:
    if not isinstance(data, list) or not data:
        raise _schema_error(scenario_id, "timeline must be non-empty array")
    events: List[Event] = []
    for idx, raw in enumerate(data):
        if not isinstance(raw, dict):
            raise _schema_error(scenario_id, "timeline entry must be object")
        if "event" not in raw or "t" not in raw:
            raise _schema_error(scenario_id, f"timeline[{idx}] missing event or t")
        if not isinstance(raw["t"], int):
            raise _schema_error(scenario_id, f"timeline[{idx}] t must be int")
        events.append(Event(t=int(raw["t"]), event=str(raw["event"]), raw=raw))
    events.sort(key=lambda e: (e.t, e.event))
    return events


def _validate_expectations(data: Any, scenario_id: str) -> Expectations:
    if not isinstance(data, dict):
        raise _schema_error(scenario_id, "expectations must be object")
    required = [
        "should_detect",
        "expected_errors",
        "max_detection_ms",
        "allow_partial_accept",
        "residual_routing_allowed",
        "max_hijacked_tracks",
        "max_unauthorized_tracks",
        "max_key_leak_attempts",
        "max_extra_latency_ms",
        "max_false_positive_blocks",
        "max_false_negative_leaks",
    ]
    for field in required:
        if field not in data:
            raise _schema_error(scenario_id, f"expectations missing {field}")
    return Expectations(
        should_detect=bool(data["should_detect"]),
        expected_errors=[str(e) for e in data.get("expected_errors", [])],
        max_detection_ms=int(data["max_detection_ms"]),
        allow_partial_accept=bool(data["allow_partial_accept"]),
        residual_routing_allowed=bool(data["residual_routing_allowed"]),
        max_hijacked_tracks=int(data["max_hijacked_tracks"]),
        max_unauthorized_tracks=int(data["max_unauthorized_tracks"]),
        max_key_leak_attempts=int(data["max_key_leak_attempts"]),
        max_extra_latency_ms=int(data["max_extra_latency_ms"]),
        max_false_positive_blocks=int(data["max_false_positive_blocks"]),
        max_false_negative_leaks=int(data["max_false_negative_leaks"]),
    )


def parse_scenario(raw: Dict[str, Any]) -> Scenario:
    scenario_id = str(raw.get("scenario_id", "")).strip()
    if not scenario_id:
        raise CorpusError("scenario_id is required")
    tags = [str(t) for t in raw.get("tags", [])]
    sfu_context = _validate_sfu_context(raw.get("sfu_context"), scenario_id)
    participants = _validate_participants(raw.get("participants"), scenario_id)
    events = _validate_events(raw.get("timeline"), scenario_id)
    expectations = _validate_expectations(raw.get("expectations", {}), scenario_id)
    return Scenario(
        scenario_id=scenario_id,
        tags=tags,
        sfu_context=sfu_context,
        participants=participants,
        events=events,
        expectations=expectations,
    )


def load_corpus(path: str) -> List[Scenario]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise CorpusError("corpus root must be array")
    return [parse_scenario(entry) for entry in data]


def simulate(scenario: Scenario) -> SimulationResult:
    errors: List[str] = []
    notes: List[str] = []

    def add_error(code: str) -> None:
        if code not in errors:
            errors.append(code)

    authed: Set[str] = set()
    room_expected = set(scenario.sfu_context.expected_participants)
    key_leak_attempts = 0
    hijacked_tracks = 0
    unauthorized_tracks = 0
    replayed_tracks = 0
    duplicate_routes = 0
    simulcast_spoofs = 0
    bitrate_abuse_events = 0
    false_positive_blocks = 0
    false_negative_leaks = 0
    affected_participants: Set[str] = set()

    routes: Dict[str, str] = {}  # track_id -> participant id
    track_layers: Dict[str, List[str]] = {}

    detection_time: Optional[int] = None

    for ev in scenario.events:
        e = ev.event
        payload = ev.raw
        t = ev.t

        # join
        if e == "join":
            pid = payload.get("participant")
            token = payload.get("token")
            if pid not in scenario.participants:
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1
            else:
                part = scenario.participants[pid]
                if token not in part.tokens:
                    add_error("IMPERSONATION")
                else:
                    authed.add(pid)

        elif e == "publish":
            pid = payload.get("participant")
            track_id = payload.get("track_id")
            layers = payload.get("layers", [])
            if not isinstance(pid, str) or not isinstance(track_id, str):
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1
            elif pid not in authed:
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1
            else:
                routes[track_id] = pid
                track_layers[track_id] = layers if isinstance(layers, list) else []

        elif e == "subscribe":
            pid = payload.get("participant")
            track_id = payload.get("track_id")
            if not isinstance(pid, str) or not isinstance(track_id, str):
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1
            elif pid not in authed:
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1
            elif track_id not in routes:
                add_error("UNAUTHORIZED_SUBSCRIBE")
                unauthorized_tracks += 1

        elif e == "ghost_subscribe":
            pid = payload.get("participant")
            track_id = payload.get("track_id")
            add_error("UNAUTHORIZED_SUBSCRIBE")
            unauthorized_tracks += 1
            affected_participants.add(pid or "ghost")

        elif e == "impersonate":
            pid = payload.get("participant")
            add_error("IMPERSONATION")
            affected_participants.add(pid or "unknown")

        elif e == "replay_track":
            track_id = payload.get("track_id")
            if track_id in routes:
                add_error("REPLAY_TRACK")
                replayed_tracks += 1

        elif e == "dup_track":
            track_id = payload.get("track_id")
            if track_id in routes:
                add_error("DUPLICATE_ROUTE")
                duplicate_routes += 1

        elif e == "simulcast_spoof":
            track_id_val = payload.get("track_id")
            requested_layers = payload.get("requested_layers", [])
            allowed = track_layers.get(track_id_val, []) if isinstance(track_id_val, str) else []
            if any(layer not in allowed for layer in requested_layers):
                add_error("SIMULCAST_SPOOF")
                simulcast_spoofs += 1

        elif e == "bitrate_abuse":
            add_error("BITRATE_ABUSE")
            bitrate_abuse_events += 1

        elif e == "key_rotation_skip" or e == "stale_key_reuse":
            add_error("STALE_KEY_REUSE")
            key_leak_attempts += 1

        elif e == "steal_key":
            add_error("KEY_LEAK_ATTEMPT")
            key_leak_attempts += 1

        # latency impact / detection time
        if errors and detection_time is None:
            detection_time = t

    metrics = {
        "unauthorized_tracks": unauthorized_tracks,
        "hijacked_tracks": hijacked_tracks,
        "impersonation_attempts": 1 if "IMPERSONATION" in errors else 0,
        "key_leak_attempts": key_leak_attempts,
        "duplicate_routes": duplicate_routes,
        "replayed_tracks": replayed_tracks,
        "simulcast_spoofs": simulcast_spoofs,
        "bitrate_abuse_events": bitrate_abuse_events,
        "accepted_tracks": len([k for k, v in routes.items() if v]),
        "rejected_tracks": unauthorized_tracks,
        "false_positive_blocks": false_positive_blocks,
        "false_negative_leaks": false_negative_leaks,
        "max_extra_latency_ms": detection_time if detection_time is not None else 0,
        "affected_participant_count": len(affected_participants),
    }

    detection = len(errors) > 0
    detection_ms = detection_time

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

    if result.metrics.get("hijacked_tracks", 0) > exp.max_hijacked_tracks:
        failures.append("hijacked_tracks_exceeded")
    if result.metrics.get("unauthorized_tracks", 0) > exp.max_unauthorized_tracks:
        failures.append("unauthorized_tracks_exceeded")
    if result.metrics.get("key_leak_attempts", 0) > exp.max_key_leak_attempts:
        failures.append("key_leak_exceeded")
    if result.metrics.get("max_extra_latency_ms", 0) > exp.max_extra_latency_ms:
        failures.append("latency_exceeded")
    if result.metrics.get("false_positive_blocks", 0) > exp.max_false_positive_blocks:
        failures.append("false_positive_blocks_exceeded")
    if result.metrics.get("false_negative_leaks", 0) > exp.max_false_negative_leaks:
        failures.append("false_negative_leaks_exceeded")

    if not exp.residual_routing_allowed and result.metrics.get("duplicate_routes", 0) > 0:
        failures.append("residual_routing")

    status = "pass" if not failures else "fail"
    return status, failures


__all__ = [
    "Scenario",
    "SimulationResult",
    "Expectations",
    "SFUContext",
    "Participant",
    "Event",
    "load_corpus",
    "parse_scenario",
    "simulate",
    "evaluate_expectations",
    "CorpusError",
]
