# FoxWhisper v0.9 — Implementation-Grade Specification (DRAFT)

*Derived from FoxWhisper v0.8.1. This v0.9 document is the first implementation-grade specification and will evolve alongside conformance tooling and reference implementations.*

***NOTE: DRAFT – subject to change before v0.9 freeze***

---

# 0. Preface

FoxWhisper v0.9 builds on v0.8.1, focusing on threat model standardization, cryptographic hygiene, implementation clarity, and integration of conformance outputs. This version maintains all security guarantees while improving formal verification friendliness and operational robustness.

## 0.1 Version Goals

v0.9 continues the refinement objectives:

- **Threat Model Unification**: Replace fragmented adversary definitions with a single Dolev-Yao adversary model for formal verification clarity
- **Key Schedule Hygiene**: Clean up media key derivation hierarchy to eliminate frame_counter from epoch key computation
- **IV Strategy Standardization**: Implement deterministic GCM nonce construction to prevent catastrophic nonce reuse
- **SFU Authentication Binding**: Anchor SFU admission to the trust graph with signed tokens and endpoint binding
- **Epoch Skew Tolerance**: Add bounded tolerance for cross-layer epoch mismatches to improve real-world robustness
- **Theorem Wording Precision**: Tighten formal property language to accurately reflect security guarantees

## 0.2 Relationship to Previous Versions

v0.9 is a refinement release building on v0.8.1's foundation:

- **v0.8**: Formal verification + media integration
- **v0.8.1**: Threat model cleanup + key schedule refinements + implementation robustness
- **v0.9**: Implementation-grade draft incorporating conformance and formal/abuse validation outputs

v0.9 is not backwards compatible with v0.8/v0.8.1. Implementations MUST reject legacy labels, legacy encodings, and legacy message shapes as malformed / non-conformant.

## 0.3 Scope and Applicability

FoxWhisper v0.9 maintains the same scope as v0.8/v0.8.1 with enhanced clarity:

**Enterprise Deployments**: Now with standardized threat model for compliance certification
**High-Security Applications**: Improved formal verification friendliness for government/financial use
**Media-Intensive Platforms**: Cleaner key schedule for media encryption implementations
**Standards Development**: More precise theorem statements for academic analysis

---

# 1. Introduction

FoxWhisper v0.9 introduces critical refinements beyond v0.8.1, focusing on threat model standardization, cryptographic hygiene, implementation clarity, and integration of conformance results without changing core security guarantees.

## 1.1 Version Goals

v0.9 continues the refinement objectives:

**Threat Model Unification**: Replace fragmented adversary definitions with a single Dolev-Yao adversary model for formal verification clarity

**Key Schedule Hygiene**: Clean up media key derivation hierarchy to eliminate frame_counter from epoch key computation

**IV Strategy Standardization**: Implement deterministic GCM nonce construction to prevent catastrophic nonce reuse

**SFU Authentication Binding**: Anchor SFU admission to the trust graph with signed tokens and endpoint binding

**Epoch Skew Tolerance**: Add bounded tolerance for cross-layer epoch mismatches to improve real-world robustness

**Theorem Wording Precision**: Tighten formal property language to accurately reflect security guarantees

## 1.2 Relationship to Previous Versions

v0.9 is a refinement release building on v0.8.1's foundation:

- **v0.8**: Formal verification + media integration
- **v0.8.1**: Threat model cleanup + key schedule refinements + implementation robustness
- **v0.9**: Implementation-grade draft incorporating conformance and formal/abuse validation outputs

v0.9 is not backwards compatible with v0.8/v0.8.1. Implementations MUST reject legacy labels, legacy encodings, and legacy message shapes as malformed / non-conformant.

## 1.3 Scope and Applicability

FoxWhisper v0.9 maintains the same scope as v0.8/v0.8.1 with enhanced clarity:

**Enterprise Deployments**: Now with standardized threat model for compliance certification
**High-Security Applications**: Improved formal verification friendliness for government/financial use
**Media-Intensive Platforms**: Cleaner key schedule for media encryption implementations
**Standards Development**: More precise theorem statements for academic analysis

## 1.4 Changes from v0.8.1 (Draft Outline)

This v0.9 specification is derived from v0.8.1 and will gradually incorporate the results of conformance testing, adversarial validation, and formal verification. Until v0.9 is frozen, this section serves as a living outline of intended deltas.

- **Handshake & Key Schedule Refinements**: Clarify HKDF labels, IV/AAD construction, and any implementation-driven tweaks, while keeping the core primitive set aligned with v0.8.1.
- **Group Messaging & EARE Semantics**: Tighten wording around epoch chains, fork detection, and poisoning resistance to reflect validator behavior and adversarial corpora.
- **Media Profile Refinements**: Refine media epoch rules, SFU authentication binding, media transcript integrity format, and (optionally) frame signing semantics.
- **Replay, DR Divergence & Epoch Fork Behavior**: Align normative text with replay/poisoning/fork simulators and epoch-chain validators, including reconciliation policies and drop rules.
- **SFU Auth & Abuse Guardrails**: Describe SFU token lifetimes, replay protection, auth failure semantics, and guarantees around SFU-visible vs end-to-end encrypted metadata.
- **Cross-Layer Integration & Error Semantics**: Specify cross-layer error ontology, epoch skew tolerance (including grace periods), and behavior for multi-device media scenarios.
- **Conformance & Interoperability Requirements**: Define how implementations use the v0.9 test vectors, validators, and interoperability tools to claim conformance.

## 1.5 Conformance Parameters (Crypto Profile)

The following parameters are normative for v0.9 conformance:

- **KEM/KEX**: Crypto suite `FW-CRYPTO-SUITE-01` — X25519 (RFC 7748) + ML-KEM-1024 (FIPS 203; formerly CRYSTALS-Kyber-1024). Encodings: X25519 public keys are 32-byte RFC 7748 encodings; ML-KEM-1024 public keys are 1568 bytes and ciphertexts are 1568 bytes. Each component shared secret is 32 bytes; `ikm = x25519_shared || kem_shared` (64 bytes) before HKDF.
- **KDF**: HKDF-SHA256 (RFC 5869). Unless otherwise stated, all derived keys are 32 bytes. HKDF labels (`info`) and salt encoding rules are specified in §1.5.1 and §1.5.2.
- **AEAD**: AES-256-GCM. Deterministic IV/nonce and AAD construction are context-specific (messaging vs media) and MUST be derived from public context only (see §1.6 and §3.4.3). No (key, IV) reuse is permitted (see §1.7).
- **Media mode**: Encrypted media with per-device keys; media epoch rekeys MUST precede join/leave traffic and reset replay windows.
- **Transcript/auth digests**: When transcripts are recorded (SFU or client), only digests/IDs/error codes are stored; no keys or plaintext. `handshake_secret` MUST NEVER be transmitted, logged, or included in any transcript structure (it appears only in test fixtures).
- **Replay windows**: Replay window semantics are defined by this specification; validators test conformance to the specification (not vice versa).

### 1.5.1 HKDF Label Registry (Normative)

All HKDF `info` labels are ASCII strings and MUST be used as their exact ASCII bytes (UTF-8 encoding of the same characters). Implementations MUST NOT add NUL terminators, whitespace, or hidden Unicode characters.

| Purpose | `info` label (ASCII) | ASCII bytes (hex) |
|---|---|---|
| Handshake root secret | `FW-Handshake-Root` | `46 57 2d 48 61 6e 64 73 68 61 6b 65 2d 52 6f 6f 74` |
| Double Ratchet root update | `FW-DR-Root` | `46 57 2d 44 52 2d 52 6f 6f 74` |
| Double Ratchet send chain seed | `FW-DR-CKS` | `46 57 2d 44 52 2d 43 4b 53` |
| Double Ratchet recv chain seed | `FW-DR-CKR` | `46 57 2d 44 52 2d 43 4b 52` |
| Double Ratchet message key | `FW-Message` | `46 57 2d 4d 65 73 73 61 67 65` |
| Double Ratchet chain key | `FW-Chain` | `46 57 2d 43 68 61 69 6e` |
| Stream key | `FW-StreamKey` | `46 57 2d 53 74 72 65 61 6d 4b 65 79` |
| Media epoch key | `FW-MediaEpochKey` | `46 57 2d 4d 65 64 69 61 45 70 6f 63 68 4b 65 79` |
| Media frame key | `FW-FrameKey` | `46 57 2d 46 72 61 6d 65 4b 65 79` |
| Control plane MAC key | `FW-CP-MAC` | `46 57 2d 43 50 2d 4d 41 43` |

When `info` is defined as a concatenation (e.g., `"FW-StreamKey" || call_id || ...`), the label bytes above are the prefix of the `info` byte string.

### 1.5.1.1 Strict Label Conformance (Normative)

Implementations claiming v0.9 conformance MUST treat the HKDF label registry above as exact.

- Implementations MUST use the exact ASCII bytes for the `FW-*` labels as specified.
- Implementations MUST reject any message, transcript, fixture, or derived-value claim that depends on legacy or alternate label strings (for example, any `FoxWhisper-*` label strings) as malformed / non-conformant.

This document does not define a backwards-compatibility mode.

### 1.5.2 HKDF Salt Semantics (Normative)

- HKDF `salt` is a byte string.
- Unless otherwise specified, `salt = 0^HashLen` (for SHA-256, 32 bytes of `0x00`).
- Integer salts MUST be encoded as fixed-width unsigned big-endian byte strings:
  - `U32BE(x)` is 4 bytes.
  - `U64BE(x)` is 8 bytes.
- `salt = ""` (zero-length) is distinct from `salt = 0^HashLen` and MUST NOT be substituted implicitly.

### 1.5.3 Algorithm Suite Identifier (Normative)

FoxWhisper v0.9 defines a single mandatory algorithm suite. When a handshake transcript includes selected cryptographic parameters, it MUST identify the suite using `crypto_suite_id`.

| `crypto_suite_id` | KEX | KEM | KDF | AEAD |
|---|---|---|---|---|
| `FW-CRYPTO-SUITE-01` | X25519 (RFC 7748) | ML-KEM-1024 (FIPS 203) | HKDF-SHA256 | AES-256-GCM |

Encoding rules:

- X25519 public keys are 32 bytes (RFC 7748 u-coordinate encoding).
- ML-KEM-1024 public keys are 1568 bytes; ciphertexts are 1568 bytes; shared secrets are 32 bytes.
- These values are transported as CBOR byte strings (`bstr`) on wire and as Base64 in JSON fixtures.

Note: protocol fields historically named `kyber_public_key` and `kyber_ciphertext` carry ML-KEM-1024 public key and ciphertext bytes in v0.9.

### 1.5.4 HKDF Function Definition (Normative)

All uses of HKDF in this specification refer to RFC 5869 HKDF with SHA-256 (Extract+Expand):

```
HKDF(input_key_material, salt, info, L):
    prk = HKDF-Extract(salt, input_key_material)   // HMAC-SHA256
    okm = HKDF-Expand(prk, info, L)                // HMAC-SHA256
    return okm
```

Pseudocode in this document MUST use named parameters (`input_key_material=...`, `salt=...`, `info=...`, `L=...`). If a positional form is used in any diagram/tooling, the order is exactly: `(input_key_material, salt, info, L)`.

Implementations claiming v0.9 conformance MUST implement these parameters and pass the published conformance vector/validator suites (CBOR, crypto, epoch-chain, SFU abuse, media) without relaxing these rules.

## 1.6 AEAD Context Separation (Normative)

FoxWhisper uses AES-256-GCM across multiple layers. Implementations MUST treat messaging and media encryption as distinct AEAD contexts with distinct nonce derivation domains and AAD construction rules. Nonces/IVs MUST be derived only from public context; secrets MUST NOT be included.

The constructions below use:

- `canonicalCBOR(x)` → canonical CBOR byte string of object `x`
- `Truncate_96bits(b)` → first 12 bytes of `b`
- `SHA256(b)` → 32-byte hash
- `U8(x)` → 1-byte unsigned integer encoding
- `||` → byte concatenation

### 1.6.1 Messaging AEAD Context (Normative)

- AAD: `aad = SHA256(canonicalCBOR(message_header))` (32 bytes).
- Nonce/IV:

  ```
  // Normalize the messaging context identifier to a fixed 32-byte value.
  // context_type: 0x01 = group, 0x02 = session
  // raw_context_id: group_id (when context_type=0x01) or session_id (when context_type=0x02)
  msg_context_id = SHA256("FW-MSG-CTX" || U8(context_type) || raw_context_id)

  message_nonce_context = {
      context_type: context_type,
      context_id: msg_context_id,      // 32 bytes
      epoch_id: epoch_id,              // 0 for pairwise/DR sessions
      sender_device_id: sender_device_id,
      message_index: message_index
  }
  iv = Truncate_96bits(SHA256("FW-NONCE-MSG" || canonicalCBOR(message_nonce_context)))
  ```

- Domain separation label bytes: ASCII `"FW-NONCE-MSG"`.
- Context-ID label bytes: ASCII `"FW-MSG-CTX"`.

### 1.6.2 Media AEAD Context (Normative)

- AAD: `aad = SHA256(canonicalCBOR(frame_header))` (32 bytes).
- Nonce/IV:

  ```
  media_nonce_context = {
      call_id: call_id,
      sender_device_id: sender_device_id,
      stream_id: stream_id,
      media_epoch: media_epoch,
      frame_sequence: frame_sequence
  }
  iv = Truncate_96bits(SHA256("FW-NONCE-MEDIA" || canonicalCBOR(media_nonce_context)))
  ```

- Domain separation label bytes: ASCII `"FW-NONCE-MEDIA"`.

### 1.6.3 Hash-Based IV Derivation Assumptions (Normative)

IVs in this specification are derived as `Truncate_96bits(SHA256(...))`.

- Implementations MUST ensure the underlying nonce-context tuple is unique for each encryption under a given AEAD key.
- Security analysis assumes SHA-256 collision resistance; truncation to 96 bits is treated as a pseudorandom 96-bit function for collision probability analysis.

Collisions are expected to be negligible at realistic scales; nevertheless, if an implementation detects reuse of nonce-derivation inputs under an AEAD key (e.g., monotonic counter rollback, duplicate `message_index`, duplicate `frame_sequence` for the same `(call_id, sender_device_id, stream_id, media_epoch)`, or local state loss/rollback), it MUST treat it as potential (key, IV) reuse and follow §1.7.

Implementations MUST NOT reuse nonce derivation inputs across contexts by omitting the domain separation label or by reusing a media-shaped tuple for messaging (or vice versa).

## 1.7 Nonce Safety Invariant (Normative)

Nonce reuse in AES-GCM under the same key is catastrophic. For any AEAD key `K`, a sender MUST ensure IV/nonce uniqueness across all encryptions under `K`.

- Crash/rollback safety: implementations MUST either (a) persist all monotonic counters used in nonce derivation across crashes/reboots, or (b) treat any loss/rollback of that state as a rekey event and derive fresh keys before encrypting again.
- Sender response: if a sender detects counter/sequence rollback, duplicate nonce inputs (e.g., duplicate `message_index` or duplicate `frame_sequence` under the same stream/epoch), or local state loss that could cause (key, IV) reuse, it MUST stop encrypting under the affected key and MUST trigger rekey/abort for that context (e.g., messaging resync, media epoch advance, or call teardown).
- Receiver response: if a receiver detects replay/rollback (duplicate counters/IVs inconsistent with its replay window policy), it MUST hard-drop the affected packets and SHOULD request resynchronization or abort the stream/session depending on deployment policy.
- Retransmission note: retransmitting the exact same ciphertext+IV+tag is not a new encryption and is permitted; re-encrypting different plaintext under the same IV and key is forbidden.

## 1.8 Identifier Encoding Conventions (Normative)

Unless explicitly stated otherwise, protocol identifiers are fixed-length byte strings encoded as CBOR byte strings (`bstr`) on wire:

- `call_id`: 16 bytes
- `group_id`: 16 bytes
- `channel_id`: 16 bytes (alias of `group_id` when used for routing/session-protocol membership)
- `user_id`: 16 bytes
- `device_id`: 16 bytes
- `stream_id`: 4 bytes
- `msg_id`: 16 bytes (session protocol correlation/idempotency)
- `envelope_id`: 16 bytes (session protocol delivery idempotency)
- `object_id`: 32 bytes (session protocol sync object identifier)

Terminology note:

- `sender_device_id` is the canonical field name for the media sender identity in frame headers; it carries the sender’s `device_id` bytes.
- `participant_id` is a historical alias for `sender_device_id` in older drafts/fixtures and MUST NOT be used in new on-wire encodings.

Derived identifiers:

- `session_id`: 32 bytes (SHA-256 output), encoded as CBOR `bstr` length 32

Documentation and JSON fixtures render byte strings using Base64 (RFC 4648, standard alphabet, with `=` padding) or hex for readability. Base64 is not a wire encoding; CBOR uses byte strings. Human-readable strings like `"call-67890"` are debug renderings only and MUST NOT appear in canonical CBOR or on-wire messages.

### 1.8.2 Legacy Input Rejection (Normative)

Implementations claiming v0.9 conformance MUST reject the following as malformed / non-conformant:

