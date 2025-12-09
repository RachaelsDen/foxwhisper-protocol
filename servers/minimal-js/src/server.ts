import { WebSocketServer, WebSocket } from 'ws';
import cbor from 'cbor';
import { createHash } from 'crypto';
import { decodeTagged, encodeTagged, makeHandshakeComplete, makeHandshakeResponse, TAG_HANDSHAKE_COMPLETE, TAG_HANDSHAKE_INIT, TAG_HANDSHAKE_RESPONSE } from './handshake.js';
import { createToyCryptoProvider } from './crypto/toy.js';
import { createRealCryptoProvider } from './crypto/real.js';
import { computeSharedSecret, generateX25519KeyPair } from './crypto/x25519.js';
import { KYBER_CT_B64, KYBER_PUB_B64, encapsulate } from './crypto/kyber.js';
import { isSpaceRoom } from './space.js';
import { parseGroupId } from './group.js';
import type { DataMessage, HandshakeInit, JoinMessage, ServerConfig } from './types.js';
 
 
 const CRYPTO_PROFILE = 'fw-hybrid-x25519-kyber1024';
 
 export class MinimalServer {

  private wss: WebSocketServer;
  private readonly serverId: string;
  private rooms: Map<string, Set<WebSocket>> = new Map();
  private sessions: Set<WebSocket> = new Set();
  private readonly logFn: (event: string, meta?: Record<string, unknown>) => void;
  private readonly auditFn: (event: string, meta?: Record<string, unknown>) => void;
  private connections: Map<
    WebSocket,
    { clientId: string; sessionId: string; connectionId: string; deviceId?: string; remote?: string; hybrid_shared_b64?: string }
  > = new Map();
  private groupMembers: Map<string, Set<string>> = new Map();
  private connCounter = 0;
  private readonly serverX25519PrivDer: Buffer;
  private readonly serverX25519PubB64: string;
  private readonly kyberCiphertextB64: string;
  private readonly kyberPublicB64: string;
  private moderationHook: (meta: { room_id: string; sender?: string; seq?: number; size?: number }) => 'allow' | 'deny' | 'defer';
  private authHook: (meta: { client_id: string; connection_id: string; remote?: string }) => 'allow' | 'deny' | 'unauthenticated';
  private cryptoProvider: any;

  constructor(cfg: ServerConfig) {
    const insecureAllowed = process.env.FOXW_ALLOW_INSECURE_TOY_CRYPTO === 'YES_I_UNDERSTAND';
    const backend = cfg.cryptoBackend ?? process.env.FOXW_CRYPTO_BACKEND ?? 'toy';
    if (cfg.cryptoProvider) {
      this.cryptoProvider = cfg.cryptoProvider;
    } else if (backend === 'real') {
      this.cryptoProvider = createRealCryptoProvider();
    } else {
      if (!insecureAllowed) {
        throw new Error('toy crypto mode requires FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND');
      }
      this.cryptoProvider = createToyCryptoProvider();
    }
    this.serverId = cfg.serverId ?? 'minimal-server';
    this.logFn = cfg.logger ?? (() => {});
    this.auditFn = cfg.auditLogger ?? (() => {});
    this.log('crypto_backend', {
      backend,
      crypto_profile: CRYPTO_PROFILE,
      insecure_allowed: insecureAllowed,
      x25519_pub_b64: 'MCowBQYDK2VuAyEAoNF8HngL59Fo+xvZ1cKXmVAvycQTJhUyRi5lC7VFiUk=',
      kyber_pub_b64: KYBER_PUB_B64.slice(0, 16) + '...',
      kyber_ct_b64: KYBER_CT_B64.slice(0, 16) + '...',
    });
    this.moderationHook = cfg.moderationHook ?? (() => 'allow');
    this.authHook = cfg.authHook ?? (() => 'allow');
    const defaultX25519 = {
      pub: 'MCowBQYDK2VuAyEAoNF8HngL59Fo+xvZ1cKXmVAvycQTJhUyRi5lC7VFiUk=',
      priv: 'MC4CAQAwBQYDK2VuBCIEIBj899XAYjECe9iYBUvV4KKarYeGAnR5eIF3K2Hd1ORE',
    };
    this.serverX25519PubB64 = defaultX25519.pub;
    this.serverX25519PrivDer = Buffer.from(defaultX25519.priv, 'base64');
    this.kyberCiphertextB64 = KYBER_CT_B64;
    this.kyberPublicB64 = KYBER_PUB_B64;
    if (!cfg.cryptoProvider && backend === 'toy') {
      this.logFn('warning', {
        message: '⚠️ FOXW INSECURE MODE ENABLED (TOY CRYPTO / PLAINTEXT). DO NOT USE IN PRODUCTION.',
      });
    }
    this.wss = new WebSocketServer({ port: cfg.port });
    this.wss.on('connection', (socket, req) => this.handleConnection(socket, req));
  }

  address() {
    return this.wss.address();
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.clients.forEach((c) => c.close());
      this.wss.close(() => resolve());
    });
  }

  private handleConnection(socket: WebSocket, req: any) {
    const maxConns = parseInt(process.env.FOXW_MAX_CONNECTIONS ?? '0', 10);
    const current = this.connections.size;
    const remote = req?.socket?.remoteAddress as string | undefined;
    if (maxConns > 0 && current >= maxConns) {
      this.log('RATE_LIMIT_CONNECTION_REJECTED', { max: maxConns, current, remote });
      socket.close();
      return;
    }
    const connectionId = `conn-${++this.connCounter}`;
    this.connections.set(socket, { clientId: '', sessionId: '', connectionId, remote });
    this.log('connection:opened', { connection_id: connectionId, remote });
    socket.on('message', (data) => this.handleMessage(socket, data as Buffer));
    socket.on('close', () => {
      const meta = this.connections.get(socket);
      this.log('connection:closed', { connection_id: connectionId, client_id: meta?.clientId, session_id: meta?.sessionId });
      this.cleanup(socket);
    });
  }

  private cleanup(socket: WebSocket) {
    const meta = this.connections.get(socket);
    this.sessions.delete(socket);
    this.connections.delete(socket);
    for (const [roomId, members] of this.rooms) {
      members.delete(socket);
      if (members.size === 0) {
        this.rooms.delete(roomId);
      }
    }
    if (meta?.clientId) {
      for (const [groupId, members] of this.groupMembers) {
        members.delete(meta.clientId);
        if (members.size === 0) {
          this.groupMembers.delete(groupId);
        }
      }
    }
    this.log('session:cleanup');
    if (meta?.clientId && meta?.sessionId) {
      this.audit('device_disconnected', { client_id: meta.clientId, session_id: meta.sessionId, connection_id: meta.connectionId });
    }
  }

  private joinRoom(socket: WebSocket, roomId: string) {
    if (!roomId) return;
    const members = this.rooms.get(roomId) ?? new Set<WebSocket>();
    const already = members.has(socket);
    members.add(socket);
    this.rooms.set(roomId, members);
    const meta = this.connections.get(socket);
    this.log(already ? 'room:join:dup' : 'room:joined', {
      room_id: roomId,
      members: members.size,
      client_id: meta?.clientId,
      session_id: meta?.sessionId,
    });
    const groupId = parseGroupId(roomId);
    if (groupId && meta?.clientId) {
      const gset = this.groupMembers.get(groupId) ?? new Set<string>();
      gset.add(meta.clientId);
      this.groupMembers.set(groupId, gset);
    }
    this.audit('join', { room_id: roomId, client_id: meta?.clientId, session_id: meta?.sessionId, ts: Date.now() });
    const memberIds = Array.from(members)
      .map((ws) => this.connections.get(ws)?.clientId)
      .filter((x): x is string => !!x);
    const ack = { type: 'JOIN_ACK', room_id: roomId, members: memberIds, timestamp: Date.now() } as const;
    socket.send(cbor.encodeOne(ack));
  }


  private leaveRoom(socket: WebSocket, roomId: string) {
    const members = this.rooms.get(roomId);
    if (!members) return;
    members.delete(socket);
    if (members.size === 0) {
      this.rooms.delete(roomId);
    }
    const meta = this.connections.get(socket);
    const groupId = parseGroupId(roomId);
    if (groupId && meta?.clientId) {
      const gset = this.groupMembers.get(groupId);
      gset?.delete(meta.clientId);
      if (gset && gset.size === 0) {
        this.groupMembers.delete(groupId);
      }
    }
    this.log('room:left', {
      room_id: roomId,
      members: members?.size ?? 0,
      client_id: meta?.clientId,
      session_id: meta?.sessionId,
    });
    this.audit('leave', { room_id: roomId, client_id: meta?.clientId, session_id: meta?.sessionId, ts: Date.now() });
  }

  getRegistrySnapshot() {
    return Array.from(this.connections.values()).map((v) => ({ ...v }));
  }

  private log(event: string, meta?: Record<string, unknown>) {
    this.logFn(event, meta);
  }

  private audit(event: string, meta?: Record<string, unknown>) {
    this.auditFn(event, meta);
  }

  private handleMessage(socket: WebSocket, data: Buffer) {
    let tag: number | null = null;
    let value: any;
    try {
      const decoded = decodeTagged(data);
      tag = decoded.tag;
      value = decoded.value;
    } catch (err) {
      this.log('protocol_error', { kind: 'MALFORMED_CBOR', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (tag === TAG_HANDSHAKE_INIT) {
      const init = value as HandshakeInit;
      const existing = this.connections.get(socket);
      const connectionId = existing?.connectionId ?? `conn-${this.connCounter}`;
      const authDecision = this.authHook({ client_id: init.client_id, connection_id: connectionId, remote: existing?.remote });
      if (authDecision !== 'allow') {
        this.log('auth:denied', { client_id: init.client_id, connection_id: connectionId, decision: authDecision });
        socket.close();
        return;
      }
      let kyberCiphertext = this.kyberCiphertextB64;
      let kyberShared: string | undefined;
      if (init.kyber_public_key) {
        try {
          const { ciphertextB64, sharedSecretB64 } = encapsulate(init.kyber_public_key);
          kyberCiphertext = ciphertextB64;
          kyberShared = sharedSecretB64;
        } catch (err) {
          this.log('handshake:kyber_encapsulate_error', {
            client_id: init.client_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        this.log('handshake:kyber_missing_pub', { client_id: init.client_id });
      }
      let x25519Shared: Buffer | undefined;
      try {
        x25519Shared = computeSharedSecret(this.serverX25519PrivDer, init.x25519_public_key);
      } catch (err) {
        this.log('handshake:x25519_error', { client_id: init.client_id, error: err instanceof Error ? err.message : String(err) });
      }
      const resp = makeHandshakeResponse(init, this.serverId, this.serverX25519PubB64, kyberCiphertext);
      const complete = makeHandshakeComplete(resp);
      socket.send(encodeTagged(resp, TAG_HANDSHAKE_RESPONSE));
      socket.send(encodeTagged(complete, TAG_HANDSHAKE_COMPLETE));
      this.sessions.add(socket);
      const hybridShared = x25519Shared && kyberShared ? Buffer.concat([x25519Shared, Buffer.from(kyberShared, 'base64')]).toString('base64') : undefined;
      this.connections.set(socket, {
        clientId: init.client_id,
        sessionId: complete.session_id,
        connectionId,
        remote: existing?.remote,
        hybrid_shared_b64: hybridShared,
      });
      this.log('handshake:complete', {
        client_id: init.client_id,
        session_id: complete.session_id,
        connection_id: connectionId,
        crypto_profile: CRYPTO_PROFILE,
        hybrid_shared_digest: hybridShared ? createHash('sha256').update(Buffer.from(hybridShared, 'base64')).digest('base64') : undefined,
      });
      this.audit('device_registered', { client_id: init.client_id, session_id: complete.session_id, connection_id: connectionId });
      return;
    }

    if (!this.sessions.has(socket)) {
      this.log('message:dropped:not_handshaken');
      return;
    }

    if (tag === null && value && value.type === 'JOIN') {
      const { room_id } = value as JoinMessage;
      if (!room_id || typeof room_id !== 'string' || room_id.length === 0) {
        this.log('protocol_error', { kind: 'MALFORMED_JOIN', room_id });
        return;
      }
      this.joinRoom(socket, room_id);
      return;
    }

    if (tag === null && value && value.type === 'LEAVE') {
      const { room_id } = value as JoinMessage;
      if (!room_id || typeof room_id !== 'string' || room_id.length === 0) {
        this.log('protocol_error', { kind: 'MALFORMED_LEAVE', room_id });
        return;
      }
      this.leaveRoom(socket, room_id);
      return;
    }

    if (tag === null && value && value.type === 'DATA') {
      const msg = value as DataMessage;
      if (!msg.room_id || typeof msg.room_id !== 'string' || msg.room_id.length === 0) {
        this.log('protocol_error', { kind: 'MALFORMED_DATA', room_id: msg.room_id });
        return;
      }
      const members = this.rooms.get(msg.room_id);
      const meta = this.connections.get(socket);
      const groupId = parseGroupId(msg.room_id);
      if (groupId && meta?.clientId) {
        const gset = this.groupMembers.get(groupId);
        if (!gset || !gset.has(meta.clientId)) {
          this.log('protocol_error', { kind: 'UNAUTHORIZED_ROOM_SEND', room_id: msg.room_id, sender: meta.clientId });
          return;
        }
      }
      if (!members || !members.has(socket)) {
        this.log('protocol_error', { kind: 'UNAUTHORIZED_ROOM_SEND', room_id: msg.room_id, sender: meta?.clientId });
        return;
      }
      const encoded = cbor.encodeOne(msg);
      const size = encoded.length;
      const decision = this.moderationHook({ room_id: msg.room_id, sender: meta?.clientId, seq: (msg as any).seq, size });
      if (decision === 'deny' || decision === 'defer') {
        this.audit('data_denied', { room_id: msg.room_id, sender: meta?.clientId, seq: (msg as any).seq, decision });
        return;
      }
      let delivered = 0;
      for (const member of members) {
        if (member.readyState === WebSocket.OPEN) {
          member.send(encoded);
          delivered += 1;
        }
      }
      this.log('data:delivered', { room_id: msg.room_id, delivered, sender: meta?.clientId });
      this.audit('data', { room_id: msg.room_id, sender: meta?.clientId, seq: (msg as any).seq, size, delivered, ts: Date.now() });
      return;
    }
  }
}
