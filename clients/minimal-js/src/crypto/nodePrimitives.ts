import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import type { RealCryptoPrimitives, SessionKeys } from '../types.js';

/**
 * Node-backed implementation of RealCryptoPrimitives.
 *
 * This is a spec-leaning implementation intended for the v0.9 Node test harness:
 * - HKDF-SHA256 for key derivation (32-byte outputs).
 * - AES-256-GCM for AEAD.
 * - Nonce is 96-bit (12 bytes), encoded as base64 inside SessionKeys.
 *
 * NOTE: X25519/Kyber operations are intentionally **not** wired here yet.
 * For now, key agreement is handled at a higher level using vector-provided
 * material; this module focuses on symmetric crypto.
 */
export function createNodeRealCryptoPrimitives(): RealCryptoPrimitives {
  function deriveSessionKeys(sharedSecret: Uint8Array, context: Uint8Array): SessionKeys {
    // Derive 32 + 32 + 12 bytes = 76 bytes of key material
    const totalLength = 32 + 32 + 12;
    const okm = Buffer.from(
      new Uint8Array(hkdfSync('sha256', sharedSecret, context, Buffer.from('FoxWhisper-SessionKeys', 'utf8'), totalLength)),
    );

    const encKeyBytes = okm.subarray(0, 32);
    const authKeyBytes = okm.subarray(32, 64);
    const nonceBytes = okm.subarray(64, 76); // 12 bytes

    return {
      encKey: encKeyBytes.toString('base64'),
      authKey: authKeyBytes.toString('base64'),
      nonce: nonceBytes.toString('base64'),
    };
  }

  function aeadEncrypt(
    plaintext: Uint8Array,
    ad: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    if (key.length !== 32) {
      throw new Error(`AES-256-GCM key must be 32 bytes, got ${key.length}`);
    }
    if (nonce.length !== 12) {
      throw new Error(`AES-GCM nonce must be 12 bytes, got ${nonce.length}`);
    }
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    if (ad.length > 0) {
      cipher.setAAD(ad);
    }
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([enc, tag]);
  }

  function aeadDecrypt(
    ciphertext: Uint8Array,
    ad: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array {
    if (ciphertext.length < 16) {
      throw new Error('ciphertext too short to contain auth tag');
    }
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const body = ciphertext.subarray(0, ciphertext.length - 16);

    if (key.length !== 32) {
      throw new Error(`AES-256-GCM key must be 32 bytes, got ${key.length}`);
    }
    if (nonce.length !== 12) {
      throw new Error(`AES-GCM nonce must be 12 bytes, got ${nonce.length}`);
    }

    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    if (ad.length > 0) {
      decipher.setAAD(ad);
    }
    decipher.setAuthTag(Buffer.from(tag));

    const dec = Buffer.concat([decipher.update(body), decipher.final()]);
    return dec;
  }

  return {
    // For now we expose simple random key material for X25519 to satisfy the
    // interface. Proper X25519/Kyber integration will be added when the
    // handshake secret is wired to real primitives.
    x25519KeyGen() {
      const priv = randomBytes(32);
      const pub = randomBytes(32);
      return { publicKey: pub, privateKey: priv };
    },
    x25519Ecdh(ourPrivate: Uint8Array, theirPublic: Uint8Array): Uint8Array {
      // Placeholder: real X25519 ECDH will be introduced once we have a
      // concrete key representation shared with other implementations.
      // For now, combine inputs via HKDF to get deterministic behavior.
      const combined = Buffer.concat([Buffer.from(ourPrivate), Buffer.from(theirPublic)]);
      const okm = Buffer.from(
        new Uint8Array(hkdfSync('sha256', combined, Buffer.alloc(0), Buffer.from('FoxWhisper-X25519-Stub', 'utf8'), 32)),
      );
      return okm;
    },
    kdf(sharedSecret: Uint8Array, context: Uint8Array): SessionKeys {
      return deriveSessionKeys(sharedSecret, context);
    },
    aeadEncrypt,
    aeadDecrypt,
  };
}
