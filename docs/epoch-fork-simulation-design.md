# FoxWhisper v0.9 Epoch Fork Simulation & Validation Design

## Purpose & Scope
Epoch fork stress testing is roadmap item **4.2.3**. Before we ship code we need a shared design that keeps the Python, Go, Rust, and Node.js validators aligned. This document captures:
- The data model for epoch-fork scenarios (`tests/common/adversarial/epoch_forks.json`).
- The simulator responsibilities that live in `validation/common/simulators/`.
- The validator/harness wiring that each language must implement.
- The metrics, pass/fail conditions, and CI integration steps required to close Section 4.2.3.

## Design Goals
1. **Deterministic + reproducible** – every scenario must replay identically across languages and in CI.
2. **Cross-language parity** – shared corpus + shared simulator library prevent divergent logic.
3. **Protocol fidelity** – simulators must honor the EARE hash chain, epoch monotonicity rules, and reconciliation procedures defined in `spec/e2ee-protocol-specification-v0.8.1.md` §2.2/§2.3.
4. **Actionable metrics** – outputs quantify detection latency, false positives, healing success, and performance costs so regressions are obvious.
5. **Composable CI** – deterministic runs happen inside the existing `validate-<lang>` jobs without extending runtime beyond ~90 seconds per language.

## Scenario Corpus (`tests/common/adversarial/epoch_forks.json`)
Each entry in the corpus is a deterministic scenario envelope:

```json
{
  "scenario_id": "forked_rejoin_network_partition",
  "group_context": {
    "group_id": "g-alpha",
    "epoch_size_limit": 1024,
    "membership_version": 42,
    "controller_clock_skew_ms": 250,
    "max_epoch_skew_ms": 400,
    "replay_window_ms": 120000,
    "expected_members": 58,
    "max_members": 200
  },
  "graph": {
    "nodes": [
      {"node_id": "n0", "epoch_id": 100, "eare_hash": "0xabc", "previous_epoch_hash": null, "membership_digest": "0x111", "parent_id": null, "issued_by": "controller-a", "timestamp_ms": 0},
      {"node_id": "n1", "epoch_id": 101, "eare_hash": "0xdef", "previous_epoch_hash": "0xabc", "membership_digest": "0x222", "parent_id": "n0", "issued_by": "controller-a", "timestamp_ms": 1200},
      {"node_id": "n2", "epoch_id": 101, "eare_hash": "0x987", "previous_epoch_hash": "0xabc", "membership_digest": "0x333", "parent_id": "n0", "issued_by": "controller-b", "timestamp_ms": 1300}
    ],
    "edges": [
      {"from": "n0", "to": "n1", "type": "linear"},
      {"from": "n0", "to": "n2", "type": "fork"}
    ]
  },
  "event_stream": [
    {"t": 0, "event": "partition", "participants": ["controller-b"]},
    {"t": 800, "event": "epoch_issue", "controller": "controller-a", "epoch_id": 101, "node_id": "n1"},
    {"t": 900, "event": "epoch_issue", "controller": "controller-b", "epoch_id": 101, "node_id": "n2"},
    {"t": 1800, "event": "merge", "participants": ["controller-b"], "reconcile_strategy": "prefer_longest"}
  ],
  "expectations": {
    "detected": true,
    "detection_reference": "fork_observable",
    "max_detection_ms": 400,
    "max_reconciliation_ms": 600,
    "reconciled_epoch": {"epoch_id": 101, "node_id": "n1", "eare_hash": "0xdef"},
    "allow_replay_gap": {"max_messages": 5, "max_ms": 2000},
    "expected_error_categories": ["EPOCH_FORK_DETECTED"],
    "healing_required": true
  }
}
```


### Field Summary
- **group_context** – bounds for membership size, drift tolerances, and controller metadata; includes `controller_clock_skew_ms`, `max_epoch_skew_ms`, `replay_window_ms`, `expected_members`, and optional stress knobs such as `max_members` for large-group cases.
- **graph.nodes** – DAG description of issued EAREs (epoch authenticity records). Each node must declare a stable `node_id` (fixture-local handle), `epoch_id`, issuer metadata, and optional fidelity fields (`previous_epoch_hash`, `membership_digest`) so validators can reuse the corpus for hash-chain integrity tests. Duplicate `epoch_id` values are allowed; forks are disambiguated by `node_id`, but protocol comparisons ultimately happen via `(epoch_id, eare_hash)`.
- **graph.edges** – optional annotations for visualization or alternative scoring (e.g., “fork” vs “linear”). Edges always reference `node_id`s, keeping the DAG unambiguous even when epoch IDs repeat.
- **event_stream** – deterministically ordered events (partition, issue, merge, client_receive, replay_attempt). Each event includes data payloads relevant to its type plus optional `faults` and `node_id` references. `t` represents simulation time in ms from scenario start; node `timestamp_ms` values represent controller-local issue times and may differ due to skew.
- **expectations** – scenario-level pass/fail contract (detection latency, reconciliation outcome, acceptable false-positive counts, replay tolerances, etc.). Detection windows state whether they are relative to `fork_observable` (first moment a validator could see both branches) or `fork_created` (second epoch_issue event). `reconciled_epoch` is defined via `{epoch_id, node_id, eare_hash}` so we can compare hashes for correctness while keeping the corpus human friendly. `expected_error_categories` intentionally uses logical labels (e.g., `EPOCH_FORK_DETECTED`, `HASH_CHAIN_BREAK`) so each language can map to its own error codes without diverging behavior.

