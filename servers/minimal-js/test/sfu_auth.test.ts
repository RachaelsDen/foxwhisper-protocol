import { describe, expect, it } from 'vitest';
import { deriveClientSfuAuthKey, makeClientAuthToken, verifyClientAuthToken } from '../src/crypto/sfu_auth.js';

const HANDSHAKE_SECRET = Buffer.alloc(32, 7);
const CLIENT_ID = 'alice';
const CALL_ID = 'call-123';
const BASE_TS = 1_700_000_000_000;
const NONCE = 'nonce-abc';

function flipByte(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  out[0] ^= 0xff;
  return out;
}

describe('sfu_auth helpers', () => {
  it('accepts a valid token', () => {
    const key = deriveClientSfuAuthKey(HANDSHAKE_SECRET, CLIENT_ID);
    const token = makeClientAuthToken(key, { callId: CALL_ID, clientId: CLIENT_ID, timestampMs: BASE_TS, nonce: NONCE });
    const res = verifyClientAuthToken(key, token, {
      callId: CALL_ID,
      clientId: CLIENT_ID,
      timestampMs: BASE_TS,
      nonce: NONCE,
      nowMs: BASE_TS,
      nonceCache: new Set(),
    });
    expect(res.ok).toBe(true);
  });

  it('rejects an invalid MAC as impersonation', () => {
    const key = deriveClientSfuAuthKey(HANDSHAKE_SECRET, CLIENT_ID);
    const token = makeClientAuthToken(key, { callId: CALL_ID, clientId: CLIENT_ID, timestampMs: BASE_TS, nonce: NONCE });
    const bad = flipByte(token);
    const res = verifyClientAuthToken(key, bad, {
      callId: CALL_ID,
      clientId: CLIENT_ID,
      timestampMs: BASE_TS,
      nonce: NONCE,
      nowMs: BASE_TS,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('IMPERSONATION');
    }
  });

  it('rejects expired tokens beyond skew window', () => {
    const key = deriveClientSfuAuthKey(HANDSHAKE_SECRET, CLIENT_ID);
    const token = makeClientAuthToken(key, { callId: CALL_ID, clientId: CLIENT_ID, timestampMs: BASE_TS, nonce: NONCE });
    const res = verifyClientAuthToken(key, token, {
      callId: CALL_ID,
      clientId: CLIENT_ID,
      timestampMs: BASE_TS,
      nonce: NONCE,
      nowMs: BASE_TS + 10_000,
      maxSkewMs: 1_000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects replayed nonces', () => {
    const key = deriveClientSfuAuthKey(HANDSHAKE_SECRET, CLIENT_ID);
    const token = makeClientAuthToken(key, { callId: CALL_ID, clientId: CLIENT_ID, timestampMs: BASE_TS, nonce: NONCE });
    const cache = new Set<string>();
    const first = verifyClientAuthToken(key, token, {
      callId: CALL_ID,
      clientId: CLIENT_ID,
      timestampMs: BASE_TS,
      nonce: NONCE,
      nowMs: BASE_TS,
      nonceCache: cache,
    });
    const second = verifyClientAuthToken(key, token, {
      callId: CALL_ID,
      clientId: CLIENT_ID,
      timestampMs: BASE_TS,
      nonce: NONCE,
      nowMs: BASE_TS,
      nonceCache: cache,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe('REPLAY');
    }
  });
});
