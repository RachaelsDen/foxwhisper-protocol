import { afterAll, beforeAll, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import { FoxClient } from '../src/client.js';
import { TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE, encodeTagged } from '../src/handshake.js';
import type { HandshakeResponse } from '../src/types.js';
import cbor from 'cbor';

let wss: WebSocketServer;
let port: number;

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const address = wss.address();
  if (typeof address === 'object' && address?.port) {
    port = address.port;
  } else {
    throw new Error('failed to get port');
  }
});

afterAll(async () => {
  wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

test('performs handshake and reaches ready state', async () => {
  const serverReceived: any[] = [];

  wss.once('connection', (socket) => {
    socket.on('message', (data) => {
      const decoded = cbor.decodeFirstSync(data as Buffer);
      const tagged = decoded as cbor.Tagged;
      serverReceived.push(tagged.value);
      // Respond with handshake response
      if (tagged.tag === TAG_HANDSHAKE_INIT) {
        const resp: HandshakeResponse = {
          type: 'HANDSHAKE_RESPONSE',
          version: 1,
          server_id: 'server-1',
          x25519_public_key: 'srv-x25519',
          kyber_ciphertext: 'cipher',
          timestamp: Date.now(),
          nonce: 'nonce-srv',
        };
        socket.send(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
        // And immediately send HANDSHAKE_COMPLETE
        const complete = {
          type: 'HANDSHAKE_COMPLETE',
          version: 1,
          session_id: 'sess-1',
          handshake_hash: 'hash-1',
          timestamp: Date.now(),
        };
        socket.send(encodeTagged(complete, 0xd3));
      }
    });
  });

  const client = new FoxClient({
    serverUrl: `ws://localhost:${port}`,
    clientId: 'client-1',
    deviceId: 'device-1',
    x25519PublicKey: 'cli-x25519',
    kyberPublicKey: 'cli-kyber',
  });

  await expect(client.connect()).resolves.not.toThrow();
  expect(client.getState()).toBe('ready');
  expect(serverReceived[0]).toMatchObject({ type: 'HANDSHAKE_INIT', client_id: 'client-1' });

  client.close();
});