### Seeds & Extensions
- `tests/common/adversarial/seeds/epoch_forks/*.json` store AFL/libFuzzer seeds derived from the corpus for long-running fuzzers.
- Variant scenarios can request **fault injection hooks** (e.g., drop next EARE, delay validation) by appending `faults` arrays to the event stream entries, for example:
  ```json
  {"t": 900, "event": "epoch_issue", "controller": "controller-b", "epoch_id": 101, "node_id": "n2", "faults": ["drop_next_eare", "delay_validation:200"]}
  ```

### Time Semantics & Detection Anchors
- `t` fields in `event_stream` encode simulation time (ms since scenario start). Metrics such as `detection_ms` and `reconciliation_ms` are computed strictly in this timeline so results stay deterministic.
- `timestamp_ms` on nodes reflects the issuing controller’s clock. Combine with `controller_clock_skew_ms` to test skew tolerance from the spec.
- `detection_reference` specifies whether `max_detection_ms` is measured relative to `fork_created` (the second conflicting `epoch_issue`) or `fork_observable` (first moment an honest validator has ingested conflicting data). Latent fork scenarios should set `fork_observable` so validators aren’t penalized before the fork is visible to them.

## Simulator & Validator Architecture

### 1. Shared Simulator Library (`validation/common/simulators/epoch.py`)
Responsibilities:
- Parse corpus entries into strongly-typed dataclasses (e.g., `EpochNode`, `ForkEvent`).
- Validate DAG invariants (no backward edges, consistent hash chain, timestamp monotonicity within a controller).
- Execute the event stream, maintaining per-controller views plus aggregated “ground truth”. Only the simulator sees global truth; hooks expose the same sequence of observable events (EARE arrivals, partitions, merges) that a real implementation would see—never simulator-only hints.
- Emit deterministic callbacks ("on_fork", "on_merge", "on_out_of_order_eare") ordered by `(scenario_index, event.t, event_index)` so iteration order never drifts between runs.
- Provide helper utilities for calculating divergence depth, replay window violations, reconciliation costs, and for splitting `sim_time_ms` vs `wall_time_ms` so performance instrumentation does not affect pass/fail outcomes.
- Reject any randomness inside the simulator. If a scenario needs shuffled ordering, the corpus provides an explicit `shuffle_seed` or explicit ordering list so every language processes events identically.

### 2. Python Coordinator (`validation/python/validators/epoch_fork_fuzzer.py`)
- Entry point invoked by `./scripts/validate-python.sh`.
- Loads corpus, instantiates simulator, registers the Python validator’s detection hooks, and writes metrics to `results/epoch_fork_summary.json`.
- Produces deterministic console output plus machine-readable JSON records for CI annotations.

### 3. Language Shims
| Language | Location | Notes |
|----------|----------|-------|
| Python | `validation/python/validators/epoch_fork_fuzzer.py` | Canonical implementation, exports CLI + library mode.
| Go | `validation/go/validators/epoch_fork/` (new) | Uses cgo/ffi-free JSON streaming: Python coordinator shells out to Go binary per scenario.
| Rust | `validation/rust/validators/epoch_fork/` (new) | Leverages serde for DAG parsing and ties into `cargo test` target.
| Node.js | `validation/nodejs/validators/epoch_fork.js` | Consumed by CI via `node validate_epoch_fork.js --scenario <id>`.

Each shim consumes the same JSON scenario, executes local validation logic (hash chain verification, membership reconciliation), and returns a structured status envelope that the Python coordinator aggregates. The envelope schema is:

```json
{
  "scenario_id": "forked_rejoin_network_partition",
  "language": "rust",
  "status": "pass" | "fail" | "error",
  "detection": true,
  "detection_ms": 312,
  "reconciliation_ms": 204,
  "winning_epoch_id": 101,
  "winning_hash": "0xdef",
  "messages_dropped": 3,
  "healing_actions": ["reset_sender_keys"],
  "errors": ["EPOCH_FORK_DETECTED"],
  "false_positives": {"warnings": 0, "hard_errors": 0},
  "notes": []
}
```

Node IDs stay internal to the corpus; shims never need to output them. The coordinator can optionally derive a `winning_node_id` when writing summaries, but comparisons are strictly hash-based.

Exit codes distinguish harness failures (non-zero) from logical failures (`status = fail`). Shims must exit with code 0 even when reporting `status = "fail"`; non-zero codes indicate harness/runtime errors and skip metrics comparison.

