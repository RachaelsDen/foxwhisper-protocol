import { describe, expect, it } from 'vitest';
import { MinimalSfu } from '../src/sfu.js';

const CALL_ID = 'call-xyz';

function makeSfu() {
  return new MinimalSfu({
    callId: CALL_ID,
    roomId: CALL_ID,
    clientAuthKey: Buffer.alloc(32, 1),
    policy: { acceptAnyToken: true },
  });
}

describe('MinimalSfu media key distribution', () => {
  it('grants and returns a key to an authenticated participant', () => {
    const sfu = makeSfu();
    sfu.join('alice', { token: 't', nonce: 'n', timestamp_ms: Date.now() });
    sfu.grantMediaKey({ callId: CALL_ID, participantId: 'alice', keyId: 'k1', encryptedKeyBlob: 'blob' });
    const res = sfu.requestMediaKey('alice', 'k1');
    expect(res.granted).toBe(true);
    if (res.granted) {
      expect(res.keyId).toBe('k1');
      expect(res.encryptedKeyBlob).toBe('blob');
    }
  });

  it('rejects when callId mismatches', () => {
    const sfu = makeSfu();
    sfu.join('alice', { token: 't', nonce: 'n', timestamp_ms: Date.now() });
    sfu.grantMediaKey({ callId: 'other-call', participantId: 'alice', keyId: 'k1' });
    const res = sfu.requestMediaKey('alice', 'k1');
    expect(res.granted).toBe(false);
    if (!res.granted) {
      expect(res.error).toBe('KEY_LEAK_ATTEMPT');
    }
  });

  it('rejects stale epoch reuse', () => {
    const sfu = makeSfu();
    sfu.join('alice', { token: 't', nonce: 'n', timestamp_ms: Date.now() });
    sfu.grantMediaKey({ callId: CALL_ID, participantId: 'alice', keyId: 'k1', mediaEpoch: 1 });
    const res = sfu.requestMediaKey('alice', 'k1', 2);
    expect(res.granted).toBe(false);
    if (!res.granted) {
      expect(res.error).toBe('STALE_KEY_REUSE');
    }
  });
});
