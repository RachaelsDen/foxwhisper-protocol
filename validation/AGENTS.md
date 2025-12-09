# AGENTS Guide – Validation and Conformance Tools

## Scope and Purpose

- The `validation/` tree contains **multi-language validators and simulators** for FoxWhisper.
- Primary goals:
  - Enforce CBOR structure, schema, and canonical encoding for all message types.
  - Validate adversarial scenarios (replay storms, epoch forks, multi-device desync, SFU abuse, corrupted EARE, malformed packets).
  - Provide **cryptographic conformance checks** that mirror the v0.8.1 / v0.9 spec.
  - Serve as the source of truth for cross-language compatibility.

All changes here should tighten alignment with the spec and shared test vectors, never loosen it.

## Authoritative References

Agents MUST treat the following as authoritative when modifying validators:

- `spec/e2ee-protocol-specification-v0.8.1.md` – current normative crypto and protocol spec.
- `docs/v0.9-comprehensive-todo-list.md` – especially:
  - **4.1 Conformance Test Suite**
  - **4.2 Fuzzing & Adversarial Simulation Framework**
  - **4.4 Interoperability Tools**, including **4.4.4 Crypto Conformance Validators**.
- Shared test vectors under `tests/common/`.

Any drift from these must be treated as a spec / vector update task, not a silent validator change.

## Responsibilities per Area

### 1. CBOR and Schema Validators (All Languages)

- Ensure:
  - Required fields are present and correctly typed.
  - Field lengths and formats match v0.8.1 (e.g., x25519 pub keys, Kyber public/ciphertext sizes, nonce lengths).
  - No unknown fields are accepted unless explicitly added to the spec.
  - CBOR encoding is **canonical** and matches shared hex/bytes when vectors specify them.
- Any change to accepted/rejected fields MUST:
  - Be reflected in `tests/common/handshake/cbor_test_vectors*.json` (or other relevant vector files).
  - Be consistent across Go, Python, Node.js, Erlang, and Rust validators.

### 2. Adversarial Simulators (Python, Node.js, Go, Rust, Erlang)

- Files such as:
  - `validation/common/simulators/*`
  - `validation/*/validators/*` (e.g., corrupted EARE, replay, desync, SFU abuse).
- These are **behavioral oracles** for: replay, poisoning, epoch forks, device desync, SFU abuse, corrupted EARE.
- When editing simulators:
  - Keep semantics aligned with adversarial corpora in `tests/common/adversarial/*.json`.
  - Preserve invariants and metrics described in `docs/fuzzing-adversarial-architecture.md` and related docs.
  - Update expectations and metrics consistently across languages when behavior changes.

### 3. Crypto Conformance Validators (4.4.4)

Agents MUST implement and maintain the crypto checks described in **4.4.4 Crypto Conformance Validators** of the v0.9 TODO:

- **Handshake crypto checks**
  - Recompute hybrid secret using X25519 + Kyber as per v0.8.1:
    - `x25519_shared = X25519(client_x25519_priv, server_x25519_pub)`
    - `kyber_shared = Kyber.Decapsulate(client_kyber_priv, server_kyber_ciphertext)`
    - `handshake_secret = HKDF(x25519_shared || kyber_shared, "FoxWhisper-Handshake-Root", 32)`
  - Compare derived values with shared test vectors.

- **DR/Double Ratchet checks**
  - Recompute message and chain keys via HKDF-SHA256 with labels:
    - `"FoxWhisper-Message"`, `"FoxWhisper-Chain"`.
  - Verify AES-256-GCM encrypt/decrypt using deterministic 96-bit IV and AAD as per v0.8.1 (§6.1.2).

- **Media crypto checks**
  - Recompute `media_epoch_key` and `frame_key` via HKDF-SHA256 with labels:
    - `"FW-MediaEpochKey"`, `"FW-FrameKey"`.
  - Recompute deterministic IV:
    - `deterministic_iv = Truncate_96bits(SHA256(call_id || participant_id || stream_id || frame_sequence))`.
  - Verify AES-256-GCM decrypts media frame test vectors using correct AAD.

- **Group/EARE signature checks**
  - Verify ed25519 signatures on:
    - Group key distribution messages.
    - Epoch Authenticity Records (EAREs).
  - Confirm EARE hash-chain linkage matches spec (previous_epoch_hash, membership_digest, etc.).

- **Cross-language crypto diff harness**
  - Emit JSON summaries from each language’s validator (Go, Python, Node.js, Erlang, Rust) containing at least:
    - Hash or tag of derived keys (not raw keys).
    - IV and AAD (or their hashes).
    - Ciphertext digest.
  - Compare these outputs across languages to detect drift from v0.8.1 / v0.9.

## Drift Prevention Rules

- DO:
  - Tighten checks when you discover ambiguities (and then update spec + vectors accordingly).
  - Keep validators strict by default, rejecting unknown fields and schema drift.
  - Add new tests/vectors whenever behavior changes.
- DO NOT:
  - Relax validators just to "make tests pass" without spec/vector updates.
  - Introduce new message fields, tags, or crypto parameters in validators alone.
  - Depend on language-specific quirks (e.g., base64 variants) without clear, documented rules.

## Implementation Notes for Agents

- When adding or modifying validators:
  - Start from the shared vector format in `tests/common/*`.
  - Ensure that at least one language has a “golden” implementation that others can cross-check against.
  - Prefer deterministic, reproducible behavior; avoid time/entropy-dependent outputs in validation paths.

By following this guide, validators will remain the concrete enforcement of the spec rather than diverging implementations.
