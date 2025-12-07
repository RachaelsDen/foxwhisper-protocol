"""Replay storm simulator shared across languages."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class ReplayProfile:
    """Configuration for a single replay storm scenario."""

    profile_id: str
    burst_rate: float
    duration_ms: int
    alert_threshold: float = 0.5
    queue_limit: Optional[float] = None

    @classmethod
    def from_dict(cls, data: Dict[str, float]) -> "ReplayProfile":
        return cls(
            profile_id=str(data["profile_id"]),
            burst_rate=float(data["burst_rate"]),
            duration_ms=int(data["duration_ms"]),
            alert_threshold=float(data.get("alert_threshold", 0.5)),
            queue_limit=float(data["queue_limit"]) if "queue_limit" in data else None,
        )


class ReplayStormSimulator:
    """Deterministic replay storm simulator."""

    def __init__(self, window_size: int, capacity_per_ms: float, queue_limit: Optional[float] = None) -> None:
        self.window_size = max(1, window_size)
        self.capacity_per_ms = max(0.0, capacity_per_ms)
        self.queue_limit = queue_limit if queue_limit is not None else float(self.window_size * 8)

    def simulate(self, profile: ReplayProfile) -> Dict[str, Any]:
        queue_limit = profile.queue_limit or self.queue_limit
        pending = 0.0
        processed = 0.0
        dropped = 0.0
        total_generated = 0.0
        max_queue = 0.0
        latency_integral = 0.0

        for _ in range(max(0, profile.duration_ms)):
            pending += profile.burst_rate
            total_generated += profile.burst_rate

            if self.capacity_per_ms > 0:
                processed_now = min(pending, self.capacity_per_ms)
            else:
                processed_now = 0.0
            pending -= processed_now
            processed += processed_now

            overflow = max(0.0, pending - queue_limit)
            if overflow > 0:
                pending -= overflow
                dropped += overflow

            if pending > max_queue:
                max_queue = pending
            latency_integral += pending

        drop_ratio = dropped / total_generated if total_generated > 0 else 0.0
        delivery_ratio = processed / total_generated if total_generated > 0 else 0.0
        latency_penalty = latency_integral / profile.duration_ms if profile.duration_ms > 0 else latency_integral
        alert_triggered = drop_ratio >= profile.alert_threshold

        return {
            "profile_id": profile.profile_id,
            "total_generated": total_generated,
            "processed": processed,
            "dropped": dropped,
            "drop_ratio": drop_ratio,
            "delivery_ratio": delivery_ratio,
            "max_queue_depth": max_queue,
            "latency_penalty": latency_penalty,
            "alert_triggered": alert_triggered,
        }
