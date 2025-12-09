import { createCipheriv, createDecipheriv, hkdfSync } from 'crypto';

export type ServerSessionKeys = {
  encKey: Buffer;
  authKey: Buffer;
  nonce: Buffer;
};

function hkdfLabel(ikm: Buffer, salt: Buffer, label: string, length: number): Buffer {
  return Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from(label, 'utf8'), length)));
}

function deriveSessionKeys(handshakeHashB64: string, sessionIdB64: string): ServerSessionKeys {
  const handshakeHash = Buffer.from(handshakeHashB64, 'base64');
  const sessionId = Buffer.from(sessionIdB64, 'base64');
  const hybridStub = Buffer.concat([handshakeHash, sessionId]);
  const handshakeSecret = hkdfLabel(hybridStub, Buffer.alloc(0), 'FoxWhisper-Handshake-Root', 32);
  const total = hkdfLabel(handshakeSecret, sessionId, 'FoxWhisper-SessionKeys', 32 + 32 + 12);
  return {
    encKey: total.subarray(0, 32),
    authKey: total.subarray(32, 64),
    nonce: total.subarray(64, 76),
  };
}

export function createRealCryptoProvider() {
  return {
    deriveSessionKeys,
    aeadEncrypt(plaintext: Buffer, aad: Buffer, keys: ServerSessionKeys): Buffer {
      const cipher = createCipheriv('aes-256-gcm', keys.encKey, keys.nonce);
      cipher.setAAD(aad);
      const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([enc, tag]);
    },
    aeadDecrypt(ciphertext: Buffer, aad: Buffer, keys: ServerSessionKeys): Buffer {
      if (ciphertext.length < 16) throw new Error('ciphertext too short');
      const tag = ciphertext.subarray(ciphertext.length - 16);
      const body = ciphertext.subarray(0, ciphertext.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', keys.encKey, keys.nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    },
  };
}
