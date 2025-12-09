# Minimal FoxWhisper Server (JS)

Metadata-only reference server that performs the handshake and routes DATA messages to JOINed rooms.

## Quick start
- `npm install`
- Tests: `npm test` (defaults to `FOXW_CRYPTO_BACKEND=real`)
- Demo: `npm run demo` (also uses real crypto by default)
- Start a minimal server (tsx, dev only):
  ```bash
  FOXW_CRYPTO_BACKEND=real \
    npx tsx -e "import { MinimalServer } from './src/server.js'; new MinimalServer({ port: 3000, logger: console.info });"
  ```

## Usage
```ts
import { MinimalServer } from './src/server.js';

const server = new MinimalServer({
  port: 3000,
  serverId: 'srv-1',
  logger: (event, meta) => console.info('[server]', event, meta),
});
```

## Message flow
- Clients send `HANDSHAKE_INIT` (CBOR tag d1); server replies with `HANDSHAKE_RESPONSE` (d2) and `HANDSHAKE_COMPLETE` (d3).
- Clients must send `JOIN` before they can receive DATA for a room. Server also sends a `JOIN_ACK` with optional member list.
- DATA is only delivered to members of the target room; unauthorized sends are logged and dropped.
- LEAVE immediately removes membership; late deliveries to a departed client are dropped.

### Message shapes
- `JOIN`: `{ type: 'JOIN', room_id: string, timestamp: number }`
- `JOIN_ACK`: `{ type: 'JOIN_ACK', room_id: string, members?: string[], timestamp: number }`
- `LEAVE`: `{ type: 'LEAVE', room_id: string, timestamp: number }`
- `DATA`: `{ type: 'DATA', room_id: string, sender: string, payload: unknown, timestamp: number, seq?: number }`

## Logging
Provide `logger` in `ServerConfig` to observe activity. Events include:
- `crypto_backend` (includes `backend`, `crypto_profile`, key hints)
- `warning` (insecure mode banner)
- `connection:opened`, `connection:closed`, `session:cleanup`
- `handshake:complete`
- `device_registered`, `device_disconnected`
- `room:joined`, `room:join:dup`, `room:left`
- `data:delivered` (with count per room)
- `protocol_error` (e.g., `UNAUTHORIZED_ROOM_SEND`, `MALFORMED_*`, `message:dropped:not_handshaken`)
- Audit logger (optional): `join`, `leave`, `data`, `data_denied`

## Config
- `FOXW_CRYPTO_BACKEND=real|toy` (default is `real` in scripts/CI; set `toy` only for experiments)
- `FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND` (required when `FOXW_CRYPTO_BACKEND=toy`)

## Security caveats
⚠️ Reference/test-only. Not production-ready.
- Real crypto backend (X25519+Kyber via PQClean) is wired for conformance; toy crypto remains available for fuzzing/experiments only.
- No authentication.
- Rate limiting is minimal (max-connections env); no robust DoS protection.
- No TLS/transport security wiring in this minimal server; run behind a TLS-terminating reverse proxy (nginx/Caddy) or add TLS at runtime.

### State table (server)
| From          | Event                            | To                         |
|---------------|----------------------------------|----------------------------|
| CONNECTED     | HANDSHAKE_INIT → COMPLETE        | HANDSHAKEN                 |
| HANDSHAKEN    | JOIN(room)                       | HANDSHAKEN + member(room)  |
| HANDSHAKEN    | LEAVE(room)                      | HANDSHAKEN (room removed)  |
| any           | disconnect                       | DISCONNECTED (leave all)   |

Illegal transitions/notes:
- DATA from non-member → protocol_error `UNAUTHORIZED_ROOM_SEND` + drop.
- Malformed JOIN/LEAVE/DATA → protocol_error `MALFORMED_*` + drop.
- Disconnect removes all memberships.

### Demo
`npm run demo` (with the env var above) starts a server, two clients, JOINs a room, exchanges DATA, logs events, asserts both sides received both messages, and exits cleanly.
