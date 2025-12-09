import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { MinimalServer } from '../src/server.js';
import WebSocket from 'ws';
import cbor from 'cbor';
import { TAG_HANDSHAKE_INIT, encodeTagged } from '../src/handshake.js';
import { makeSpaceRoom } from '../src/space.js';
import { groupToRoom } from '../src/group.js';
import type { DataMessage } from '../src/types.js';

let server: MinimalServer;
let port: number;
const serverLogs: Array<{ event: string; meta?: any }> = [];

beforeAll(async () => {
  server = new MinimalServer({ port: 0, logger: (event, meta) => serverLogs.push({ event, meta }) });
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

beforeEach(() => {
  serverLogs.length = 0;
});

function doHandshake(ws: WebSocket, clientId: string) {
  const init = {

    type: 'HANDSHAKE_INIT',
    version: 1,
    client_id: clientId,
    x25519_public_key: 'cli-x',
    kyber_public_key: 'cli-k',
    timestamp: Date.now(),
    nonce: 'n1',
  };
  ws.send(encodeTagged(init, TAG_HANDSHAKE_INIT));
}

function waitForReady(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const tagged = cbor.decodeFirstSync(data as Buffer) as cbor.Tagged;
      if (tagged.tag === 0xd3) {
        resolve();
      }
    });
  });
}

function joinRoom(ws: WebSocket, roomId: string) {
  ws.send(cbor.encodeOne({ type: 'JOIN', room_id: roomId, timestamp: Date.now() }));
}

function leaveRoom(ws: WebSocket, roomId: string) {
  ws.send(cbor.encodeOne({ type: 'LEAVE', room_id: roomId, timestamp: Date.now() }));
}

test('routes data messages to subscribers in same room', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);

  await new Promise<void>((resolve) => wsA.once('open', () => resolve()));
  await new Promise<void>((resolve) => wsB.once('open', () => resolve()));

  doHandshake(wsA, 'a');
  doHandshake(wsB, 'b');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);

  joinRoom(wsA, 'room-1');
  joinRoom(wsB, 'room-1');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const received: DataMessage[] = [];

  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') {
      received.push(decoded as DataMessage);
    }
  });
  wsA.on('message', () => {}); // ensure server can broadcast to sender without unhandled listener

  const dataMsg: DataMessage = {
    type: 'DATA',
    room_id: 'room-1',
    sender: 'a',
    payload: { hello: 'room' },
    timestamp: Date.now(),
  };
  wsA.send(cbor.encodeOne(dataMsg));

  await new Promise((resolve) => setTimeout(resolve, 150));

  expect(received.length).toBe(1);
  expect(received[0]).toMatchObject({ payload: { hello: 'room' }, room_id: 'room-1' });

  wsA.close();
  wsB.close();
});

test('does not deliver to other rooms', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);
  const wsC = new WebSocket(`ws://localhost:${port}`);

  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
    new Promise<void>((resolve) => wsC.once('open', () => resolve())),
  ]);

  doHandshake(wsA, 'a');
  doHandshake(wsB, 'b');
  doHandshake(wsC, 'c');
  await Promise.all([waitForReady(wsA), waitForReady(wsB), waitForReady(wsC)]);

  joinRoom(wsA, 'room-1');
  joinRoom(wsB, 'room-1');
  joinRoom(wsC, 'room-2');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const receivedB: DataMessage[] = [];
  const receivedC: DataMessage[] = [];

  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') {
      receivedB.push(decoded as DataMessage);
    }
  });
  wsC.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') {
      receivedC.push(decoded as DataMessage);
    }
  });
  wsA.on('message', () => {});

  const dataMsg: DataMessage = {
    type: 'DATA',
    room_id: 'room-1',
    sender: 'a',
    payload: { hello: 'room1' },
    timestamp: Date.now(),
  };
  wsA.send(cbor.encodeOne(dataMsg));

  await new Promise((resolve) => setTimeout(resolve, 150));

  expect(receivedB.length).toBe(1);
  expect(receivedB[0]).toMatchObject({ room_id: 'room-1', payload: { hello: 'room1' } });
  expect(receivedC.length).toBe(0);

  wsA.close();
  wsB.close();
  wsC.close();
});

