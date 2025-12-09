import { createCipheriv, createDecipheriv, createHash, hkdfSync } from 'crypto';
import { encodeCanonical } from './cborCanonical.js';

function decodeB64(input: string): Buffer {
  return Buffer.from(input, 'base64');
}

function hkdfLabel(ikm: Uint8Array, salt: Uint8Array, label: string, length: number): Buffer {
  return Buffer.from(new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from(label, 'utf8'), length)));
}

function buildAAD(groupId: string, senderId: string, messageId: string): Buffer {
  const header = {
    group_id: groupId,
    sender_id: senderId,
    message_id: messageId,
  };
  const canonical = encodeCanonical(header);
  return createHash('sha256').update(canonical).digest();
}

function buildNonce(groupId: string, senderId: string, messageId: string): Buffer {
  const header = {
    group_id: groupId,
    sender_id: senderId,
    message_id: messageId,
  };
  const canonical = encodeCanonical(header);
  const digest = createHash('sha256').update(canonical).digest();
  return digest.subarray(0, 12);
}

function deriveGroupKey(groupId: string): Buffer {
  const ikm = decodeB64(groupId);
  return hkdfLabel(ikm, Buffer.alloc(0), 'FoxWhisper-GroupKey', 32);
}

function deriveSenderKey(groupKey: Buffer, senderId: string): Buffer {
  const salt = decodeB64(senderId);
  return hkdfLabel(groupKey, salt, 'FoxWhisper-Group-SenderKey', 32);
}

export type GroupCiphertext = {
  ciphertext_b64: string;
  nonce_b64: string;
  aad_sha256: string;
  sender_key_sha256: string;
};

export class GroupSession {
  private readonly groupId: string;
  private readonly groupKey: Buffer;
  private readonly members: Set<string> = new Set();
  private readonly seenMessages: Set<string> = new Set();

  constructor(groupId: string) {
    this.groupId = groupId;
    this.groupKey = deriveGroupKey(groupId);
  }

  addMember(memberId: string): void {
    this.members.add(memberId);
  }

  removeMember(memberId: string): void {
    this.members.delete(memberId);
  }

  encrypt(senderId: string, messageId: string, plaintext: Uint8Array): GroupCiphertext {
    if (!this.members.has(senderId)) {
      throw new Error(`sender ${senderId} not in group`);
    }
    const senderKey = deriveSenderKey(this.groupKey, senderId);
    const aad = buildAAD(this.groupId, senderId, messageId);
    const nonce = buildNonce(this.groupId, senderId, messageId);

    const cipher = createCipheriv('aes-256-gcm', senderKey, nonce);
    cipher.setAAD(aad);
    const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([enc, tag]);

    return {
      ciphertext_b64: combined.toString('base64'),
      nonce_b64: nonce.toString('base64'),
      aad_sha256: createHash('sha256').update(aad).digest('hex'),
      sender_key_sha256: createHash('sha256').update(senderKey).digest('hex'),
    };
  }

  decrypt(senderId: string, messageId: string, ciphertextB64: string): Uint8Array {
    if (!this.members.has(senderId)) {
      throw new Error(`sender ${senderId} not in group`);
    }
    const replayKey = `${senderId}:${messageId}`;
    if (this.seenMessages.has(replayKey)) {
      throw new Error('replay detected');
    }
    this.seenMessages.add(replayKey);

    const senderKey = deriveSenderKey(this.groupKey, senderId);
    const aad = buildAAD(this.groupId, senderId, messageId);
    const nonce = buildNonce(this.groupId, senderId, messageId);

    const combined = decodeB64(ciphertextB64);
    if (combined.length < 16) {
      throw new Error('ciphertext too short');
    }
    const tag = combined.subarray(combined.length - 16);
    const body = combined.subarray(0, combined.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', senderKey, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(body), decipher.final()]);
    return dec;
  }
}
