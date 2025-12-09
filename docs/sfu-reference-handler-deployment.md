# SFU Reference Handler Deployment (v0.9)

This guide shows how to run the in-process SFU reference handler in `servers/minimal-js` alongside the minimal server, and how to capture SFU-specific artifacts for CI.

## Topology
- Minimal client ↔ Minimal server (signaling, metadata) ↔ In-process SFU handler (`MinimalSfu`).
- SFU handles routing decisions only; it never sees plaintext media or raw keys.

## Configuration
- Environment: `FOXW_CRYPTO_BACKEND=real` (preferred for CI); use `acceptAnyToken` only in corpus tests.
- `SfuConfig` (constructor for `MinimalSfu`):
  - `roomId` / `callId` / `sfuId`
  - `logger`, `auditLogger`
  - `clientAuthKey` (or `sfuSecretKey` for SFU→client token flows)
  - `expectedParticipants` (optional allowlist)
  - `policy`: `maxSubscribersPerTrack`, `allowedLayers`, `tokenMaxSkewMs`, `nonceCacheTtlMs`, `acceptAnyToken` (tests only)
- Auth tokens: HMAC-SHA256 over `call_id || client_id || timestamp || nonce`, key = `HKDF(handshake_secret, info="FW-SFU-ClientAuth"||client_id, L=32)`.

## Running locally
1) Install deps: `npm ci --prefix servers/minimal-js`
2) Run tests (writes artifacts): `npm test --prefix servers/minimal-js`
3) Start server + SFU (example):
   ```bash
   node -e "const { MinimalSfu } = require('./dist/sfu.js'); const sfu = new MinimalSfu({roomId:'room-1', callId:'room-1', clientAuthKey:Buffer.alloc(32,1)}); console.log('SFU ready')"
   ```
   Integrate with your signaling path by invoking `join/publishTrack/subscribeTrack/onFrame` in-process.

## Artifacts (CI)
- Key distribution status: `servers/minimal-js/test-output/sfu_key_distribution_status.json`
- Transcript sample: `servers/minimal-js/test-output/sfu_media_transcript.json`
- SFU abuse replay is covered by `test/sfu_abuse_harness.test.ts`; metrics remain in-process.

## Security properties (tied to tests)
- **No plaintext/keys at SFU**: handler stores only IDs, digests, and encrypted blobs; see `sfu.ts` and artifact files above.
- **Auth required for routing**: invalid or replayed tokens → `UNAUTHORIZED_SUBSCRIBE`/`IMPERSONATION`; covered by `sfu_auth.test.ts`.
- **Routing integrity**: ghost/impersonation events denied and recorded; covered by `sfu_abuse_harness.test.ts` and `sfu_abuse_transcript.test.ts`.
- **Key scope enforcement**: call/epoch mismatches → `KEY_LEAK_ATTEMPT` / `STALE_KEY_REUSE`; covered by `sfu_keys.test.ts` and vector-driven `sfu_keys_vectors.test.ts`.
- **Transcript integrity**: canonical CBOR digests logged per frame; covered by `sfu_transcript.test.ts`.

## Operational caveats
- Reference-only; add TLS termination, real identity, rate limiting, and observability before production.
- `acceptAnyToken` policy is for corpus/tests only—disable in real runs.
