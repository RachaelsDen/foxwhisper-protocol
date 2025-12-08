import { afterAll, beforeAll, expect, test } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { FoxClient } from '../src/client.js';
import { TAG_HANDSHAKE_COMPLETE, TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE, encodeTagged, deriveHandshakeComplete } from '../src/handshake.js';
import { KYBER_CT_B64 } from '../src/crypto/kyber.js';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import cbor from 'cbor';

let wss: WebSocketServer;
let port: number;
const SERVER_X25519_PUB = 'MCowBQYDK2VuAyEAoNF8HngL59Fo+xvZ1cKXmVAvycQTJhUyRi5lC7VFiUk=';
const CRYPTO_PROFILE = 'fw-hybrid-x25519-kyber1024';

function digestB64(input: string | undefined | null): string | null {
  if (!input) return null;
  return createHash('sha256').update(Buffer.from(input, 'base64')).digest('base64');
}

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
  wss.clients.forEach((c) => c.close(1000, 'test_shutdown'));
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

test('joins and exchanges a data message', async () => {
  const receivedServer: any[] = [];
  const roomMembers: Map<string, Set<WebSocket>> = new Map();

  wss.on('connection', (socket) => {
    const roomsForSocket = new Set<string>();

    socket.on('message', (data) => {
      const decoded = cbor.decodeFirstSync(data as Buffer);
      const tagged = decoded as cbor.Tagged;
      const msg = tagged instanceof cbor.Tagged ? tagged.value : decoded;
      receivedServer.push(msg);

      if (tagged instanceof cbor.Tagged && tagged.tag === TAG_HANDSHAKE_INIT) {
        const resp = {
          type: 'HANDSHAKE_RESPONSE',
          version: 1,
          server_id: 'srv',
          x25519_public_key: SERVER_X25519_PUB,
          kyber_ciphertext: KYBER_CT_B64,
          timestamp: Date.now(),
          nonce: 'n-srv',
        };
        socket.send(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
        const complete = deriveHandshakeComplete(resp as any);
        socket.send(encodeTagged(complete, TAG_HANDSHAKE_COMPLETE));
        return;
      }

      if ((msg as any).type === 'JOIN') {
        roomsForSocket.add((msg as any).room_id);
        const set = roomMembers.get((msg as any).room_id) ?? new Set<WebSocket>();
        set.add(socket);
        roomMembers.set((msg as any).room_id, set);
        return;
      }
      if ((msg as any).type === 'DATA') {
        const members = roomMembers.get((msg as any).room_id) ?? new Set<WebSocket>();
        if (!members.size) return;
        const encoded = cbor.encodeOne(msg);
        for (const member of members) {
          member.send(encoded);
        }
      }
    });
  });

  const clientA = new FoxClient({
    serverUrl: `ws://localhost:${port}`,
    clientId: 'client-a',
    deviceId: 'device-a',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
    logger: console.info,
  });
  const clientB = new FoxClient({
    serverUrl: `ws://localhost:${port}`,
    clientId: 'client-b',
    deviceId: 'device-b',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
    logger: console.info,
  });

  const receivedA: any[] = [];
  const receivedB: any[] = [];
  clientA.on('message', (msg) => receivedA.push(msg));
  clientB.on('message', (msg) => receivedB.push(msg));

  await clientA.connect();
  await clientB.connect();
  await clientA.join('room-1');
  await clientB.join('room-2');

  await clientA.sendData('room-1', { hello: 'r1' });
  await new Promise((resolve) => setTimeout(resolve, 75));

  expect(receivedA.length).toBe(1);
  expect(receivedA[0]).toMatchObject({ room_id: 'room-1', payload: { hello: 'r1' } });
  expect(receivedB.length).toBe(0);

  const sessionInfo = clientA.getSessionInfo();
  const sessionKeys = clientA.getSessionKeys();
  const status = {
    crypto_profile: CRYPTO_PROFILE,
    backend: sessionInfo.cryptoBackend,
    session_id: sessionInfo.sessionId,
    handshake_hash: sessionInfo.handshakeHash,
    key_digests: {
      encKey_sha256: digestB64(sessionKeys?.encKey ?? null),
      authKey_sha256: digestB64(sessionKeys?.authKey ?? null),
      nonce_sha256: digestB64(sessionKeys?.nonce ?? null),
    },
    timestamp: Date.now(),
  };
  const outDir = path.resolve(process.cwd(), 'test-output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'minimal_e2e_status.json'), JSON.stringify(status, null, 2));

  clientA.close();
  clientB.close();
  wss.removeAllListeners('connection');
});
