"""Deterministic multi-device desynchronization simulator (Python oracle)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


class CorpusError(ValueError):
    pass


@dataclass
class Device:
    device_id: str
    dr_version: int
    clock_ms: int = 0
    state_hash: Optional[str] = None
    notes: List[str] = field(default_factory=list)


@dataclass
class MessageEnvelope:
    msg_id: str
    sender: str
    targets: List[str]
    dr_version: int
    state_hash: Optional[str]
    send_time: int
    delivered: Set[str] = field(default_factory=set)
    dropped: Set[str] = field(default_factory=set)
    replay_count: int = 0


@dataclass
class Event:
    t: int
    event: str
    raw: Dict[str, Any]


@dataclass
class Expectations:
    detected: bool
    max_detection_ms: int
    max_recovery_ms: int
    healing_required: bool
    residual_divergence_allowed: bool
    max_dr_version_delta: int
    max_clock_skew_ms: int
    allow_message_loss_rate: float
    allow_out_of_order_rate: float
    expected_error_categories: List[str]
    max_rollback_events: int


@dataclass
class Scenario:
    scenario_id: str
    tags: List[str]
    devices: Dict[str, Device]
    events: List[Event]
    expectations: Expectations


@dataclass
class SimulationResult:
    detection: bool
    detection_ms: Optional[int]
    recovery_ms: Optional[int]
    max_dr_version_delta: int
    avg_dr_version_delta: float
    max_clock_skew_ms: int
    diverged_device_count: int
    max_diverged_device_count: int
    delivered_messages: int
    expected_messages: int
    message_loss_rate: float
    out_of_order_deliveries: int
    out_of_order_rate: float
    skew_violations: int
    recovery_attempts: int
    successful_recoveries: int
    failed_recoveries: int
    max_rollback_events: int
    residual_divergence: bool
    errors: List[str]
    notes: List[str]
    metrics: Dict[str, Any]


def _schema_error(scenario_id: str, detail: str) -> CorpusError:
    return CorpusError(f"[{scenario_id}] {detail}")


def _validate_devices(data: Any, scenario_id: str) -> Dict[str, Device]:
    if not isinstance(data, list) or not data:
        raise _schema_error(scenario_id, "devices must be a non-empty array")
    devices: Dict[str, Device] = {}
    for entry in data:
        if not isinstance(entry, dict):
            raise _schema_error(scenario_id, "device entry must be an object")
        device_id = entry.get("device_id")
        if not isinstance(device_id, str) or not device_id:
            raise _schema_error(scenario_id, "device_id must be a non-empty string")
        if device_id in devices:
            raise _schema_error(scenario_id, f"duplicate device_id {device_id}")
        dr_version = entry.get("dr_version")
        clock_ms = entry.get("clock_ms", 0)
        state_hash = entry.get("state_hash")
        if not isinstance(dr_version, int):
            raise _schema_error(scenario_id, f"device {device_id} dr_version must be integer")
        if not isinstance(clock_ms, int):
            raise _schema_error(scenario_id, f"device {device_id} clock_ms must be integer")
        if state_hash is not None and not isinstance(state_hash, str):
            raise _schema_error(scenario_id, f"device {device_id} state_hash must be string or null")
        devices[device_id] = Device(device_id=device_id, dr_version=dr_version, clock_ms=clock_ms, state_hash=state_hash)
    return devices


def _validate_events(data: Any, scenario_id: str) -> List[Event]:
    if not isinstance(data, list) or not data:
        raise _schema_error(scenario_id, "timeline must be a non-empty array")
    events: List[Event] = []
    for idx, raw in enumerate(data):
        if not isinstance(raw, dict):
            raise _schema_error(scenario_id, "timeline entry must be an object")
        if "event" not in raw or not isinstance(raw["event"], str):
            raise _schema_error(scenario_id, f"timeline[{idx}] missing event string")
        if "t" not in raw or not isinstance(raw["t"], int):
            raise _schema_error(scenario_id, f"timeline[{idx}] missing integer t")
        events.append(Event(t=int(raw["t"]), event=str(raw["event"]), raw=raw))
    events.sort(key=lambda e: (e.t, e.event))
    return events


def _validate_expectations(data: Any, scenario_id: str) -> Expectations:
    if not isinstance(data, dict):
        raise _schema_error(scenario_id, "expectations must be an object")
    required = [
        "detected",
        "max_detection_ms",
        "max_recovery_ms",
        "healing_required",
        "residual_divergence_allowed",
        "max_dr_version_delta",
        "max_clock_skew_ms",
        "allow_message_loss_rate",
        "allow_out_of_order_rate",
        "expected_error_categories",
        "max_rollback_events",
    ]
    for field in required:
        if field not in data:
            raise _schema_error(scenario_id, f"expectations missing {field}")
    if not isinstance(data["detected"], bool):
        raise _schema_error(scenario_id, "expectations.detected must be boolean")
    if not isinstance(data["healing_required"], bool):
        raise _schema_error(scenario_id, "expectations.healing_required must be boolean")
    if not isinstance(data["residual_divergence_allowed"], bool):
        raise _schema_error(scenario_id, "expectations.residual_divergence_allowed must be boolean")
    int_fields = ["max_detection_ms", "max_recovery_ms", "max_dr_version_delta", "max_clock_skew_ms", "max_rollback_events"]
    for field in int_fields:
        if not isinstance(data[field], int):
            raise _schema_error(scenario_id, f"expectations.{field} must be integer")
    float_fields = ["allow_message_loss_rate", "allow_out_of_order_rate"]
    for field in float_fields:
        if not isinstance(data[field], (int, float)):
            raise _schema_error(scenario_id, f"expectations.{field} must be number")
    expected_error_categories = data.get("expected_error_categories", [])
    if not isinstance(expected_error_categories, list) or any(not isinstance(item, str) for item in expected_error_categories):
        raise _schema_error(scenario_id, "expectations.expected_error_categories must be array of strings")

    return Expectations(
        detected=bool(data["detected"]),
        max_detection_ms=int(data["max_detection_ms"]),
        max_recovery_ms=int(data["max_recovery_ms"]),
        healing_required=bool(data["healing_required"]),
        residual_divergence_allowed=bool(data["residual_divergence_allowed"]),
        max_dr_version_delta=int(data["max_dr_version_delta"]),
        max_clock_skew_ms=int(data["max_clock_skew_ms"]),
        allow_message_loss_rate=float(data["allow_message_loss_rate"]),
        allow_out_of_order_rate=float(data["allow_out_of_order_rate"]),
        expected_error_categories=list(expected_error_categories),
        max_rollback_events=int(data["max_rollback_events"]),
    )


def parse_scenario(raw: Dict[str, Any]) -> Scenario:
    scenario_id = str(raw.get("scenario_id", "")).strip()
    if not scenario_id:
        raise CorpusError("scenario_id is required")
    tags = [str(tag) for tag in raw.get("tags", [])]
    devices = _validate_devices(raw.get("devices"), scenario_id)
    events = _validate_events(raw.get("timeline"), scenario_id)
    expectations = _validate_expectations(raw.get("expectations", {}), scenario_id)
    return Scenario(scenario_id=scenario_id, tags=tags, devices=devices, events=events, expectations=expectations)


def load_corpus(path: str) -> List[Scenario]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise CorpusError("Corpus root must be a list of scenarios")
    return [parse_scenario(entry) for entry in data]


def _current_dr_stats(devices: Dict[str, Device]) -> Tuple[int, int, int]:
    versions = [device.dr_version for device in devices.values()]
    min_ver = min(versions)
    max_ver = max(versions)
    return min_ver, max_ver, max_ver - min_ver


def _state_hash_divergence(devices: Dict[str, Device]) -> bool:
    hashes = {device.state_hash for device in devices.values() if device.state_hash is not None}
    return len(hashes) > 1


def _max_clock_skew(devices: Dict[str, Device]) -> int:
    clocks = [device.clock_ms for device in devices.values()]
    return max(clocks) - min(clocks) if clocks else 0


def simulate(scenario: Scenario) -> SimulationResult:
    devices = {k: Device(**vars(v)) for k, v in scenario.devices.items()}
    messages: Dict[str, MessageEnvelope] = {}

    detection_time: Optional[int] = None
    divergence_start: Optional[int] = None
    recovery_time: Optional[int] = None

    delivered_messages = 0
    expected_messages = 0
    dropped_messages = 0
    out_of_order = 0
    dr_delta_integral = 0
    dr_samples = 0
    max_dr_delta = 0
    max_diverged_device_count = 0
    max_clock_skew_ms = _max_clock_skew(devices)
    skew_violations = 0
    recovery_attempts = 0
    successful_recoveries = 0
    failed_recoveries = 0
    max_rollback_events = 0
    errors: List[str] = []
    notes: List[str] = []

    def mark_error(code: str, at: Optional[int] = None) -> None:
        nonlocal detection_time
        if code not in errors:
            errors.append(code)
        if detection_time is None and at is not None:
            detection_time = at

    for event in sorted(scenario.events, key=lambda ev: (ev.t, ev.event)):
        kind = event.event
        payload = event.raw

        # Keep clocks roughly aligned to timeline time
        for dev in devices.values():
            dev.clock_ms = max(dev.clock_ms, event.t)

        if kind == "send":
            msg_id = payload.get("msg_id")
            sender = payload.get("from")
            targets = payload.get("to", [])
            dr_version = payload.get("dr_version")
            state_hash = payload.get("state_hash")
            if not isinstance(msg_id, str) or not isinstance(sender, str) or not isinstance(targets, list):
                raise CorpusError(f"[{scenario.scenario_id}] invalid send event")
            if sender not in devices:
                raise CorpusError(f"[{scenario.scenario_id}] send references unknown device {sender}")
            if msg_id not in messages:
                messages[msg_id] = MessageEnvelope(
                    msg_id=msg_id,
                    sender=sender,
                    targets=[str(t) for t in targets],
                    dr_version=int(dr_version) if dr_version is not None else devices[sender].dr_version,
                    state_hash=state_hash if isinstance(state_hash, str) else None,
                    send_time=event.t,
                )
            else:
                messages[msg_id].replay_count += 1
            expected_messages += len(targets)
            sender_state = devices.get(sender)
            if sender_state:
                new_ver = int(dr_version) if dr_version is not None else sender_state.dr_version
                if new_ver < sender_state.dr_version:
                    max_rollback_events = max(max_rollback_events, sender_state.dr_version - new_ver)
                sender_state.dr_version = new_ver
                if isinstance(state_hash, str):
                    sender_state.state_hash = state_hash

        elif kind == "recv":
            msg_id = payload.get("msg_id")
            device_id = payload.get("device")
            if msg_id not in messages or device_id not in devices:
                mark_error("UNKNOWN_MESSAGE", event.t)
            if msg_id in messages and device_id in devices:
                envelope = messages[msg_id]
                if device_id in envelope.delivered:
                    mark_error("DUPLICATE_DELIVERY")
                if event.t < envelope.send_time:
                    out_of_order += 1
                envelope.delivered.add(device_id)
                delivered_messages += 1
                apply_ver = payload.get("apply_dr_version")
                apply_hash = payload.get("state_hash")
                dev = devices[device_id]
                if apply_ver is not None:
                    apply_ver = int(apply_ver)
                    if apply_ver < dev.dr_version:
                        max_rollback_events = max(max_rollback_events, dev.dr_version - apply_ver)
                    dev.dr_version = apply_ver
                if isinstance(apply_hash, str):
                    dev.state_hash = apply_hash

        elif kind == "drop":
            msg_id = payload.get("msg_id")
            targets = payload.get("targets")
            if msg_id not in messages:
                mark_error("UNKNOWN_MESSAGE", event.t)
            else:
                envelope = messages[msg_id]
                target_list = [str(t) for t in targets] if isinstance(targets, list) else envelope.targets
                envelope.dropped.update(target_list)
                dropped_messages += len(target_list)

        elif kind == "replay":
            msg_id = payload.get("msg_id")
            sender = payload.get("from")
            targets = [str(t) for t in payload.get("to", [])]
            dr_version = payload.get("dr_version")
            if not isinstance(msg_id, str) or not isinstance(sender, str):
                raise CorpusError(f"[{scenario.scenario_id}] invalid replay event")
            if sender not in devices:
                raise CorpusError(f"[{scenario.scenario_id}] replay references unknown device {sender}")
            if msg_id not in messages:
                messages[msg_id] = MessageEnvelope(
                    msg_id=msg_id,
                    sender=sender,
                    targets=targets,
                    dr_version=int(dr_version) if dr_version is not None else devices[sender].dr_version,
                    state_hash=None,
                    send_time=event.t,
                    replay_count=1,
                )
            else:
                messages[msg_id].replay_count += 1
            expected_messages += len(targets)
            mark_error("REPLAY_INJECTED", event.t)

        elif kind == "backup_restore":
            device_id = payload.get("device")
            new_version = payload.get("dr_version")
            state_hash = payload.get("state_hash")
            if device_id not in devices or not isinstance(new_version, int):
                raise CorpusError(f"[{scenario.scenario_id}] invalid backup_restore event")
            dev = devices[device_id]
            if new_version < dev.dr_version:
                max_rollback_events = max(max_rollback_events, dev.dr_version - new_version)
                mark_error("ROLLBACK_APPLIED")
            dev.dr_version = new_version
            if isinstance(state_hash, str):
                dev.state_hash = state_hash

        elif kind == "clock_skew":
            device_id = payload.get("device")
            delta = payload.get("delta_ms")
            if device_id not in devices or not isinstance(delta, int):
                raise CorpusError(f"[{scenario.scenario_id}] invalid clock_skew event")
            devices[device_id].clock_ms += delta
            max_clock_skew_ms = max(max_clock_skew_ms, _max_clock_skew(devices))
            if max_clock_skew_ms > scenario.expectations.max_clock_skew_ms:
                skew_violations += 1
                mark_error("CLOCK_SKEW_VIOLATION", event.t)

        elif kind == "resync":
            device_id = payload.get("device")
            target_version = payload.get("target_dr_version")
            state_hash = payload.get("state_hash")
            if device_id not in devices or not isinstance(target_version, int):
                raise CorpusError(f"[{scenario.scenario_id}] invalid resync event")
            dev = devices[device_id]
            recovery_attempts += 1
            before_delta = _current_dr_stats(devices)[2]
            if target_version < dev.dr_version:
                max_rollback_events = max(max_rollback_events, dev.dr_version - target_version)
            dev.dr_version = target_version
            if isinstance(state_hash, str):
                dev.state_hash = state_hash
            after_delta = _current_dr_stats(devices)[2]
            if after_delta == 0:
                successful_recoveries += 1
            elif after_delta < before_delta:
                notes.append(f"resync on {device_id} reduced divergence")
            else:
                failed_recoveries += 1

        else:
            raise CorpusError(f"[{scenario.scenario_id}] unsupported event type {kind}")

        # Update divergence metrics after applying the event
        min_ver, max_ver, dr_delta = _current_dr_stats(devices)
        dr_delta_integral += dr_delta
        dr_samples += 1
        max_dr_delta = max(max_dr_delta, dr_delta)

        divergence_active = dr_delta > 0
        if divergence_active and divergence_start is None:
            divergence_start = event.t
            detection_time = detection_time or event.t
        if divergence_active:
            if "DIVERGENCE_DETECTED" not in errors:
                errors.append("DIVERGENCE_DETECTED")
        if divergence_active is False and divergence_start is not None and recovery_time is None:
            recovery_time = event.t

        divergent_devices = {dev_id for dev_id, dev in devices.items() if dev.dr_version != min_ver}
        max_diverged_device_count = max(max_diverged_device_count, len(divergent_devices))

        # Track clock skew for each step
        max_clock_skew_ms = max(max_clock_skew_ms, _max_clock_skew(devices))

    if divergence_start is None and errors:
        if scenario.events:
            divergence_start = scenario.events[0].t
            detection_time = detection_time or scenario.events[0].t
        else:
            divergence_start = 0
            detection_time = detection_time or 0

    residual_divergence = _current_dr_stats(devices)[2] > 0
    detection = divergence_start is not None or bool(errors)
    detection_ms = None
    if detection_time is not None and divergence_start is not None:
        detection_ms = max(0, detection_time - divergence_start)
    recovery_ms = None
    if recovery_time is not None and detection_time is not None:
        recovery_ms = max(0, recovery_time - detection_time)

    message_loss_rate = 0.0
    if expected_messages > 0:
        message_loss_rate = max(0.0, (expected_messages - delivered_messages) / expected_messages)
    out_of_order_rate = 0.0
    if delivered_messages > 0:
        out_of_order_rate = out_of_order / delivered_messages

    avg_dr_delta = float(dr_delta_integral) / dr_samples if dr_samples else 0.0

    if message_loss_rate > 0:
        mark_error("MESSAGE_LOSS")
    if out_of_order > 0:
        mark_error("OUT_OF_ORDER")

    min_ver_for_metrics, _, _ = _current_dr_stats(devices)

    metrics = {
        "max_dr_version_delta": max_dr_delta,
        "avg_dr_version_delta": avg_dr_delta,
        "max_clock_skew_ms": max_clock_skew_ms,
        "diverged_device_count": len({dev.device_id for dev in devices.values() if dev.dr_version != min_ver_for_metrics}),
        "max_diverged_device_count": max_diverged_device_count,
        "delivered_messages": delivered_messages,
        "expected_messages": expected_messages,
        "message_loss_rate": message_loss_rate,
        "out_of_order_deliveries": out_of_order,
        "out_of_order_rate": out_of_order_rate,
        "skew_violations": skew_violations,
        "recovery_attempts": recovery_attempts,
        "successful_recoveries": successful_recoveries,
        "failed_recoveries": failed_recoveries,
        "max_rollback_events": max_rollback_events,
        "residual_divergence": residual_divergence,
    }

    return SimulationResult(
        detection=detection,
        detection_ms=detection_ms,
        recovery_ms=recovery_ms,
        max_dr_version_delta=max_dr_delta,
        avg_dr_version_delta=avg_dr_delta,
        max_clock_skew_ms=max_clock_skew_ms,
        diverged_device_count=metrics["diverged_device_count"],
        max_diverged_device_count=max_diverged_device_count,
        delivered_messages=delivered_messages,
        expected_messages=expected_messages,
        message_loss_rate=message_loss_rate,
        out_of_order_deliveries=out_of_order,
        out_of_order_rate=out_of_order_rate,
        skew_violations=skew_violations,
        recovery_attempts=recovery_attempts,
        successful_recoveries=successful_recoveries,
        failed_recoveries=failed_recoveries,
        max_rollback_events=max_rollback_events,
        residual_divergence=residual_divergence,
        errors=errors,
        notes=notes,
        metrics=metrics,
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

    if exp.healing_required:
        if result.recovery_ms is None:
            failures.append("missing_recovery_ms")
        elif exp.max_recovery_ms and result.recovery_ms > exp.max_recovery_ms:
            failures.append("recovery_sla")
        if not exp.residual_divergence_allowed and result.residual_divergence:
            failures.append("residual_divergence")

    if result.max_dr_version_delta > exp.max_dr_version_delta:
        failures.append("dr_delta_exceeded")

    if result.max_clock_skew_ms > exp.max_clock_skew_ms:
        failures.append("clock_skew_exceeded")

    if result.message_loss_rate > exp.allow_message_loss_rate:
        failures.append("message_loss_rate")

    if result.out_of_order_rate > exp.allow_out_of_order_rate:
        failures.append("out_of_order_rate")

    if result.max_rollback_events > exp.max_rollback_events:
        failures.append("rollback_exceeded")

    missing_errors = [code for code in exp.expected_error_categories if code not in result.errors]
    if missing_errors:
        failures.append("missing_error_categories")

    status = "pass" if not failures else "fail"
    return status, failures


__all__ = [
    "Scenario",
    "SimulationResult",
    "Expectations",
    "Event",
    "Device",
    "MessageEnvelope",
    "load_corpus",
    "parse_scenario",
    "simulate",
    "evaluate_expectations",
    "CorpusError",
]
