import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { createRealCryptoProvider } from '../src/crypto/real.js';
import { buildDeterministicNonce } from '../src/crypto/toy.js';
import type { HandshakeComplete } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const HANDSHAKE_VECTORS_PATH = path.join(
  ROOT_DIR,
  'tests',
  'common',
  'handshake',
  'end_to_end_test_vectors_js.json',
);
const DR_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'dr_test_vectors.json');
const OUT_DIR = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

describe('handshake/DR derived digests', () => {
  test('derives session keys and deterministic nonce digests from handshake vectors', () => {
    const handshakeVectors = JSON.parse(fs.readFileSync(HANDSHAKE_VECTORS_PATH, 'utf8'));
    const steps = handshakeVectors.handshake_flow.steps as Array<{ type: string; message: any }>;
    const completeMsg = steps.find((s) => s.type === 'HANDSHAKE_COMPLETE')?.message as HandshakeComplete | undefined;
    expect(completeMsg).toBeTruthy();

    const provider = createRealCryptoProvider({});
    const keys = provider.keyAgreement.deriveSessionKeys(completeMsg as HandshakeComplete);

    const encKeyBytes = decodeB64(keys.encKey);
    const authKeyBytes = decodeB64(keys.authKey);
    const nonceBytes = decodeB64(keys.nonce);

    expect(encKeyBytes.length).toBe(32);
    expect(authKeyBytes.length).toBe(32);
    expect(nonceBytes.length).toBe(12);

    const nonceDigest = sha256Hex(nonceBytes);
    const adNonce = buildDeterministicNonce({ room_id: 'room-1', sender: 'client-a', seq: 1 });
    const adNonceBytes = decodeB64(adNonce);
    expect(adNonceBytes.length).toBe(12);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      handshake_complete_session_id: completeMsg?.session_id,
      encKey_sha256: sha256Hex(encKeyBytes),
      authKey_sha256: sha256Hex(authKeyBytes),
      nonce_sha256: nonceDigest,
      deterministic_nonce_b64: adNonce,
      deterministic_nonce_sha256: sha256Hex(adNonceBytes),
    };
    fs.writeFileSync(path.join(OUT_DIR, 'handshake_dr_crypto_status.json'), JSON.stringify(summary, null, 2));
  });

  test('validates DR vector base64 fields and emits digests', () => {
    const vectors = JSON.parse(fs.readFileSync(DR_VECTORS_PATH, 'utf8'));
    const backup = vectors.dr_backup.device_record;
    const restore = vectors.dr_restore.restore_request;
    const reset = vectors.dr_reset.reset_request;
    const backupDataB64 = vectors.dr_restore.backup_data as string;

    const devicePriv = decodeB64(backup.device_private_key);
    const devicePub = decodeB64(backup.device_public_key);
    const backupData = decodeB64(backupDataB64);
    const restoreCode = decodeB64(restore.verification_code);
    const resetCode = decodeB64(reset.verification_code);

    expect(devicePriv.length).toBeGreaterThan(0);
    expect(devicePub.length).toBeGreaterThan(0);
    expect(backupData.length).toBeGreaterThan(0);
    expect(restoreCode.length).toBeGreaterThan(0);
    expect(resetCode.length).toBeGreaterThan(0);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const summary = {
      backup_device_public_key_sha256: sha256Hex(devicePub),
      backup_device_private_key_sha256: sha256Hex(devicePriv),
      backup_data_sha256: sha256Hex(backupData),
      restore_verification_code_sha256: sha256Hex(restoreCode),
      reset_verification_code_sha256: sha256Hex(resetCode),
    };
    fs.writeFileSync(path.join(OUT_DIR, 'dr_vectors_crypto_status.json'), JSON.stringify(summary, null, 2));
  });
});
