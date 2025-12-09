import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MinimalSfu } from '../src/sfu.js';

const CALL_ID = 'call-xyz';
const OUT_DIR = path.resolve('test-output');
const TRANSCRIPT_PATH = path.join(OUT_DIR, 'sfu_media_transcript.json');

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

function makeSfu() {
  return new MinimalSfu({
    callId: CALL_ID,
    roomId: CALL_ID,
    clientAuthKey: Buffer.alloc(32, 1),
    policy: { acceptAnyToken: true },
  });
}

describe('MinimalSfu transcript', () => {
  it('records routed and denied frames with digests and writes artifact', () => {
    ensureOutDir();
    const sfu = makeSfu();
    sfu.join('alice', { token: 't', nonce: 'n', timestamp_ms: Date.now() });
    sfu.publishTrack('alice', { trackId: 'a1', kind: 'video', layers: ['low'] });

    sfu.onFrame({
      call_id: CALL_ID,
      participant_id: 'alice',
      stream_id: 'a1',
      frame_sequence: 1,
      media_epoch: 0,
    });

    sfu.onFrame({
      call_id: CALL_ID,
      participant_id: 'ghost',
      stream_id: 'missing',
      frame_sequence: 1,
      media_epoch: 0,
    });

    const entries = sfu.getTranscript();
    expect(entries.length).toBe(2);
    const routed = entries.find((e) => e.routing_action === 'routed');
    const denied = entries.find((e) => e.routing_action === 'denied');
    expect(routed?.header_digest).toBeTruthy();
    expect(denied?.reason).toBe('UNAUTHORIZED_SUBSCRIBE');

    fs.writeFileSync(TRANSCRIPT_PATH, JSON.stringify(entries, null, 2));
    expect(fs.existsSync(TRANSCRIPT_PATH)).toBe(true);
  });
});
