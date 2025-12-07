import cbor from 'cbor';
import { randomBytes, createHash } from 'crypto';
import type { HandshakeInit, HandshakeResponse, HandshakeComplete } from './types.js';

export const TAG_HANDSHAKE_INIT = 0xd1;
export const TAG_HANDSHAKE_RESPONSE = 0xd2;
export const TAG_HANDSHAKE_COMPLETE = 0xd3;

export function createHandshakeInit(params: {
  clientId: string;
  x25519PublicKey: string;
  kyberPublicKey: string;
  nonce?: string;
  timestamp?: number;
}): HandshakeInit {
  return {
    type: 'HANDSHAKE_INIT',
    version: 1,
    client_id: params.clientId,
    x25519_public_key: params.x25519PublicKey,
    kyber_public_key: params.kyberPublicKey,
    timestamp: params.timestamp ?? Date.now(),
    nonce: params.nonce ?? randomBytes(16).toString('base64'),
  };
}

export function encodeTagged(msg: any, tag: number): Buffer {
  return cbor.encodeOne(new cbor.Tagged(tag, msg), { canonical: true });
}

export function encodeHandshakeInit(msg: HandshakeInit): Buffer {
  return encodeTagged(msg, TAG_HANDSHAKE_INIT);
}

export function encodeHandshakeComplete(msg: HandshakeComplete): Buffer {
  return encodeTagged(msg, TAG_HANDSHAKE_COMPLETE);
}

export function decodeIncoming(data: Buffer): any {
  const decoded = cbor.decodeFirstSync(data);
  return decoded; // may be tagged
}

export function isHandshakeResponse(obj: any): obj is HandshakeResponse {
  return obj && obj.type === 'HANDSHAKE_RESPONSE' && obj.version === 1;
}

export function isHandshakeComplete(obj: any): obj is HandshakeComplete {
  return obj && obj.type === 'HANDSHAKE_COMPLETE' && obj.version === 1;
}

export function deriveHandshakeComplete(resp: HandshakeResponse): HandshakeComplete {
  const hash = createHash('sha256')
    .update(resp.server_id)
    .update(resp.nonce)
    .digest('base64');
  return {
    type: 'HANDSHAKE_COMPLETE',
    version: 1,
    session_id: hash,
    handshake_hash: hash,
    timestamp: Date.now(),
  };
}