test('drops data when sender has not joined', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);

  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);

  doHandshake(wsA, 'a');
  doHandshake(wsB, 'b');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);

  joinRoom(wsB, 'room-1');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') {
      received.push(decoded as DataMessage);
    }
  });

  wsA.send(
    cbor.encodeOne({
      type: 'DATA',
      room_id: 'room-1',
      sender: 'a',
      payload: { should: 'drop' },
      timestamp: Date.now(),
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(0);
  expect(serverLogs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'UNAUTHORIZED_ROOM_SEND')).toBeTruthy();

  wsA.close();
  wsB.close();
});

test('drops data after leave', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);

  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);

  doHandshake(wsA, 'a');
  doHandshake(wsB, 'b');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);

  joinRoom(wsA, 'room-1');
  joinRoom(wsB, 'room-1');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') {
      received.push(decoded as DataMessage);
    }
  });
  wsA.on('message', () => {});

  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: 'room-1', sender: 'a', payload: { first: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(1);

  leaveRoom(wsB, 'room-1');
  await new Promise((resolve) => setTimeout(resolve, 20));

  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: 'room-1', sender: 'a', payload: { second: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(1);

  wsA.close();
  wsB.close();
});

test('malformed CBOR is ignored without crash', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  doHandshake(ws, 'mal');
  await waitForReady(ws);
  ws.send(Buffer.from([0xff]));
  await new Promise((resolve) => setTimeout(resolve, 30));
  ws.close();
});

test('malformed JOIN/LEAVE are dropped and logged', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  doHandshake(ws, 'mal2');
  await waitForReady(ws);
  serverLogs.length = 0;
  ws.send(cbor.encodeOne({ type: 'JOIN', room_id: 123, timestamp: Date.now() }));
  ws.send(cbor.encodeOne({ type: 'JOIN', room_id: '', timestamp: Date.now() }));
  ws.send(cbor.encodeOne({ type: 'LEAVE', timestamp: Date.now() }));
  ws.send(cbor.encodeOne({ type: 'LEAVE', room_id: '', timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(serverLogs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'MALFORMED_JOIN')).toBeTruthy();
  expect(serverLogs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'MALFORMED_LEAVE')).toBeTruthy();
  ws.close();
});

test('malformed DATA is dropped and logged', async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  doHandshake(ws, 'mal3');
  await waitForReady(ws);
  serverLogs.length = 0;
  ws.send(cbor.encodeOne({ type: 'DATA', sender: 'x', payload: { bad: true }, timestamp: Date.now() }));
  ws.send(cbor.encodeOne({ type: 'DATA', room_id: 123, sender: 'x', payload: { bad: true }, timestamp: Date.now() }));
  ws.send(cbor.encodeOne({ type: 'DATA', room_id: '', sender: 'x', payload: { bad: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(serverLogs.find((l) => l.event === 'protocol_error' && l.meta?.kind === 'MALFORMED_DATA')).toBeTruthy();
  ws.close();
});

test('space room routing uses same semantics', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);
  const spaceRoom = makeSpaceRoom('alpha', 'main');
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  doHandshake(wsA, 'spa');
  doHandshake(wsB, 'spb');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);
  joinRoom(wsA, spaceRoom);
  joinRoom(wsB, spaceRoom);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') received.push(decoded as DataMessage);
  });
  wsB.on('message', () => {});
  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: spaceRoom, sender: 'spa', payload: { hi: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(received.length).toBe(1);
  wsA.close();
  wsB.close();
});

test('group room requires membership', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);
  const groupRoom = groupToRoom('g1');
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  doHandshake(wsA, 'ga');
  doHandshake(wsB, 'gb');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);
  expect(serverLogs.some((l) => l.event === 'handshake:complete')).toBeTruthy();
  joinRoom(wsA, groupRoom);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') received.push(decoded as DataMessage);
  });
  wsB.send(cbor.encodeOne({ type: 'DATA', room_id: groupRoom, sender: 'gb', payload: { hi: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(received.length).toBe(0);
  const events = serverLogs.map((l) => l.event);
  expect(events).toContain('protocol_error');
  const protoErrs = serverLogs.filter((l) => l.event === 'protocol_error');
  expect(protoErrs.map((l) => l.meta?.kind)).toContain('UNAUTHORIZED_ROOM_SEND');
  wsA.close();
  wsB.close();
});

test('group room delivers when joined', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);
  const groupRoom = groupToRoom('g2');
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  doHandshake(wsA, 'ga2');
  doHandshake(wsB, 'gb2');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);
  joinRoom(wsA, groupRoom);
  joinRoom(wsB, groupRoom);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') received.push(decoded as DataMessage);
  });
  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: groupRoom, sender: 'ga2', payload: { hi: true }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(1);
  wsA.close();
  wsB.close();
});

