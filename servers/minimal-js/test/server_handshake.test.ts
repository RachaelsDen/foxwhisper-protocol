import { afterAll, beforeAll, expect, test } from 'vitest';
import { MinimalServer } from '../src/server.js';
import WebSocket from 'ws';
import cbor from 'cbor';
import { TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE, TAG_HANDSHAKE_COMPLETE, encodeTagged } from '../src/handshake.js';

let server: MinimalServer;
let port: number;

beforeAll(async () => {
  server = new MinimalServer({ port: 0 });
  const address = server.address();
  if (typeof address === 'object' && address?.port) {
    port = address.port;
  } else {
    throw new Error('failed to get port');
  }
});

afterAll(async () => {
  await server.close();
});

test('responds to handshake init with response and complete', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const receivedTags: number[] = [];

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      const init = {
        type: 'HANDSHAKE_INIT',
        version: 1,
        client_id: 'client-1',
        x25519_public_key: 'cli-x',
        kyber_public_key: 'cli-k',
        timestamp: Date.now(),
        nonce: 'n1',
      };
      ws.send(encodeTagged(init, TAG_HANDSHAKE_INIT));
    });

    ws.on('message', (data) => {
      const decoded = cbor.decodeFirstSync(data as Buffer) as cbor.Tagged;
      receivedTags.push(decoded.tag as number);
      if (receivedTags.includes(TAG_HANDSHAKE_RESPONSE) && receivedTags.includes(TAG_HANDSHAKE_COMPLETE)) {
        resolve();
      }
    });

    ws.on('error', (err) => reject(err));
  });

  expect(receivedTags).toContain(TAG_HANDSHAKE_RESPONSE);
  expect(receivedTags).toContain(TAG_HANDSHAKE_COMPLETE);
  ws.close();
});
