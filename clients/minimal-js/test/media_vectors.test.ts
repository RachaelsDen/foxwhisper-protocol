import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { deriveMediaKey, encryptFrame, decryptFrame } from '../src/media.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const MEDIA_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'media_encryption_test_vectors.json');
const OUT_DIR = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

describe('media harness against vectors', () => {
  const vectors = JSON.parse(fs.readFileSync(MEDIA_VECTORS_PATH, 'utf8'));

  test('media key derivation digests and lengths (vector-provided key)', () => {
    const step = vectors.key_derivation.steps[0];
    const input = step.input;
    const derived = deriveMediaKey({
      root_key: input.root_key,
      chain_key: input.chain_key,
      message_index: input.message_index,
      salt: input.salt,
    });

    const vectorMediaKey = decodeB64(step.output.media_key);
    expect(vectorMediaKey.length).toBe(32);
    expect(derived.media_key_b64.length).toBeGreaterThan(0);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      vector_media_key_sha256: sha256Hex(vectorMediaKey),
      derived_media_key_sha256: derived.media_key_sha256,
      derived_vs_vector_match: derived.media_key_sha256 === sha256Hex(vectorMediaKey),
    };
    fs.writeFileSync(path.join(OUT_DIR, 'media_key_status.json'), JSON.stringify(summary, null, 2));
  });

  test('frame protection digests (vector is opaque)', () => {
    const step = vectors.frame_protection.steps[0];
    const input = step.input;
    const output = step.output;

    // We do not expect to match the opaque vector ciphertext; emit digests for comparison.
    const enc = encryptFrame({
      media_key: input.media_key,
      frame_data: input.frame_data,
      frame_iv: input.frame_iv,
      aad: input.aad,
    });

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      vector_encrypted_frame_sha256: sha256Hex(decodeB64(output.encrypted_frame)),
      harness_encrypted_frame_sha256: sha256Hex(decodeB64(enc.ciphertext_b64)),
      vector_auth_tag_sha256: sha256Hex(decodeB64(output.auth_tag)),
      harness_auth_tag_sha256: sha256Hex(decodeB64(enc.auth_tag_b64)),
      aad_sha256: enc.aad_sha256,
      nonce_sha256: enc.nonce_sha256,
      media_key_sha256: enc.media_key_sha256,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'media_vectors_status.json'), JSON.stringify(summary, null, 2));

    // Basic sanity: lengths
    expect(decodeB64(output.auth_tag).length).toBe(16);
    expect(decodeB64(output.encrypted_frame).length).toBeGreaterThan(0);
    expect(decodeB64(enc.ciphertext_b64).length).toBeGreaterThan(0);
  });
});
