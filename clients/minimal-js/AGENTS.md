# AGENTS Guide – Minimal JS Client (Node Test Harness)

## Scope and Purpose

- This directory contains the **minimal FoxWhisper JS client**, implemented in TypeScript.
- For v0.9, this client is a **Node-only test harness**, not a production application.
- Its primary goal is to:
  - Exercise the protocol against shared test vectors in `tests/common/*`.
  - Serve as a cross-language oracle to compare behavior with Go/Python/Node/Erlang/Rust.
  - Provide real data to refine the v0.8.1 spec into a more concrete v0.9.

## Crypto and Spec Alignment

When modifying code under `clients/minimal-js/`, agents MUST:

- Treat `spec/e2ee-protocol-specification-v0.8.1.md` as the **authoritative cryptographic reference**.
- Implement crypto according to v0.8.1 (unless a v0.9 spec section explicitly overrides it):
  - Hybrid handshake secret:
    - `x25519_shared = X25519(client_x25519_priv, server_x25519_pub)`
    - `kyber_shared = Kyber.Decapsulate(client_kyber_priv, server_kyber_ciphertext)`
    - `handshake_secret = HKDF(x25519_shared || kyber_shared, "FoxWhisper-Handshake-Root", 32)`
  - KDF: **HKDF-SHA256**, 32-byte outputs, with labeled `info` strings (e.g., "FoxWhisper-Message", "FoxWhisper-Chain", "FW-MediaEpochKey", "FW-FrameKey").
  - AEAD: **AES-256-GCM** for DR, messaging, and media.
  - IV/nonce: deterministic 96-bit IV = `Truncate_96bits(SHA256(context))`, where context is defined by the spec:
    - DR/messaging: typically `call_id || participant_id || stream_id || frame_sequence` (see v0.8.1 §6.1.2).
    - Media frames: same pattern (see v0.8.1 §3.4.3, §6.3.1).
  - AAD: `SHA256(canonicalCBOR(header))` or canonical CBOR header, as specified in v0.8.1 examples.
  - Group/EARE signatures: **ed25519** (see v0.8.1 group and EARE examples).
- NEVER introduce new crypto primitives or parameter sets in this client without a corresponding spec update and shared test vectors.
- NEVER rely on toy XOR-based crypto for anything other than explicitly marked test stubs.

## Testing and Vectors

- Prefer shared cross-language vectors over ad-hoc fixtures:
  - Handshake/DR: `tests/common/handshake/cbor_test_vectors*.json`, `dr_test_vectors*.json`.
  - Group: `tests/common/handshake/group_messaging_test_vectors.json` (or current equivalent).
  - Media: `tests/common/media_*` vectors, when present.
  - Adversarial: `tests/common/adversarial/*` as needed.
- When adding tests in `clients/minimal-js/test/`:
  - First look for an existing vector file under `tests/common/`.
  - If you must create new vectors, prefer adding them under `tests/common/` so other languages can reuse them.
- Any change to CBOR shapes, tags, or field names MUST be reflected in:
  - The shared test vectors under `tests/common/`.
  - The multi-language validators under `validation/*`.
  - The spec, when it’s a normative change.

## Node-Only Harness Constraints

- This client is currently **Node-focused**:
  - Use Node’s `crypto` module for randomness and AEAD.
  - Do NOT add browser-specific code paths or UI concerns here.
- Key storage in this harness may be simplified (in-memory or file-based) but MUST be clearly documented as **test-only**.
  - Production guidance for hardware-backed keys belongs in the spec and server-side (e.g., Erlang/Phoenix) implementations.

## Relation to v0.9 TODOs

- This directory is responsible for executing the milestones in:
  - `docs/v0.9-comprehensive-todo-list.md` → section **4.3.1 Minimal Reference Client** and **4.3.1.a Minimal JS Node Test Harness Milestones**.
- When implementing milestones M0–M4:
  - M0: Do not change crypto choices without updating the spec and the TODO.
  - M1–M3: Ensure tests are vector-driven and compare derived values (keys, IVs, AAD) to other implementations.
  - M4: Integrate results into CI and emit machine-readable summaries for cross-language diffs.

## Drift Prevention Rules

- DO:
  - Cross-check changes against `e2ee-protocol-specification-v0.8.1.md` and `docs/v0.9-comprehensive-todo-list.md`.
  - Add or update shared test vectors when behavior changes.
  - Keep the Node client simple, debuggable, and focused on protocol correctness.
- DO NOT:
  - Introduce un-specified fields, tags, or crypto parameters.
  - Add UI/UX or browser-only code.
  - Relax validation logic to "make tests pass" without updating the spec and vectors.
