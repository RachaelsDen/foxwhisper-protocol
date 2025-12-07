# FoxWhisper v0.9 Fuzzing & Adversarial Simulation Architecture

## Purpose
Section 4.2 of the v0.9 roadmap covers malformed-packet fuzzing, replay storms, epoch forks, and multi-device desynchronization scenarios. This document defines the shared architecture the repo will use to implement those deliverables without duplicating logic across languages.

## Design Principles
1. **Single source of truth for vectors** – Each adversarial scenario describes the canonical inputs/expectations in `tests/common/adversarial/`. Language harnesses import or transpile from this corpus.
2. **Composability** – Fuzzing harnesses and simulators must plug into the same CLI entrypoints the GitHub workflow already runs (Python as coordinator, per-language subcommands for runtime-specific behavior).
3. **Deterministic outputs** – Every fuzzing job writes JSON results to `results/` so the cross-language compatibility step can consume them.
4. **Progressive hardening** – Start with targeted malformed corpus tests, then graduate scenarios into continuous fuzzing (AFL/LibFuzzer) once baseline logic is validated.

## Component Map
| Component | Location | Description |
|-----------|----------|-------------|
| **Adversarial corpus** | `tests/common/adversarial/*.json` | Seed corpora for malformed CBOR, epoch forks, desync flows, and replay storms. Each file contains deterministic fixtures plus optional fuzz seeds. |
| **Python coordinator** | `validation/python/validators/fuzz_harness.py` (new) | Loads corpus files, drives per-language validators (via CLI or foreign function interface), aggregates metrics, and emits `results/fuzzing_summary.json`. |
| **Language shims** | `validation/{python,nodejs,go,rust}/fuzzers/` | Thin adapters that feed corpus entries into the native validator implementation, expose instrumentation hooks, and (optionally) wrap AFL/libFuzzer entrypoints. |
| **Simulator library** | `validation/common/simulators/` | Shared utilities for replay storm modelling, device desync timelines, and epoch fork graphs. Python version ships first; Go/Rust ports follow as needed. |
| **CI wiring** | `.github/workflows/validation.yml` | Adds a “Fuzzing & Simulation” job that runs the Python coordinator in deterministic mode (no random fuzzing) so GitHub Actions stays fast. Long-running fuzzing lives in optional nightly jobs. |

## Current Implementation (Dec 2025)
- ✅ `tests/common/adversarial/malformed_packets.json` defines deterministic handshake mutations (missing nonce, shuffled maps, corrupted tags, oversized nonces, invalid key material).
- ✅ `validation/python/validators/fuzz_harness.py` reuses the CBOR encoder to replay those mutations, enforce invariants, and emit `results/malformed_packet_fuzz_results.json` during CI runs.
- ✅ `tools/generators/generate_malformed_packets.py` regenerates concrete seed files in `tests/common/adversarial/seeds/` for offline fuzzers.
- ✅ `validation/python/fuzzers/afl_entrypoint.py` consumes JSON envelopes from STDIN, making it trivial to point AFL or LibFuzzer at the corpus (seed files double as initial inputs).
- ✅ GitHub Actions (`validate-python` job) now runs the deterministic harness alongside the replay/poisoning validator so regressions surface immediately.

## Section 4.2 Breakdown
### 4.2.1 Malformed Packet Fuzzing
- **Corpus**: `tests/common/adversarial/malformed_packets.json`
  - Fields: `seed_id`, `original_message`, `mutations` (list of mutation descriptors), `expected_outcome` (`reject`, `panic`, `recover`).
- **Harness hook**: extend each language’s CBOR validator with `--fuzz-input=<file>` flag that processes a single mutated message and returns structured status.
- **Fuzzer integration**: provide AFL dictionary + seed files generated from corpus. Later we can add GitHub “fuzz” workflow referencing these seeds.

### 4.2.2 Replay Storm Simulation
- **Simulator**: `validation/common/simulators/replay.py` implements the same math used in the replay/poisoning validator, but exposes streaming APIs (rate limiting, queue depth, drop ratio metrics).
- **Profiles**: `tests/common/adversarial/replay_storm_profiles.json` describes burst rates, attack durations, and expected detector actions.
- **Output**: `results/replay_storm_summary.json` with per-profile KPIs (`max_queue_depth`, `drops`, `latency_penalty`).

