import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { FoxClient } from '../src/client.js';
import { TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE, encodeTagged } from '../src/handshake.js';
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

test('joins and exchanges a data message', async () => {
  const receivedServer: any[] = [];
  const incomingMessages: any[] = [];

  wss.once('connection', (socket) => {
    socket.on('message', (data) => {
      const tagged = cbor.decodeFirstSync(data as Buffer) as cbor.Tagged;
      receivedServer.push(tagged.value);
      if (tagged.tag === TAG_HANDSHAKE_INIT) {
        const resp = {
          type: 'HANDSHAKE_RESPONSE',
          version: 1,
          server_id: 'srv',
          x25519_public_key: 'srv-x',
          kyber_ciphertext: 'ct',
          timestamp: Date.now(),
          nonce: 'n-srv',
        };
        socket.send(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
        socket.send(
          encodeTagged(
            {
              type: 'HANDSHAKE_COMPLETE',
              version: 1,
              session_id: 'sess',
              handshake_hash: 'hash',
              timestamp: Date.now(),
            },
            0xd3,
          ),
        );
      } else {
        // Assume data message, echo back
        socket.send(data);
      }
    });
  });

  const client = new FoxClient({
    serverUrl: `ws://localhost:${port}`,
    clientId: 'client-2',
    deviceId: 'device-2',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
  });

  const onMessage = vi.fn((msg) => incomingMessages.push(msg));
  client.on('message', onMessage);

  await client.connect();
  await client.join('room-1');
  await client.sendData('room-1', { hello: 'world' });

  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(receivedServer.some((m) => m.type === 'HANDSHAKE_INIT')).toBe(true);
  expect(onMessage).toHaveBeenCalled();
  expect(incomingMessages[0]).toMatchObject({ payload: { hello: 'world' } });

  client.close();
});