- Any HKDF `info` label string not in the v0.9 registry (e.g., any `FoxWhisper-*` prefixes).
- Any on-wire use of legacy field names such as `participant_id`.
- Any non-canonical CBOR encoding for on-wire objects that require canonical CBOR.
- Any on-wire use of human-readable identifier encodings (e.g., `"call-67890"`) in place of fixed-length CBOR `bstr` identifiers.

### 1.8.1 Strict Fixture Encoding (Normative)

For v0.9 conformance:

- JSON fixtures MUST use RFC 4648 Base64 with `=` padding for byte strings.
- Base64url (RFC 4648 URL-safe alphabet), unpadded Base64, or any other legacy/alternate encoding MUST be rejected as malformed / non-conformant.

JWK note (normative):

- JWK fields (and JWK base64url conventions) are documentation/tooling formats and MUST NOT
  appear in this specification's normative fixtures or on-wire encodings.

## 1.9 Protocol Wire Overview (Normative)

The protocol uses canonical CBOR (RFC 8949) for on-wire encoding. This overview summarizes the top-level objects and which fields are bound by AEAD AAD or signatures.

> **Threat Model + Trust Boundary (Messaging)**: The network and any relay/metadata services are untrusted. Confidentiality and integrity are end-to-end between endpoint devices. Authentication depends on the surrounding identity model (see §1.9.3).

> **Threat Model + Trust Boundary (Group Epochs)**: The group controller key(s) are trusted for authorization and sign EAREs. The network and servers are adversarial; clients enforce fork rules locally.

> **Threat Model + Trust Boundary (Media)**: The SFU is operationally trusted for routing/availability but cryptographically untrusted. It can see media headers and ciphertext but cannot decrypt payloads.

### 1.9.0 Handshake Wire Format (Normative)

This section defines the on-wire handshake messages used to establish a client↔server session.

#### 1.9.0.0 Handshake Freshness and Anti-Replay (Normative)

Handshake messages include `timestamp_ms` and `nonce` for abuse mitigation and replay
resistance. Implementations MUST enforce the rules below.

Parameters (normative defaults for v0.9 conformance):

- `HANDSHAKE_MAX_CLOCK_SKEW_MS = 300_000` (5 minutes)
- `HANDSHAKE_NONCE_TTL_MS = 600_000` (10 minutes)

Timestamp requirements:

- `timestamp_ms` is REQUIRED on all handshake messages.
- A receiver MUST reject a handshake message if `timestamp_ms` is outside the acceptance
  window:
  - `now_ms - HANDSHAKE_MAX_CLOCK_SKEW_MS <= timestamp_ms <= now_ms + HANDSHAKE_MAX_CLOCK_SKEW_MS`
- If `timestamp_ms` is missing or invalid type, reject with `BAD_FORMAT`.
- If `timestamp_ms` is outside the window, reject with `AUTH_FAILED`.

Error response behavior (normative):

- On `BAD_FORMAT` or freshness failures, the server MUST send `HANDSHAKE_ERROR` and MUST abort the handshake.
- The server MUST set `error_code = "BAD_FORMAT"` for missing/invalid fields.
- The server MUST set `error_code = "AUTH_FAILED"` for freshness/replay failures.

Nonce requirements:

- `nonce` is REQUIRED on `HANDSHAKE_INIT` and `HANDSHAKE_RESPONSE`.
- Nonce uniqueness scope is per `(client_id, server_id, crypto_suite_id)` tuple.
- A receiver MUST maintain a replay cache of recently seen nonces for at least
  `HANDSHAKE_NONCE_TTL_MS`.
- If a `(client_id, server_id, crypto_suite_id, nonce)` tuple is seen again within the TTL, reject with
  `AUTH_FAILED`.
- If `nonce` is missing or wrong length/type, reject with `BAD_FORMAT`.

Encoding rules:

- Handshake messages MUST be encoded as canonical CBOR maps.
- The top-level handshake message MUST be CBOR-tagged with one of the tags below.
- All byte-string fields are CBOR `bstr` of fixed lengths as specified.

CBOR tags (normative):

- `0xD1` = `HANDSHAKE_INIT`
- `0xD2` = `HANDSHAKE_RESPONSE`
- `0xD3` = `HANDSHAKE_COMPLETE`
- `0xD4` = `HANDSHAKE_ERROR`

#### 1.9.0.1 HANDSHAKE_INIT (client → server)

```
handshake_init = {
  "type": "HANDSHAKE_INIT",
  "version": 1,

  // Identity / routing
  "client_id": bstr,              // 16 bytes

  // Crypto suite selection
  "crypto_suite_id": "FW-CRYPTO-SUITE-01",
  "handshake_auth": text,         // e.g., "TLS-PINNED" or "ED25519-TRANSCRIPT"

  // Public KEX/KEM inputs
  "x25519_public_key": bstr,      // 32 bytes (RFC 7748 u-coordinate)
  "kyber_public_key": bstr,       // 1568 bytes (ML-KEM-1024 public key)

  // Anti-replay / freshness
  "timestamp_ms": uint64,
  "nonce": bstr                   // 16 bytes
}
```

Notes:

- Field names historically used `kyber_public_key`; in v0.9 this field carries ML‑KEM‑1024 public key bytes.
- Implementations MUST reject `HANDSHAKE_INIT` messages that omit required fields or violate fixed-length constraints.

#### 1.9.0.2 HANDSHAKE_RESPONSE (server → client)

```
handshake_response = {
  "type": "HANDSHAKE_RESPONSE",
  "version": 1,

  // Identity / routing
  "server_id": bstr,              // 16 bytes

  // Echo negotiated parameters
  "crypto_suite_id": "FW-CRYPTO-SUITE-01",
  "handshake_auth": text,

  // Public KEX/KEM inputs
  "x25519_public_key": bstr,      // 32 bytes
  "kyber_ciphertext": bstr,       // 1568 bytes (ML-KEM-1024 ciphertext)

  // Transcript binding
  "session_id": bstr,             // 32 bytes; MUST equal SHA256(canonicalCBOR(handshake_transcript_raw))

  // Key confirmation (see §1.9.3)
  "server_confirm": bstr,         // 32 bytes; MAY be omitted only under §1.9.3.2

  // Anti-replay / freshness
  "timestamp_ms": uint64,
  "nonce": bstr                   // 16 bytes
}
```

#### 1.9.0.3 HANDSHAKE_COMPLETE (client → server)

```
handshake_complete = {
  "type": "HANDSHAKE_COMPLETE",
  "version": 1,

  // Transcript binding
  "session_id": bstr,             // 32 bytes

  // Key confirmation (see §1.9.3)
  "client_confirm": bstr,         // 32 bytes; MAY be omitted only under §1.9.3.2

  // Anti-replay / freshness
  "timestamp_ms": uint64
}
```

#### 1.9.0.4 HANDSHAKE_ERROR (server → client)

```
handshake_error = {
  "type": "HANDSHAKE_ERROR",
  "version": 1,
  "error_code": text,             // see registry below
  "retryable": bool,
  "details": text                 // optional human-readable string
}
```

Handshake error codes (minimum set; normative):

- `BAD_FORMAT` (parse failure, invalid field sizes, missing required fields)
- `UNSUPPORTED_SUITE` (unknown or unsupported `crypto_suite_id`)
- `AUTH_FAILED` (handshake authentication policy failed)

Additional error codes MAY be defined, but implementations MUST support at least the above.

### 1.9.1 Messaging Wire Format (Normative)

An encrypted message is represented as:

- `message_header` (CBOR map; canonical encoding required)
- `ciphertext` (CBOR `bstr`)
- `auth_tag` (CBOR `bstr`, 16 bytes for AES-GCM)
- `iv` (CBOR `bstr`, 12 bytes)

`message_header` schema (required fields):

```
message_header = {
  "type": "ENCRYPTED_MESSAGE",
  "version": 1,
  "context_type": uint,         // 0x01 = group, 0x02 = session
  "raw_context_id": bstr,       // group_id (16 bytes) or session_id (32 bytes)
  "epoch_id": uint,             // 0 for pairwise/DR sessions
  "sender_device_id": bstr,     // 16 bytes
  "message_index": uint,
  "timestamp_ms": uint,
  "message_type": uint          // application-defined
}
```

AAD binding (normative):

- `aad = SHA256(canonicalCBOR(message_header))`.

IV handling (normative):

- The `iv` field is transmitted, but it is not an independent input: it is fully determined by the public nonce context in §1.6.1.
- Senders MUST set `iv` equal to the deterministic IV derived in §1.6.1.
- Receivers MUST recompute the expected IV from `message_header` (and the nonce context in §1.6.1) and MUST reject the message if the transmitted `iv` does not match, even if decryption would succeed with the transmitted IV.

#### 1.9.1.1 Messaging Replay Window (Normative)

Replay protection is enforced per sender and epoch, keyed by the tuple `(context_type, raw_context_id, epoch_id, sender_device_id)`.

Parameters:

- `MESSAGE_REPLAY_WINDOW_MESSAGES = 1024`.
- `MESSAGE_MAX_FORWARD_JUMP = 1024`.

Sender requirements:

- For each tuple above, senders MUST use a strictly increasing `message_index` (uint64) starting at 0 and MUST NOT reuse a `message_index` value under the same epoch keys.
- Retransmissions MAY resend the identical `(message_header, ciphertext, auth_tag, iv)`; this is not a new encryption. Re-encrypting different plaintext under the same derived IV and key is forbidden (see §1.7).

Receiver algorithm:

- Receivers maintain, per tuple above:
  - `highest_accepted` (uint64), initialized to 0 with an “unset” marker.
  - `seen` bitmap of length `MESSAGE_REPLAY_WINDOW_MESSAGES` tracking successfully authenticated messages.
- On `epoch_id` change for a given `(context_type, raw_context_id, sender_device_id)`, receivers MUST reset replay state for that epoch (i.e., start with `highest_accepted` unset and an empty `seen` bitmap for the new epoch).
- Receivers MUST NOT advance `highest_accepted` or update `seen` until the message passes AES‑256‑GCM authentication.

Epoch gating (group context):

- Receivers MUST drop any message whose `epoch_id` is less than the receiver’s currently validated epoch for that group.
- If a message’s `epoch_id` is greater than the receiver’s currently validated epoch, receivers MAY buffer only when `epoch_id = current+1` while fetching/validating the missing EARE/keys; they MUST NOT accept/decrypt until that epoch is validated.

Given a candidate message with `seq = message_index`:

1. Window expiry (avoid unsigned underflow): if `highest_accepted` is set and `highest_accepted >= MESSAGE_REPLAY_WINDOW_MESSAGES` and `seq <= highest_accepted - MESSAGE_REPLAY_WINDOW_MESSAGES`, drop with `MESSAGE_WINDOW_EXPIRED`.
2. Excessive forward jump (DoS protection): if `highest_accepted` is set and `seq > highest_accepted` and `seq - highest_accepted > MESSAGE_MAX_FORWARD_JUMP`, drop with `MESSAGE_INDEX_TOO_FAR`.
3. If `highest_accepted` is set and `seq <= highest_accepted`:
   - `idx = highest_accepted - seq`.
   - If `seen[idx]` is set, drop with `REPLAY_DETECTED`.
4. Verify AES‑256‑GCM (`aad`, `iv`, `auth_tag`). If authentication fails, drop and DO NOT update replay state.
5. On successful authentication:
   - If `highest_accepted` is unset: set `highest_accepted = seq`, clear `seen`, set `seen[0] = 1`.
   - Else if `seq > highest_accepted`:
     - `delta = seq - highest_accepted`.
     - If `delta >= MESSAGE_REPLAY_WINDOW_MESSAGES`: clear `seen`.
     - Else: left-shift `seen` by `delta` and clear the lowest `delta` bits.
     - Set `highest_accepted = seq` and set `seen[0] = 1`.
   - Else (`seq <= highest_accepted` and not previously seen): set `seen[highest_accepted - seq] = 1`.

Delivery semantics:

- A receiver MUST deliver at most one application-level message per `(context_type, raw_context_id, epoch_id, sender_device_id, message_index)`; duplicates MUST be dropped and MUST NOT be delivered twice.

### 1.10 Double Ratchet (Normative)

This section defines the normative Double Ratchet behavior for pairwise messaging sessions
(i.e., `context_type = 0x02`, `epoch_id = 0`). It is aligned with the Signal Double Ratchet
construction in structure (root-key update mixed with DH output; per-direction chain keys;
per-message keys), but all encodings, labels, and on-wire context binding are defined here.

#### 1.10.1 State

```
DR_State = {
  session_id: bstr(32),
  self_device_id: bstr(16),
  peer_device_id: bstr(16),

  root_key: bstr(32),
  self_dh_priv: bstr(32),
  self_dh_pub: bstr(32),
  peer_dh_pub: bstr(32),

  send_chain_key: bstr(32),
  recv_chain_key: bstr(32),
  send_counter: uint64,
  recv_counter: uint64,

  skipped_keys: Map<uint64, bstr(32)>
}
```

Constants (normative defaults):

- `DR_MAX_SKIP = 1024` (maximum number of skipped message keys retained per session)

#### 1.10.2 Initialization

After handshake completion:

- `root_key = handshake_secret` (32 bytes; §6.1.1).

Each device MUST generate an initial DH ratchet keypair:

- `self_dh_priv, self_dh_pub = X25519_KeyGen()`.

Initial chain keys are derived from the root key and the two device IDs for direction
separation:

```
send_chain_key = HKDF(
  input_key_material = root_key,
  salt = 0^HashLen,
  info = "FW-DR-CKS" || session_id || self_device_id || peer_device_id,
  L = 32
)
recv_chain_key = HKDF(
  input_key_material = root_key,
  salt = 0^HashLen,
  info = "FW-DR-CKR" || session_id || self_device_id || peer_device_id,
  L = 32
)
send_counter = 0
recv_counter = 0
```

Note: `peer_device_id` is the device ID authenticated for this session by the handshake
authentication policy (§1.9.3).

#### 1.10.3 Message Key Derivation (Sending)

To encrypt a message at `message_index = send_counter`:

```
message_key = HKDF(
  input_key_material = send_chain_key,
  salt = U64BE(send_counter),
  info = "FW-Message",
  L = 32
)

next_send_chain_key = HKDF(
  input_key_material = send_chain_key,
  salt = 0^HashLen,
  info = "FW-Chain",
  L = 32
)
```

The sender MUST then:

- set `send_chain_key = next_send_chain_key`
- set `send_counter = send_counter + 1`

#### 1.10.4 Message Key Derivation (Receiving)

On receiving a message with `message_index = i`:

1. If `i < recv_counter`:
   - If `skipped_keys[i]` exists, use it and delete it.
   - Otherwise, drop as replay (`REPLAY_DETECTED`) or `MESSAGE_WINDOW_EXPIRED`.
2. If `i > recv_counter`:
   - The receiver MUST derive and cache skipped keys for indices `recv_counter .. i-1`.
   - If caching would exceed `DR_MAX_SKIP`, the receiver MUST evict oldest cached skipped keys
     and SHOULD signal an error; implementations MAY treat this as non-conformant input and abort.
3. Derive `message_key` for `i` using `recv_chain_key` and `U64BE(i)` as in §1.10.3.
4. Advance `recv_chain_key` by applying the chain-key update step repeatedly until
   `recv_counter = i+1`.

Skips cache derivation (normative):

```
for j in recv_counter .. i-1:
  skipped_keys[j] = HKDF(
    input_key_material = recv_chain_key,
    salt = U64BE(j),
    info = "FW-Message",
    L = 32
  )
  recv_chain_key = HKDF(
    input_key_material = recv_chain_key,
    salt = 0^HashLen,
    info = "FW-Chain",
    L = 32
  )
recv_counter = i
```

Then derive `message_key` for index `i`, decrypt, and finally set `recv_counter = i+1`.

#### 1.10.5 DH Ratchet Step (Signal-aligned)

To achieve post-compromise recovery, implementations MAY periodically perform a DH ratchet
step by mixing a new DH output into the root key.

This spec defines a minimal, unambiguous DH ratchet update:

```
dh_out = X25519(self_dh_priv, peer_dh_pub)

// v0.9 strict conformance: implementations MUST NOT reuse "FW-Handshake-Root" for DR root updates.
root_key = HKDF(
  input_key_material = root_key || dh_out,
  salt = 0^HashLen,
  info = "FW-DR-Root",
  L = 32
)

// Reset per-direction chain keys after a DH step
send_chain_key = HKDF(
  input_key_material = root_key,
  salt = 0^HashLen,
  info = "FW-DR-CKS" || session_id || self_device_id || peer_device_id,
  L = 32
)
recv_chain_key = HKDF(
  input_key_material = root_key,
  salt = 0^HashLen,
  info = "FW-DR-CKR" || session_id || self_device_id || peer_device_id,
  L = 32
)
send_counter = 0
recv_counter = 0
skipped_keys = {}
```

Notes:

- This is Signal-aligned in structure but not byte-for-byte identical to Signal's KDF naming.
- Implementations MUST apply the messaging AEAD nonce/AAD rules in §1.6.1/§1.9.1 regardless
  of DH ratchet usage.

