import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import cbor from 'cbor';
import { encodeTagged } from '../src/handshake.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

const HANDSHAKE_VECTORS_PATH = path.join(
  ROOT_DIR,
  'tests',
  'common',
  'handshake',
  'cbor_test_vectors_fixed.json',
);

const DR_VECTORS_PATH = path.join(ROOT_DIR, 'tests', 'common', 'handshake', 'dr_test_vectors.json');

interface HandshakeVectorFile {
  [name: string]: { tag: number; data: Record<string, unknown> };
}

interface DrVectorsFile {
  [name: string]: any;
}

describe('handshake/DR vector conformance (structure + encoding)', () => {
  test('encodes handshake CBOR vectors canonically and can re-decode them', () => {
    const raw = fs.readFileSync(HANDSHAKE_VECTORS_PATH, 'utf8');
    const vectors: HandshakeVectorFile = JSON.parse(raw);

    const summary: Record<string, { tag: number; hexPrefix: string; length: number }> = {};

    for (const [name, { tag, data }] of Object.entries(vectors)) {
      const tagged = new cbor.Tagged(tag, data);
      const encoded = cbor.encodeCanonical(tagged);
      const decoded = cbor.decodeFirstSync(encoded) as cbor.Tagged;
      const value = decoded instanceof cbor.Tagged ? decoded.value : decoded;
      expect(value).toMatchObject({ type: data.type, version: data.version });

      summary[name] = {
        tag,
        length: encoded.length,
        hexPrefix: encoded.toString('hex').slice(0, 64).toUpperCase(),
      };
    }

    const outDir = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'handshake_cbor_status.json');
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

    // Basic sanity: we produced summaries for all three handshake messages.
    expect(Object.keys(summary).sort()).toEqual([
      'HANDSHAKE_COMPLETE',
      'HANDSHAKE_INIT',
      'HANDSHAKE_RESPONSE',
    ]);
  });

  test('validates DR vectors have required structure', () => {
    const raw = fs.readFileSync(DR_VECTORS_PATH, 'utf8');
    const vectors: DrVectorsFile = JSON.parse(raw);

    const backup = vectors.dr_backup?.device_record;
    expect(backup).toBeTruthy();
    expect(backup.type).toBe('DEVICE_RECORD_BACKUP');
    expect(backup.version).toBe(1);
    expect(typeof backup.user_id).toBe('string');
    expect(typeof backup.device_id).toBe('string');

    const restore = vectors.dr_restore?.restore_request;
    expect(restore).toBeTruthy();
    expect(restore.type).toBe('DEVICE_RECORD_RESTORE');
    expect(restore.version).toBe(1);

    const reset = vectors.dr_reset?.reset_request;
    expect(reset).toBeTruthy();
    expect(reset.type).toBe('DEVICE_RECORD_RESET');
    expect(reset.version).toBe(1);

    const outDir = path.join(ROOT_DIR, 'clients', 'minimal-js', 'test-output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'dr_vectors_status.json');
    const summary = {
      has_backup: !!backup,
      has_restore: !!restore,
      has_reset: !!reset,
    };
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  });
});
