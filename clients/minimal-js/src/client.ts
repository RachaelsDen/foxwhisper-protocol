import cbor from 'cbor';
import { EventEmitter } from 'events';
import {
  createHandshakeInit,
  decodeIncoming,
  deriveHandshakeComplete,
  encodeHandshakeInit,
  encodeHandshakeComplete,
  isHandshakeResponse,
  isHandshakeComplete,
} from './handshake.js';
import type { HandshakeComplete } from './types.js';
import { createWebSocket } from './transport.js';
import { DeviceRecordStore } from './device_record.js';
import { ConnectionError, ProtocolError, StateError } from './errors.js';
import { buildAssociatedData, buildDeterministicNonce, createToyCryptoProvider } from './crypto/toy.js';
import { computeSharedSecret } from './crypto/x25519.js';
import { decapsulate as kyberDecap, KYBER_CT_B64, KYBER_PRIV_B64, KYBER_PUB_B64 } from './crypto/kyber.js';
import { createRealCryptoProvider } from './crypto/real.js';
import type {
  ClientConfig,
  ClientErrorEvent,
  ClientState,
  CiphertextPacket,
  CryptoProvider,
  DataMessage,
  IncomingMessage,
  JoinAckMessage,
  JoinMessage,
  PlaintextPacket,
  ProtocolErrorKind,
  SessionKeys,
  WebSocketLike,
} from './types.js';

const READY_STATES = {
  OPEN: 1,
};

const CRYPTO_PROFILE = 'fw-hybrid-x25519-kyber1024';

export class FoxClient extends EventEmitter {
  private ws: WebSocketLike | null = null;
  private state: ClientState = 'disconnected';
  private readonly cfg: ClientConfig;
  private readonly dr: DeviceRecordStore;
  private readonly logFn: (event: string, meta?: Record<string, unknown>) => void;
  private cryptoProvider: CryptoProvider | null;
  private sessionKeys: SessionKeys | null = null;
  private joinedRooms: Set<string> = new Set();
  private joinSeq = 0;
  private dataSeq = 0;
  private x25519PrivateDer: Buffer;
  private x25519PublicB64: string;
  private kyberPrivateB64: string;
  private kyberPublicB64: string;
  private cryptoBackendChosen: 'toy' | 'real' | null = null;
  private lastHandshakeComplete: HandshakeComplete | null = null;

  constructor(cfg: ClientConfig) {
    super();
    this.cfg = cfg;
    const userId = cfg.userId ?? cfg.clientId;
    this.dr = new DeviceRecordStore(userId, cfg.deviceId);
    this.logFn = cfg.logger ?? (() => {});
    this.cryptoProvider = cfg.crypto ?? null;
    this.sessionKeys = null;

    const defaultX25519 = {
      pub: 'MCowBQYDK2VuAyEA2vjRv2ycBboYSFCJfBR6rfYNLNA3VJdYPlX60fnen0o=',
      priv: 'MC4CAQAwBQYDK2VuBCIEIHgRGlElC/402YfJbZRe82JM39lm41C7LyuHTu/PB+hU',
    };
    const providedPair = cfg.x25519KeyPair;
    this.x25519PublicB64 = providedPair?.publicKeyDerB64 ?? defaultX25519.pub;
    this.x25519PrivateDer = Buffer.from(providedPair?.privateKeyDerB64 ?? defaultX25519.priv, 'base64');

    this.kyberPrivateB64 = KYBER_PRIV_B64;
    this.kyberPublicB64 = KYBER_PUB_B64;
  }

  getState(): ClientState {
    return this.state;
  }

  getSessionInfo() {
    return {
      sessionId: this.lastHandshakeComplete?.session_id ?? null,
      handshakeHash: this.lastHandshakeComplete?.handshake_hash ?? null,
      cryptoBackend: this.cryptoBackendChosen,
      cryptoProfile: CRYPTO_PROFILE,
    };
  }

  getSessionKeys(): SessionKeys | null {
    return this.sessionKeys;
  }

  getDeviceRecord() {
    return this.dr.get();
  }

