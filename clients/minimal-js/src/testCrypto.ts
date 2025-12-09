import type { Aead, CryptoProvider, KeyAgreement, SessionKeys, HandshakeComplete } from './types.js';
import { buildAssociatedData } from './crypto/toy.js';

function xorBytes(data: Uint8Array, keyByte: number): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ keyByte;
  }
  return out;
}

export function createToyKeyAgreement(): KeyAgreement {
  return {
    deriveSessionKeys(handshake: HandshakeComplete): SessionKeys {
      return {
        encKey: `enc:${handshake.session_id}`,
        authKey: `auth:${handshake.handshake_hash}`,
        nonce: String(handshake.timestamp),
      };
    },
  };
}

export function createToyAead(): Aead {
  return {
    encrypt(plaintext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array {
      const keyByte = keys.encKey.charCodeAt(0) & 0xff;
      const combined = new Uint8Array(ad.length + plaintext.length);
      combined.set(ad, 0);
      combined.set(plaintext, ad.length);
      return xorBytes(combined, keyByte);
    },
    decrypt(ciphertext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array {
      const keyByte = keys.encKey.charCodeAt(0) & 0xff;
      const combined = xorBytes(ciphertext, keyByte);
      const adSlice = combined.slice(0, ad.length);
      const ptSlice = combined.slice(ad.length);
      if (!adSlice.every((b, i) => b === ad[i])) {
        throw new Error('aad mismatch');
      }
      return ptSlice;
    },
  };
}

export function createToyCryptoProvider(): CryptoProvider {
  return {
    keyAgreement: createToyKeyAgreement(),
    aead: createToyAead(),
  };
}

export { buildAssociatedData };