### 1.9.2 Media Wire Format (Normative)

A media frame is represented as:

- `frame_header` (CBOR map; canonical encoding required)
- `ciphertext` (CBOR `bstr`)
- `auth_tag` (CBOR `bstr`, 16 bytes for AES-GCM)
- `iv` (CBOR `bstr`, 12 bytes)

AAD binding (normative):

- `aad = SHA256(canonicalCBOR(frame_header))`.

IV handling (normative):

- The `iv` field is transmitted, but it is not an independent input: it is fully determined by the public nonce context in §1.6.2.
- Senders MUST set `iv` equal to the deterministic IV derived in §1.6.2.
- Receivers MUST recompute the expected IV from `frame_header` (and the nonce context in §1.6.2) and MUST reject the frame if the transmitted `iv` does not match, even if decryption would succeed with the transmitted IV.

Replay-window handling (normative):

- Receivers MUST enforce the media replay window defined in §3.5.4.1.

### 1.9.3 Handshake Authentication and Key Confirmation (Normative)

The hybrid handshake transcript hash binds all public handshake inputs and selected suite parameters. Concretely, the transcript hash MUST cover (at minimum) both X25519 public keys, the client ML‑KEM public key (`kyber_public_key`) if exchanged, the ML‑KEM ciphertext (`kyber_ciphertext`), and the selected `crypto_suite_id` / authentication mode. Confidentiality of derived secrets comes from X25519 + ML‑KEM. Authentication is provided by the surrounding identity/transport model.

- Implementations MUST NOT treat an unauthenticated handshake as secure against man-in-the-middle.
- Implementations MUST provide peer authentication by either:
  - running the handshake inside an authenticated, confidential transport (e.g., TLS 1.3) with peer identity verification (certificate/public-key pinning), OR
  - signing the transcript hash with long-term Ed25519 identity keys that are verified via a trusted directory/controller.

Key confirmation (normative): implementations MUST implement key confirmation bound to the transcript hash (e.g., `HMAC-SHA256(handshake_secret, transcript_hash)`) so mismatched transcripts/keys are detected early. When the handshake is executed entirely inside an authenticated transport that already provides mutual key confirmation (e.g., TLS 1.3) and the implementation binds the FoxWhisper transcript to that channel, the transport MAY be treated as satisfying this requirement and an additional protocol-level confirmation message MAY be omitted.

#### 1.9.3.1 Explicit Key Confirmation (Normative)

Unless omitted under the TLS rule in §1.9.3.2, implementations MUST perform explicit mutual
key confirmation using the 32-byte `handshake_secret` and the 32-byte transcript hash
(`transcript_sha256`, which equals `session_id`).

Definitions:

- `transcript_sha256 = SHA256(canonicalCBOR(handshake_transcript_raw))`
- `client_confirm = HMAC-SHA256(handshake_secret, "FW-KC-CLIENT" || transcript_sha256)`
- `server_confirm = HMAC-SHA256(handshake_secret, "FW-KC-SERVER" || transcript_sha256)`

Where `"FW-KC-CLIENT"` and `"FW-KC-SERVER"` are ASCII strings and `||` is byte concatenation.

Message carriage (normative):

- `HANDSHAKE_RESPONSE` MUST include `server_confirm` as CBOR `bstr` length 32.
- `HANDSHAKE_COMPLETE` MUST include `client_confirm` as CBOR `bstr` length 32.

Missing-key-confirmation rule (normative):

- If `handshake_auth` does not indicate TLS-based authentication per §1.9.3.2, then missing
  `server_confirm` or `client_confirm` is a hard failure and MUST be treated as `AUTH_FAILED`.

Verification rules (normative):

- A client MUST verify `server_confirm` before considering the handshake complete.
- A server MUST verify `client_confirm` before considering the handshake complete.

Failure handling (normative):

- If confirmation fails, the receiver MUST abort the session and MUST treat the handshake as failed.
- The server SHOULD respond with `HANDSHAKE_ERROR` with `error_code = "AUTH_FAILED"` when applicable.

#### 1.9.3.2 TLS-Based Authentication (Key Confirmation Omission Rule) (Normative)

If the handshake runs inside TLS 1.3 with mutual peer authentication (certificate/public-key
pinning, or equivalent deployment policy) and `handshake_auth` indicates TLS-based
authentication (e.g., `"TLS-PINNED"`), an implementation MAY omit the explicit
`client_confirm` / `server_confirm` fields.

Binding requirement (normative): even when explicit confirmation fields are omitted,
implementations MUST still bind the FoxWhisper transcript to the authenticated TLS channel by
requiring both sides to:

1. Compute `session_id = SHA256(canonicalCBOR(handshake_transcript_raw))` from the
   public handshake inputs exchanged on that TLS connection.
2. Include `session_id` in `HANDSHAKE_RESPONSE` and `HANDSHAKE_COMPLETE`.
3. Verify that the peer-provided `session_id` matches the locally computed `session_id`.

If any check fails, the handshake MUST be rejected as `AUTH_FAILED`.

### 1.9.4 Session Protocol (Normative)

Earlier drafts used the prefix CP_* ('Control Plane'). This specification uses SP_* ('Session Protocol') exclusively. CP_* identifiers MUST NOT appear on wire.

FoxWhisper requires a minimal session protocol between client devices and the metadata server `S` to support:

- Session lifecycle and liveness (keepalive, graceful close).
- Reliable delivery of opaque, end‑to‑end encrypted envelopes (the server routes; clients decrypt).
- Client-owned encrypted sync objects (friends list, channel index, device state) stored by the server but not readable or forgeable by it.
- Channel membership routing decisions that are server-enforced but client-verifiable.

Control plane messages are **not end-to-end encrypted among clients**; the server may read them. They MUST be integrity-protected and replay-protected at the session layer.

#### 1.9.4.1 Control Message Framing (Normative)

Control plane messages are canonical CBOR maps. Each message has common fields plus type-specific fields.

Common fields:

- `type` (CBOR text): one of the `SP_*` message types defined below.
- `version` (uint): MUST be 1.
- `session_id` (bstr, 32 bytes): MUST equal the handshake transcript hash (`session_id`) for the active client↔server session.
- `seq` (uint64): per-direction session sequence number.
- `timestamp_ms` (uint64): sender wall-clock time (milliseconds since Unix epoch).
- `msg_id` (bstr, 16 bytes): sender-chosen unique identifier for correlation/idempotency.
- `in_reply_to` (bstr, 16 bytes): OPTIONAL; `msg_id` of the request being answered.
- `mac` (bstr, 32 bytes): session-layer integrity tag (see below).

Session-layer integrity key (where `handshake_secret` is the 32-byte handshake root secret derived by the hybrid handshake KDF; see §6.1.1):

```
sp_mac_key = HKDF(
  input_key_material = handshake_secret,
  salt = 0^HashLen,
  info = "FW-CP-MAC",
  L = 32
)
```

MAC computation (normative):

- Let `m0` be the control message object with the `mac` field removed.
- `mac = HMAC-SHA256(sp_mac_key, canonicalCBOR(m0))`.
- Receivers MUST verify `mac` before acting on any session-protocol message.

Trust note (normative): the session-protocol MAC protects against network tampering and accidental corruption; it does not protect a client against a malicious or compromised server endpoint.

Transport note:

- Control plane messages MAY be sent over a secure transport (e.g., TLS). Transport confidentiality does not replace the required MAC verification.

#### 1.9.4.2 Session Protocol Replay Protection (Normative)

Receivers MUST enforce replay protection over session-protocol `seq` values per `(session_id, direction)`.

Parameters:

- `SP_REPLAY_WINDOW_MESSAGES = 64`.
- `SP_MAX_FORWARD_JUMP = 64`.

Receiver algorithm:

- Apply the same sliding-window logic as §1.9.1.1 (Messaging Replay Window), replacing `message_index` with `seq` and using the parameters above.
- Replay state MUST NOT be updated until after the `mac` is verified.

#### 1.9.4.3 Session and Liveness Messages (Normative)

`SP_HELLO` (client → server): announce device and negotiate session parameters.

```
sp_hello = {
  "type": "SP_HELLO",
  "version": 1,
  "session_id": session_id,
  "device_id": device_id,               // bstr (16 bytes)
  "protocol_version": "0.9",           // text
  "capabilities": capabilities,         // CBOR map (deployment-defined)
  "desired_keepalive_ms": keepalive_ms, // OPTIONAL uint64
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_WELCOME` (server → client): server parameters for this connection.

```
sp_welcome = {
  "type": "SP_WELCOME",
  "version": 1,
  "session_id": session_id,
  "server_time_ms": server_time_ms,      // uint64
  "rate_limits": rate_limits,            // map (e.g., max_envelopes_per_minute)
  "max_envelope_bytes": max_envelope_bytes, // uint64
  "keepalive_ms": keepalive_ms,          // uint64
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "in_reply_to": hello_msg_id,
  "mac": mac
}
```

`SP_PING` / `SP_PONG` (either direction): keepalive and RTT measurement.

```
sp_ping = {
  "type": "SP_PING",
  "version": 1,
  "session_id": session_id,
  "ping_id": ping_id,                   // bstr (8–16 bytes)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}

sp_pong = {
  "type": "SP_PONG",
  "version": 1,
  "session_id": session_id,
  "ping_id": ping_id,
  "server_time_ms": server_time_ms,     // OPTIONAL uint64
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "in_reply_to": ping_msg_id,
  "mac": mac
}
```

`SP_GOODBYE` (either direction): graceful close.

```
sp_goodbye = {
  "type": "SP_GOODBYE",
  "version": 1,
  "session_id": session_id,
  "reason_code": reason_code,           // text (e.g., "CLIENT_SHUTDOWN")
  "details": details,                   // OPTIONAL text
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_RESULT` (either direction): generic acknowledgment for a prior request.

