import { afterAll, beforeAll, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';
import { FoxClient } from '../src/client.js';
import { TAG_HANDSHAKE_COMPLETE, TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE, deriveHandshakeComplete, encodeTagged } from '../src/handshake.js';
import { KYBER_CT_B64 } from '../src/crypto/kyber.js';
import type { HandshakeResponse } from '../src/types.js';
import cbor from 'cbor';

const SERVER_X25519_PUB = 'MCowBQYDK2VuAyEAoNF8HngL59Fo+xvZ1cKXmVAvycQTJhUyRi5lC7VFiUk=';

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
          x25519_public_key: SERVER_X25519_PUB,
          kyber_ciphertext: KYBER_CT_B64,
          timestamp: Date.now(),
          nonce: 'nonce-srv',
        };
        socket.send(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
        const complete = deriveHandshakeComplete(resp);
        socket.send(encodeTagged(complete, TAG_HANDSHAKE_COMPLETE));
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
