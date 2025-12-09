import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'crypto';
import { encodeCanonical } from './cborCanonical.js';

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

function hkdfLabel(ikm: Uint8Array, salt: Uint8Array, label: string, length: number): Buffer {
  return Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from(label, 'utf8'), length)));
}

function buildFrameAAD(frameHeader: Record<string, unknown>): Buffer {
  const canonical = encodeCanonical(frameHeader);
  return createHash('sha256').update(canonical).digest();
}

function buildDeterministicIV(context: Buffer): Buffer {
  const digest = createHash('sha256').update(context).digest();
  return digest.subarray(0, 12);
}

export type MediaKeyDerivationInput = {
  root_key: string;
  chain_key: string;
  message_index: number;
  salt: string;
};

export type MediaKeyDerivationOutput = {
  media_key_b64: string;
  media_key_sha256: string;
};

export function deriveMediaKey(input: MediaKeyDerivationInput): MediaKeyDerivationOutput {
  const root = decodeB64(input.root_key);
  const chain = decodeB64(input.chain_key);
  const salt = decodeB64(input.salt); // explicit salt from vector
  const info = Buffer.from('FW-MediaEpochKey', 'utf8');
  const ikm = root; // derive from root key only
  const mediaKey = Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, info, 32)));
  return {
    media_key_b64: mediaKey.toString('base64'),
    media_key_sha256: createHash('sha256').update(mediaKey).digest('hex'),
  };
}

export type FrameProtectInput = {
  media_key: string;
  frame_data: string; // base64
  frame_iv: string; // base64
  aad: string; // base64 (canonical header pre-hash)
};

export type FrameProtectOutput = {
  ciphertext_b64: string; // ciphertext only, tag separate
  auth_tag_b64: string;
  aad_sha256: string;
  nonce_sha256: string;
  media_key_sha256: string;
};

export function encryptFrame(input: FrameProtectInput): FrameProtectOutput {
  const key = decodeB64(input.media_key);
  const frame = decodeB64(input.frame_data);
  const iv = decodeB64(input.frame_iv);
  const aad = decodeB64(input.aad);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const enc = Buffer.concat([cipher.update(frame), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext_b64: enc.toString('base64'),
    auth_tag_b64: tag.toString('base64'),
    aad_sha256: createHash('sha256').update(aad).digest('hex'),
    nonce_sha256: createHash('sha256').update(iv).digest('hex'),
    media_key_sha256: createHash('sha256').update(key).digest('hex'),
  };
}

export function decryptFrame(input: FrameProtectInput & { encrypted_frame: string; auth_tag: string }): Buffer {
  const key = decodeB64(input.media_key);
  const combined = decodeB64(input.encrypted_frame); // may already contain tag
  const iv = decodeB64(input.frame_iv);
  const aad = decodeB64(input.aad);
  const providedTag = decodeB64(input.auth_tag);

  const body = combined;
  const tag = providedTag.length === 16 ? providedTag : providedTag.subarray(0, 16);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function buildFrameContext(callId: string, participantId: string, streamId: string, frameSeq: number): Buffer {
  const context = Buffer.concat([
    decodeB64(callId),
    decodeB64(participantId),
    decodeB64(streamId),
    Buffer.from(Uint32Array.from([frameSeq]).buffer),
  ]);
  return buildDeterministicIV(context);
}

export function frameHeaderAAD(header: Record<string, unknown>): Buffer {
  return buildFrameAAD(header);
}
