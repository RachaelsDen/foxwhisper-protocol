"""Epoch fork fuzzer/coordinator for deterministic CI runs."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from validation.common.simulators import epoch as epoch_mod  # type: ignore[import]

CorpusError = epoch_mod.CorpusError
evaluate_expectations = epoch_mod.evaluate_expectations
load_corpus = epoch_mod.load_corpus
simulate = epoch_mod.simulate

DEFAULT_CORPUS = Path("tests/common/adversarial/epoch_forks.json")
DEFAULT_SUMMARY = Path("results/epoch_fork_summary.json")
DEFAULT_ENVELOPES = Path("results/epoch_fork_envelopes.jsonl")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def _append_jsonl(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, sort_keys=True))
        f.write("\n")


def _run_go_shim(go_cmd: str, corpus: Path, scenario_id: str) -> Optional[Dict[str, Any]]:
    cmd = [
        go_cmd,
        "run",
        str(Path("validation/go/validators/epoch_fork/main.go")),
        "--corpus",
        str(corpus),
        "--scenario",
        scenario_id,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return None
    try:
        return json.loads(proc.stdout.splitlines()[0])
    except json.JSONDecodeError:
        sys.stderr.write("Failed to parse Go shim output\n")
        return None


def _run_node_shim(node_cmd: str, corpus: Path, scenario_id: str) -> Optional[Dict[str, Any]]:
    cmd = [
        node_cmd,
        str(Path("validation/nodejs/validators/epoch_fork.js")),
        "--corpus",
        str(corpus),
        "--scenario",
        scenario_id,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return None
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        return None
    try:
        return json.loads(lines[0])
    except json.JSONDecodeError:
        sys.stderr.write("Failed to parse Node shim output\n")
        return None


def _run_rust_shim(cargo_cmd: str, corpus: Path, scenario_id: str) -> Optional[Dict[str, Any]]:
    cmd = [
        cargo_cmd,
        "run",
        "--quiet",
        "--bin",
        "validate_epoch_fork_rust",
        "--",
        "--corpus",
        str(corpus),
        "--scenario",
        scenario_id,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        return None
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        return None
    try:
        return json.loads(lines[0])
    except json.JSONDecodeError:
        sys.stderr.write("Failed to parse Rust shim output\n")
        return None


def run_scenario(scenario, language: str = "python") -> Dict[str, Any]:
    import time

    start = time.perf_counter()
    sim_result = simulate(scenario)
    wall_ms = int((time.perf_counter() - start) * 1000)
    status, failures = evaluate_expectations(scenario, sim_result)

    envelope: Dict[str, Any] = {
        "scenario_id": scenario.scenario_id,
        "language": language,
        "status": status,
        "detection": sim_result.detection,
        "detection_ms": sim_result.detection_ms,
        "reconciliation_ms": sim_result.reconciliation_ms,
        "winning_epoch_id": sim_result.winning_epoch_id,
        "winning_hash": sim_result.winning_hash,
        "messages_dropped": sim_result.messages_dropped,
        "healing_actions": sim_result.healing_actions,
        "errors": sim_result.errors,
        "false_positives": sim_result.false_positives,
        "notes": sim_result.notes,
        "failures": failures,
        "wall_time_ms": wall_ms,
        "tags": getattr(scenario, "tags", []),
    }
    return envelope


def build_summary(language: str, envelopes: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "language": language,
        "run_id": os.environ.get("EPOCH_FORK_RUN_ID"),
        "scenarios": [
            {
                "scenario_id": env["scenario_id"],
                "status": env.get("status"),
                "detection": env.get("detection"),
                "detection_ms": env.get("detection_ms"),
                "reconciliation_ms": env.get("reconciliation_ms"),
                "winning_epoch_id": env.get("winning_epoch_id"),
                "winning_hash": env.get("winning_hash"),
                "messages_dropped": env.get("messages_dropped"),
                "wall_time_ms": env.get("wall_time_ms"),
                "notes": env.get("notes", []),
            }
            for env in envelopes
        ],
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run deterministic epoch fork scenarios")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--scenario", type=str, default=None, help="Run only the specified scenario_id")
    parser.add_argument("--summary-out", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--envelope-out", type=Path, default=DEFAULT_ENVELOPES)
    parser.add_argument("--go-shim", type=str, default=None, help="Optional Go shim command (e.g., 'go')")
    parser.add_argument("--node-shim", type=str, default=None, help="Optional Node shim command (e.g., 'node')")
    parser.add_argument("--rust-shim", type=str, default=None, help="Optional Rust shim command (e.g., 'cargo')")
    parser.add_argument("--stress", action="store_true", help="Include stress-tagged scenarios and emit wall_time_ms")
    args = parser.parse_args(argv)

    try:
        corpus = load_corpus(str(args.corpus))
    except (CorpusError, FileNotFoundError) as exc:
        sys.stderr.write(f"Failed to load corpus: {exc}\n")
        return 1

    selected = []
    for s in corpus:
        if args.scenario is not None and s.scenario_id != args.scenario:
            continue
        if not args.stress and "stress" in getattr(s, "tags", []):
            continue
        selected.append(s)

    if not selected:
        sys.stderr.write("No scenarios matched\n")
        return 1

    envelopes: List[Dict[str, Any]] = []
    for scenario in selected:
        env = run_scenario(scenario, language="python")
        envelopes.append(env)
        _append_jsonl(args.envelope_out, env)
        if args.go_shim:
            go_env = _run_go_shim(args.go_shim, args.corpus, scenario.scenario_id)
            if go_env:
                go_env.setdefault("language", "go")
                envelopes.append(go_env)
                _append_jsonl(args.envelope_out, go_env)
        if args.node_shim:
            node_env = _run_node_shim(args.node_shim, args.corpus, scenario.scenario_id)
            if node_env:
                node_env.setdefault("language", "nodejs")
                envelopes.append(node_env)
                _append_jsonl(args.envelope_out, node_env)
        if args.rust_shim:
            rust_env = _run_rust_shim(args.rust_shim, args.corpus, scenario.scenario_id)
            if rust_env:
                rust_env.setdefault("language", "rust")
                envelopes.append(rust_env)
                _append_jsonl(args.envelope_out, rust_env)

    summary = build_summary("python", [e for e in envelopes if e.get("language") == "python"])
    _write_json(args.summary_out, summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
