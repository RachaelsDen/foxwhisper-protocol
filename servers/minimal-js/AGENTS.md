# AGENTS Guide - Minimal JS Server (Metadata-Only Reference)
## Scope and Purpose
This directory contains the **minimal FoxWhisper reference server**, a TypeScript
package for metadata-only routing, handshake completion, room membership, and
SFU media forwarding. It does not own device-record encryption, payload
decryption, or end-to-end key management; those stay with the client.

Primary goals:
- Exercise the server side of the protocol against shared test vectors.
- Provide an in-process SFU reference handler for adversarial and conformance testing.
- Serve as a wiring demo alongside the minimal client.
## Key Modules
| Module | Role |
|---|---|
| `src/server.ts` | WebSocket server: handshake, JOIN/LEAVE/DATA routing, auth/moderation hooks |
| `src/sfu.ts` | In-process SFU reference: auth, publish/subscribe, frame routing, transcripts, media key grants |
| `src/sfu_types.ts` | SFU config, participants, tracks, subscriptions, frame, transcript, and error-code types |
| `src/crypto/sfu_auth.ts` | HKDF-derived SFU auth keys, HMAC tokens, timing-safe verification, nonce replay protection |
| `src/space.ts` | `space:*` room helpers |
| `src/handshake.ts` | CBOR-tagged handshake encoding and decoding |
| `demo/minimal-chat.ts` | End-to-end demo that starts the server, connects two minimal clients, and asserts DATA delivery |

## Crypto Directionality

The server encapsulates Kyber and completes the X25519+Kyber hybrid handshake,
but **never decrypts message or media payloads**. It routes ciphertext frames
by header metadata only. SFU auth tokens use HKDF-derived keys from the
handshake secret and `timingSafeEqual` verification. This package does not own
Double Ratchet state, message keys, media frame keys, or device-record crypto.

## Build, Test, and Scripts

```bash
npm test
npm run demo
npm run typecheck
npm run build
```

`npm test` and `npm run demo` default to `FOXW_CRYPTO_BACKEND=real`. Toy crypto
requires both `FOXW_CRYPTO_BACKEND=toy` and `FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND`.

## Test and Vector Sources

- `test/golden_transcript.test.ts` validates CBOR round-trips against
  `test/fixtures/golden_transcript.json`.
- `test/sfu_auth.test.ts` covers token derivation and verification.
- `test/sfu_keys_vectors.test.ts` checks key distribution against
  `tests/common/handshake/media_encryption_test_vectors.json`.
- `test/sfu_abuse_harness.test.ts` and `test/sfu_abuse_transcript.test.ts`
  validate adversarial scenarios from `tests/common/adversarial/sfu_abuse.json`.
- `test/server_routing.test.ts` and `test/server_handshake.test.ts` cover core
  routing and handshake behavior.
- `test/sfu_transcript.test.ts` exercises transcript integrity.

Prefer shared vectors under `tests/common/`. Any CBOR shape change must also be
reflected in shared vectors, validators, and the spec.

## Security Caveats

This is a **reference/test-only server**. It lacks TLS termination, real
authentication, production-grade rate limiting, and robust DoS protection.
Run it behind a TLS-terminating reverse proxy if you need transport security.
The SFU handler is a single-process validation tool, not a distributed design.
Toy crypto exists for fuzzing and experiments only.

## Relation to v0.9 TODOs

This directory implements:

- `docs/v0.9-comprehensive-todo-list.md` section **4.3.2 Minimal Server Reference (Metadata-Only)**
- `docs/v0.9-comprehensive-todo-list.md` section **4.3.3 SFU Reference Handler**
- `docs/v0.9-sfu-reference-handler-todo-list.md` for the expanded SFU plan

## Drift Prevention

- Cross-check changes against the v0.8.1 spec and the v0.9 TODO docs.
- Do not add payload decryption or media-frame decryption to this package.
- Do not introduce crypto primitives without a corresponding spec update and shared vectors.
- Keep the server focused on metadata routing, auth hooks, moderation hooks, and SFU forwarding.