```
sp_result = {
  "type": "SP_RESULT",
  "version": 1,
  "session_id": session_id,
  "in_reply_to": request_msg_id,        // bstr (16 bytes)
  "status": status,                    // text: "OK" | "ERROR"
  "error_code": error_code,            // OPTIONAL text
  "details": details,                  // OPTIONAL text
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

Request/response requirements (normative):

- The server MUST respond with `SP_RESULT` to `SP_SUBSCRIBE`, `SP_PUT_OBJECT`, `SP_INVITE_CREATE`, `SP_INVITE_ACCEPT`, and `SP_MEMBER_REMOVE`.
- When a request fails, the server MUST set `status = "ERROR"` and provide an `error_code`.

#### 1.9.4.4 Reliable Delivery of Opaque Envelopes (Normative)

The server routes opaque envelopes to a subscribed device. The server MUST NOT assume it can decrypt or validate envelope contents.

`SP_SUBSCRIBE` (client → server): request delivery for a device.

```
sp_subscribe = {
  "type": "SP_SUBSCRIBE",
  "version": 1,
  "session_id": session_id,
  "user_id": user_id,                   // OPTIONAL bstr (16 bytes)
  "device_id": device_id,               // bstr (16 bytes)
  "cursor": cursor,                     // OPTIONAL bstr (16 bytes) last acked envelope_id
  "want_backlog": want_backlog,         // OPTIONAL bool (default true)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_ENQUEUE_ENVELOPE` (client → server): enqueue an opaque envelope for delivery.

```
sp_enqueue_envelope = {
  "type": "SP_ENQUEUE_ENVELOPE",
  "version": 1,
  "session_id": session_id,

  "target_device_id": target_device_id, // bstr (16 bytes)
  "envelope_id": envelope_id,           // bstr (16 bytes)
  "payload_cbor": payload_cbor,         // bstr (opaque CBOR bytes)

  // OPTIONAL TTL for server-side delivery policy
  "expiry_ms": expiry_ms,               // OPTIONAL uint64 (milliseconds since Unix epoch)

  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

Server requirements (normative):

- The server MUST treat `payload_cbor` as an opaque byte string and MUST store/forward it byte-for-byte (no re-encoding).
- Idempotency: the server MUST treat `(target_device_id, envelope_id)` as an idempotency key.
  - If the pair has already been enqueued, the server MUST NOT enqueue a duplicate.
  - The server MUST respond with `SP_RESULT(OK)` to duplicate enqueues.
- The server MUST enforce a deployment-defined maximum envelope size and reject oversized payloads.
- If `payload_cbor` is oversized, the server MUST reply with `SP_RESULT` where `status = "ERROR"` and `error_code = "TOO_LARGE"`, and MUST NOT enqueue.
- If `expiry_ms` is provided, the server MUST treat it as an upper bound on delivery attempts and MUST NOT deliver the envelope after `expiry_ms`.
- If `expiry_ms` is omitted, server delivery TTL/expiry is deployment policy.

Client requirements (normative):

- The client MUST generate a fresh random `envelope_id` (16 bytes) per logical envelope.
- The client SHOULD retry `SP_ENQUEUE_ENVELOPE` on transient errors using the same `envelope_id`.

`SP_DELIVER` (server → client): deliver one batch of envelopes.

Each delivered envelope is:

```
delivery_envelope = {
  "envelope_id": envelope_id,           // bstr (16 bytes)
  "payload_cbor": payload_cbor,         // bstr (opaque CBOR bytes)
  "received_at_ms": received_at_ms      // OPTIONAL uint64
}
```

And the delivery message is:

```
sp_deliver = {
  "type": "SP_DELIVER",
  "version": 1,
  "session_id": session_id,
  "envelopes": [delivery_envelope, ...],
  "more": more,                         // OPTIONAL bool (server has more backlog)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

Server requirements:

- The server MUST treat `payload_cbor` as an opaque byte string and MUST forward it byte-for-byte (no re-encoding).
- The server MUST retry deliveries until it receives a matching `SP_ACK` or terminal `SP_NACK`.
- The server MUST deduplicate by `envelope_id` and MUST NOT enqueue the same `(device_id, envelope_id)` twice.

Client requirements:

- The client MUST verify the session-protocol `mac` and replay window before attempting to CBOR-decode `payload_cbor`.
- The client MUST treat `envelope_id` as an idempotency key and MUST NOT process the same envelope twice.

`SP_ACK` (client → server): acknowledge receipt.

```
sp_ack = {
  "type": "SP_ACK",
  "version": 1,
  "session_id": session_id,
  "envelope_id": envelope_id,           // bstr (16 bytes)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_NACK` (client → server): cannot process envelope.

```
sp_nack = {
  "type": "SP_NACK",
  "version": 1,
  "session_id": session_id,
  "envelope_id": envelope_id,           // bstr (16 bytes)
  "error_code": error_code,             // text (e.g., "BAD_FORMAT", "TOO_LARGE")
  "details": details,                   // OPTIONAL text
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

#### 1.9.4.5 Client-Owned Encrypted Sync Objects (Normative)

The server stores client-owned sync objects as opaque ciphertext blobs. The server MUST NOT be able to read or forge object updates.

Well-known object kinds (minimum set for interoperability):

- `OBJ_FRIENDS`
- `OBJ_CHANNEL_INDEX`
- `OBJ_DEVICE_STATE`

Object identifier derivation (recommended):

- `UTF8(s)` denotes the UTF-8 bytes of text string `s`.

```
object_id = SHA256("FW-OBJ-ID" || owner_user_id || UTF8(object_kind))   // 32 bytes
```

Object encryption (normative):

- Each object kind has a `client_object_key` (32 bytes) shared across the user’s devices (distributed via the secure device-linking mechanism).
- Plaintext is canonical CBOR.
- AAD and IV are deterministic:
  - `obj_aad = SHA256(canonicalCBOR({"object_id": object_id, "object_version": v}))`
  - `iv = Truncate_96bits(SHA256("FW-NONCE-OBJ" || canonicalCBOR({"object_id": object_id, "object_version": v})))`
- Encrypt with AES-256-GCM: `ciphertext, auth_tag = AES-256-GCM(client_object_key, plaintext, obj_aad, iv)`.

`SP_GET_OBJECT` (client → server): fetch latest object.

```
sp_get_object = {
  "type": "SP_GET_OBJECT",
  "version": 1,
  "session_id": session_id,
  "object_id": object_id,               // bstr (32 bytes)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_PUT_OBJECT` (client → server): publish an update.

```
sp_put_object = {
  "type": "SP_PUT_OBJECT",
  "version": 1,
  "session_id": session_id,
  "object_id": object_id,               // bstr (32 bytes)
  "object_version": v,                  // uint64
  "ciphertext": ciphertext,             // bstr
  "auth_tag": auth_tag,                 // bstr (16 bytes)
  "iv": iv,                             // bstr (12 bytes)
  "writer_device_id": device_id,        // bstr (16 bytes)
  "writer_sig": writer_sig,             // bstr (Ed25519 signature)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

Where `writer_sig = ed25519_sign(writer_device_privkey, canonicalCBOR(put_object_without_writer_sig_and_mac))`.

`SP_OBJECT` (server → client): return an object record.

```
sp_object = {
  "type": "SP_OBJECT",
  "version": 1,
  "session_id": session_id,
  "object_id": object_id,
  "object_version": v,
  "ciphertext": ciphertext,
  "auth_tag": auth_tag,
  "iv": iv,
  "writer_device_id": writer_device_id,
  "writer_sig": writer_sig,
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "in_reply_to": request_msg_id,        // OPTIONAL
  "mac": mac
}
```

Versioning and rollback rules (normative):

- Object versions MUST be strictly monotonically increasing per `object_id`.
- The server MUST reject `SP_PUT_OBJECT` updates where `object_version` is less than or equal to the stored version.
- Clients MUST treat receipt of an older `object_version` than previously observed as a rollback attempt and MUST NOT silently accept it.

#### 1.9.4.6 Channel Membership and Invites (Normative)

The server must route by membership. Membership changes MUST be authorized by a signed capability or a signed request by an authorized identity.

Minimal, capability-style invite token:

```
invite_token = {
  "type": "CHANNEL_INVITE_TOKEN",
  "version": 1,
  "channel_id": channel_id,             // bstr (16 bytes)
  "invitee_user_id": invitee_user_id,  // bstr (16 bytes)
  "permissions": permissions,           // map/array (deployment-defined)
  "issued_at_ms": issued_at_ms,
  "expiry_ms": expiry_ms,
  "nonce": nonce,                       // bstr (16 bytes)
  "issuer_device_id": issuer_device_id, // bstr (16 bytes)
  "signature": ed25519_sign(issuer_privkey, canonicalCBOR(token_without_signature))
}
```

`SP_INVITE_CREATE` (client → server): register an invite token for delivery/routing.

```
sp_invite_create = {
  "type": "SP_INVITE_CREATE",
  "version": 1,
  "session_id": session_id,
  "invite_token": invite_token,         // CBOR map
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_INVITE_ACCEPT` (client → server): accept an invite.

```
sp_invite_accept = {
  "type": "SP_INVITE_ACCEPT",
  "version": 1,
  "session_id": session_id,
  "invite_token": invite_token,
  "accepting_device_id": device_id,     // bstr (16 bytes)
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_MEMBER_REMOVE` (client → server): remove a member (authorization required).

```
sp_member_remove = {
  "type": "SP_MEMBER_REMOVE",
  "version": 1,
  "session_id": session_id,
  "channel_id": channel_id,
  "member_user_id": member_user_id,
  "removal_proof": removal_proof,       // CBOR map; deployment-defined signed request/capability
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "mac": mac
}
```

`SP_MEMBER_LIST` (server → client): return server routing membership view (advisory).

Normative directionality:

- `SP_MEMBER_LIST` is server → client only; clients MUST NOT send this message.

```
sp_member_list = {
  "type": "SP_MEMBER_LIST",
  "version": 1,
  "session_id": session_id,
  "channel_id": channel_id,
  "members": [user_id, ...],            // array of bstr (16 bytes)
  "proofs": proofs,                     // OPTIONAL array of invite/removal proofs
  "timestamp_ms": timestamp_ms,
  "seq": seq,
  "msg_id": msg_id,
  "in_reply_to": request_msg_id,        // OPTIONAL
  "mac": mac
}

Routing privacy note (normative):

- The server MUST maintain internal mappings of `channel_id → user_ids` and `user_id → device_ids` for routing.
- `SP_MEMBER_LIST` is an advisory user-level routing view and MUST NOT include device identifiers.
- Clients MUST NOT depend on server-provided membership or device topology for cryptographic decisions.
```

Authorization requirements (normative):

- The server MUST verify signatures on `invite_token` (and on `removal_proof` where applicable) against an authorized channel authority key set.
- The server MUST enforce `expiry_ms` and MUST reject expired tokens.
- Clients MUST NOT treat server membership as cryptographic truth for end-to-end messaging; cryptographic membership is enforced by EARE validation and local epoch rules.

#### 1.9.4.7 Session Protocol State Machines (Normative)

Session lifecycle:

- After the handshake completes, the client MUST send `SP_HELLO`. The server MUST reply with `SP_WELCOME` (or `SP_RESULT` with `status="ERROR"`). After a successful welcome, both sides consider the session protocol session ACTIVE.
- While ACTIVE, either side MAY send `SP_PING` and MUST respond to a valid ping with `SP_PONG`.
- Either side MAY initiate graceful shutdown by sending `SP_GOODBYE`. After sending or receiving `SP_GOODBYE`, the peer MUST stop initiating new session-protocol requests and SHOULD close the underlying transport promptly.

Reliable delivery:

- A device becomes eligible for delivery after a successful `SP_SUBSCRIBE` / `SP_RESULT(OK)`.
- The server MAY send `SP_DELIVER` at any time while the session is ACTIVE.
- For each `delivery_envelope`, the client MUST respond with exactly one of:
  - `SP_ACK(envelope_id)` after durable receipt and/or successful handoff to the decrypt/dispatch pipeline, OR
  - `SP_NACK(envelope_id, error_code)` if it cannot process the envelope.
- The server MUST retry unacked envelopes until acked or until a deployment-defined terminal policy triggers drop; retries MUST reuse the same `envelope_id`.

Object sync:

- `SP_GET_OBJECT` is a read: server replies `SP_OBJECT` if present, otherwise `SP_RESULT(ERROR)`.
- `SP_PUT_OBJECT` is a write: server replies `SP_RESULT(OK)` if stored, otherwise `SP_RESULT(ERROR)`.
- Clients MUST enforce monotonic `object_version` locally; the server MUST reject stale writes; clients MUST treat rollback as a hard error.

Channel membership:

- `SP_INVITE_CREATE` registers an `invite_token` for routing; server replies `SP_RESULT`.
- `SP_INVITE_ACCEPT` applies an invite; server replies `SP_RESULT`.
- `SP_MEMBER_REMOVE` removes a member (authorization required); server replies `SP_RESULT`.
- `SP_MEMBER_LIST` returns the server’s current routing view; clients treat it as advisory unless accompanied by proofs.

---

# 2. Formal Verification Framework

FoxWhisper v0.9 refines the formal verification framework with a unified threat model and clearer security properties.

This section is non-normative. It defines vocabulary and modeling hooks for the reference Tamarin/ProVerif models and provides informal intent statements; it does not replace the protocol’s normative MUST/SHOULD requirements.

## 2.0 Assumptions and Scope (Non-normative)

Assumptions used by the intent statements below:

- Handshake authentication and key confirmation are satisfied per §1.9.3 (e.g., authenticated transport or transcript signing, plus confirmation).
- Group-controller signing keys are pinned/authorized; devices verify EARE signatures/PoP before accepting epoch state.
- Compromise is modeled explicitly via `DeviceCompromise(...)`; securely erased past keys are not assumed recoverable.

Scope notes:

- Mechanized models use a Dolev–Yao adversary model; the prose below should not be read as a computational reduction.
- Claims are scoped to the SFU/network attacker. Invited endpoints that legitimately hold keys can decrypt by design.

## 2.1 System Model

Formal model alignment: Tamarin and ProVerif models MUST use the shared vocabulary, events, and constructors in `docs/v0.9-formal-modeling-conventions.md` so that AAD/IV contexts and key-derivation labels remain consistent with the normative text and cross-language test vectors.

### 2.1.1 Actors

| Actor | Capabilities | Trust Model |
|--------|-------------|------------|
| Client Device C | Cryptographic operations, state management | Honest or compromised |
| Group Controller G | Membership management, epoch authority | Honest |
| Metadata Server S | Message routing, metadata storage | Dolev-Yao adversary |
| SFU F | Media frame forwarding, participant management | Dolev-Yao adversary |
| Network Attacker A | Full network control, Byzantine behavior | Dolev-Yao adversary |

### 2.1.2 Unified Dolev-Yao Adversary Model

**Adversary Capabilities**:
The attacker controls the network and may fully control the metadata server and SFU. They can intercept, replay, drop, reorder, and inject messages at will, and may cause the server and SFU to behave arbitrarily (Byzantine behavior).

**Trust Boundaries**:

- **Trusted Parties**: Clients and group controllers are the only trusted parties
- **Untrusted Parties**: Metadata server and SFU are "logically untrusted; modelled as if fully controlled by the adversary"

**Formal Adversary Definition**:

```
Adversary A ∈ Dolev-Yao:
  - Can read, modify, drop, reorder, inject all network messages
  - Can control metadata server S and SFU F completely
  - Cannot break cryptography; compromise is modeled explicitly via `DeviceCompromise(D)` events that reveal device secrets to the adversary
  - Can perform arbitrary symbolic computation on known terms; cryptographic primitives are modeled as perfect (no decryption/forgery without the required keys unless revealed by compromise events)
```

This unified model makes formal verification more standard and easier to reason about.

### 2.1.3 Event System

**Cryptographic Events**:

- `HandshakeInit(C, S, params)` - Initiate PQ handshake
- `HandshakeComplete(C, S, session_key)` - Establish shared secret
- `EpochAdvance(G, epoch_id, EARE)` - Transition to new epoch
- `SendMessage(D, G, msg)` - Send encrypted message
- `ReceiveMessage(D, G, msg)` - Receive encrypted message

**Media Events**:

- `SendMediaFrame(C, F, frame)` - Send encrypted media frame
- `ReceiveMediaFrame(C, F, frame)` - Receive encrypted media frame
- `DeviceJoin(C, call_id, participant)` - Participant joins call
- `DeviceLeave(C, call_id, participant)` - Participant leaves call

**State Events**:

- `DeviceReset(D)` - Device loses state and rejoins
- `DeviceCompromise(D)` - Device confirmed compromised

## 2.2 Formal State Machines

### 2.2.1 Double Ratchet State Machine

```
DR_State = {
  root_key: K_R,
  dh_private: k_dh_priv,
  dh_public: k_dh_pub,
  send_chain_key: K_CK_s,
  recv_chain_key: K_CK_r,
  send_counter: N_s,
  recv_counter: N_r,
  skipped_keys: Map<uint, K_msg>
}

Transitions:
- DR_AdvanceSendingChain(DR_State) -> DR_State'
- DR_AdvanceReceivingChain(DR_State) -> DR_State'
- DR_DHRatchetStep(DR_State, dh_pub_remote) -> DR_State'
```

### 2.2.2 Group Messaging State Machine

```
Group_State = {
  group_id: GID,
  epoch_id: EID,
  members: Set<Device>,
  eare_chain: EARE_0, EARE_1, ..., EARE_n,
  sender_keys: Map<Device, GroupSenderCK_0>,
  message_indices: Map<Device, uint>
}

Transitions:
- Group_AddMember(Group_State, Device) -> Group_State'
- Group_RemoveMember(Group_State, Device) -> Group_State'
- Group_EpochAdvance(Group_State, EARE) -> Group_State'
- Group_ReceiveMessage(Group_State, Message) -> Group_State'
```

### 2.2.3 Media State Machine

```
Media_State = {
  call_id: CallID,
  call_key: K_call,
  participants: Set<Device>,
  stream_keys: Map<Device, Map<StreamID, K_stream>>,
  media_epoch: MEID
}

Transitions:
- Media_AddParticipant(Media_State, Device) -> Media_State'
- Media_RemoveParticipant(Media_State, Device) -> Media_State'
- Media_Rekey(Media_State) -> Media_State'
```

## 2.3 Security Goals (Informal)

The statements below describe intended security goals and include brief proof sketches. Exact, machine-checked properties live in the Tamarin/ProVerif models; this section is not a substitute for those proofs and is not itself normative.

### 2.3.1 Confidentiality

**Goal**: An adversary cannot learn the plaintext of a message unless it compromises at least one endpoint device that legitimately holds the corresponding session or group keys.

**Sketch (non-normative)**:

```
forall msg, A: 
  (msg ∈ Messages ∧ A ∉ CompromisedDevices) =>
    A ⊬ plaintext(msg)
```

**Proof Sketch**: Uses standard AEAD confidentiality+integrity security combined with secrecy of the underlying key exchange / ratchet-derived keys.

### 2.3.2 Past Secrecy (Forward Secrecy)

**Goal**: Compromise of a device at time t does not reveal message keys for messages sent before t, assuming old message keys/chain keys are securely deleted.

**Sketch (non-normative intuition)**:

```
forall t, msg, D:
  (msg.time < t ∧ D ∈ CompromisedAt(t)) =>
    adversary ⊬ msg_key(msg)
```

**Proof Sketch**: Past secrecy comes from deleting per-message keys and advancing the ratchet so previously-used key material is not recoverable from current state.

### 2.3.3 Post-Compromise Security

**Goal**: After a device compromise at time t, once a healing event occurs and assuming the attacker does not retain ongoing access to the device, the attacker cannot forge messages that authenticate as coming from the device for times > t. Healing events are triggered by: (a) a new DH ratchet step, (b) a new epoch with fresh sender keys, or (c) a device reset/rejoin with fresh keys.

**Sketch (non-normative)**:

```
forall t, msg, A:
  (CompromiseDetected(t) ∧ msg.time > t ∧ msg.sender = D) =>
    A ⊬ forge(msg, D)
```

**Proof Sketch**: Healing events cause honest peers to derive fresh keys that are unknown to an attacker who no longer has access to the device’s secrets. Device identity keys/signatures are primarily used for authenticating session-protocol records (e.g., EARE signatures), not for preventing data-plane forgery during an active compromise.

### 2.3.4 Epoch Integrity

**Goal (Safety + Eventual Consistency)**:

- Safety: No two honest devices accept conflicting signed EAREs for the same `(group_id, epoch_id)`.
- Liveness (under stated network assumptions): honest devices eventually converge to the same membership view once they have received and validated the same EARE chain.

**Sketch (non-normative safety)**:

```
forall epoch, D1, D2, E1, E2:
  (D1, D2 ∈ HonestDevices ∧ AcceptedEARE(D1, epoch, E1) ∧ AcceptedEARE(D2, epoch, E2)) =>
    E1 = E2
```

**Proof Sketch**: Signed, hash-chained Epoch Authenticity Records (EARE) plus fork-resolution rules ensure that honest devices reject conflicting branches for the same epoch and converge on a single valid chain.

### 2.3.5 Replay Security

**Goal**: An adversary cannot successfully replay a message outside its acceptable replay window.

**Sketch (non-normative)**:

```
forall msg, A:
  (msg.replay ∧ now - msg.timestamp > REPLAY_WINDOW) =>
    msg.accepted = false
```

**Proof Sketch**: Replay resistance is enforced by receiver state and an explicit acceptance policy (e.g., a sliding window over message indices/sequence numbers). Timestamps may be used to bound state and garbage-collect old entries; uniqueness alone does not prevent replay without such a policy.

## 2.4 Tamarin/ProVerif Model Hooks

### 2.4.1 Protocol Rules for Tamarin

```
rule Handshake_Init:
  [ Frac(~ltkA @ A), !HandshakeStarted(A, B) ]
  --[ HandshakeInit(A, B, params) ]
  -> [ HandshakeStarted(A, B), Frac(ltkA @ A) ]

rule DR_Send_Message:
  [ SendReady(D), DR_State(D, ck, n) ]
  --[ SendMessage(D, encrypt(plaintext, ck), n) ]
  -> [ SendReady(D), DR_State(D, ck', n+1) ]

rule Group_Epoch_Advance:
  [ EpochReady(G), EARE(E), Group_State(G, epoch) ]
  --[ EpochAdvance(G, epoch+1, EARE') ]
  -> [ EpochReady(G), Group_State(G, epoch+1), EARE'(E) ]
```

### 2.4.2 ProVerif Equations

```
function derive_message_key(chain_key, index):
  return HKDF(
    input_key_material = chain_key,
    salt = U64BE(index),
    info = "FW-Message",
    L = 32
  )

function verify_epoch_integrity(eare_current, eare_previous):
  return SHA256(eare_previous) == eare_current.previous_epoch_hash

function check_sender_key_uniqueness(sender_id, epoch, new_key):
  existing_key = get_sender_key(sender_id, epoch)
  return existing_key == NULL || existing_key == new_key
```

### 2.4.3 Lemmas for Automated Proofs

**Lemma 1 (Key Separation)**: Message keys derived from different chain keys are computationally independent.

**Lemma 2 (Epoch Monotonicity)**: Epoch IDs strictly increase and never repeat.

**Lemma 3 (Sender Uniqueness)**: Each sender can have only one root key per epoch.

These lemmas enable automated theorem proving for core security properties.

---

# 3. FoxWhisper Media Profile v1 (SFU-Based)

FoxWhisper Media Profile v1 provides a complete, secure media encryption framework designed for Selective Forwarding Units (SFUs) while maintaining end-to-end security. The profile integrates seamlessly with FoxWhisper messaging protocol and enables real-time voice/video communication with formal security guarantees.

> **Threat Model + Trust Boundary (Media)**: The SFU and network are adversarial. Endpoints enforce all cryptographic checks (epoch/membership rules, replay windows, AES‑GCM verification). The SFU can observe media headers and ciphertexts for routing but MUST NOT access end-to-end keys.

## 3.1 Design Principles

**SFU Trust Model**: The SFU is operationally trusted for availability/routing but cryptographically untrusted; it routes encrypted media frames without access to plaintext content or end-to-end keys.

**End-to-End Security**: Media encryption and decryption occur only on endpoint devices, never on SFU or intermediate network elements.

**Scalability**: Support for large group calls (100+ participants) with efficient bandwidth usage and minimal latency.

**Key Separation / Compartmentalization**: Compromise of one stream’s derived keys does not automatically grant access to other streams’ derived keys.

Media provides epoch-level past secrecy if old epoch keys are securely deleted; it does not provide per-frame break-in recovery within an epoch.

## 3.2 Cryptographic Foundations

### 3.2.1 Key Hierarchy

```
User Identity Key (Ed25519)
    └── Device Identity Keys (Ed25519)
        └── Call Keys (per-call, per-media-epoch)
            └── Stream Keys (per-participant, per-stream)
                └── Frame Keys (per-frame, derived from stream keys)
```

### 3.2.2 Media Key Schedule (Refined)

**Call Key Generation and Distribution (Normative)**:

`callKey` is a fresh, uniformly random 32-byte secret generated by a participating endpoint device (the call initiator or a designated controller device) using a cryptographically secure RNG. If `callKey` is generated by a server-side service, that deployment is server-trusted encryption and is not end-to-end encrypted in the usual sense.

`callKey` is scoped to a specific `media_epoch`. On every media epoch advance (join/leave rekey or periodic rekey), a new `callKey` MUST be generated and distributed to the current membership. This prevents late joiners from decrypting prior-epoch media.

```
call_id = random(16 bytes)
media_epoch = 0
callKey[media_epoch] = random(32 bytes)
```

Distribution (normative):

- `callKey[e]` MUST be distributed end-to-end encrypted over the FoxWhisper messaging layer as a `CALL_KEY_UPDATE` plaintext payload (defined below) carried inside an `ENCRYPTED_MESSAGE`.
- The payload MUST bind at least `(call_id, media_epoch)` and carry the 32-byte `call_key` for that epoch.
- The SFU MAY relay encrypted key blobs but MUST NOT receive or access plaintext media keys.
- Devices MUST securely delete `callKey[e]` once they have advanced past epoch `e`.

#### 3.2.2.1 Call Key Distribution Payloads (Normative)

`CALL_KEY_UPDATE` plaintext payload (CBOR map; canonical encoding required):

```
call_key_update = {
    "type": "CALL_KEY_UPDATE",
    "version": 1,
    "call_id": call_id,             // bstr (16 bytes)
    "media_epoch": media_epoch,     // uint
    "call_key": callKey[media_epoch], // bstr (32 bytes)

    // Optional bindings for implementations that tie calls to groups
    "group_id": group_id,           // optional bstr (16 bytes)

    // Operational metadata (does not replace cryptographic binding)
    "issued_at_ms": issued_at_ms    // optional uint64
}
```

Transport rules:

- A `CALL_KEY_UPDATE` MUST be sent as the encrypted plaintext of an `ENCRYPTED_MESSAGE` (messaging AEAD).
- For group calls where the call membership is exactly the current group membership for the relevant epoch, a single group-context message MAY be used.
- If call membership is a strict subset of a group (or if a leave/join update must exclude specific devices), the sender MUST send per-recipient encrypted messages so non-participants or removed devices do not receive `call_key` for the new `media_epoch`.

Receiver rules:

- Receivers MUST treat the `call_key_update` fields as authenticated data (integrity-protected by the enclosing AEAD) and MUST reject if `(call_id, media_epoch)` does not match local call state or violates monotonic epoch advance.
- Receivers MUST enforce authorization for who may advance `media_epoch` and distribute `call_key` (deployment-defined, e.g., initiator/controller device or admin devices). Unauthorized call-key updates MUST be ignored.

**Stream Key Derivation**:

```
streamKey[i] = HKDF(
    input_key_material = callKey[media_epoch],
    salt = 0^HashLen,
    info = "FW-StreamKey" || call_id || U32BE(media_epoch) || sender_device_id[i] || stream_id[i],
    L = 32
)
```

**Media Epoch Key Derivation (Refined)**:

```
mediaEpochKey[i] = HKDF(
    input_key_material = streamKey[i],
    salt = U32BE(media_epoch),
    info = "FW-MediaEpochKey",
    L = 32
)
```

**Frame Key Derivation (Refined)**:

```
frameKey[i][n] = HKDF(
    input_key_material = mediaEpochKey[i],
    salt = U64BE(frame_sequence[n]),
    info = "FW-FrameKey",
    L = 32
)
```

**Key Hierarchy Clarifications**:

- `mediaEpochKey` depends only on `streamKey` + `media_epoch` (one key per epoch)
- `frameKey` depends on `mediaEpochKey` + `frame_sequence`
- `frame_counter` is removed from epoch key derivation entirely
- Clean separation between epoch-level and frame-level key derivation

### 3.2.3 Security Properties

**End-to-End Confidentiality (SFU/Network)**: Media payload confidentiality is end-to-end between call participants. The SFU and network attackers cannot decrypt media without endpoint keys.

**Compromise Scope (Epoch-Scoped)**:

- `callKey[e]` is shared among the current call membership for epoch `e`. Compromise of `callKey[e]` (or compromise of any device that holds it) compromises confidentiality of media for epoch `e`.
- This protocol does not attempt to prevent an authorized participant (or compromised participant device) from decrypting other participants’ media; group-call E2EE protects against the SFU/network, not against invited endpoints.

**Membership Revocation via Epoch Advance**: On join/leave rekeys, a fresh `callKey[e+1]` is distributed only to current members. Removed members (who do not receive `callKey[e+1]`) cannot decrypt future epochs.

**Forward Secrecy Across Epochs (Best-Effort)**: If endpoints securely delete old `callKey[e]` and derived keys when advancing epochs, later compromise does not automatically reveal past epochs.

**Key Separation (Streams/Frames)**: Distinct `(call_id, media_epoch, sender_device_id, stream_id)` inputs produce distinct per-stream keys. This supports clean separation of streams and helps avoid accidental (key, nonce) reuse across different streams/devices.

## 3.3 SFU Authentication Framework (Refined)

### 3.3.1 Authentication Model

The SFU MAY authenticate clients (sessions) for admission control and abuse mitigation, but it is untrusted for end-to-end security. Endpoints MUST treat the SFU as potentially adversarial and MUST enforce all end-to-end checks (epoch/membership rules and AES-256-GCM verification) locally.

### 3.3.2 SFU Admission Control (Controller-Signed Tokens)

SFU admission control uses bearer tokens issued by a trusted call controller / authorization service. Tokens are signed so that verification requires only the controller’s public key (no symmetric key distribution between clients and SFU).

**Controller-Signed Admission Token (Normative)**:

```
sfu_admission_token = {
    "type": "SFU_ADMISSION_TOKEN",
    "call_id": call_id,                          // CBOR bstr
    "client_id": client_id,                      // CBOR bstr
    "client_device_pubkey": client_device_pubkey, // Ed25519 public key (32-byte CBOR bstr)
    "issued_at_ms": issued_at_ms,                // uint64 milliseconds since Unix epoch
    "expiry_ms": expiry_ms,                      // uint64 milliseconds since Unix epoch
    "nonce": nonce,                              // CBOR bstr (RECOMMENDED 16 bytes)
    "capabilities": client_capabilities,         // CBOR map/array (deployment-defined)
    "aud": sfu_id_or_domain,                     // REQUIRED audience binding
    "signature": ed25519_sign(controller_privkey, canonicalCBOR(token_without_signature))
}
```

- The token is a bearer credential and MUST be transmitted only over an authenticated, confidential channel (e.g., TLS).
- The SFU MUST verify `signature` using a pinned `controller_pubkey` and MUST enforce `aud` matching, `call_id`/`client_id` matching, and token time validity (`issued_at_ms`, `expiry_ms`).
- Replay protection: the SFU MUST reject replays of the same `(call_id, nonce)` and MUST retain its replay cache at least until `expiry_ms + MAX_CLOCK_SKEW_MS`.
- Proof-of-possession: the SFU MUST require the client to prove possession of the private key corresponding to `client_device_pubkey` (example below) to reduce the impact of stolen bearer tokens.
- Clients MUST NOT be required to share symmetric secrets with the SFU for admission control as part of this protocol.

**SFU Endpoint Authentication (Client-side)**:
Clients MUST authenticate the SFU endpoint before sending media. Acceptable mechanisms include:

- TLS with certificate/public-key pinning under a deployment-specific trust root, OR
- a controller-signed `sfu_session_descriptor` that binds the expected SFU endpoint and TLS identity to `call_id` (example below), verified by the client using `controller_pubkey`.

Example descriptor:

```
sfu_session_descriptor = {
    "type": "SFU_SESSION_DESCRIPTOR",
    "call_id": call_id,
    "aud": sfu_id_or_domain,
    "sfu_endpoint": sfu_endpoint,
    "sfu_tls_cert_sha256": SHA256(sfu_tls_certificate_der),
    "issued_at_ms": issued_at_ms,
    "expiry_ms": expiry_ms,
    "signature": ed25519_sign(controller_privkey, canonicalCBOR(descriptor_without_signature))
}
```

**Client Proof-of-Possession (Normative)**:

- During SFU session establishment, the SFU MUST provide a fresh random `sfu_challenge` (CBOR `bstr`, RECOMMENDED 16 bytes).
- The client MUST respond with a proof signed by the private key corresponding to `client_device_pubkey` in the admission token:

```
sfu_join_proof = {
    "type": "SFU_JOIN_PROOF",
    "call_id": call_id,
    "client_id": client_id,
    "token_nonce": nonce,
    "sfu_challenge": sfu_challenge,
    "signature": ed25519_sign(client_device_privkey, canonicalCBOR(proof_without_signature))
}
```

The SFU MUST verify this signature using `client_device_pubkey` from the admission token.

**Token Lifetime and Replay Window**:

- `issued_at_ms` and `expiry_ms` are `uint64` milliseconds since Unix epoch.
- Admission tokens MUST have a short validity period (RECOMMENDED ≤ 5 minutes).
- `aud` is REQUIRED and MUST match the receiving SFU’s configured audience identifier to prevent cross-SFU/cross-environment replay.
- `MAX_CLOCK_SKEW_MS = 300_000` (5 minutes) for v0.9 conformance. Deployments MAY configure a tighter (smaller) value; deployments SHOULD NOT increase it without a strong operational reason.
- `nonce` is REQUIRED. The SFU MUST reject replays of the same `(call_id, nonce)` and MUST retain its replay cache until at least `expiry_ms + MAX_CLOCK_SKEW_MS` (or call teardown).
- Time validity checks on `issued_at_ms`/`expiry_ms` MUST apply `MAX_CLOCK_SKEW_MS` as symmetric tolerance: accept only when `issued_at_ms - MAX_CLOCK_SKEW_MS <= now_ms <= expiry_ms + MAX_CLOCK_SKEW_MS`.

### 3.3.3 Media Frame Integrity (End-to-End)

Media frame integrity and authenticity for endpoints is provided by the AES-256-GCM authentication tag.

- The `auth_tag` field in `media_frame` is the AES-256-GCM tag produced during encryption under `frameKey`.
- This profile does not define an additional per-frame HMAC. An SFU does not possess `frameKey` and therefore cannot verify end-to-end media authenticity.

**Verification Responsibilities**:

- SFU: MAY verify client authentication tokens before routing media (admission/abuse mitigation only).
- Clients: MUST authenticate the SFU endpoint (see §3.3.2) before establishing an SFU session.
- Clients: MUST verify AES-256-GCM (`aad`, `iv`, `auth_tag`) and MUST enforce membership/epoch/replay checks before rendering media.

## 3.4 Media Frame Structure

### 3.4.1 Frame Header

```
media_frame_header = {
    version: 1,
    call_id: bytes[16] (CBOR bstr length 16),
    sender_device_id: bytes[16] (CBOR bstr length 16),
    stream_id: bytes[4] (CBOR bstr length 4),
    frame_sequence: uint64,
    media_epoch: uint32,
    timestamp_ms: uint64 milliseconds since Unix epoch,
    payload_type: uint8,
    flags: uint8  // REQUIRED (set to 0 if unused)
}
```

### 3.4.2 Frame Payload

**Payload Types**:

- `0x01`: Audio payload (Opus, AAC, etc.)
- `0x02`: Video payload (H.264, VP9, AV1, etc.)
- `0x03`: Data channel messages
- `0x04`: Control messages (key frame requests, rekeying)

### 3.4.3 Frame Encryption with Deterministic IV

**Deterministic IV Construction (Preferred)**:

```
media_nonce_context = {
    call_id: call_id,
    sender_device_id: sender_device_id,
    stream_id: stream_id,
    media_epoch: media_epoch,
    frame_sequence: frame_sequence
}
iv = Truncate_96bits(SHA256("FW-NONCE-MEDIA" || canonicalCBOR(media_nonce_context)))
```

**Frame Encryption**:

```
// Plaintext is the payload only (a single CBOR value)
frame_plaintext = canonicalCBOR(payload)
aad = SHA256(canonicalCBOR(frame_header))
frame_ciphertext = AES-256-GCM(
    key = frameKey,
    plaintext = frame_plaintext,
    aad = aad,
    iv = iv
)
```

Payload encoding is unambiguous: `payload` is a single CBOR value (RECOMMENDED: `bstr` containing codec frame bytes). Implementations MUST NOT concatenate multiple CBOR encodings or merge header fields into the plaintext.

**Nonce Reuse Considerations**:
IV is deterministic and derived from public context. Implementations MUST ensure no (key, IV) reuse for AES-GCM, including across crashes/rollbacks (see §1.7).

**Frame Output (JSON Fixture Rendering)**:

On wire, `ciphertext`, `auth_tag`, and `iv` are CBOR byte strings (`bstr`). Base64 is used only for documentation/fixtures.

```
media_frame_fixture_json = {
    "header": frame_header,
    "ciphertext_b64": base64_encode(frame_ciphertext.ciphertext),
    "auth_tag_b64": base64_encode(frame_ciphertext.auth_tag),
    "iv_b64": base64_encode(iv)
}
```

## 3.5 Call Management

### 3.5.1 Call Establishment

**Call Initiation**:

1. Initiator generates `call_id` and initial `callKey[0]` (with `media_epoch = 0`).
2. Initiator sends a call invitation over FoxWhisper messaging that includes `call_id`, `media_epoch`, and end-to-end encrypted key blobs carrying `callKey[media_epoch]` for each recipient device.
3. Recipients decrypt `callKey[media_epoch]`, derive `streamKey`/`mediaEpochKey`/`frameKey`, and begin media encryption/decryption for that epoch.
4. Participants obtain controller-signed SFU admission and authenticate the SFU endpoint (see §3.3.2), then connect to the SFU.
5. SFU establishes media routing for the call (routing only; no access to end-to-end keys).

### 3.5.2 Participant Management

**Join During Active Call**:

```
join_protocol:
    controller_or_initiator -> {
        // Membership change triggers an epoch advance and fresh keying material
        media_epoch += 1
        callKey[media_epoch] = random(32 bytes)
        send_CALL_KEY_UPDATE_over_messaging(call_id, media_epoch, callKey[media_epoch])  // CALL_KEY_UPDATE payload; see §3.2.2.1
    }

    new_participant -> {
        authenticate_with_sfu()
        wait_for_CALL_KEY_UPDATE_over_messaging(call_id, media_epoch)  // see §3.2.2.1
        derive_stream_keys_and_begin_media(callKey[media_epoch])
    }
```

Media key distribution MUST be end-to-end encrypted to recipient devices (e.g., via the FoxWhisper messaging layer). The SFU MAY relay encrypted key blobs but MUST NOT receive or access plaintext media keys (e.g., `callKey`, `streamKey`, `mediaEpochKey`, `frameKey`).

**Leave During Active Call**:

```
leave_protocol:
    leaving_participant -> {
        stop_sending_media()
        revoke_local_media_state()
    }

    controller_or_initiator -> {
        // Membership change triggers an epoch advance and fresh keying material
        media_epoch += 1
        callKey[media_epoch] = random(32 bytes)
        send_CALL_KEY_UPDATE_over_messaging(call_id, media_epoch, callKey[media_epoch])  // CALL_KEY_UPDATE payload; see §3.2.2.1
    }

    sfu -> {
        stop_routing_to_departing_device()
    }
```

### 3.5.3 Media Epoch Management

**Automatic Rekeying**:

- Media epoch advances (a) on membership changes (join/leave). Implementations SHOULD also advance epochs on suspected sender state rollback/nonce safety violations (see §1.7). Periodic epoch advances MAY be used as defense-in-depth (RECOMMENDED: every 10–30 minutes); frame-count-based triggers are NOT RECOMMENDED because media frame rates vary widely and can cause excessive rekey churn.
- On epoch advance to `e`, the controller/initiator generates a fresh `callKey[e]` and distributes it end-to-end encrypted to all current member devices over the messaging layer.
- After receiving `callKey[e]`, devices derive `streamKey`/`mediaEpochKey`/`frameKey` for epoch `e` and MUST securely delete `callKey[e-1]` and all derived keys for prior epochs.

**Manual Rekeying**:

- Any participant MAY request immediate epoch advance.
- Deployments MUST define who is authorized to advance epochs (e.g., initiator/controller; group consensus in group calls).

### 3.5.4 Media Retransmission and Loss Recovery

- RTX/NACK retransmissions MUST resend the identical ciphertext + AAD (no re-encryption, no nonce/IV changes). SFUs MAY buffer/resend but MUST NOT alter payload, IV, or tag.
- Retransmission is only permitted while the frame’s sequence number remains inside the active replay window for the current media epoch/stream (see §3.5.4.1). After an epoch advance or window expiry, retransmits MUST be dropped.
- FEC/repair symbols (if deployed) are covered by the same AAD and replay window as the primary frame; receivers MUST drop any repair symbol that fails epoch/AAD/window checks.
- Receivers MUST hard-drop late/retransmitted packets that fail AAD, epoch tag, or replay-window validation; no reassembly or partial acceptance is allowed.

#### 3.5.4.1 Media Replay Window (Normative)

Replay protection is enforced per stream and epoch, keyed by the tuple `(call_id, sender_device_id, stream_id, media_epoch)`.

Parameters:

- `MEDIA_REPLAY_WINDOW_FRAMES = 64`.

Sender requirements:

- For each tuple above, senders MUST use a strictly increasing `frame_sequence` (uint64) starting at 0.
- Senders MUST NOT reuse a `frame_sequence` value under the same epoch keys. If a sender loses/rolls back its sequence state, it MUST trigger an epoch advance (fresh `callKey[e+1]`) before encrypting again.

Receiver algorithm:

- Receivers maintain, per tuple above:
  - `highest_accepted` (uint64), initialized to 0 with an “unset” marker.
  - `seen` bitmap of length `MEDIA_REPLAY_WINDOW_FRAMES` tracking successfully authenticated frames.
- On `media_epoch` advance, receivers MUST reset replay state for the new epoch (i.e., start with `highest_accepted` unset and an empty `seen` bitmap for that epoch).
- Receivers MUST NOT advance `highest_accepted` or update `seen` until the frame passes AES‑GCM authentication.

Given a candidate frame with `seq = frame_sequence`:

1. Epoch gating (must be applied before replay checks):
   - If `media_epoch` is less than the receiver’s current epoch for that stream, drop (stale/replay).
   - If `media_epoch` is greater than the receiver’s current epoch, follow §5.1: the receiver MAY buffer when `media_epoch = current+1` while fetching/validating membership+keys, but MUST NOT accept/decrypt until that epoch state is validated.
2. Window expiry (avoid unsigned underflow): if `highest_accepted` is set and `highest_accepted >= MEDIA_REPLAY_WINDOW_FRAMES` and `seq <= highest_accepted - MEDIA_REPLAY_WINDOW_FRAMES`, drop with `FRAME_WINDOW_EXPIRED`.
3. If `highest_accepted` is set and `seq <= highest_accepted`:
   - `idx = highest_accepted - seq`.
   - If `seen[idx]` is set, drop with `REPLAY_DETECTED`.
4. Verify AES‑256‑GCM (`aad`, `iv`, `auth_tag`). If authentication fails, drop and DO NOT update replay state.
5. On successful authentication:
   - If `highest_accepted` is unset: set `highest_accepted = seq`, clear `seen`, set `seen[0] = 1`.
   - Else if `seq > highest_accepted`:
     - `delta = seq - highest_accepted`.
     - If `delta >= MEDIA_REPLAY_WINDOW_FRAMES`: clear `seen`.
     - Else: left-shift `seen` by `delta` and clear the lowest `delta` bits.
     - Set `highest_accepted = seq` and set `seen[0] = 1`.
   - Else (`seq <= highest_accepted` and not previously seen): set `seen[highest_accepted - seq] = 1`.

### 3.5.5 Join/Leave Rekey and Routing Grace

- SFU-visible metadata includes the media frame header fields needed for routing/ops (e.g., `call_id`, `stream_id`, `sender_device_id`, `media_epoch`, `frame_sequence`, `payload_type`, `timestamp_ms`, `flags`) plus ciphertext/tag/IV lengths. Keys, plaintext, and end-to-end secrets remain end-to-end.
- Join: endpoints MUST advance the media epoch and switch to fresh epoch keying material (i.e., a new `callKey[media_epoch]`) before sending frames that the new participant is expected to decrypt. Receivers MUST reject frames whose (`sender_device_id`, `media_epoch`) is not consistent with current membership. SFU SHOULD delay routing join traffic until it observes the epoch switch to reduce wasted bandwidth.
- Leave: endpoints MUST advance the media epoch and switch to fresh epoch keying material (new `callKey[media_epoch]`), and MUST stop using prior-epoch keys for new encryptions. Receivers MUST drop frames from non-members or from previous epochs. SFU SHOULD stop forwarding to the departing device after a bounded grace period (RECOMMENDED ≤ one replay window).
- Leavers MUST NOT be able to decrypt post-leave frames due to the mandatory epoch advance; late joiners start at the first epoch/sequence after the join rekey and MUST NOT decrypt earlier frames.

### 3.5.6 Multi-Device Participation

- Keys are per-device; each media stream is labeled with `sender_device_id` and `stream_id` in AAD, and SFU routing MUST preserve these labels.
- Per-device joins/leaves force media epoch advance as in 3.5.5; routing to a leaving device MUST cease after grace ≤ one replay window.
- Late-joining devices begin at the first post-join epoch/sequence and MUST NOT decrypt prior frames; receivers drop frames whose `sender_device_id` is not in the current membership/epoch.

### 3.5.7 Cross-Layer Error Taxonomy (Media-Focused)

- Canonical errors: `EPOCH_DESYNC`, `DEVICE_NOT_MEMBER`, `FRAME_WINDOW_EXPIRED`, `REPLAY_DETECTED`, `SFU_AUTH_FAILED`, `KEY_MISMATCH`, `TRANSCRIPT_MISMATCH`.
- Severity and actions:
  - Fatal: `SFU_AUTH_FAILED`, persistent `KEY_MISMATCH`, repeated `EPOCH_DESYNC` ⇒ teardown or forced resync.
  - Recoverable: `REPLAY_DETECTED`, `FRAME_WINDOW_EXPIRED`, single `DEVICE_NOT_MEMBER` ⇒ drop frame, optionally request resend; continue media.
  - Warning: transient skew; log/telemetry only.
- Cross-layer propagation: media `EPOCH_DESYNC`/`DEVICE_NOT_MEMBER` MAY trigger messaging resync or epoch advance; messaging hiccups that do not alter keys MUST NOT disrupt media.

### 3.5.8 SFU Authentication, Key Lifecycle, and Transcript Integrity

- **SFU admission and endpoint authentication**: clients present a controller-signed `sfu_admission_token` (Ed25519) for admission; SFU verifies using a pinned `controller_pubkey` and enforces expiry + `(call_id, nonce)` replay protection. Clients MUST authenticate the SFU endpoint using TLS (certificate/public-key pinning) or a controller-signed `sfu_session_descriptor` (see §3.3.2).
- **Key lifecycle**: SFU MAY route key IDs or encrypted key blobs; it MUST enforce call/epoch scoping and deny cross-call/epoch reuse (`KEY_LEAK_ATTEMPT`). Admission-token replay caches are per-call and MAY be cleared on token expiry or call teardown.
- **Transcript integrity**: SFU transcripts record only digests/IDs/error codes (no keys or plaintext). `header_digest = SHA256(canonicalCBOR([frame_header, routing_metadata]))`; each entry includes routing action, reason/error, `track_id`, `media_epoch`, `frame_sequence` range, and participants. Transcripts MUST be consistent with the media error taxonomy above.
- **Visibility**: SFU never sees raw frame keys or plaintext; only routing metadata, digests, and optional encrypted key blobs.

## 3.6 Security Analysis

### 3.6.1 Threat Model (Unified)

**SFU Compromise**: SFU learns routing information but cannot decrypt media content.

**Network Attacker**: Can inject, modify, or replay media frames but cannot forge valid authentication.

**Participant Compromise**: Compromise of any participant device that holds `callKey[e]` enables decryption (and potential injection/forgery) of media for epoch `e` across the call. This design protects against the SFU/network, not against invited endpoints.

**Insider Threat**: A malicious participant is an authorized endpoint and is expected to be able to decrypt other participants’ media by design. The protocol does not provide cryptographic non-repudiation or strong origin attribution against malicious insiders; post-leave privacy is enforced by epoch rekeying and withholding `callKey[e+1]` from removed devices.

### 3.6.2 Security Guarantees

**Confidentiality**: Media frames are readable only by intended participants; the SFU can only route/forward based on visible metadata and cannot decrypt payloads.

**Integrity (Non‑Members)**: Any modification of media frames by the SFU/network is detectable through the AES‑GCM authentication tag.

**Origin Authentication (Non‑Members)**: Frames are authenticated as originating from some device that possesses the correct epoch keying material. The protocol does not provide cryptographic non‑repudiation or strong origin attribution among call members (a malicious insider can forge frames for other participants’ streams).

**Forward Secrecy Across Epochs (Best‑Effort)**: If endpoints securely delete `callKey[e]` and derived keys when advancing epochs, later compromise does not automatically reveal past epochs. Removed members cannot decrypt future epochs because they do not receive `callKey[e+1]`.

**Replay Protection**: Receivers MUST enforce a per‑stream sliding replay window over `frame_sequence` within the current `media_epoch` and drop duplicates/out‑of‑window frames (see §3.5.4.1).

## 3.7 Performance Considerations

### 3.7.1 Bandwidth Optimization

**Frame Batching**: SFU can batch multiple media frames in single network packet to reduce overhead.

**Key Distribution Optimization**: Epoch call keys (`callKey[media_epoch]`) are distributed once per epoch to current members (end-to-end encrypted via messaging); per-stream and per-frame keys are derived locally.

**Compression**: Media payloads are typically compressed at the codec/application layer prior to encryption; avoid adding general-purpose compression at the protocol layer in sensitive contexts (see §4.4.1 caution).

### 3.7.2 Latency Optimization

**Frame Size Limits**: Maximum frame size of 1200 bytes to ensure timely delivery.

**Key Derivation Caching**: Frequently used HKDF results are cached to reduce computational overhead.

**Parallel Processing**: Multiple media streams can be processed in parallel on multi-core devices.

---

# 4. Performance Architecture Framework (Non-normative)

FoxWhisper v0.9 provides a comprehensive performance architecture enabling high-throughput, low-latency operation across diverse deployment scenarios from mobile devices to enterprise servers.

This section is non-normative implementation guidance; it is not required for protocol conformance.

## 4.1 Design Principles

**Concurrency-First Design**: All operations are designed for parallel execution with minimal blocking and deterministic resource management.

**Resource Awareness**: Clear bounds on memory usage, CPU utilization, and network bandwidth to enable predictable performance at scale.

**Scalability Focus**: Architecture supports from small group chats (2-3 participants) to large enterprise channels (10,000+ members) with linear performance characteristics.

## 4.2 Messaging Performance Architecture

### 4.2.1 Double Ratchet Pipeline

**Pipeline Stages**:

```
incoming_message_queue → signature_verification → aad_validation → dr_ratchet_step → 
key_derivation → decryption → plaintext_processing → outgoing_message_queue
```

**Concurrency Model**:

```
class DRPipeline {
    // Thread-safe state management
    atomic<DR_State> dr_state;
    concurrent_queue<Message> incoming_queue;
    thread_pool<WorkerThread> decryption_workers;
    
    // Non-blocking message processing
    void processMessage(Message msg) {
        incoming_queue.enqueue(msg);
        if (dr_state.compare_exchange_weak()) {
            schedule_ratchet_step();
        }
    }
    
    // Parallel decryption
    void processBatch() {
        batch = incoming_queue.dequeue_batch(BATCH_SIZE);
        workers.parallel_process(batch);
    }
}
```

**Performance Optimizations**:

- **Batched Ratchet Steps**: Multiple DH ratchets combined into single computation
- **Key Caching**: Frequently used message keys cached with LRU eviction
- **Speculative Decryption**: Pre-derive keys for anticipated message indices
- **Memory Pooling**: Reuse cryptographic buffers to reduce allocation overhead

### 4.2.2 Sender-Key Batching System

**Batch Distribution Protocol**:

```
class SenderKeyBatch {
    struct BatchedDistribution {
        epoch_id: uint32,
        sender_roots: Map<DeviceID, GroupSenderCK_0>,
        batch_signature: Ed25519_signature,
        timestamp: uint64
    }
    
    // Server-side aggregation
    void distributeBatch(List<Device> recipients) {
        batch = collect_pending_sender_keys();
        batch.batch_signature = sign_batch(batch);
        broadcast_to_group(batch);
    }
}
```

**Client-Side Processing**:

```
void processBatchedDistribution(BatchedDistribution batch) {
    verify_batch_signature(batch);
    for_each (sender_root in batch.sender_roots) {
        if (is_first_root_for_sender(batch.epoch_id, sender_root.device_id)) {
            store_sender_key(sender_root);
        } else {
            handle_sender_key_poisoning_attempt(sender_root);
        }
    }
}
```

**Performance Benefits**:

- **O(1) Network Complexity**: Single broadcast per epoch regardless of group size
- **Reduced Latency**: Batch processing eliminates per-key round trips
- **Lower CPU Usage**: Signature verification amortized across batch

### 4.2.3 Epoch Distribution Optimization

**Efficient Epoch Change Protocol**:

```
class EpochManager {
    // Parallel epoch preparation
    void prepareEpochTransition() {
        workers.parallel_generate([
            generate_new_eare(),
            generate_all_sender_keys(),
            compute_epoch_hash()
        ]);
    }
    
    // Atomic epoch switch
    void commitEpochTransition() {
        atomic_swap_epoch_state();
        broadcast_epoch_commit();
    }
}
```

### 4.2.4 Sender-Key Batching Heuristics (Non-normative)

- Recommended: flush batches within ~50–150 ms or when batch size reaches N (e.g., 8–16 sender roots), whichever comes first.
- Consider bypassing batching for small/latency-sensitive groups (≤4 participants) or during media calls with tight latency budgets; use batching for larger groups when churn is high.
- Avoid mixing epochs in a batch; sign each batch; treat duplicates as potential poisoning/fork signals; consider sending at least one unbatched distribution immediately after an epoch advance.
- Avoid starving new sender keys: keep bounded latency (≤ batching window); if a batch is held due to join/leave or abuse signals, send keys immediately.

### 4.2.5 SFU Buffering and Encryption-Aware Scheduling

- Per-stream queues with bounded depth (e.g., 50–100 frames) and per-participant caps to prevent hoarding; prioritize control/rekey frames ahead of media.
- Congestion eviction: drop oldest media first; do not drop pending rekey/control; optionally favor lower-bitrate streams under pressure.
- Do not alter ciphertext/AAD/IV/tag in-flight; endpoints will drop on validation failure (security requirement; see §3.5.4).
- Instrument queues and drops for performance/abuse tests; align queue depth with replay-window sizes used in validation harnesses.

## 4.3 Resource Management and Bounds

### 4.3.1 Memory Constraints

**Skipped Keys Cache**:

```
class SkippedKeysCache {
    max_entries_per_sender: 1000;
    max_total_entries: 10000;
    eviction_policy: LRU_WITH_TIMEOUT(24_hours);
    
    // Memory-efficient storage
    struct CacheEntry {
        message_key: bytes[32];
        timestamp: uint64;
        access_count: uint16;
    }
}
```

**State Persistence**:

```
// Memory usage bounds
MAX_DR_STATE_SIZE = 2_KB;           // Per session
MAX_GROUP_STATE_SIZE = 100_KB;         // Per 1000-member group  
MAX_MEDIA_STATE_SIZE = 50_KB;           // Per active call
MAX_CONCURRENT_SESSIONS = 100;           // Per device
```

### 4.3.2 CPU Utilization Optimization

**Cryptographic Operation Batching**:

```
// Batch HKDF operations
batch_hkdf(inputs: List<HKDFInput>) -> List<bytes> {
    // Use SIMD-accelerated HKDF when available
    return hardware_accelerated_hkdf(inputs);
}

// Batch signature verification
batch_verify(signatures: List<Signature>) -> List<bool> {
    // Use Ed25519 batch verification when available
    return ed25519_batch_verify(signatures);
}
```

**Asynchronous Processing**:

```
// Non-blocking cryptographic operations
async void processMessage(Message msg) {
    // Queue heavy operations to worker threads
    if (requires_heavy_crypto(msg)) {
        crypto_worker_queue.enqueue(msg);
        return;  // Process asynchronously
    }
    // Process light messages immediately
    return process_lightweight_message(msg);
}
```

## 4.4 Network Performance Optimization

### 4.4.1 Bandwidth Efficiency

**Message Compression (Caution)**:

Compression-before-encryption can create side channels when an attacker can influence plaintext and observe ciphertext sizes (e.g., CRIME/BREACH-style attacks). Implementations SHOULD prefer codec/application-layer compression and SHOULD avoid compressing protocol messages that may mix secrets with attacker-controlled bytes. If compression is used, deployments SHOULD add padding and disable compression for sensitive contexts.

**Header Optimization**:

```
// NON-NORMATIVE: internal header summary example.
// This MUST NOT replace the cryptographic AAD defined in §1.6.
optimized_aad = {
    version: 1,
    message_type: 1,
    group_id: group_id,
    epoch_id: epoch_id,
    sender_id: sender_id,
    message_index: message_index,
    timestamp: timestamp
    // Total: 32 bytes fixed size
}
```

### 4.4.2 Latency Reduction

**Pipeline Parallelization**:

```
// Overlap network I/O with computation
void processWithPipeline(Message msg) {
    // Stage 1: Network I/O (non-blocking)
    network_thread.receive_async(msg);
    
    // Stage 2: Cryptographic operations (parallel)
    crypto_pool.process_async(msg);
    
    // Stage 3: Application processing (main thread)
    app_thread.deliver_to_user(msg);
}
```

**Connection Reuse**:

```
// Maintain persistent connections for reduced handshake overhead
class ConnectionManager {
    connection_pool: Map<ServerID, PersistentConnection>;
    
    Connection getConnection(ServerID server) {
        return connection_pool.get_or_create(server);
    }
}
```

## 4.5 Performance Monitoring and Metrics

### 4.5.1 Key Performance Indicators

**Throughput Metrics**:

- Messages per second (per device and per group)
- Cryptographic operations per second
- Network bandwidth utilization (bytes/second)
- CPU utilization percentage

**Latency Metrics**:

- Message processing latency (receive → deliver)
- Handshake completion time
- Epoch transition duration
- Media frame processing latency

**Resource Metrics**:

- Memory usage by component
- Skipped keys cache hit rate
- Thread pool utilization
- Network connection efficiency

### 4.5.2 Adaptive Performance

**Dynamic Scaling**:

```
class PerformanceManager {
    void adjustForLoad() {
        load = measure_current_load();
        
        if (load > HIGH_THRESHOLD) {
            increase_batch_sizes();
            enable_aggressive_caching();
            reduce_concurrent_operations();
        } else if (load < LOW_THRESHOLD) {
            decrease_batch_sizes();
            reduce_memory_usage();
            increase_concurrent_operations();
        }
    }
}
```

**Platform-Specific Optimizations**:

- **Mobile**: Reduced memory usage, battery-aware processing
- **Server**: High throughput, connection pooling
- **Desktop**: Maximum parallelization, hardware acceleration

This performance architecture enables FoxWhisper to scale from small group chats to enterprise channels while maintaining security guarantees and providing excellent user experience across all deployment scenarios.

---

# 5. Cross‑Layer Integration

FoxWhisper v0.9 refines cross-layer integration with bounded epoch skew tolerance for improved real-world robustness.

## 5.1 Messaging ↔ Media Epoch Alignment (Refined)

**Epoch Skew Tolerance Rules**:

Implementations MAY observe transient epoch skew between messaging and media, but MUST NOT treat “skew tolerance” as permission to accept frames under an unknown or stale membership view.

Let `E_frame` be the `media_epoch` carried in a received frame and let `E_valid` be the highest epoch for which the receiver has validated the corresponding membership/EARE state and derived the correct media keys.

- Acceptance gate (mandatory): a receiver MUST NOT decrypt/render a frame for epoch `E_frame` unless it has the validated membership state for `E_frame` and the keys for `E_frame`.
- If `E_frame = E_valid + 1` (media ahead by 1): the receiver SHOULD request/fetch the missing epoch state (EARE/call updates) and MAY buffer frames for at most `N` frames or `T` seconds while synchronizing; once the buffer limit is exceeded, frames MUST be dropped (and the implementation MAY escalate to resync/teardown).
- If `E_frame < E_valid` (media behind / stale): the receiver MUST treat frames as stale/replay and MUST drop them (this is especially important after removals).

If `|messagingEpoch − mediaEpoch| > 1`, or if skew persists beyond the bounded synchronization limits above, implementations MUST treat this as a protocol error and trigger resynchronization or teardown.

`N` (frames) and `T` (seconds) are implementation-defined operational parameters and are not conformance-impacting; they MUST be finite and SHOULD be small.

**Rationale**: A strict “must match exactly always” rule is too brittle in real networks. Limited skew tolerance can improve liveness without weakening security only when the acceptance gate above is enforced (i.e., no acceptance without validated epoch/membership state).

## 5.2 Error Propagation

- Media errors MAY trigger epoch advance
- Messaging ratchet failures MUST NOT break media unless keys overlap
- Cross-layer error states MUST be propagated with appropriate severity levels

## 5.3 State Synchronization and Epoch Fork Handling

> **Threat Model + Trust Boundary (Group Epochs)**: The network and servers are adversarial. Group controllers are authorized signers of EAREs; clients MUST verify signatures/PoP, enforce monotonic epoch IDs, and apply fork-resolution rules locally.

**Synchronization Points**:

- Call establishment: Both layers initialize with synchronized epochs.
- Member changes: Both layers advance epochs atomically; losing-branch epochs MUST NOT be routed/processed.
- Network recovery: Graceful resynchronization with bounded tolerance.

**Epoch fork reconciliation**:

- Authorization: EAREs MUST be signed by an authorized group controller key for `group_id` (and MUST include proof-of-possession where required). Clients MUST reject EAREs that fail signature/PoP verification or that are signed by unknown/unauthorized controller keys.
- Serialization: The controller MUST maintain a single-writer epoch log and MUST NOT issue two different EAREs for the same `(group_id, epoch_id)`. If the controller is replicated, it MUST use a linearizable store/consensus mechanism to serialize epoch advances; concurrent membership changes MUST be merged into a single next-epoch EARE or applied as sequential epochs.
- Client behavior on forks: if a device observes two distinct valid EAREs for the same `(group_id, epoch_id)`, it MUST treat this as `EPOCH_FORK`, MUST stop accepting messages/frames for epochs ≥ that `epoch_id` until resynchronized from the controller, and SHOULD alert/telemetry. Sustained forks indicate controller failure or compromise and MAY require call/group teardown.
- Chain selection (liveness): if multiple candidate EARE chains are present, devices select the longest valid chain (highest `epoch_id` with valid linkage). If equal length, break ties deterministically (e.g., lexicographically smallest `SHA256(canonicalCBOR(last_eare))`). Devices MUST drop and count messages/frames from non-selected branches.
- Validators MUST verify signature validity, PoP validity, hash linkage, and monotonic epoch IDs. Any failure is a hard error (`EARE_SIGNATURE_INVALID`, `EARE_POP_INVALID`, `EPOCH_FORK`), and the chain is rejected.
- Replay/drop policy: frames/messages from losing branches or outside the replay window are hard-dropped and MUST NOT be reconciled into the current transcript.

**State Replay Protection**:

- Messaging and media layers enforce anti-replay windows; persistent ratchet state MUST be rollback-protected.
- Session resumption MUST revalidate session keys/ratchets and bind resumption tokens to device identity and session parameters.

## 5.4 Epoch Authenticity Record (EARE) Format (Normative)

This section defines the canonical EARE structure, signature coverage, and proof-of-possession
(PoP) rules required for v0.9 conformance.

### 5.4.1 EARE Schema

An EARE is a canonical CBOR map with required fields:

```
eare = {
  "type": "EPOCH_AUTHENTICITY_RECORD",
  "version": 1,

  "group_id": bstr,                 // 16 bytes
  "epoch_id": uint64,
  "previous_epoch_hash": bstr,      // 32 bytes; SHA256(canonicalCBOR(previous_eare))

  // Membership snapshot
  "members": [ member_entry, ... ],
  "admin_device_ids": [ bstr(16), ... ],

  "timestamp_ms": uint64,
  "reason": text,

  // Controller authorization
  "controller_pubkey": bstr,        // 32 bytes Ed25519 public key
  "controller_signature": bstr      // 64 bytes Ed25519 signature
}

member_entry = {
  "user_id": bstr,                  // 16 bytes
  "device_id": bstr,                // 16 bytes
  "device_pubkey": bstr,            // 32 bytes Ed25519 public key

  // Proof-of-possession (PoP) of the device private key
  "device_pop": bstr                // 64 bytes Ed25519 signature
}
```

Canonical encoding requirements (normative):

- All EARE objects MUST be encoded with canonical CBOR.
- Field order is not semantically significant, but canonical encoding is load-bearing for
  signature/chain hashing.

### 5.4.2 Signature Coverage (Normative)

Define:

- `eare_without_signatures` = the EARE object with `controller_signature` removed.

Controller signature:

- `controller_signature = ed25519_sign(controller_privkey, canonicalCBOR(eare_without_signatures))`.

Verification:

- Clients MUST verify `controller_signature` using `controller_pubkey`.
- Clients MUST reject EAREs whose `controller_pubkey` is not authorized for `group_id`.

### 5.4.3 Proof-of-Possession (PoP) (Normative)

Each `member_entry.device_pop` proves possession of the private key corresponding to
`member_entry.device_pubkey` and binds it to the group + epoch + controller.

PoP context object:

```
pop_context = {
  "type": "EARE_DEVICE_POP",
  "version": 1,
  "group_id": group_id,
  "epoch_id": epoch_id,
  "user_id": user_id,
  "device_id": device_id,
  "device_pubkey": device_pubkey,
  "controller_pubkey": controller_pubkey
}
```

PoP signature:

- `device_pop = ed25519_sign(device_privkey, canonicalCBOR(pop_context))`.

Verification:

- Clients MUST verify `device_pop` for every `member_entry` before accepting the EARE.
- Any PoP failure is a hard error (`EARE_POP_INVALID`) and the EARE MUST be rejected.

### 5.4.4 Acceptance Rules (Normative)

- `previous_epoch_hash` MUST equal `SHA256(canonicalCBOR(previous_eare))` for `epoch_id > 0`.
- `epoch_id` MUST be strictly increasing for a given `group_id`.
- If two distinct valid EAREs are observed for the same `(group_id, epoch_id)`, clients MUST
  raise `EPOCH_FORK` and follow the fork-resolution rules in §5.3.

---

# 6. Preliminary Conformance Hooks

FoxWhisper v0.9 establishes foundation for comprehensive conformance testing and ecosystem development, providing test vectors and validation procedures essential for multi-implementation compatibility.

## 6.1 Canonical CBOR Test Vectors

### 6.1.1 Handshake Test Vectors

**Complete Hybrid Handshake Example (X25519 + ML-KEM-1024)**:

```
// Input parameters
client_x25519_priv = 0x...
client_x25519_pub = 0x...
client_kyber_priv = 0x...            // ML-KEM-1024 private key
client_kyber_pub = 0x...             // ML-KEM-1024 public key
server_x25519_priv = 0x...
server_x25519_pub = 0x...
server_kyber_ciphertext = base64_decode("...")  // ML-KEM-1024 ciphertext

// Expected intermediate values
x25519_shared = X25519(client_x25519_priv, server_x25519_pub)
kem_shared = ML-KEM-1024.Decapsulate(client_kyber_priv, server_kyber_ciphertext)
handshake_secret = HKDF(
  input_key_material = x25519_shared || kem_shared,
  salt = 0^HashLen,
  info = "FW-Handshake-Root",
  L = 32
)

// Public transcript inputs (all public; hashed to bind the handshake)
params = {
  "crypto_suite_id": "FW-CRYPTO-SUITE-01",
  "handshake_auth": "TLS-PINNED"  // example authentication mode (see §1.9.3)
}
// Raw transcript object (CBOR; bstr fields). This is what `canonicalCBOR()` hashes.
handshake_transcript_raw = {
  "type": "HANDSHAKE_TRANSCRIPT",
  "client_x25519_pub": client_x25519_pub,          // bstr (32 bytes)
  "server_x25519_pub": server_x25519_pub,          // bstr (32 bytes)
  "kyber_public_key": client_kyber_pub,            // bstr (ML-KEM-1024 public key)
  "kyber_ciphertext": server_kyber_ciphertext,     // bstr (ML-KEM-1024 ciphertext)
  "params": params
}

// Fixture rendering (JSON only; Base64 text). Display/transport for fixtures only.
handshake_transcript_fixture_json = {
  "type": "HANDSHAKE_TRANSCRIPT",
  "client_x25519_pub_b64": base64_encode(client_x25519_pub),
  "server_x25519_pub_b64": base64_encode(server_x25519_pub),
  "kyber_public_key_b64": base64_encode(client_kyber_pub),
  "kyber_ciphertext_b64": base64_encode(server_kyber_ciphertext),
  "params": params
}

// Expected outputs
root_key = handshake_secret
session_id = SHA256(canonicalCBOR(handshake_transcript_raw))
```

#### 6.1.1.1 Byte-Level Handshake Transcript Binding Vector

The following is a concrete canonical CBOR encoding of `handshake_transcript_raw` (Base64 of CBOR bytes), and the resulting `session_id` binding.

```
handshake_transcript_raw_cbor_b64 = "pmR0eXBldEhBTkRTSEFLRV9UUkFOU0NSSVBUZnBhcmFtc6JuaGFuZHNoYWtlX2F1dGhqVExTLVBJTk5FRG9jcnlwdG9fc3VpdGVfaWRyRlctQ1JZUFRPLVNVSVRFLTAxcGt5YmVyX2NpcGhlcnRleHRZBiBpVFiVIVjJuB33kDjNg1KIVy9VoRktMiICVf5JqIGiNvAf2MvksDDAZ2MbiGqYVwhvw7dGzTBIH51UCA/DAFG8Oy55TnMLYDzw3OCvyYx7kT/EeSmT4wh8kzk/oi2GuPZ+XXdNuyZvD5v/OvTN3lLJTzNMlD1h/psHg5ldflVsDijOFBJ/VTV+lDoO8qS3KFV9ySa2+hiOKwI3mmjceaObr5DDaB8oPJCuxBaOOyRftM1Ottv2NBlfcIQ4Dt5xYweTVowiN9p75u/z+RNxVYnXR6CkLkLyZFRKIOJ58zqgVnmWciH/Li0cJ47hLMxuSWJlXkgSYDNyiJo8Q8tO9ug7x3+dzv6V5r/qoMIG5PySXEWZGD7d241pcB5JO26nf7YoB3qPWuhkfC6ZYyWhcVr8FwDmh3Oz0WU2xOLCH73Z8A7+zC3JqEbB6nSyC9+c9MH0DSHqilsvY+XxDU+wlJ52QWslAbM+RK59zig6Igfc7eiWWe8mhfr4GeRUwTJ+cmZxCGFgDjafQCqc58sf1vqLnEQdt2JPvcmmVAZEZ720Wer8Zk4hhVt3khD9TfJPLSxtZUDMTSNgtrUL9jMxOFrsAr1EPXQChSp2NzN1jB5kSX/J6TBtuwexyZl5l0V3lPquO65b3WVrwDLgJJZVlGBQHuBI7+nOVl8Soj50f9PUniMV7cdFuyKn7/V/RAGP4lsJXbB4TjQEbEeWzG4ZK/R26EoqYxk7EoUs2292W7+Q1JDmTfMX/2br6VJaM62/uw0DhLukzlTpzC5RFPHSDoJu900539+V9Ea+uqnmV6whwIvODTvLFNrKcI4AngqEk8iIvrkBs6umdNC7ToejYyM1HzSrrzbPHzuQward49pr+i28Rp8YHXmjG69kggoDKOT/A2LyhV0mpzDEPUFDySwRA0KXXqogQUr6jQAS+GtiN4yHSfWUeWVuxW8HUfmXb0cIvfy/xqFKM9NbcnTZVKbwhrcodl0Mi+ie/Vx6xq/bbffgkswHnconwEpD4vxM87zgj13nnYbZKvhCoUbFP/zYXe01j6cHSTQ0gRVecUlfHruY/dXPjbLU6/Qm8dEjn6y6x3wngMjONpV3Rxv4NNX7M4GuEO6U/QcVhdRqe52SiUhj8j3YNNDdDyfKlbe4Nuqu7VoeSJWyrjbq0dkYUiTw71Dgw1++50cR6+/LmwMnZUYSETSCwnZ6iJF6EjllFmqELJYc6+U2mcdALZcHMT4H4PdBN9kMy9gaZKWZO2MKF62eyvEqjPwpMahlYMHXCxKGvmdOj10qJchqGzCR73uZWjVAEslYrmaIO+7KfgxUxDpsPmFIjCPUngUYdwyFTEIF+Ox8eNAJL9dfCRZAZU+TQdoXB4L6sHXtMcGRaq18lYp91pHbUNi4Vpruo1AAnqZ8FDvNSg8yEd/U3RSdv0Wes5O7fP+t1vH4r1GbtJ+1HM//EDE3I/PhBHWWSVrg0hk7V084qtmb6bZv1xM1X+oXkpJSkVdNO7mlItA8Qak58+XnMhJUHPjRKt6Vh1/6ycmPr3yT2i89+4yip8ckPf5BoffUuo96QSPAs0Bha2hmE7bBJYINA9F48gk1z6PpF1u8vCrvYkxmnIINbsMZMI0O7BbL5tjqzXdewQmUSKTY7XO8lA95hLyBbldecPwyyUE44Qx+T2/XnHOFlOpwjTZ6ULL5sKjfA4jUg0aVoeVxaoXertTwVhS81dbY9U58Y0lYWf/THEM62VHiko+qscCpOIgvkf28fcRLtOxYFdxsoP3svsdQudBya4KoR8Z9hPQ97LMXcZMpDqqfCfLTnBSP5/Kop8iyfUA0D5pD6ckHDLz/ATK6saNlGkSoFHXlB9SMj8vMft1oDeertuZea1zc2mYPcHzJpqvsozjkRpofm6cbH26Gy/soeHc5BcDK8I1KHduLZKwVLaUipmrZigRE2BONDm4ZMz7z0W4dFAdoA1LLms5XCFJtR72XllTyenGVG2+BSQTnUroHi66UUl1/WaE4Cr1djlW+Ucj8950YhbRlRARqHOesMO8plDZ72GAwOiYDQcAoJWVpPeOlNBmggZcMU7BZpOYCI2k3DH2Y73BreWJlcl9wdWJsaWNfa2V5WQYgAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/wABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp+goaKjpKWmp6ipqqusra6vsLGys7S1tre4ubq7vL2+v8DBwsPExcbHyMnKy8zNzs/Q0dLT1NXW19jZ2tvc3d7f4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoOEhYaHiImKi4yNjo+QkZKTlJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/wABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5/gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp+goaKjpKWmp6ipqqusra6vsLGys7S1tre4ubq7vL2+v8DBwsPExcbHyMnKy8zNzs/Q0dLT1NXW19jZ2tvc3d7f4OHi4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl9gYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoOEhYaHiImKi4yNjo+QkZKTlJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Dh4uPk5ebn6Onq6+zt7u/w8fLz9PX29/j5+vv8/f7/AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh9xY2xpZW50X3gyNTUxOV9wdWJYIDsmi6U+g4E0h0zCpSwJsMXSuWxT+GGCVFE78CCtL9oGcXNlcnZlcl94MjU1MTlfcHViWCCnO9TPCfJcdV7syMEHDkrWHgDwZ9W2zL/F/zr4OpCwJQ=="
transcript_sha256_b64 = "iCz0fKF6oSMPqAoHzrz4+uNxhqx5j3Ijx4blxtpM36A="
session_id_b64 = "iCz0fKF6oSMPqAoHzrz4+uNxhqx5j3Ijx4blxtpM36A="
```

**Normative: Secret Exclusion from Transcripts**:

- `handshake_secret` MUST NEVER be transmitted, logged, or included in any transcript structure; it appears only in test fixtures.
- `session_id` and any transcript hash MUST depend only on public handshake inputs (public keys, ciphertexts, selected parameters).
- `session_id` MUST be computed over the raw CBOR transcript object containing `bstr` fields (e.g., `handshake_transcript_raw`), not over Base64 text renderings.
- Transcript structures MUST NOT include secrets or values derived from secrets.

**Test Fixture Rendering (JSON Only)**:

```
handshake_test_fixture_json = {
  "type": "HANDSHAKE_TEST_FIXTURE",
  "handshake_transcript": handshake_transcript_fixture_json,
  "expected_handshake_secret_b64": base64_encode(handshake_secret),
  "session_id_b64": base64_encode(session_id)
}
```

### 6.1.2 Double Ratchet Test Vectors

**DR Message Encryption Example**:

```
// Input state
dr_state = {
  session_id: 0x...,
  sender_device_id: 0x...,
  root_key: 0x...,
  send_chain_key: 0x...,
  send_counter: 42,
  dh_private: 0x...,
  dh_public: 0x...
}

// Input message
plaintext = "Hello, FoxWhisper!"

// Expected operations
message_key = HKDF(
  input_key_material = dr_state.send_chain_key,
  salt = U64BE(dr_state.send_counter),
  info = "FW-Message",
  L = 32
)
next_chain_key = HKDF(
  input_key_material = dr_state.send_chain_key,
  salt = 0^HashLen,
  info = "FW-Chain",
  L = 32
)
context_type = 0x02  // session
raw_context_id = dr_state.session_id
sender_device_id = dr_state.sender_device_id
msg_context_id = SHA256("FW-MSG-CTX" || U8(context_type) || raw_context_id)

message_nonce_context = {
  "context_type": context_type,
  "context_id": msg_context_id,
  "epoch_id": 0,
  "sender_device_id": sender_device_id,
  "message_index": dr_state.send_counter
}
iv = Truncate_96bits(SHA256("FW-NONCE-MSG" || canonicalCBOR(message_nonce_context)))
aad = SHA256(canonicalCBOR(message_header))

// Expected outputs
ciphertext, auth_tag = AES-256-GCM(message_key, plaintext, aad, iv)
next_dr_state = {
  root_key: dr_state.root_key,
  send_chain_key: next_chain_key,
  send_counter: dr_state.send_counter + 1,
  dh_private: dr_state.dh_private,
  dh_public: dr_state.dh_public
}
```

#### 6.1.2.1 Byte-Level DR Message Header + AEAD Vector

This vector provides concrete bytes for `canonicalCBOR(message_header)`, the derived `aad`, and one AES‑256‑GCM encryption using the messaging nonce derivation.

```
chain_key_hex = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
message_index = 7
sender_device_id_hex = 0f1e2d3c4b5a69788796a5b4c3d2e1f0

canonicalCBOR(message_header)_b64 = "qWR0eXBlcUVOQ1JZUFRFRF9NRVNTQUdFZ3ZlcnNpb24BaGVwb2NoX2lkAGxjb250ZXh0X3R5cGUCbG1lc3NhZ2VfdHlwZQFsdGltZXN0YW1wX21zGwAAAYw4/ceIbW1lc3NhZ2VfaW5kZXgHbnJhd19jb250ZXh0X2lkWCB0/iZ5wDD0ajoIb5L9mtnjRPYMoXtBmxtNH2OxNlHZIXBzZW5kZXJfZGV2aWNlX2lkUA8eLTxLWml4h5altMPS4fA="

aad_b64 = "r2e8tadmvTt3PCx2irf104nGwTLe7Ep/36zw3L11iY0="
iv_b64 = "zTlQbVWjieXPD+2W"

message_key_b64 = "7DrcLXOvTJ/kgMzb/Cm2VAjVyPI//PBNHdpdlTnt0PY="
plaintext_utf8 = "Hello, FoxWhisper!"
ciphertext_b64 = "uZb+BRATdrg5aRdpoebpQupr"
auth_tag_b64 = "hovJ+6eQQwR1RvOdv184eA=="
```

### 6.1.3 Group Messaging Test Vectors

**Sender Key Distribution Example**:

```
// Input parameters
group_id = base64_decode("...")
epoch_id = 42
sender_device_id = base64_decode("...")
group_sender_ck_0 = random(32 bytes)

// Expected group key distribution message
group_key_distribution_fixture_json = {
  "type": "GROUP_KEY_DISTRIBUTION",
  "version": 1,
  "group_id_b64": base64_encode(group_id),
  "epoch_id": epoch_id,
  "sender_device_id_b64": base64_encode(sender_device_id),
  "group_sender_ck_0_b64": base64_encode(group_sender_ck_0),
  "sender_device_pubkey_b64": base64_encode(sender_device_pubkey),
  "signature_b64": base64_encode(ed25519_sign(sender_device_priv_key, canonicalCBOR(distribution_without_signature)))
}
```

#### 6.1.3.1 Byte-Level Group Sender Key Distribution Vector

```
group_id_hex = 00112233445566778899aabbccddeeff
epoch_id = 42
sender_device_id_hex = 0f1e2d3c4b5a69788796a5b4c3d2e1f0
group_sender_ck_0_hex = f0e1d2c3b4a5968778695a4b3c2d1e0f00112233445566778899aabbccddeeff

sender_device_pubkey_b64 = "bc5H2txPRq0Vw7zDQnHT0EDv7gLaG/LtWIWOQlSoRsw="
// Test-only private key material to reproduce signatures MUST NOT be expressed as JWK in this specification.
// If private key fixtures are required for conformance tooling, they MUST be provided as local-only
// byte strings in test tooling (see `spec/crypto_conformance_secrets.schema.json`).

canonicalCBOR(distribution_without_signature)_b64 = "p2R0eXBldkdST1VQX0tFWV9ESVNUUklCVVRJT05ndmVyc2lvbgFoZXBvY2hfaWQYKmhncm91cF9pZFAAESIzRFVmd4iZqrvM3e7/cHNlbmRlcl9kZXZpY2VfaWRQDx4tPEtaaXiHlqW0w9Lh8HFncm91cF9zZW5kZXJfY2tfMFgg8OHSw7Sllod4aVpLPC0eDwARIjNEVWZ3iJmqu8zd7v90c2VuZGVyX2RldmljZV9wdWJrZXlYIG3OR9rcT0atFcO8w0Jx09BA7+4C2hvy7ViFjkJUqEbM"
signature_b64 = "uSWOT346jAiwn6VNsZWt8C5LB5hzVz9ELbQHWsNOuHufzcAAGXVi+pIsectjtvjc0rcO/nIjnOOxgpsgUftuDA=="
```

## 6.2 Epoch Authenticity Record Examples

### 6.2.1 Complete EARE Structure

**EARE Creation Example**:

```
// Input parameters
group_id = base64_decode("...")          // 16 bytes
epoch_id = 42
members = [
  {"user_id": base64_decode("..."), "device_id": base64_decode("..."), "device_pub_key": base64_decode("...")},
  {"user_id": base64_decode("..."), "device_id": base64_decode("..."), "device_pub_key": base64_decode("...")}
]
admin_device_ids = [base64_decode("..."), base64_decode("...")]
previous_epoch_hash = SHA256(canonicalCBOR(previous_eare))

// Expected EARE structure
epoch_authenticity_record = {
  "type": "EPOCH_AUTHENTICITY_RECORD",
  "group_id": group_id,
  "epoch_id": epoch_id,
  "previous_epoch_hash": previous_epoch_hash,
  "members": members,
  "admin_device_ids": admin_device_ids,
  "timestamp": 1701763200000,
  "reason": "member_added",
  "admin_signatures": [
    {
      "admin_device_id": admin_device_ids[0],
      "signature": ed25519_sign(device1_priv_key, canonicalCBOR(eare_without_signatures))
    },
    {
      "admin_device_id": admin_device_ids[1],
      "signature": ed25519_sign(device2_priv_key, canonicalCBOR(eare_without_signatures))
    }
  ]
}
```

## 6.3 Media Frame Test Vectors

### 6.3.1 Media Frame Encryption with Refined Key Schedule

**Complete Media Frame Example**:

```
// Input parameters
call_id = base64_decode("...")               // 16 bytes
sender_device_id = base64_decode("...")    // 16 bytes
stream_id = base64_decode("...")           // 4 bytes
stream_key = 0x...
media_epoch = 42
frame_sequence = 15
payload_type = 0x01  // Audio payload
payload = base64_decode("...")  // codec frame bytes (CBOR bstr)

// Expected operations with refined key schedule
media_epoch_key = HKDF(
    input_key_material = stream_key,
    salt = U32BE(media_epoch),
    info = "FW-MediaEpochKey",
    L = 32
)

frame_key = HKDF(
    input_key_material = media_epoch_key,
    salt = U64BE(frame_sequence),
    info = "FW-FrameKey",
    L = 32
)

frame_header = {
  "version": 1,
  "call_id": call_id,
  "sender_device_id": sender_device_id,
  "stream_id": stream_id,
  "frame_sequence": frame_sequence,
  "media_epoch": media_epoch,
  "timestamp_ms": 1701763200000,
  "payload_type": payload_type,
  "flags": 0
}

media_nonce_context = {
  "call_id": call_id,
  "sender_device_id": sender_device_id,
  "stream_id": stream_id,
  "media_epoch": media_epoch,
  "frame_sequence": frame_sequence
}
deterministic_iv = Truncate_96bits(SHA256("FW-NONCE-MEDIA" || canonicalCBOR(media_nonce_context)))

aad = SHA256(canonicalCBOR(frame_header))
frame_plaintext = canonicalCBOR(payload)

// Expected outputs
frame_ciphertext, frame_auth_tag = AES-256-GCM(frame_key, frame_plaintext, aad, deterministic_iv)

// Complete media frame structure
media_frame = {
  "header": frame_header,
  "ciphertext": base64_encode(frame_ciphertext),
  "auth_tag": base64_encode(frame_auth_tag),
  "iv": base64_encode(deterministic_iv)
}
```

#### 6.3.1.1 Byte-Level Media Frame Vector

```
call_id_hex = a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
sender_device_id_hex = 0f1e2d3c4b5a69788796a5b4c3d2e1f0
stream_id_hex = 00000001
media_epoch = 1
frame_sequence = 15

test_callKey_b64 = "ESIzRFVmd4iZAKq7zN3u/wARIjNEVWZ3iJmqu8zd7v8="
expected_streamKey_b64 = "fj5ubgWdOugI001NhVAi79s/hkXqDT1bA79v/eCzcy4="
expected_mediaEpochKey_b64 = "dnBMs+aAn+/MuPDIHUZ+lr9f8on263J68g7c82TrGrw="
expected_frameKey_b64 = "3zhnFsL8ETn8p5DdhRvtFZtzxTYeSBD9om8CKKLKNh4="

canonicalCBOR(frame_header)_b64 = "qWVmbGFncwBnY2FsbF9pZFCgoaKjpKWmp6ipqqusra6vZ3ZlcnNpb24BaXN0cmVhbV9pZEQAAAABa21lZGlhX2Vwb2NoAWxwYXlsb2FkX3R5cGUBbHRpbWVzdGFtcF9tcxsAAAGMOP20AG5mcmFtZV9zZXF1ZW5jZQ9wc2VuZGVyX2RldmljZV9pZFAPHi08S1ppeIeWpbTD0uHw"
aad_b64 = "rPV/NWUYpyCrv/jzwnAz7+5PHQ5Vf4nWZQBMxjaDsMs="
iv_b64 = "cl7x3T3Lxb/DEmqI"

canonicalCBOR(payload)_b64 = "VAECAwQFBgcICQoLDA0ODxAREhMU"

ciphertext_b64 = "zQKZPj3jhSH0nMrJlgUJ8opDo/x1"
auth_tag_b64 = "UMggigJO7vX046+EC2SgOg=="
```

## 6.4 Validation Procedures

### 6.4.1 Canonical Encoding Validation

**CBOR Canonicalization Test**:

```
// Canonical CBOR is load-bearing: protocol hashes use canonicalCBOR() output.
test_data = {"a": 1, "b": 2, "c": [3, 4, 5]}
canonical_bytes = canonicalCBOR(test_data)

// Generate deliberately non-canonical encodings of equivalent data.
noncanonical_encodings = [
    encode_map_with_permuted_key_order(test_data),
    encode_map_with_nonminimal_integer_widths(test_data),
    encode_with_indefinite_length_containers(test_data)
]

// Decode each non-canonical encoding, then re-encode canonically.
for enc in noncanonical_encodings:
    decoded = cbor_decode(enc)
    assert(canonicalCBOR(decoded) == canonical_bytes)
```

### 6.4.2 Cross-Platform Compatibility

**Implementation Validation Test**:

```
// Test vector for cross-platform verification
compatibility_test = {
  "handshake_input": handshake_test_vector,
  "expected_dr_state": expected_dr_result,
  "expected_group_state": expected_group_result,
  "expected_media_frame": expected_media_result
}

// Implementations must produce identical results
implementation_result = run_implementation_test(compatibility_test)
assert(implementation_result.matches_expected())
```

## 6.5 Error Handling Test Cases

### 6.5.1 Malformed Input Handling

**Invalid CBOR Structures**:

```
malformed_cbor_tests = [
  {"description": "Truncated CBOR", "data": truncated_byte_sequence},
  {"description": "Invalid map key type", "data": invalid_key_type_cbor},
  {"description": "Duplicate map keys", "data": duplicate_keys_cbor},
  {"description": "Invalid array length", "data": invalid_array_length_cbor}
]

// Each test must be rejected with appropriate error
for test_case in malformed_cbor_tests:
    result = parse_cbor(test_case.data)
    assert(result.error == EXPECTED_ERROR)
```

### 6.5.2 Cryptographic Validation

**Signature Verification Tests**:

```
signature_tests = [
  {"description": "Invalid signature", "signature": invalid_signature},
  {"description": "Wrong signing key", "signature": wrong_key_signature},
  {"description": "Modified message", "signature": valid_signature_modified_message}
]

// Verify signature validation catches all attacks
for test_case in signature_tests:
    verification = verify_signature(test_case.signature, test_case.message)
    assert(verification.result == test_case.expected_result)
```

### 6.5.3 Epoch Skew Tolerance Tests

**Epoch Mismatch Handling**:

```
epoch_skew_tests = [
  {"description": "Small skew (1)", "messaging_epoch": 42, "media_epoch": 43, "expected": "allow_with_warning"},
  {"description": "Large skew (5)", "messaging_epoch": 42, "media_epoch": 47, "expected": "reject_and_resync"},
  {"description": "Persistent skew", "messaging_epoch": 42, "media_epoch": 43, "frames": 100, "expected": "reject_and_resync"}
]

// Verify epoch skew tolerance behavior
for test_case in epoch_skew_tests:
    result = handle_epoch_mismatch(test_case)
    assert(result.action == test_case.expected)
```

These conformance hooks provide foundation for automated testing, cross-platform compatibility verification, and security validation essential for FoxWhisper ecosystem development.

---

# End of v0.9 Specification (Draft)
