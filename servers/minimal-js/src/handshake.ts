import cbor from 'cbor';
import { randomBytes, createHash } from 'crypto';
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

function b64ToBuf(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

export function makeHandshakeResponse(
  init: HandshakeInit,
  serverId: string,
  serverX25519PubB64: string,
  kyberCiphertextB64: string,
): HandshakeResponse {
  const params = {
    crypto_suite_id: init.crypto_suite_id,
    handshake_auth: init.handshake_auth,
  };
  const handshakeTranscriptRaw = {
    type: 'HANDSHAKE_TRANSCRIPT',
    client_x25519_pub: b64ToBuf(init.x25519_public_key),
    server_x25519_pub: b64ToBuf(serverX25519PubB64),
    kyber_public_key: b64ToBuf(init.kyber_public_key),
    kyber_ciphertext: b64ToBuf(kyberCiphertextB64),
    params,
  };
  const transcriptBytes = canonicalEncode(handshakeTranscriptRaw);
  const sessionIdBytes = createHash('sha256').update(transcriptBytes).digest();
  const session_id = sessionIdBytes.toString('base64');

  return {
    type: 'HANDSHAKE_RESPONSE',
    version: 1,
    server_id: serverId,
    crypto_suite_id: init.crypto_suite_id,
    handshake_auth: init.handshake_auth,
    x25519_public_key: serverX25519PubB64,
    kyber_ciphertext: kyberCiphertextB64,
    session_id,
    timestamp_ms: Date.now(),
    nonce: randomBytes(16).toString('base64'),
  };
}

export function makeHandshakeComplete(resp: HandshakeResponse): HandshakeComplete {
  return {
    type: 'HANDSHAKE_COMPLETE',
    version: 1,
    session_id: resp.session_id,
    timestamp_ms: Date.now(),
  };
}

export function encodeTagged(value: any, tag: number): Buffer {
  return cbor.encodeOne(new cbor.Tagged(tag, value));
}
