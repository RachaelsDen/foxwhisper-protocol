import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { createRealCryptoProvider } from '../src/crypto/real.js';
import { GroupSession } from '../src/group.js';
import { deriveMediaKey } from '../src/media.js';
import type { HandshakeComplete } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');

const HANDSHAKE_VECTORS_PATH = path.join(
  ROOT_DIR,
  'tests',
  'common',
  'handshake',
  'end_to_end_test_vectors_js.json',
);
const GROUP_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'group_messaging_test_vectors.json');
const MEDIA_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'media_encryption_test_vectors.json');
const DR_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'dr_test_vectors.json');

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

describe('key schedule consistency (digest-only)', () => {
  const handshakeVectors = JSON.parse(fs.readFileSync(HANDSHAKE_VECTORS_PATH, 'utf8'));
  const groupVectors = JSON.parse(fs.readFileSync(GROUP_VECTORS_PATH, 'utf8'));
  const mediaVectors = JSON.parse(fs.readFileSync(MEDIA_VECTORS_PATH, 'utf8'));
  const drVectors = JSON.parse(fs.readFileSync(DR_VECTORS_PATH, 'utf8'));

  test('collects digests across handshake → group → media → DR', () => {
    const steps = handshakeVectors.handshake_flow.steps as Array<{ type: string; message: any }>;
    const completeMsg = steps.find((s) => s.type === 'HANDSHAKE_COMPLETE')?.message as HandshakeComplete | undefined;
    expect(completeMsg).toBeTruthy();

    const provider = createRealCryptoProvider({});
    const sessionKeys = provider.keyAgreement.deriveSessionKeys(completeMsg as HandshakeComplete);
    const sessionDigests = {
      encKey_sha256: sha256Hex(decodeB64(sessionKeys.encKey)),
      authKey_sha256: sha256Hex(decodeB64(sessionKeys.authKey)),
      nonce_sha256: sha256Hex(decodeB64(sessionKeys.nonce)),
    };

    // Group harness: derive sender key and ciphertext digest for a small payload.
    const groupMsg = groupVectors.group_messaging.steps.find((s: any) => s.type === 'GROUP_MESSAGE_ENCRYPT')?.message;
    expect(groupMsg).toBeTruthy();
    const groupSession = new GroupSession(groupMsg.group_id);
    groupSession.addMember(groupMsg.sender_id);
    const payload = Buffer.from('hello-group');
    const groupEnc = groupSession.encrypt(groupMsg.sender_id, groupMsg.message_id, payload);
    const groupDigests = {
      sender_key_sha256: groupEnc.sender_key_sha256,
      ciphertext_sha256: sha256Hex(Buffer.from(groupEnc.ciphertext_b64, 'base64')),
      nonce_sha256: sha256Hex(Buffer.from(groupEnc.nonce_b64, 'base64')),
      aad_sha256: groupEnc.aad_sha256,
    };

    // Media harness: derive media key and encrypt frame per harness (vectors are opaque).
    const mediaStep = mediaVectors.key_derivation.steps[0];
    const mediaInput = mediaStep.input;
    const mediaDerived = deriveMediaKey({
      root_key: mediaInput.root_key,
      chain_key: mediaInput.chain_key,
      message_index: mediaInput.message_index,
      salt: mediaInput.salt,
    });
    const mediaDigests = {
      derived_media_key_sha256: mediaDerived.media_key_sha256,
      vector_media_key_sha256: sha256Hex(decodeB64(mediaStep.output.media_key)),
    };

    // DR digests (structural integrity only).
    const dr = drVectors.dr_backup.device_record;
    const drDigests = {
      device_public_key_sha256: sha256Hex(decodeB64(dr.device_public_key)),
      device_private_key_sha256: sha256Hex(decodeB64(dr.device_private_key)),
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      handshake: sessionDigests,
      group: groupDigests,
      media: mediaDigests,
      device_record: drDigests,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'key_schedule_status.json'), JSON.stringify(summary, null, 2));

    // Basic sanity assertions
    expect(decodeB64(sessionKeys.encKey).length).toBe(32);
    expect(decodeB64(sessionKeys.authKey).length).toBe(32);
    expect(decodeB64(sessionKeys.nonce).length).toBe(12);
    expect(decodeB64(mediaStep.output.media_key).length).toBe(32);
  });
});
