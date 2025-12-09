import { describe, expect, test } from 'vitest';
import cbor from 'cbor';
import vectors from './fixtures/golden_handshake.json';
import badVectors from './fixtures/malformed_handshake.json';
import { encodeTagged, TAG_HANDSHAKE_RESPONSE, TAG_HANDSHAKE_COMPLETE, deriveHandshakeComplete } from '../src/handshake.js';
import { decodeIncoming } from '../src/handshake.js';
import { FoxClient } from '../src/client.js';

const resp = vectors.handshake_response;
const respBuf = encodeTagged(resp, TAG_HANDSHAKE_RESPONSE);
const complete = deriveHandshakeComplete(resp);
const completeBuf = encodeTagged(complete, TAG_HANDSHAKE_COMPLETE);

describe('conformance: golden handshake vector', () => {
  test('decodes handshake response', () => {
    const decoded = decodeIncoming(Buffer.from(respBuf));
    const value = decoded instanceof cbor.Tagged ? decoded.value : decoded;
    expect(value).toMatchObject({ type: 'HANDSHAKE_RESPONSE', server_id: 'srv' });
  });

  test('decodes handshake complete', () => {
    const decoded = decodeIncoming(Buffer.from(completeBuf));
    const value = decoded instanceof cbor.Tagged ? decoded.value : decoded;
    expect(value).toMatchObject({ type: 'HANDSHAKE_COMPLETE', session_id: complete.session_id });
  });
});

class FakeSocket {
  readyState = 1;
  onopen: null | (() => void) = null;
  onmessage: null | ((ev: { data: any }) => void) = null;
  onclose: null | (() => void) = null;
  onerror: null | ((err: any) => void) = null;
  sent: any[] = [];
  triggerOpen() { this.onopen?.(); }
  triggerMessage(data: Buffer) { this.onmessage?.({ data }); }
  send(data: any) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
}

describe('conformance: malformed handshake vector', () => {
  test('emits protocol error and does not reach ready', async () => {
    const logs: any[] = [];
    const errors: any[] = [];
    const ws = new FakeSocket();
    const client = new FoxClient({
      serverUrl: 'ws://localhost',
      clientId: 'c1',
      deviceId: 'd1',
      x25519PublicKey: 'cli-x',
      kyberPublicKey: 'cli-k',
      wsFactory: () => ws as any,
      insecureCrypto: true,
      logger: (e, m) => logs.push({ e, m }),
    });
    client.on('error', (err) => errors.push(err));
    const connectPromise = client.connect();
    ws.triggerOpen();
    // malformed frame
    ws.triggerMessage(Buffer.from([0xff]));
    await expect(connectPromise).rejects.toBeDefined();
    expect(errors.some((e) => e.kind === 'DECODE_FAILED')).toBe(true);
    expect(client.getState()).not.toBe('ready');
  });
});
