import { describe, expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveHandshakeComplete } from '../src/handshake.js';
import { createRealCryptoProvider } from '../src/crypto/real.js';
import type { HandshakeComplete, HandshakeInit, HandshakeResponse } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'v0.9', 'handshake_flow_test_vectors.json');

describe('handshake flow vectors (JS end-to-end)', () => {
  test('deriveHandshakeComplete matches vector and feeds real crypto KDF', () => {
    const raw = fs.readFileSync(VECTORS_PATH, 'utf8');
    const vectors = JSON.parse(raw);
    const flow = vectors.handshake_flow;
    expect(flow).toBeTruthy();

    const init = flow.steps[0].message as HandshakeInit;
    const resp = flow.steps[1].message as HandshakeResponse;
    const expectedComplete = flow.steps[2].message as HandshakeComplete;

    const derived = deriveHandshakeComplete(init, resp);
    expect(derived.session_id).toBe(expectedComplete.session_id);

    const provider = createRealCryptoProvider({});
    // Provide a deterministic fake shared_secret so we can validate the KDF output shape.
    const withSecret = { ...derived, shared_secret: Buffer.alloc(64, 7).toString('base64') } as any;
    const keys = provider.keyAgreement.deriveSessionKeys(withSecret);
    expect(Buffer.from(keys.encKey, 'base64').length).toBe(32);
    expect(Buffer.from(keys.authKey, 'base64').length).toBe(32);
    expect(Buffer.from(keys.nonce ?? '', 'base64').length).toBe(12);
  });
});
