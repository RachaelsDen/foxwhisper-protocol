import cbor from 'cbor';
import { randomBytes, createHash, hkdfSync } from 'crypto';
import type { HandshakeInit, HandshakeResponse, HandshakeComplete } from './types.js';

export const TAG_HANDSHAKE_INIT = 0xd1;
export const TAG_HANDSHAKE_RESPONSE = 0xd2;
export const TAG_HANDSHAKE_COMPLETE = 0xd3;

export function decodeTagged(buffer: Buffer): any {
  const decoded = cbor.decodeFirstSync(buffer);
  if (decoded instanceof cbor.Tagged) {
    return { tag: decoded.tag, value: decoded.value };
  }
  return { tag: null, value: decoded };
}

function canonicalEncode(value: any): Buffer {
  return cbor.encodeOne(value, { canonical: true }) as Buffer;
}

export function makeHandshakeResponse(
  init: HandshakeInit,
  serverId: string,
  serverX25519PubB64: string,
  kyberCiphertextB64: string,
): HandshakeResponse {
  return {
    type: 'HANDSHAKE_RESPONSE',
    version: 1,
    server_id: serverId,
    x25519_public_key: serverX25519PubB64,
    kyber_ciphertext: kyberCiphertextB64,
    timestamp: Date.now(),
    nonce: randomBytes(12).toString('base64'),
  };
}

export function makeHandshakeComplete(resp: HandshakeResponse): HandshakeComplete {
  const transcript = canonicalEncode(resp);
  const hashBytes = createHash('sha256').update(transcript).digest();
  const sessionIdBytes = new Uint8Array(
    hkdfSync('sha256', hashBytes, Buffer.alloc(0), Buffer.from('FoxWhisper-SessionId', 'utf8'), 32),
  );
  const session_id = Buffer.from(sessionIdBytes).toString('base64');
  return {
    type: 'HANDSHAKE_COMPLETE',
    version: 1,
    session_id,
    handshake_hash: Buffer.from(hashBytes).toString('base64'),
    timestamp: Date.now(),
  };
}

export function encodeTagged(value: any, tag: number): Buffer {
  return cbor.encodeOne(new cbor.Tagged(tag, value));
}
