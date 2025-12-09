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

export type JoinMessage = {
  type: 'JOIN';
  room_id: string;
  timestamp: number;
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

export type Incoming = HandshakeInit | DataMessage | JoinMessage | LeaveMessage;

export type Outgoing = HandshakeResponse | HandshakeComplete | DataMessage | JoinAckMessage;


export type ServerLogger = (event: string, meta?: Record<string, unknown>) => void;
export type ServerAuditLogger = (event: string, meta?: Record<string, unknown>) => void;

export type ModerationDecision = 'allow' | 'deny' | 'defer';
export type ModerationHook = (meta: { room_id: string; sender?: string; seq?: number; size?: number }) => ModerationDecision;

export type AuthDecision = 'allow' | 'deny' | 'unauthenticated';
export type AuthHook = (meta: { client_id: string; connection_id: string; remote?: string }) => AuthDecision;

export interface ServerConfig {
  port: number;
  serverId?: string;
  wsFactory?: any;
  logger?: ServerLogger;
  auditLogger?: ServerAuditLogger;
  moderationHook?: ModerationHook;
  authHook?: AuthHook;
  cryptoProvider?: any;
  cryptoBackend?: 'toy' | 'real';
}
