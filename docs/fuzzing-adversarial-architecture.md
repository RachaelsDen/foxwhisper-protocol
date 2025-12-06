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
- **State machine**: representation of each device’s view (epoch, session key, pending events).
- **Scenario file**: `tests/common/adversarial/device_desync.json` listing sequences like “clock skew”, “partial delivery”, “split-brain restore”.
- **Simulator**: Python orchestrator updates each device state per event and flags divergence thresholds; outputs go to `results/device_desync_summary.json`.

### 4.2.5 Corrupted EARE Injection & 4.2.6 SFU Abuse
- **Corrupted EARE**: reuse the epoch fork DAG structures but add explicit tampering steps; integrate into `epoch_fork_fuzzer.py`.
- **SFU abuse**: create `tests/common/adversarial/sfu_abuse.json` capturing unauthorized key requests, hijacked streams, etc. Node.js is the first target since the existing media validators use JavaScript; a Go shim validates server-side controls.

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
