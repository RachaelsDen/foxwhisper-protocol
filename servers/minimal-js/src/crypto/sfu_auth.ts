import { createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import type { SfuErrorCode } from '../sfu_types.js';

export type ClientAuthContext = {
  callId: string;
  clientId: string;
  timestampMs: number;
  nonce: string;
};

export type VerifyAuthContext = ClientAuthContext & {
  nowMs?: number;
  maxSkewMs?: number;
  nonceCache?: Set<string>;
};

export type SfuAuthVerifyResult =
  | { ok: true }
  | { ok: false; error: SfuErrorCode | 'TOKEN_EXPIRED' | 'REPLAY' | 'INVALID_TOKEN' };

function hkdfLabel(ikm: Buffer, salt: Buffer, label: string, length: number): Buffer {
  return Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from(label, 'utf8'), length)));
}

function normalizeKey(key: Buffer | string): Buffer {
  return Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
}

function serializeAuthMessage(ctx: ClientAuthContext): Buffer {
  return Buffer.concat([
    Buffer.from(ctx.callId, 'utf8'),
    Buffer.from(ctx.clientId, 'utf8'),
    Buffer.from(String(ctx.timestampMs), 'utf8'),
    Buffer.from(ctx.nonce, 'utf8'),
  ]);
}

export function deriveClientSfuAuthKey(handshakeSecret: Buffer, clientId: string): Buffer {
  if (!Buffer.isBuffer(handshakeSecret)) {
    throw new Error('handshakeSecret must be a Buffer');
  }
  return hkdfLabel(handshakeSecret, Buffer.alloc(0), `FW-SFU-ClientAuth${clientId}`, 32);
}

export function makeClientAuthToken(key: Buffer | string, ctx: ClientAuthContext): Buffer {
  const keyBuf = normalizeKey(key);
  const msg = serializeAuthMessage(ctx);
  return createHmac('sha256', keyBuf).update(msg).digest();
}

export function verifyClientAuthToken(
  key: Buffer | string,
  token: Buffer | string,
  ctx: VerifyAuthContext
): SfuAuthVerifyResult {
  const keyBuf = normalizeKey(key);
  const tokenBuf = Buffer.isBuffer(token) ? token : Buffer.from(token, 'base64');
  const expected = makeClientAuthToken(keyBuf, ctx);

  if (expected.length !== tokenBuf.length || !timingSafeEqual(expected, tokenBuf)) {
    return { ok: false, error: 'IMPERSONATION' };
  }

  const now = ctx.nowMs ?? Date.now();
  const maxSkew = ctx.maxSkewMs ?? 5 * 60 * 1000;
  if (Math.abs(now - ctx.timestampMs) > maxSkew) {
    return { ok: false, error: 'TOKEN_EXPIRED' };
  }

  const cache = ctx.nonceCache;
  if (cache) {
    const cacheKey = `${ctx.clientId}:${ctx.nonce}`;
    if (cache.has(cacheKey)) {
      return { ok: false, error: 'REPLAY' };
    }
    cache.add(cacheKey);
  }

  return { ok: true };
}
