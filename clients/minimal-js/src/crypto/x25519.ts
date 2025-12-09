import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, diffieHellman } from 'crypto';

export type X25519KeyPair = {
  publicKeyDerB64: string;
  privateKeyDer: Buffer;
};

export function generateX25519KeyPair(): X25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return {
    publicKeyDerB64: Buffer.from(pubDer).toString('base64'),
    privateKeyDer: Buffer.from(privDer),
  };
}

function makePrivateKey(privDer: Buffer): KeyObject {
  return createPrivateKey({ format: 'der', type: 'pkcs8', key: privDer });
}

function makePublicKey(pubDerB64: string): KeyObject {
  return createPublicKey({ format: 'der', type: 'spki', key: Buffer.from(pubDerB64, 'base64') });
}

export function computeSharedSecret(privateKeyDer: Buffer, peerPublicKeyB64: string): Buffer {
  const privateKey = makePrivateKey(privateKeyDer);
  const publicKey = makePublicKey(peerPublicKeyB64);
  return diffieHellman({ privateKey, publicKey });
}
