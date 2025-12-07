export type HandshakeInit = {
  type: 'HANDSHAKE_INIT';
  version: number;
  client_id: string;
  x25519_public_key: string;
  kyber_public_key: string;
  timestamp: number;
  nonce: string;
};

export type HandshakeResponse = {
  type: 'HANDSHAKE_RESPONSE';
  version: number;
  server_id: string;
  x25519_public_key: string;
  kyber_ciphertext: string;
  timestamp: number;
  nonce: string;
};

export type HandshakeComplete = {
  type: 'HANDSHAKE_COMPLETE';
  version: number;
  session_id: string;
  handshake_hash: string;
  timestamp: number;
};

export type DataMessage = {
  type: 'DATA';
  room_id: string;
  sender: string;
  payload: unknown;
  timestamp: number;
};

export type IncomingMessage = HandshakeResponse | HandshakeComplete | DataMessage;

export type OutgoingMessage = HandshakeInit | DataMessage;

export type ClientState = 'disconnected' | 'handshaking' | 'ready';

export interface DeviceRecord {
  device_id: string;
  dr_version: number;
  last_updated: number;
}

export interface ClientConfig {
  serverUrl: string;
  clientId: string;
  deviceId: string;
  x25519PublicKey: string;
  kyberPublicKey: string;
  token?: string;
  wsFactory?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  readyState: number;
  onopen: null | (() => void);
  onmessage: null | ((ev: { data: any }) => void);
  onclose: null | (() => void);
  onerror: null | ((err: any) => void);
  send(data: any): void;
  close(): void;
}
