import cbor from 'cbor';
import { EventEmitter } from 'events';
import { createHandshakeInit, decodeIncoming, deriveHandshakeComplete, encodeHandshakeInit, encodeHandshakeComplete, isHandshakeResponse, isHandshakeComplete } from './handshake.js';
import { createWebSocket } from './transport.js';
import { DeviceRecordStore } from './device_record.js';
import type {
  ClientConfig,
  ClientState,
  DataMessage,
  IncomingMessage,
  OutgoingMessage,
  WebSocketLike,
} from './types.js';

const READY_STATES = {
  OPEN: 1,
};

export class FoxClient extends EventEmitter {
  private ws: WebSocketLike | null = null;
  private state: ClientState = 'disconnected';
  private readonly cfg: ClientConfig;
  private readonly dr: DeviceRecordStore;

  constructor(cfg: ClientConfig) {
    super();
    this.cfg = cfg;
    this.dr = new DeviceRecordStore(cfg.deviceId);
  }

  getState(): ClientState {
    return this.state;
  }

  getDeviceRecord() {
    return this.dr.get();
  }

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') return;
    this.state = 'handshaking';
    const factory = this.cfg.wsFactory ?? createWebSocket;
    this.ws = factory(this.cfg.serverUrl);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('websocket not created'));

      this.ws.onopen = () => {
        try {
          const init = createHandshakeInit({
            clientId: this.cfg.clientId,
            x25519PublicKey: this.cfg.x25519PublicKey,
            kyberPublicKey: this.cfg.kyberPublicKey,
          });
          this.sendRaw(encodeHandshakeInit(init));
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onmessage = (ev) => {
        try {
          const decoded = decodeIncoming(Buffer.from(ev.data));
          const message = (decoded instanceof cbor.Tagged ? decoded.value : decoded) as IncomingMessage;
          if (isHandshakeResponse(message)) {
            const complete = deriveHandshakeComplete(message);
            this.sendRaw(encodeHandshakeComplete(complete));
          } else if (isHandshakeComplete(message)) {
            this.state = 'ready';
            this.emit('ready');
            resolve();
          } else if ((message as any).type === 'DATA') {
            this.emit('message', message as DataMessage);
          }
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onclose = () => {
        this.state = 'disconnected';
      };
    });
  }

  async join(roomId: string): Promise<void> {
    if (this.state !== 'ready') throw new Error('client not ready');
    // For minimal client, join is implicit after handshake; no extra action required.
    this.emit('joined', roomId);
  }

  async sendData(roomId: string, payload: unknown): Promise<void> {
    if (this.state !== 'ready') throw new Error('client not ready');
    const msg: DataMessage = {
      type: 'DATA',
      room_id: roomId,
      sender: this.cfg.clientId,
      payload,
      timestamp: Date.now(),
    };
    this.sendRaw(cbor.encodeOne(msg));
  }

  close(): void {
    if (this.ws && this.ws.readyState === READY_STATES.OPEN) {
      this.ws.close();
    }
    this.state = 'disconnected';
  }

  private sendRaw(buf: Buffer) {
    if (!this.ws) throw new Error('websocket not connected');
    this.ws.send(buf);
  }
}
