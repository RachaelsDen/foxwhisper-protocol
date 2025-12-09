import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { GroupSession } from '../src/group.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const GROUP_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'group_messaging_test_vectors.json');
const OUT_DIR = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

describe('group messaging harness against vectors', () => {
  const vectors = JSON.parse(fs.readFileSync(GROUP_VECTORS_PATH, 'utf8'));

  test('validates group creation/join/leave structure', () => {
    const creation = vectors.group_creation;
    expect(creation.group_info.group_id).toBeTruthy();
    expect(creation.steps[0].message.type).toBe('GROUP_CREATE');

    const join = vectors.group_join;
    expect(join.group_context.group_id).toBeTruthy();
    expect(join.steps[0].message.type).toBe('GROUP_JOIN_REQUEST');
    expect(join.steps[1].message.type).toBe('GROUP_JOIN_APPROVAL');

    const leave = vectors.group_leave;
    expect(leave.group_context.group_id).toBeTruthy();
    expect(leave.steps[0].message.type).toBe('GROUP_LEAVE_REQUEST');
    expect(leave.steps[1].message.type).toBe('GROUP_MEMBER_REMOVE');
  });

  test('encrypts/decrypts group message and emits digests', () => {
    const messaging = vectors.group_messaging;
    const stepEncrypt = messaging.steps.find((s: any) => s.type === 'GROUP_MESSAGE_ENCRYPT');
    const stepDistribute = messaging.steps.find((s: any) => s.type === 'GROUP_MESSAGE_DISTRIBUTE');
    expect(stepEncrypt).toBeTruthy();
    expect(stepDistribute).toBeTruthy();

    const msg = stepEncrypt.message;
    const dist = stepDistribute.message;

    const session = new GroupSession(msg.group_id);
    session.addMember(msg.sender_id);

    const plaintext = decodeB64(msg.message_content);
    const enc = session.encrypt(msg.sender_id, msg.message_id, plaintext);
    const dec = session.decrypt(msg.sender_id, msg.message_id, enc.ciphertext_b64);

    expect(dec.equals(plaintext)).toBe(true);

    const vectorCipher = decodeB64(dist.encrypted_message);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      vector_cipher_sha256: sha256Hex(vectorCipher),
      harness_cipher_sha256: sha256Hex(Buffer.from(enc.ciphertext_b64, 'base64')),
      harness_nonce_b64: enc.nonce_b64,
      harness_aad_sha256: enc.aad_sha256,
      harness_sender_key_sha256: enc.sender_key_sha256,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'group_vectors_status.json'), JSON.stringify(summary, null, 2));
  });
});
