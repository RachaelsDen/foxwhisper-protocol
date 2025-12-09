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
  // Local-only, not transmitted: base64 of the shared secret (X25519 or hybrid) for key derivation.
  shared_secret?: string;
};

export type DataMessage = {
  type: 'DATA';
  room_id: string;
  sender: string;
  payload: unknown;
  timestamp: number;
  seq?: number;
};

export type JoinMessage = {
  type: 'JOIN';
  room_id: string;
  timestamp: number;
  seq?: number;
};

export type LeaveMessage = {
  type: 'LEAVE';
  room_id: string;
  timestamp: number;
};

export type JoinAckMessage = {
  type: 'JOIN_ACK';
  room_id: string;
  members?: string[];
  timestamp: number;
};

export type CiphertextPacket = {
  ciphertext: string;
  seq: number;
  ad?: unknown;
};

export type PlaintextPacket = {
  room_id: string;
  sender: string;
  payload: unknown;
  seq: number;
};

export type SessionKeys = {
  encKey: string;
  authKey: string;
  nonce: string;
};

export interface KeyAgreement {
  deriveSessionKeys(handshake: HandshakeComplete): SessionKeys;
}

export interface Aead {
  encrypt(plaintext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array;
  decrypt(ciphertext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array;
}

export interface CryptoProvider {
  keyAgreement: KeyAgreement;
  aead: Aead;
}

export interface RealCryptoPrimitives {
  x25519KeyGen(): { publicKey: Uint8Array; privateKey: Uint8Array };
  x25519Ecdh(ourPrivate: Uint8Array, theirPublic: Uint8Array): Uint8Array;
  kdf(sharedSecret: Uint8Array, context: Uint8Array): SessionKeys;
  aeadEncrypt(plaintext: Uint8Array, ad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  aeadDecrypt(ciphertext: Uint8Array, ad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
}

export interface RealCryptoConfig {
  primitives?: RealCryptoPrimitives;
}

export type ProtocolErrorKind =
  | 'DATA_FOR_UNJOINED_ROOM'
  | 'UNAUTHORIZED_ROOM_SEND'
  | 'UNEXPECTED_JOIN_ACK'
  | 'LATE_DATA_AFTER_DISCONNECT'
  | 'MALFORMED_JOIN'
  | 'MALFORMED_LEAVE'
  | 'MALFORMED_DATA'
  | 'MALFORMED_CBOR'
  | 'DECODE_FAILED'
  | 'UNKNOWN_MSG_TYPE';

export type ClientErrorEvent = {
  kind: ProtocolErrorKind;
  message?: string;
  details?: unknown;
};

export type IncomingMessage = HandshakeResponse | HandshakeComplete | DataMessage | JoinAckMessage;

export type OutgoingMessage = HandshakeInit | DataMessage | JoinMessage | LeaveMessage;


export type ClientState = 'disconnected' | 'connecting' | 'handshaking' | 'ready' | 'closing' | 'closed';

export type DeviceRecordBackup = {
  type: 'DEVICE_RECORD_BACKUP';
  version: number;
  user_id: string;
  device_id: string;
  device_private_key: string;
  device_public_key: string;
  device_info: {
    device_type: string;
    platform: string;
    version: string;
    created_at: number;
  };
  timestamp: number;
};

export type DeviceRecordRestoreRequest = {
  type: 'DEVICE_RECORD_RESTORE';
  version: number;
  user_id: string;
  device_id: string;
  restore_timestamp: number;
  verification_code: string;
};

export type DeviceRecordResetRequest = {
  type: 'DEVICE_RECORD_RESET';
  version: number;
  user_id: string;
  device_id: string;
  reset_reason: string;
  reset_timestamp: number;
  verification_code: string;
};

export type DeviceRecordStatus = 'active' | 'inactive';

export interface DeviceRecordState {
  user_id: string;
  device_id: string;
  version: number;
  status: DeviceRecordStatus;
  last_updated: number;
  backup?: DeviceRecordBackup;
  last_restore?: DeviceRecordRestoreRequest;
  last_reset?: DeviceRecordResetRequest;
}

export type ClientLogger = (event: string, meta?: Record<string, unknown>) => void;

export interface ClientX25519Config {
  publicKeyDerB64: string;
  privateKeyDerB64: string;
}

export interface ClientConfig {
  serverUrl: string;
  clientId: string;
  userId?: string;
  deviceId: string;
  x25519PublicKey?: string; // optional, derived from x25519KeyPair when not provided
  kyberPublicKey?: string;
  x25519KeyPair?: ClientX25519Config;
  token?: string;
  wsFactory?: (url: string) => WebSocketLike;
  logger?: ClientLogger;
  crypto?: CryptoProvider;
  cryptoBackend?: 'toy' | 'real';
  realCryptoConfig?: RealCryptoConfig;
  insecureCrypto?: boolean;
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
