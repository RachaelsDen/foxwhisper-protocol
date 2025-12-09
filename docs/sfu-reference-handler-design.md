# SFU Reference Handler Design (v0.9)

Goal: provide an in-process, reference-grade SFU handler behind `MinimalServer` that is easy to exercise with the SFU abuse corpus and media test vectors. This is not a production SFU; it exists to clarify state, error codes, and test alignment.

## Trust Model & Constraints
- SFU is logically untrusted: it routes ciphertext only and never sees plaintext media.
- No raw media keys or handshake secrets ever enter SFU logic; only key IDs, entitlements, or encrypted blobs are handled.
- SFU authentication uses HMAC tokens derived from `handshake_secret` (client) and an `sfu_secret_key` (SFU→client). Tokens must include nonce + timestamp and enforce a replay/expiry window.

## Operating Assumptions
- Runs in-process with `MinimalServer` (no extra socket); receives participant identity, call/room IDs, and pre-derived `client_sf_auth_key`/`sfu_secret_key` from tests.
- Media frames arrive with headers: `call_id`, `participant_id`, `stream_id`, `frame_sequence`, `media_epoch`, optional `layer`, and frame auth tag. SFU never accesses payload.
- Key distribution is controller-driven: SFU receives `SfuKeyGrant {callId, participantId, mediaEpoch, keyId, encryptedKeyBlob?}` and serves `requestMediaKey` lookups.

## Core State & APIs
- State: `participants` (registered), `authState` (authenticated), `tracks` (trackId→publisher + layers), `subscriptions` (trackId→subscribers), `keyGrants` (participant→key IDs), `nonceCache` (anti-replay), metrics, transcript buffer.
- APIs (draft):
  - `authenticate(participantId, tokenCtx)` → verifies token, updates `authState`, records impersonation on failure.
  - `join(participantId, authCtx)` / `leave(participantId)` → idempotent membership; removes tracks/subs on leave; enforces `expected_participants` when provided.
  - `publishTrack(participantId, trackInfo)` → requires auth + membership; rejects duplicate track IDs.
  - `subscribeTrack(subscriberId, trackId, options)` → requires auth + membership + existing track; enforces layer caps and subscription limits; returns {allowed|denied, error?}.
  - `onFrame(frameMeta)` → validates publisher/track mapping, updates metrics, emits transcript entry with digests only.
  - `grantMediaKey(grant)` / `requestMediaKey(participantId, keyId)` → enforce call/epoch scoping; reject cross-call reuse as `KEY_LEAK_ATTEMPT`.
  - `getTranscript()` / `resetTranscript()` → in-memory transcript management for tests.

## Invariants & Error Surfaces
- Only authenticated participants can publish/subscribe/request keys; ghost/unknown participants yield `UNAUTHORIZED_SUBSCRIBE`.
- Track IDs map one-to-one to publishers; duplicates raise `DUPLICATE_ROUTE`.
- Layer requests must be within advertised layers; violations raise `SIMULCAST_SPOOF`. Bitrate policy breaches raise `BITRATE_ABUSE`.
- Replay/nonce reuse in auth tokens rejected with `IMPERSONATION` or `UNAUTHORIZED_SUBSCRIBE` depending on context.
- Key grants are scoped to call/epoch; cross-scope requests raise `KEY_LEAK_ATTEMPT`; stale epoch usage raises `STALE_KEY_REUSE`.

## Transcript & Auditing
- Each routed/denied frame produces a transcript entry containing IDs, routing action, error (if denied), and `header_digest = SHA256(canonicalCBOR(frame_header || routing_metadata))`. No payloads or keys are recorded.
- Event hooks for `sfu:join`, `sfu:leave`, `sfu:publish`, `sfu:subscribe`, `sfu:frame:routed|dropped`, and abuse detections feed metrics + transcript.

## Test Alignment
- Error codes match the corpus/oracles: {`UNAUTHORIZED_SUBSCRIBE`, `IMPERSONATION`, `KEY_LEAK_ATTEMPT`, `STALE_KEY_REUSE`, `DUPLICATE_ROUTE`, `REPLAY_TRACK`, `HIJACKED_TRACK`, `SIMULCAST_SPOOF`, `BITRATE_ABUSE`}.
- SFU abuse harness should replay `tests/common/adversarial/sfu_abuse.json` timelines directly into the APIs above and compare metrics/errors to the Python/Node oracles.
- Media digests should reuse `clients/minimal-js/src/media.ts` helpers (deterministic IV + AAD hashing) so transcript integrity matches the media vectors.
