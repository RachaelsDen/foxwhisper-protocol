# Minimal FoxWhisper Client (JS)

Minimal metadata-only client for handshake + roomed DATA messages. JOIN is required before a room delivers DATA.

## Quick start
- `npm install`
- `npm test` (defaults to `FOXW_CRYPTO_BACKEND=real`; toy mode requires explicit opt-in)

## Happy-path sequence
CONNECT → HANDSHAKE_INIT/RESP/COMPLETE → JOIN(room) → JOIN_ACK(room) → DATA(room)

## Usage
```ts
import { FoxClient } from './src/client.js';

const client = new FoxClient({
  serverUrl: 'ws://localhost:3000',
  clientId: 'client-1',
  deviceId: 'device-1',
  // By default the harness uses a built-in X25519+Kyber keypair and real crypto.
  // To force toy crypto for experiments, set:
  //   FOXW_CRYPTO_BACKEND=toy FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND
  logger: (event, meta) => console.info('[client]', event, meta),
});

await client.connect();
await client.join('room-1');
client.on('message', (msg) => console.log('DATA', msg));
await client.sendData('room-1', { hello: 'room' });
await client.leave('room-1');
```

## Logging
Provide `logger` in `ClientConfig` to inspect behavior. Events emitted include:
- `crypto_backend` (includes `backend`, `crypto_profile`, key hints)
- `connect:start`, `ws:error`, `ws:closed`
- `handshake:init:send`, `handshake:response:recv`, `handshake:complete:send`, `handshake:complete:recv`
- `join:send`, `join:ack`, `leave:send`
- `data:send`, `data:recv`
- `protocol_error` (e.g., `DATA_FOR_UNJOINED_ROOM`, `UNEXPECTED_JOIN_ACK`)

## Error handling
Subscribe to `client.on('error', (evt) => ...)` to inspect structured errors:

| kind | When it happens |
| --- | --- |
| `DECODE_FAILED` | Invalid/truncated CBOR frame |
| `MALFORMED_JOIN` / `MALFORMED_DATA` | Bad/empty room_id in JOIN/DATA |
| `UNAUTHORIZED_ROOM_SEND` | DATA sent to room/group without JOIN |
| `UNEXPECTED_JOIN_ACK` | JOIN_ACK for a room not joined |
| `UNKNOWN_MSG_TYPE` | Message type not recognized |


## Message shapes
- `JOIN`: `{ type: 'JOIN', room_id: string, timestamp: number, seq?: number }`
- `JOIN_ACK`: `{ type: 'JOIN_ACK', room_id: string, members?: string[], timestamp: number }`
- `LEAVE`: `{ type: 'LEAVE', room_id: string, timestamp: number }`
- `DATA`: `{ type: 'DATA', room_id: string, sender: string, payload: unknown, timestamp: number, seq?: number }`

## State notes
- DATA is dropped locally if the room is not joined; logged as `protocol_error`.
- After `leave()` or disconnect, DATA sends reject with `StateError`.
- JOIN is idempotent; unexpected JOIN_ACK is ignored and logged.

### State table (client)
| From          | Event                     | To             |
|---------------|---------------------------|----------------|
| DISCONNECTED  | connect()                 | CONNECTING     |
| CONNECTING    | handshake_ok              | READY          |
| READY         | join(room)                | READY + joined(room) |
| READY         | leave(room)               | READY (room removed) |
| any           | disconnect/error          | CLOSED         |

Illegal transitions/notes:
- DATA before JOIN(room) → protocol_error + drop.
- DATA after leave/disconnect → StateError (send) or protocol_error (recv late).
- Disconnect is treated as leave-all.

⚠️ The minimal client is a Node-only test harness. By default it uses the **real** crypto backend (X25519+Kyber via PQClean) for conformance. Toy crypto is available for experiments only and requires:
- `FOXW_CRYPTO_BACKEND=toy`
- `FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND`

DO NOT USE THIS HARNESS OR TOY CRYPTO IN PRODUCTION.