### 4.2.3 Epoch Fork Stress Tests
- **Graph spec**: `tests/common/adversarial/epoch_forks.json` enumerates DAGs plus event ordering.
- **Validation logic**: new module `validation/python/validators/epoch_fork_fuzzer.py` that builders can port to Go/Rust once stable. It should detect splits, check reconciliation algorithms, and benchmark detection time.

### 4.2.4 Multi-Device Desync Simulators
- **Schema** (`tests/common/adversarial/device_desync.json`): `devices` (id, `dr_version`, `clock_ms`, optional `state_hash`), `timeline` (events: `send`, `recv`, `drop`, `replay`, `backup_restore`, `clock_skew`, `resync`), and `expectations` (detection/recovery SLAs, `max_dr_version_delta`, `max_clock_skew_ms`, `allow_message_loss_rate`, `allow_out_of_order_rate`, `expected_error_categories`, `max_rollback_events`, `residual_divergence_allowed`).
- **Events**: `send` registers expected deliveries per target; `recv` applies DR/state; `drop` marks intentional loss; `replay` re-injects a prior message; `backup_restore` can roll a device back; `clock_skew` adjusts local clocks; `resync` attempts recovery (counts success/failure).
- **Metrics**: `max/avg_dr_version_delta`, message loss + out-of-order rates, `max_clock_skew_ms`, divergence width (`max_diverged_device_count`), recovery attempts/successes, `max_rollback_events`, residual divergence flag, error categories (`DIVERGENCE_DETECTED`, `MESSAGE_LOSS`, `CLOCK_SKEW_VIOLATION`, `ROLLBACK_APPLIED`, `REPLAY_INJECTED`, etc.).
- **Simulator**: Python oracle (`validation/common/simulators/desync.py`) with CLI `validation/python/validators/device_desync_sim.py --corpus tests/common/adversarial/device_desync.json --summary-out device_desync_summary.json`; writes `results/device_desync_summary.json` for CI.

### 4.2.5 Corrupted EARE Injection
- **Corpus**: `tests/common/adversarial/corrupted_eare.json` with scenarios for invalid signature/PoP, hash-chain breaks, payload tamper, and extra fields; includes `group_context`, `nodes`, `corruptions`, and `expectations`.
- **Python oracle**: `validation/common/simulators/corrupted_eare.py` with CLI runner `validation/python/validators/corrupted_eare_sim.py --corpus tests/common/adversarial/corrupted_eare.json --summary-out corrupted_eare_summary.json`.
- **Multi-language shims**: Node.js (`validation/nodejs/validators/corrupted_eare.js`), Go (`validation/go/validators/corrupted_eare/main.go`), Rust (`validate_corrupted_eare_rust`), Erlang (`validation/erlang/validators/validate_corrupted_eare_erlang.exs`).
- **CI outputs**: per-language summaries under `results/*corrupted_eare*`. Checks hash-chain continuity, tamper signals, and expectation matching.

### 4.2.6 SFU Abuse
- **Corpus (planned)**: `tests/common/adversarial/sfu_abuse.json` capturing unauthorized key requests, hijacked streams, etc. Node.js is the first target since the existing media validators use JavaScript; a Go shim validates server-side controls.

## Execution Plan
1. Land the corpus files (starting with malformed packets and replay storms).
2. Implement `validation/python/validators/fuzz_harness.py` that:
   - Runs deterministic corpus tests (acts like unit tests).
   - Optionally shells out to AFL/libFuzzer in nightly runs.
3. Add `validation/python/fuzzers/malformed_packets.py` and share logic with Node/Go/Rust via JSON fixtures.
4. Wire deterministic runs into CI; add nightly fuzz job stub.
5. Gradually port simulators to other languages as needed for cross-validation.

## Open Questions
- **Instrumentation**: Do we need coverage guidance (e.g., `cargo fuzz`) for Rust? Proposed solution: reuse existing `cargo-fuzz` template and feed the corpus as seeds.
- **Resource limits**: GitHub Actions minutes are limited. Deterministic corpus runs must finish < 2 minutes; actual fuzzing stays optional/nightly.
- **Security**: Ensure malicious vectors never leave the repo by default (do not post them in artifacts). Only summary metrics should be uploaded.
