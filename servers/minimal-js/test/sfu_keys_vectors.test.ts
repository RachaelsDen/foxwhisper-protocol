import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vectors from '../../../tests/common/handshake/media_encryption_test_vectors.json';
import { MinimalSfu } from '../src/sfu.js';

const OUT_DIR = path.resolve('test-output');
const STATUS_PATH = path.join(OUT_DIR, 'sfu_key_distribution_status.json');

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

describe('SFU key distribution vectors', () => {
  it('grants keys for the key_distribution vector and rejects wrong participants', () => {
    ensureOutDir();
    const scenario = (vectors as any).key_distribution;
    expect(scenario).toBeTruthy();
    const { sfu_context: ctx, steps } = scenario;
    const sfu = new MinimalSfu({
      callId: ctx.sfu_id,
      roomId: ctx.sfu_id,
      clientAuthKey: Buffer.alloc(32, 1),
      policy: { acceptAnyToken: true },
    });

    const status = { vector: 'key_distribution', results: [] as Array<{ step: number; status: string; error?: string }> };

    for (const step of steps as any[]) {
      if (step.type === 'KEY_DISTRIBUTE') {
        sfu.join(ctx.participant_id, { token: 't', nonce: 'n', timestamp_ms: step.message.distribution_timestamp ?? Date.now() });
        sfu.grantMediaKey({
          callId: ctx.sfu_id,
          participantId: ctx.participant_id,
          keyId: step.message.key_id ?? 'unknown',
          encryptedKeyBlob: step.message.media_key,
        });
        status.results.push({ step: step.step, status: 'granted' });
      } else if (step.type === 'KEY_ACK') {
        const resOk = sfu.requestMediaKey(ctx.participant_id, step.message.key_id ?? 'unknown');
        status.results.push({ step: step.step, status: resOk.granted ? 'granted' : 'denied', error: resOk.granted ? undefined : (resOk as any).error });
        const resBad = sfu.requestMediaKey('other', step.message.key_id ?? 'unknown');
        expect(resBad.granted).toBe(false);
        if (!resBad.granted) {
          status.results.push({ step: step.step, status: 'denied', error: resBad.error });
        }
      }
    }

    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
    expect(fs.existsSync(STATUS_PATH)).toBe(true);
  });
});
