# Tests - Shared Vectors and Local Inputs

This guide covers `tests/common/` and `tests/local/`. Changes to any file under
`tests/common/` propagate to every downstream consumer: Python, Node.js, Go,
Rust, and Erlang validators, plus the minimal JS harnesses. Treat these files
as a shared contract.

## common/ - Cross-Language Source of Truth

`common/` holds two categories: `handshake/` for valid protocol vectors and
`adversarial/` for fuzz and attack corpora.

### handshake/ - Valid Test Vectors

Each JSON file in `handshake/` covers one protocol surface: CBOR encoding,
double ratchet, end-to-end flows, group messaging, media encryption, epoch
transitions, multi-device sync, or replay/poisoning.

**Dual CBOR vector files:**

- `cbor_test_vectors.json` uses the original tag assignments.
- `cbor_test_vectors_fixed.json` carries corrected tag values.

Both files are active test surfaces. Do not merge or delete either one without
updating all consumers.

**v0.9/ subdirectory:** `handshake/v0.9/` follows a different schema, including
an `_meta` block and a different transcript structure. When editing v0.9 files,
follow their local schema rather than copying patterns from top-level handshake
vectors.

### adversarial/ - Fuzz and Attack Corpora

`adversarial/` holds scenario profiles such as `corrupted_eare.json`,
`device_desync.json`, `epoch_forks.json`, `replay_storm_profiles.json`, and
`sfu_abuse.json`, plus a seed tree.

**`malformed_packets.json` base_vector pattern:** each seed references a source
vector such as `tests/common/handshake/cbor_test_vectors.json#HANDSHAKE_INIT`.
If you rename or relocate a vector file, update every `base_vector` reference.

**`seeds/manifest.json` contract:** register every generated seed with its
`seed_id` and relative path. The nested `seeds/epoch_forks/` directory has its
own manifest contract for fork-specific seeds.

## local/ - Machine-Specific and Template Inputs

`local/` is for developer-local files that must never be committed with real
secrets. `crypto_conformance_secrets.example.json` is a template only. Copy it
to a non-example filename for local work and keep the real file untracked.

Do not add real keys, tokens, or private data under `tests/common/`.

## Generator Output Paths

Generators live in `tools/generators/`. Their output paths are inconsistent:
some scripts write into `tests/common/`, some use stale `test-vectors/` paths,
and some write to the current working directory. After running any generator,
verify that the final vectors land in `tests/common/` or the appropriate
subdirectory used by validators.

## Ripple Rule

Every edit under `tests/common/` can change assertions in five language
validators plus the minimal JS harnesses. After editing shared vectors, run the
full validation suite when possible (`./scripts/validate-ci.sh` or
`./scripts/validate-ci-nested.sh`). At minimum, run the quick validation script
and note which consumers may require follow-up updates.
