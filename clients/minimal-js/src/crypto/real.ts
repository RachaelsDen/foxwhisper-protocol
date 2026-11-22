import { hkdfSync } from 'crypto';
import type { Aead, CryptoProvider, KeyAgreement, RealCryptoConfig, SessionKeys } from '../types.js';
import { createNodeRealCryptoPrimitives } from './nodePrimitives.js';

function decodeBase64ToBytes(b64: string): Uint8Array {
  return Buffer.from(b64, 'base64');
}

function hkdfLabel(ikm: Uint8Array, salt: Uint8Array, label: string, length: number): Buffer {
  return Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from(label, 'utf8'), length)));
}

export function createRealCryptoProvider(config: RealCryptoConfig): CryptoProvider {
  const primitives = config.primitives ?? createNodeRealCryptoPrimitives();

  const keyAgreement: KeyAgreement = {
    deriveSessionKeys(handshake): SessionKeys {
      const sessionId = decodeBase64ToBytes(handshake.session_id);
      const sharedB64 = (handshake as any).shared_secret as string | undefined;
      if (!sharedB64) {
        throw new Error('missing shared_secret for v0.9 handshake');
      }
      const shared = decodeBase64ToBytes(sharedB64);
      const salt = Buffer.alloc(32, 0);
      const handshakeSecret = hkdfLabel(shared, salt, 'FW-Handshake-Root', 32);
      return primitives.kdf(handshakeSecret, sessionId);
    },
  };

  const aead: Aead = {
    encrypt(plaintext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array {
      const nonceBytes = decodeBase64ToBytes(keys.nonce ?? '');
      const keyBytes = decodeBase64ToBytes(keys.encKey);
      return primitives.aeadEncrypt(plaintext, ad, nonceBytes, keyBytes);
    },
    decrypt(ciphertext: Uint8Array, ad: Uint8Array, keys: SessionKeys): Uint8Array {
      const nonceBytes = decodeBase64ToBytes(keys.nonce ?? '');
      const keyBytes = decodeBase64ToBytes(keys.encKey);
      return primitives.aeadDecrypt(ciphertext, ad, nonceBytes, keyBytes);
    },
  };

  return { keyAgreement, aead };
}