## Detection Logic & Metrics
For every scenario we record:
- `detection`: boolean plus `detection_ms`, measured in simulation time relative to `detection_reference`. The reference defaults to `fork_created` but can be overridden per scenario. The result envelope includes both fields so we can directly compare with `expectations.detected`.
- `false_positives`: structured counts for soft warnings vs hard errors (e.g., `{ "warnings": 0, "hard_errors": 0 }`). This helps calibrate sensitivity without rewriting fixtures.
- `reconciliation_ms`: time between the confirmed detection signal and convergence to the `reconciled_epoch`. `max_reconciliation_ms` in `expectations` bounds this value.
- `winning_epoch_id` and `winning_hash`: the canonical branch after reconciliation. All languages must agree, and mismatches are fatal even if each validator individually “passes”. Node IDs are only used inside the corpus; protocol comparisons remain hash-based.
- `messages_dropped`: count of messages discarded because they referenced losing epochs (tie this to `allow_replay_gap.max_messages` / `max_ms`).
- `healing_actions`: ordered list of enum-like strings such as `reset_sender_keys`, `request_full_sync`, `drop_losing_branch`, `advance_epoch`, `revoke_member`.
- `performance`: runtime CPU/memory; tracked separately under `wall_time_ms` so pass/fail logic remains deterministic.

Pass/fail conditions compare recorded metrics with `expectations` in the corpus. Any violation fails the scenario and the CI job. `allow_replay_gap` explicitly defines the tolerated mismatch between expected vs observed replay windows both in message count and elapsed ms.

## Results Format
`results/epoch_fork_summary.json` (one file per language) contains a pared-down view for dashboards:
```json
{
  "language": "python",
  "run_id": "2025-12-07T18:34:12Z",
  "scenarios": [
    {
      "scenario_id": "forked_rejoin_network_partition",
      "status": "pass",
      "detection": true,
      "detection_ms": 312,
      "reconciliation_ms": 204,
      "winning_epoch_id": 101,
      "winning_hash": "0xdef",
      "messages_dropped": 3,
      "notes": []
    }
  ]
}
```
Full per-language envelopes are still emitted (newline-delimited JSON) for artifact diffing; summaries may include a derived `winning_node_id` for human context, but CI strictly evaluates `(winning_epoch_id, winning_hash)`.
During CI the coordinator ensures `results/` only contains deterministic summaries (no seed corpora or sensitive payloads).

## CI & Workflow Integration
1. **Python job**: extend `scripts/jobs/validate-python.sh` to run `python3 validation/python/validators/epoch_fork_fuzzer.py --corpus tests/common/adversarial/epoch_forks.json`.
2. **Multi-language fan-out**: the Python harness shells out to `node`, `go run`, and `cargo run` commands (same pattern already used by replay storm validators) so we keep orchestration logic centralized.
3. **Artifact checks**: `.github/workflows/validation.yml` uploads `results/epoch_fork_summary.json` when the job fails for triage, but skips uploads on success to keep artifacts clean. Failure artifacts also include the scenario JSON fragment and each language’s result envelope for fast diffing.
4. **Nightly fuzzing**: optional GitHub workflow uses the `seeds/epoch_forks/` corpus with AFL/libFuzzer to hunt for new fork patterns; nightly job writes its own summary file and is not required for PR gating. Any minimized repro emerging from fuzzing graduates into `tests/common/adversarial/epoch_forks.json` and the deterministic CI corpus.
5. **Exit-code discipline**: shells treat non-zero shim exit codes as harness failures; logical discrepancies propagate via JSON status so CI can distinguish crashes vs regressions.

## Implementation Phases
1. **Corpus + simulator scaffold** – land JSON schema, dataclasses, and parser validations.
2. **Python reference validator** – implement fork detection + reconciliation checks, wire into CI, ensure deterministic outputs.
3. **Language parity** – port detection hooks to Go, Rust, Node.js; update scripts/jobs to include new binaries.
4. **Performance & stress metrics** – add CPU/memory instrumentation hooks plus optional long-run scenarios (e.g., 10k epochs) guarded by `--stress` flag.
5. **Nightly fuzz integration** – produce AFL/libFuzzer harnesses using the shared corpus seeds.

## Scenario Coverage Additions
To exercise the v0.8.1 epoch integrity guarantees, seed the corpus with:
- **Transient unseen fork** – conflicting epochs issued during a partition, but some members never ingest both branches. Expect zero fork errors for those members yet consistent final membership.
- **Cross-epoch jump** – one branch advances to epoch 102 while another stays on 101 but references the same parent, testing monotonicity enforcement.
- **Hash-chain break** – duplicate epoch IDs with valid membership but incorrect `previous_epoch_hash`, ensuring validators raise `HASH_CHAIN_BREAK` in addition to (or instead of) `EPOCH_FORK_DETECTED`.
- **Persistent unresolved fork** – merge never occurs. Expect detection with `healing_required = false` plus teardown / irrecoverable status.
- **Fork + replay storm** – combine fork detection with bursty message delivery to ensure replay protections ignore losing branches after reconciliation.

Completing these phases and scenarios satisfies roadmap tasks 4.2.3.1–4.2.3.6 and sets up future work for corrupted EARE injections (4.2.5) by reusing the same DAG infrastructure.
