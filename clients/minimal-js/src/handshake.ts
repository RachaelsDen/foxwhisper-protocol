import cbor from 'cbor';
import { randomBytes, createHash, hkdfSync } from 'crypto';
import { encodeCanonical } from './cborCanonical.js';
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
  const { shared_secret, ...toEncode } = msg as any;
  return encodeTagged(toEncode, TAG_HANDSHAKE_COMPLETE);
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
  const transcript = encodeCanonical(resp);
  const hashBytes = createHash('sha256').update(transcript).digest();
  const handshake_hash = hashBytes.toString('base64');
  const sessionIdBytes = new Uint8Array(
    hkdfSync('sha256', hashBytes, Buffer.alloc(0), Buffer.from('FoxWhisper-SessionId', 'utf8'), 32),
  );
  const session_id = Buffer.from(sessionIdBytes).toString('base64');

  return {
    type: 'HANDSHAKE_COMPLETE',
    version: 1,
    session_id,
    handshake_hash,
    timestamp: Date.now(),
  };
}