  private transition(next: ClientState, allowedFrom: ClientState[]) {
    if (!allowedFrom.includes(this.state)) {
      throw new StateError(`Invalid state transition from ${this.state} to ${next}`);
    }
    this.state = next;
  }

  private emitError(err: Error) {
    const meta = err instanceof ProtocolError ? err.meta : undefined;
    const kind = (meta as any)?.kind as ProtocolErrorKind | undefined;
    this.log('error', { name: err.name, message: err.message, ...meta });
    if (this.listenerCount('error') === 0) {
      return;
    }
    const evt: ClientErrorEvent = {
      kind: kind ?? 'UNKNOWN_MSG_TYPE',
      message: err.message,
      details: meta,
    };
    this.emit('error', evt);
  }

  private logProtocolError(kind: ProtocolErrorKind, meta?: Record<string, unknown>) {
    this.log('protocol_error', { kind, ...meta });
    const err = new ProtocolError(kind.toLowerCase(), { kind, ...meta });
    if (this.listenerCount('error') > 0) {
      this.emit('error', { kind, message: err.message, details: meta } satisfies ClientErrorEvent);
    }
  }

  async connect(): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'closed') {
      throw new StateError('client already connecting or connected');
    }
    const insecureAllowed =
      this.cfg.insecureCrypto === true || process.env.FOXW_ALLOW_INSECURE_TOY_CRYPTO === 'YES_I_UNDERSTAND';
    if (!this.cryptoProvider) {
      const backend = (this.cfg.cryptoBackend ?? process.env.FOXW_CRYPTO_BACKEND ?? (insecureAllowed ? 'toy' : 'real')) as
        | 'toy'
        | 'real';
      if (backend === 'real') {
        this.cryptoProvider = createRealCryptoProvider(this.cfg.realCryptoConfig ?? {});
      } else {
        if (!insecureAllowed) {
          throw new Error('toy crypto mode requires FOXW_ALLOW_INSECURE_TOY_CRYPTO=YES_I_UNDERSTAND');
        }
        this.cryptoProvider = createToyCryptoProvider();
      }
      this.cryptoBackendChosen = backend;
      this.log('crypto_backend', {
        backend,
        crypto_profile: CRYPTO_PROFILE,
        insecure_allowed: insecureAllowed,
        x25519_pub_b64: this.x25519PublicB64.slice(0, 16) + '...',
        kyber_pub_b64: this.kyberPublicB64.slice(0, 16) + '...',
      });
    }
    this.transition('connecting', ['disconnected', 'closed']);
    const factory = this.cfg.wsFactory ?? createWebSocket;
    this.ws = factory(this.cfg.serverUrl);
    this.log('connect:start', { url: this.cfg.serverUrl });

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new ConnectionError('websocket not created'));

      this.ws.onopen = () => {
        try {
          this.transition('handshaking', ['connecting']);
          const init = createHandshakeInit({
            clientId: this.cfg.clientId,
            x25519PublicKey: this.x25519PublicB64,
            kyberPublicKey: this.cfg.kyberPublicKey ?? this.kyberPublicB64,
          });
          this.log('handshake:init:send', { client_id: this.cfg.clientId });
          this.sendRaw(encodeHandshakeInit(init));
        } catch (err) {
          const wrapped = err instanceof Error ? err : new ConnectionError(String(err));
          this.emitError(wrapped);
          reject(wrapped);
        }
      };

      this.ws.onmessage = (ev) => {
        try {
          if (this.state === 'closing' || this.state === 'closed' || this.state === 'disconnected') {
            this.logProtocolError('LATE_DATA_AFTER_DISCONNECT');
            return;
          }
          let decoded: any;
          try {
            decoded = decodeIncoming(Buffer.from(ev.data));
          } catch (err) {
            throw new ProtocolError('decode failed', { kind: 'DECODE_FAILED', error: err instanceof Error ? err.message : String(err) });
          }
          const message = (decoded instanceof cbor.Tagged ? decoded.value : decoded) as IncomingMessage;
          if (isHandshakeResponse(message)) {
            this.log('handshake:response:recv', { server_id: message.server_id });
            const complete = deriveHandshakeComplete(message);
            const parts: Buffer[] = [];
            try {
              const shared = computeSharedSecret(this.x25519PrivateDer, message.x25519_public_key);
              parts.push(shared);
            } catch (err) {
              this.log('handshake:shared_secret_error', { error: err instanceof Error ? err.message : String(err) });
            }
            try {
              const kyberCt = message.kyber_ciphertext ?? KYBER_CT_B64;
              const kyberSsB64 = kyberDecap(kyberCt, this.kyberPrivateB64);
              parts.push(Buffer.from(kyberSsB64, 'base64'));
            } catch (err) {
              this.log('handshake:kyber_decapsulate_error', { error: err instanceof Error ? err.message : String(err) });
            }
            if (parts.length) {
              (complete as any).shared_secret = Buffer.concat(parts).toString('base64');
            }
            this.lastHandshakeComplete = { ...complete } satisfies HandshakeComplete;
            delete (this.lastHandshakeComplete as any).shared_secret;
            this.sessionKeys = (this.cryptoProvider as CryptoProvider).keyAgreement.deriveSessionKeys(complete);
            this.sendRaw(encodeHandshakeComplete(complete));
            this.log('handshake:complete:send', { session_id: complete.session_id });
          } else if (isHandshakeComplete(message)) {
            if (this.state !== 'ready') {
              this.transition('ready', ['handshaking']);
              this.emit('ready');
            } else {
              this.log('handshake:complete:dup', { session_id: message.session_id });
            }
            this.log('handshake:complete:recv', { session_id: message.session_id });
            resolve();
          } else if ((message as any).type === 'DATA') {
            const dataMsg = message as DataMessage;
            const emitted = this.handleDataMessage(dataMsg);
            if (emitted) {
              this.emit('message', emitted);
            }
          } else if ((message as any).type === 'JOIN') {
            this.log('join:recv', { room_id: (message as any).room_id });
          } else if ((message as any).type === 'JOIN_ACK') {
            const ack = message as JoinAckMessage;
            if (!this.joinedRooms.has(ack.room_id)) {
              this.logProtocolError('UNEXPECTED_JOIN_ACK', { room_id: ack.room_id });
            }
            this.log('join:ack', { room_id: ack.room_id, members: ack.members?.length });
          } else {
            throw new ProtocolError('unknown message type', { kind: 'UNKNOWN_MSG_TYPE' });
          }
        } catch (err) {
          const wrapped = err instanceof ProtocolError ? err : new ProtocolError((err as Error).message);
          this.emitError(wrapped);
          if (this.state !== 'ready') {
            reject(wrapped);
          }
        }
      };

      this.ws.onerror = (err) => {
        const wrapped = new ConnectionError('ws error', { error: err instanceof Error ? err.message : String(err) });
        this.emitError(wrapped);
        reject(wrapped);
      };

      this.ws.onclose = (ev) => {
        this.state = 'closed';
        const code = (ev as any)?.code;
        const reason = (ev as any)?.reason;
        const wasClean = (ev as any)?.wasClean;
        this.log('ws:closed', { code, reason: reason ? String(reason) : undefined, was_clean: wasClean });
      };
    });
  }

  async join(roomId: string): Promise<void> {
    if (this.state !== 'ready') throw new StateError('client not ready');
    if (this.joinedRooms.has(roomId)) {
      this.log('join:dup', { room_id: roomId });
      return;
    }
    const seq = ++this.joinSeq;
    const joinMsg: JoinMessage = { type: 'JOIN', room_id: roomId, timestamp: Date.now(), seq };
    this.sendRaw(cbor.encodeOne(joinMsg));
    this.joinedRooms.add(roomId);
    this.log('join:send', { room_id: roomId, seq });
    this.emit('joined', roomId);
  }

  async leave(roomId: string): Promise<void> {
    if (this.state !== 'ready') throw new StateError('client not ready');
    if (!this.joinedRooms.has(roomId)) {
      this.log('leave:skip', { room_id: roomId });
      return;
    }
    const leaveMsg = { type: 'LEAVE', room_id: roomId, timestamp: Date.now() };
    this.sendRaw(cbor.encodeOne(leaveMsg));
    this.joinedRooms.delete(roomId);
    this.log('leave:send', { room_id: roomId });
    this.emit('left', roomId);
  }

  async sendData(roomId: string, payload: unknown): Promise<void> {
    if (this.state !== 'ready') throw new StateError('client not ready');
    if (!this.joinedRooms.has(roomId)) {
      throw new StateError('room not joined');
    }
    if (!this.sessionKeys) {
      throw new StateError('session not established');
    }
    const seq = ++this.dataSeq;
    const packet: PlaintextPacket = {
      room_id: roomId,
      sender: this.cfg.clientId,
      payload,
      seq,
    };
    const ad = buildAssociatedData({ room_id: roomId, sender: this.cfg.clientId, seq });
    const nonce = buildDeterministicNonce({ room_id: roomId, sender: this.cfg.clientId, seq });
    const perMessageKeys: SessionKeys = { ...this.sessionKeys, nonce };
    const encodedPayload = cbor.encodeOne(packet.payload ?? null);
    const cipher = (this.cryptoProvider as CryptoProvider).aead.encrypt(encodedPayload, ad, perMessageKeys);
    const msg: DataMessage = {
      type: 'DATA',
      room_id: roomId,
      sender: this.cfg.clientId,
      payload: {
        ciphertext: Buffer.from(cipher).toString('base64'),
        ad: {},
        seq,
      },
      timestamp: Date.now(),
      seq,
    };
    this.log('data:send', { room_id: roomId, seq });
    this.sendRaw(cbor.encodeOne(msg));
  }

  close(): void {
    if (this.ws && this.ws.readyState === READY_STATES.OPEN) {
      this.state = 'closing';
      this.ws.close(1000, 'client_shutdown');
    }
    this.state = 'closed';
    this.log('closed', { reason: 'client_shutdown' });
  }

  private handleDataMessage(msg: DataMessage): DataMessage | null {
    if (!this.joinedRooms.has(msg.room_id)) {
      this.logProtocolError('DATA_FOR_UNJOINED_ROOM', { room_id: msg.room_id, sender: msg.sender });
      return null;
    }
    const payload = msg.payload as any;
    if (this.isCiphertextPayload(payload)) {
      if (!this.sessionKeys || !this.cryptoProvider) {
        this.emitError(new StateError('no session keys for ciphertext'));
        return null;
      }
      try {
        const ad = buildAssociatedData({ room_id: msg.room_id, sender: msg.sender, seq: msg.seq ?? 0 });
        const nonce = buildDeterministicNonce({ room_id: msg.room_id, sender: msg.sender, seq: msg.seq ?? 0 });
        const cipherBytes = Buffer.from((payload as CiphertextPacket).ciphertext, 'base64');
        const ptBytes = this.cryptoProvider.aead.decrypt(cipherBytes, ad, { ...this.sessionKeys, nonce });
        const decodedPayload = cbor.decodeFirstSync(ptBytes);
        const normalized: DataMessage = {
          ...msg,
          payload: decodedPayload,
          seq: msg.seq,
        };
        this.log('data:recv', { room_id: normalized.room_id, sender: normalized.sender, seq: normalized.seq });
        return normalized;
      } catch (err) {
        this.emitError(new ProtocolError('decrypt failed', { error: err instanceof Error ? err.message : String(err) }));
        return null;
      }
    }
    this.log('data:recv', { room_id: msg.room_id, sender: msg.sender, seq: msg.seq });
    return msg;
  }

  private isCiphertextPayload(payload: unknown): payload is CiphertextPacket {
    return !!(payload && typeof payload === 'object' && 'ciphertext' in (payload as any));
  }

  private log(event: string, meta?: Record<string, unknown>) {
    this.logFn(event, meta);
  }

  private sendRaw(buf: Buffer) {
    if (!this.ws) throw new ConnectionError('websocket not connected');
    this.ws.send(buf);
  }
}