test('double leave is tolerated and data after leave is dropped', async () => {
  const wsA = new WebSocket(`ws://localhost:${port}`);
  const wsB = new WebSocket(`ws://localhost:${port}`);
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  doHandshake(wsA, 'a');
  doHandshake(wsB, 'b');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);
  joinRoom(wsA, 'room-x');
  joinRoom(wsB, 'room-x');
  await new Promise((resolve) => setTimeout(resolve, 20));
  leaveRoom(wsB, 'room-x');
  leaveRoom(wsB, 'room-x');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') received.push(decoded as DataMessage);
  });
  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: 'room-x', sender: 'a', payload: { should: 'drop' }, timestamp: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(0);
  wsA.close();
  wsB.close();
});

test('device registry tracks register and disconnect', async () => {
  const audit: any[] = [];
  const srv = new MinimalServer({ port: 0, logger: () => {}, auditLogger: (e, m) => audit.push({ e, m }) });
  const addr = srv.address();
  const p = typeof addr === 'object' && addr?.port ? addr.port : 0;
  const wsA = new WebSocket(`ws://localhost:${p}`);
  const wsB = new WebSocket(`ws://localhost:${p}`);
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  wsA.send(encodeTagged({ type: 'HANDSHAKE_INIT', version: 1, client_id: 'rA', x25519_public_key: 'x', kyber_public_key: 'k', timestamp: Date.now(), nonce: 'n' }, TAG_HANDSHAKE_INIT));
  wsB.send(encodeTagged({ type: 'HANDSHAKE_INIT', version: 1, client_id: 'rB', x25519_public_key: 'x', kyber_public_key: 'k', timestamp: Date.now(), nonce: 'n' }, TAG_HANDSHAKE_INIT));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(srv.getRegistrySnapshot().length).toBe(2);
  wsA.close();
  wsB.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(srv.getRegistrySnapshot().length).toBe(0);
  expect(audit.find((a) => a.e === 'device_registered')).toBeTruthy();
  expect(audit.find((a) => a.e === 'device_disconnected')).toBeTruthy();
  await srv.close();
});

test('audit logger and moderation deny are honored', async () => {
  const audit: any[] = [];
  const srv = new MinimalServer({
    port: 0,
    logger: () => {},
    auditLogger: (e, m) => audit.push({ e, m }),
    moderationHook: () => 'deny',
  });
  const addr = srv.address();
  const p = typeof addr === 'object' && addr?.port ? addr.port : 0;
  const wsA = new WebSocket(`ws://localhost:${p}`);
  const wsB = new WebSocket(`ws://localhost:${p}`);
  await Promise.all([
    new Promise<void>((resolve) => wsA.once('open', () => resolve())),
    new Promise<void>((resolve) => wsB.once('open', () => resolve())),
  ]);
  doHandshake(wsA, 'ma');
  doHandshake(wsB, 'mb');
  await Promise.all([waitForReady(wsA), waitForReady(wsB)]);
  joinRoom(wsA, 'room-m');
  joinRoom(wsB, 'room-m');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const received: DataMessage[] = [];
  wsB.on('message', (data) => {
    const decoded = cbor.decodeFirstSync(data as Buffer) as any;
    if (!(decoded instanceof cbor.Tagged) && decoded.type === 'DATA') received.push(decoded as DataMessage);
  });
  wsA.send(cbor.encodeOne({ type: 'DATA', room_id: 'room-m', sender: 'ma', payload: { should: 'deny' }, timestamp: Date.now(), seq: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(received.length).toBe(0);
  expect(audit.find((a) => a.e === 'data_denied')).toBeTruthy();
  wsA.close();
  wsB.close();
  await srv.close();
});
