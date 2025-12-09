import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveHandshakeComplete } from '../src/handshake.js';
import { createRealCryptoProvider } from '../src/crypto/real.js';
import type { HandshakeComplete, HandshakeResponse } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'end_to_end_test_vectors_js.json');

describe('handshake flow vectors (JS end-to-end)', () => {
  test('deriveHandshakeComplete matches vector and feeds real crypto KDF', () => {
    const raw = fs.readFileSync(VECTORS_PATH, 'utf8');
    const vectors = JSON.parse(raw);
    const flow = vectors.handshake_flow;
    expect(flow).toBeTruthy();

    const respStep = flow.steps.find((s: any) => s.type === 'HANDSHAKE_RESPONSE');
    const completeStep = flow.steps.find((s: any) => s.type === 'HANDSHAKE_COMPLETE');
    expect(respStep?.message).toBeTruthy();
    expect(completeStep?.message).toBeTruthy();

    const resp = respStep.message as HandshakeResponse;
    const expectedComplete = completeStep.message as HandshakeComplete;

    const derived = deriveHandshakeComplete(resp);
    expect(derived.handshake_hash).toBe(expectedComplete.handshake_hash);
    expect(derived.session_id).toBe(expectedComplete.session_id);

    const provider = createRealCryptoProvider({});
    const keys = provider.keyAgreement.deriveSessionKeys(derived);
    expect(Buffer.from(keys.encKey, 'base64').length).toBe(32);
    expect(Buffer.from(keys.authKey, 'base64').length).toBe(32);
    expect(Buffer.from(keys.nonce ?? '', 'base64').length).toBe(12);
  });
});
