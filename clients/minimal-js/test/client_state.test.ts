import { expect, test } from 'vitest';
import cbor from 'cbor';
import { FoxClient } from '../src/client.js';
import { encodeTagged, TAG_HANDSHAKE_RESPONSE, TAG_HANDSHAKE_COMPLETE, deriveHandshakeComplete } from '../src/handshake.js';
import { StateError } from '../src/errors.js';
import { buildAssociatedData, createToyAead, createToyKeyAgreement } from '../src/testCrypto.js';
import { KYBER_CT_B64 } from '../src/crypto/kyber.js';
import type { WebSocketLike, DataMessage, HandshakeResponse } from '../src/types.js';
 
const SERVER_X25519_PUB = 'MCowBQYDK2VuAyEAoNF8HngL59Fo+xvZ1cKXmVAvycQTJhUyRi5lC7VFiUk=';
 
class FakeSocket implements WebSocketLike {

  readyState = 1;
  onopen: null | (() => void) = null;
  onmessage: null | ((ev: { data: any }) => void) = null;
  onclose: null | (() => void) = null;
  onerror: null | ((err: any) => void) = null;
  sent: any[] = [];

  triggerOpen() {
    this.onopen?.();
  }

  triggerMessage(data: Buffer) {
    this.onmessage?.({ data });
  }

  send(data: any): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

async function connectClient(logger: (event: string, meta?: Record<string, unknown>) => void = () => {}): Promise<{ client: FoxClient; socket: FakeSocket; resp: HandshakeResponse }> {
  const socket = new FakeSocket();
  const client = new FoxClient({
    serverUrl: 'ws://fake',
    clientId: 'client-1',
    deviceId: 'device-1',
    x25519PublicKey: 'cli-x',
    kyberPublicKey: 'cli-k',
    wsFactory: () => socket,
    logger,
    cryptoBackend: 'toy',
    insecureCrypto: true,
  });

  const connectPromise = client.connect();
  socket.triggerOpen();

  const resp: HandshakeResponse = {
    type: 'HANDSHAKE_RESPONSE',
    version: 1,
    server_id: 'srv',
    x25519_public_key: SERVER_X25519_PUB,
    kyber_ciphertext: KYBER_CT_B64,
    timestamp: Date.now(),
    nonce: 'n-srv',
  };
  socket.triggerMessage(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
  socket.triggerMessage(encodeTagged(deriveHandshakeComplete(resp), TAG_HANDSHAKE_COMPLETE));

  await connectPromise;
  return { client, socket, resp };
}

function lastSentDataOfType(socket: FakeSocket, type: string) {
  const buffers = socket.sent.filter((b) => Buffer.isBuffer(b)) as Buffer[];
  for (let i = buffers.length - 1; i >= 0; i--) {
    const decoded = cbor.decodeFirstSync(buffers[i]) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === type) {
      return decoded;
    }
  }
  return null;
}

test('rejects DATA before JOIN', async () => {
  const { client } = await connectClient();
  await expect(client.sendData('room-1', { hello: 'x' })).rejects.toThrow(StateError);
});

test('double JOIN is idempotent (no second send)', async () => {
  const { client, socket } = await connectClient();
  await client.join('room-1');
  const firstJoin = lastSentDataOfType(socket, 'JOIN');
  expect(firstJoin?.room_id).toBe('room-1');
  expect(firstJoin?.seq).toBe(1);
  await client.join('room-1');
  const joinMessages = socket.sent
    .map((buf) => cbor.decodeFirstSync(buf as Buffer))
    .filter((d: any) => !(d instanceof cbor.Tagged) && d.type === 'JOIN');
  expect(joinMessages.length).toBe(1);
});

test('decrypts ciphertext payloads before emitting', async () => {
  const { client, socket, resp } = await connectClient();
  const events: DataMessage[] = [];
  client.on('message', (msg) => events.push(msg as DataMessage));
  await client.join('room-9');

  const keys = createToyKeyAgreement().deriveSessionKeys(deriveHandshakeComplete(resp));
  const packet = { room_id: 'room-9', sender: 'other', payload: { hi: 'there' }, seq: 7 };
  const ad = buildAssociatedData({ room_id: packet.room_id, sender: packet.sender, seq: packet.seq });
  const cipherBytes = createToyAead().encrypt(cbor.encodeOne(packet.payload), ad, keys);
  const dataMsg: DataMessage = {
    type: 'DATA',
    room_id: packet.room_id,
    sender: packet.sender,
    payload: { ciphertext: Buffer.from(cipherBytes).toString('base64'), seq: packet.seq },
    timestamp: Date.now(),
    seq: packet.seq,
  };
  socket.triggerMessage(cbor.encodeOne(dataMsg));

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events.length).toBe(1);
  expect(events[0]).toMatchObject({ payload: { hi: 'there' }, seq: 7, room_id: 'room-9' });
});

test('drops inbound DATA for unjoined room with protocol_error log', async () => {
  const logs: any[] = [];
  const { socket } = await connectClient((event, meta) => logs.push({ event, meta }));
  const dataMsg: DataMessage = {
    type: 'DATA',
    room_id: 'not-joined',
    sender: 'evil',
    payload: { nope: true },
    timestamp: Date.now(),
  };
  socket.triggerMessage(cbor.encodeOne(dataMsg));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(logs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'DATA_FOR_UNJOINED_ROOM')).toBeTruthy();
});

test('unexpected JOIN_ACK does not change state or emit join', async () => {
  const logs: any[] = [];
  const { client, socket } = await connectClient((event, meta) => logs.push({ event, meta }));
  let joined = 0;
  client.on('joined', () => joined++);
  const ack = { type: 'JOIN_ACK', room_id: 'ghost', timestamp: Date.now(), members: ['ghost'] };
  socket.triggerMessage(cbor.encodeOne(ack));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(joined).toBe(0);
  await expect(client.sendData('ghost', { hi: true })).rejects.toThrow(StateError);
  expect(logs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'UNEXPECTED_JOIN_ACK')).toBeTruthy();
});

test('DATA after leave is rejected locally', async () => {
  const { client } = await connectClient();
  await client.join('room-1');
  await client.leave('room-1');
  await expect(client.sendData('room-1', { hi: true })).rejects.toThrow(StateError);
});

test('late DATA after disconnect logs protocol_error', async () => {
  const logs: any[] = [];
  const { client, socket } = await connectClient((event, meta) => logs.push({ event, meta }));
  client.close();
  const dataMsg: DataMessage = {
    type: 'DATA',
    room_id: 'room-1',
    sender: 'any',
    payload: { hi: true },
    timestamp: Date.now(),
  };
  socket.triggerMessage(cbor.encodeOne(dataMsg));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(logs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'LATE_DATA_AFTER_DISCONNECT')).toBeTruthy();
});
