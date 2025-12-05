# FoxWhisper E2EE Protocol Specification

**Version:** 1.0  
**Date:** December 5, 2025  
**Status:** Draft - In Development  

---

## Executive Summary

The FoxWhisper E2EE Protocol is a quantum-resistant, hardware-anchored end-to-end encryption system designed to support privacy-preserving safety infrastructure while maintaining maximum security against both classical and quantum attacks.

### Core Design Principles

1. **Quantum-Resistant Security**: Hybrid key agreement combining X25519 (classical) + ML-KEM/Kyber (post-quantum)
2. **Hardware-Protected Keys**: Long-term identity keys stored in TPM/Secure Enclave
3. **Privacy-Preserving Moderation**: Enable content moderation without bulk surveillance
4. **Forward Secrecy**: Per-session key agreement with automatic rotation
5. **Legal Compliance**: Support for legal holds and minimum retention requirements

---

## Identity Model

### Identity Hierarchy

The FoxWhisper protocol uses a four-tier identity model that provides clear separation between user identity, device identity, session context, and message context:

```
User Identity Key (Long-term, Hardware-anchored)
├── Device Identity Key A (Long-lived, per-device)
│   └── Session Key A↔B (Short-lived, per-device-pair)
│       └── Message Key 1, 2, 3... (Per-message)
├── Device Identity Key B (Long-lived, per-device)
│   └── Session Key B↔C (Short-lived, per-device-pair)
│       └── Message Key 1, 2, 3... (Per-message)
└── Device Identity Key C (Long-lived, per-device)
    └── Session Key C↔A (Short-lived, per-device-pair)
        └── Message Key 1, 2, 3... (Per-message)
```

### 1. User Identity Key

**Purpose**: Long-term cryptographic identity that never leaves the device
- **Type**: Ed25519 signing key
- **Storage**: Hardware-anchored (TPM/Secure Enclave)
- **Lifecycle**: Permanent (revoked only on compromise)
- **Usage**: 
  - Signs device identity keys
  - Signs protocol handshakes
  - Signs moderation actions
  - Signs legal compliance requests

**Structure**:
```javascript
const userIdentity = {
  userId: "U1234567890ABCDEF", // Base36 encoded public key hash
  publicKey: "ed25519-public-key-32-bytes",
  privateKey: "hardware-protected-never-exposed",
  createdAt: 1701763200000,
  lastUsed: 1701763200000
};
```

### 2. Device Identity Key

**Purpose**: Per-device cryptographic identity, bound to user identity
- **Type**: X25519 key agreement + Ed25519 signing key pair
- **Storage**: Hardware-anchored on device
- **Lifecycle**: Long-lived (revocable per-device)
- **Usage**:
  - Participates in hybrid key agreement
  - Identifies device in protocol messages
  - Enables device revocation without account compromise

**Structure**:
```javascript
const deviceIdentity = {
  deviceId: "DABCDEF1234567890", // Base36 encoded device identifier
  userId: "U1234567890ABCDEF",   // Parent user identity
  x25519PublicKey: "x25519-public-key-32-bytes",
  ed25519PublicKey: "ed25519-public-key-32-bytes",
  userSignature: "ed25519-signature-of-device-key-by-user-identity",
  deviceName: "iPhone 15 Pro",
  createdAt: 1701763200000,
  lastSeen: 1701763200000
};
```

### 3. Session Key

**Purpose**: Short-lived symmetric key for secure communication between device pairs
- **Type**: 256-bit symmetric key (AES-256-GCM)
- **Derivation**: HKDF from X25519 + Kyber hybrid agreement
- **Lifecycle**: Per device-pair, rotated periodically
- **Usage**:
  - Encrypts/decrypts messages between devices
  - Derives per-message keys
  - Provides forward secrecy

**Structure**:
```javascript
const sessionKey = {
  sessionId: "S1234567890ABCDEF", // Unique session identifier
  localDeviceId: "DABCDEF1234567890",
  remoteDeviceId: "D1234567890ABCDEF",
  keyMaterial: "256-bit-session-key",
  derivedAt: 1701763200000,
  expiresAt: 1701766800000, // 1 hour TTL
  messageCount: 0
};
```

### 4. Message Key

**Purpose**: Per-message encryption key derived from session key
- **Type**: 256-bit symmetric key (AES-256-GCM)
- **Derivation**: HKDF(sessionKey, messageId, "FoxWhisper-Message-Key")
- **Lifecycle**: Single use, destroyed after encryption/decryption
- **Usage**:
  - Encrypts individual messages
  - Provides per-message forward secrecy

**Structure**:
```javascript
const messageKey = {
  messageId: "M1234567890ABCDEF", // Unique message identifier
  sessionId: "S1234567890ABCDEF", // Parent session
  keyMaterial: "derived-from-session-key",
  usedAt: 1701763200000
};
```

### Message ID Generation

#### **Security Requirements**
Message IDs must be **globally unique** and **cryptographically unpredictable** to prevent collision attacks and message splicing.

#### **Generation Algorithm**
```javascript
// Generate cryptographically secure message IDs
function generateMessageId() {
  // Use 128-bit cryptographically random identifier
  const randomBytes = await generateRandomBytes(16); // 128 bits
  
  // Encode as Base36 for user-friendly display
  const base36Id = base36Encode(randomBytes);
  
  // Add 'M' prefix for message identification
  return 'M' + base36Id;
}

// Alternative: Per-session monotonic counter with cryptographic randomness
function generateMessageIdWithCounter(sessionCounter, sessionKey) {
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setBigUint64(0, BigInt(sessionCounter));
  
  const randomBytes = await generateRandomBytes(8); // 64 bits randomness
  
  // Combine counter + randomness
  const combined = new Uint8Array([...randomBytes, ...counterBytes]);
  
  // Derive final ID
  const idBytes = await HKDF(
    'SHA-256',
    sessionKey,
    combined,
    16 // 128-bit output
  );
  
  return 'M' + base36Encode(idBytes);
}
```

#### **Collision Resistance**
- **Minimum entropy**: 128 bits (16 bytes) of cryptographic randomness
- **Collision probability**: 1 in 2^128 (practically impossible)
- **Global uniqueness**: Cryptographic randomness ensures no two messages share IDs

#### **Replay Protection Integration**
```javascript
// Message IDs are combined with counters for comprehensive replay protection
const replayProtection = {
  messageId: message.id,           // Cryptographically unique
  messageCounter: message.counter,    // Per-session monotonic
  sessionId: message.sessionId,      // Session scope
  timestamp: message.timestamp,        // Temporal validation
  senderDeviceId: message.senderDeviceId // Device identification
};

// Replay detection logic
function detectReplay(replayProtection, processedMessages) {
  const key = `${replayProtection.messageId}:${replayProtection.sessionId}`;
  
  if (processedMessages.has(key)) {
    throw new Error('Message replay detected');
  }
  
  // Additional temporal validation
  const now = Date.now();
  const messageAge = now - replayProtection.timestamp;
  const maxMessageAge = 24 * 60 * 60 * 1000; // 24 hours
  
  if (messageAge > maxMessageAge) {
    throw new Error('Message too old - possible replay');
  }
  
  processedMessages.set(key, true);
  return true; // Message accepted
}
```

### Identity Relationships

#### User ↔ Device Binding
```javascript
// Device identity is signed by user identity
const deviceBinding = {
  deviceId: "DABCDEF1234567890",
  userId: "U1234567890ABCDEF",
  devicePublicKey: "x25519-public-key",
  userSignature: "ed25519-signature-by-user-identity-key"
};
```

#### Device ↔ Session Binding
```javascript
// Session is established between specific devices
const sessionBinding = {
  sessionId: "S1234567890ABCDEF",
  localDeviceId: "DABCDEF1234567890",
  remoteDeviceId: "D1234567890ABCDEF",
  establishedAt: 1701763200000
};
```

### Protocol Message Identity Fields

All protocol messages now use explicitly defined identity fields:

```json
{
  "version": 1,
  "type": "HYBRID_HANDSHAKE_INIT",
  "timestamp": 1701763200000,
  "userId": "U1234567890ABCDEF",        // User identity (public)
  "deviceId": "DABCDEF1234567890",      // Device identity (public)
  "ephemeralX25519Pub": "base64-encoded-32-bytes",
  "kyberPub": "base64-encoded-kyber-public-key",
  "userSignature": "ed25519-signature-by-user-identity"
}
```

### Identity Management Operations

#### Device Registration
```javascript
// User registers new device
const newDevice = {
  deviceId: generateDeviceId(),
  userId: userIdentity.userId,
  x25519KeyPair: await generateX25519KeyPair(),
  ed25519KeyPair: await generateEd25519KeyPair()
};

// Sign device key with user identity
const deviceSignature = await userIdentity.sign(
  newDevice.x25519PublicKey + newDevice.ed25519PublicKey
);
```

#### Device Revocation

```javascript
// User revokes compromised device with cryptographic proof
const revocation = {
  userId: userIdentity.userId,
  revokedDeviceId: "DABCDEF1234567890",
  revokedAt: 1701763200000,
  revocationEpoch: 1701763200000, // Unix timestamp for ordering
  reason: "key-compromise|lost|stolen|user-request",
  userSignature: await userIdentity.sign(
    `REVOKE:${revokedDeviceId}:${revocation.revokedAt}:${revocation.reason}`
  )
};
```

### Revocation List Management

#### **Global Revocation State**
```javascript
// Server maintains global revocation list with temporal ordering
const revocationList = {
  entries: new Map(), // deviceId -> revocation entry
  
  addRevocation: function(revocation) {
    this.entries.set(revocation.revokedDeviceId, revocation);
  },
  
  isRevoked: function(deviceId, timestamp) {
    const revocation = this.entries.get(deviceId);
    if (!revocation) return false;
    
    // Device is revoked if revocation epoch is before or equal to timestamp
    return revocation.revocationEpoch <= timestamp;
  },
  
  getRevocationProof: function(deviceId) {
    return this.entries.get(deviceId);
  }
};
```

#### **Revocation Verification in Handshakes**
```javascript
// Verify device is not revoked during handshake
function verifyDeviceNotRevoked(deviceId, userId, timestamp, revocationList) {
  const isRevoked = revocationList.isRevoked(deviceId, timestamp);
  
  if (isRevoked) {
    const revocation = revocationList.getRevocationProof(deviceId);
    
    // Verify revocation signature
    const signatureValid = await verifyUserSignature(
      revocation.userSignature,
      `REVOKE:${deviceId}:${revocation.revocationEpoch}:${revocation.reason}`
    );
    
    if (!signatureValid) {
      throw new Error('Invalid revocation signature');
    }
    
    throw new Error(`Device ${deviceId} revoked at ${revocation.revokedAt} for reason: ${revocation.reason}`);
  }
  
  return true; // Device is valid
}
```

#### **Session State Rollback on Revocation**
```javascript
// Handle sessions involving revoked devices
function handleRevocationInSessions(revokedDeviceId, sessionStates) {
  const affectedSessions = [];
  
  for (const [sessionId, sessionState] of sessionStates.entries()) {
    if (sessionState.localDeviceId === revokedDeviceId || 
        sessionState.remoteDeviceId === revokedDeviceId) {
      
      // Immediately terminate session
      affectedSessions.push({
        sessionId: sessionId,
        action: 'terminate',
        reason: 'device-revoked',
        timestamp: Date.now()
      });
      
      // Securely destroy session state
      await destroySessionState(sessionId);
    }
  }
  
  return affectedSessions;
}

// Secure session state destruction
async function destroySessionState(sessionId) {
  // Delete all session keys from hardware storage
  await secureStorage.delete(`session-${sessionId}`);
  await secureStorage.delete(`send-chain-${sessionId}`);
  await secureStorage.delete(`recv-chain-${sessionId}`);
  await secureStorage.delete(`skipped-keys-${sessionId}`);
  
  // Clear from memory
  sessionStates.delete(sessionId);
}
```

#### **Replay Protection for Revoked Devices**
```javascript
// Prevent replay attacks using old revoked device signatures
function detectRevokedDeviceReplay(message, revocationList) {
  const revocation = revocationList.getRevocationProof(message.senderDeviceId);
  
  if (revocation && message.timestamp > revocation.revokedAt) {
    // Message from revoked device after revocation - potential replay
    const timeSinceRevocation = message.timestamp - revocation.revokedAt;
    const replayWindow = 24 * 60 * 60 * 1000; // 24 hours
    
    if (timeSinceRevocation < replayWindow) {
      throw new Error(`Potential replay from revoked device: message sent ${timeSinceRevocation}ms after revocation`);
    }
  }
  
  return false; // No replay detected
}
```

#### **Device Recovery After Revocation**
```javascript
// Process for user to recover from device compromise
const deviceRecovery = {
  // User initiates recovery after device is secured
  initiateRecovery: async function(userId, compromisedDeviceId) {
    // 1. Verify user identity (biometric + password)
    await authenticateUserStrongly(userId);
    
    // 2. Revoke all existing device keys
    await revokeAllDeviceKeys(userId);
    
    // 3. Generate new device identity
    const newDeviceIdentity = await generateNewDeviceIdentity(userId);
    
    // 4. Register new device with fresh keys
    const registration = await registerNewDevice(newDeviceIdentity);
    
    return {
      newDeviceId: registration.deviceId,
      recoveryComplete: true,
      recommendation: "Secure recovered device and update all other devices"
    };
  },
  
  // Other devices update their trust after revocation
  updateTrustAfterRevocation: async function(userId, revokedDeviceId) {
    const allDevices = await getUserDevices(userId);
    
    for (const device of allDevices) {
      if (device.deviceId !== revokedDeviceId) {
        // Refresh device directory and verify revocation list
        await device.updateRevocationList();
        await device.verifyRevocationStatus(revokedDeviceId);
      }
    }
  }
};
```

#### Session Establishment
```javascript
// Session between specific devices
const sessionInit = {
  localUserId: "U1234567890ABCDEF",
  localDeviceId: "DABCDEF1234567890",
  remoteUserId: "U1234567890ABCDEF",  // Same user for self-communication
  remoteDeviceId: "D1234567890ABCDEF", // Different device
  ephemeralKeys: await generateEphemeralKeys()
};
```

### Security Properties

#### **Compartmentalization**
- User identity compromise → All devices compromised
- Device compromise → Only that device compromised
- Session compromise → Only messages in that session
- Message compromise → Only that message

#### **Revocation Granularity**
- User identity revocation → Account-wide reset
- Device revocation → Single device removal
- Session termination → Immediate key destruction
- Message deletion → Individual message removal

#### **Forward Secrecy**
- User identity compromise → Past sessions remain secure
- Device compromise → Past sessions on other devices remain secure
- Session compromise → Past messages remain secure
- Message compromise → Future messages remain secure

---

## Protocol Architecture

### High-Level Overview

```
User A (Device 1)                    User B (Device 2)
     |                                       |
     | 1. HYBRID_HANDSHAKE_INIT              |
     |    - X25519 ephemeral public key       |
     |    - Kyber KEM public key            |
     |--------------------------------------->|
     |                                       |
     | 2. HYBRID_HANDSHAKE_RESP              |
     |    - X25519 ephemeral public key       |
     |    - Kyber ciphertext (encapsulated)   |
     |<---------------------------------------|
     |                                       |
     | 3. Complete Key Agreement               |
     |    A: X25519 + Kyber decapsulation   |
     |    B: X25519 + Kyber shared secret    |
     |<=====================================>|
     |                                       |
     | 4. ENCRYPTED_MESSAGES                 |
     |<=====================================>|
```

### Kyber KEM Flow

```
Device A (Initiator)                           Device B (Responder)
     |                                            |
     | 1. Generate Kyber KEM keypair               |
     |    kyberPrivA, kyberPubA                    |
     |                                            |
     | 2. Send kyberPubA in INIT message           |
     |------------------------------------------->|
     |                                            |
     | 3. Encapsulate to kyberPubA                   |
     |    kyberCiphertextB, kyberSharedB             |
     |                                            |
     | 4. Send kyberCiphertextB in RESP message      |
     |<-------------------------------------------|
     |                                            |
     | 5. Decapsulate kyberCiphertextB               |
     |    kyberSharedA = decapsulate(kyberPrivA,     |
     |                     kyberCiphertextB)            |
     |                                            |
     | Both sides now have kyberSharedA == kyberSharedB |
```

### Key Components

1. **Hybrid Key Agreement Layer**: X25519 + Kyber KEM
2. **Hardware Key Storage**: TPM/Secure Enclave integration
3. **Message Encryption**: AES-256-GCM for payload encryption
4. **Session Management**: Per-session keys with forward secrecy
5. **Compliance Layer**: Privacy-preserving moderation support

---

## Wire Format & Encoding

### Wire Format Specification

**Wire format: CBOR (JSON in specification is illustrative). All binary data uses base64 encoding in JSON examples for readability.**

#### Rationale for CBOR
- **Binary Efficiency**: More compact than JSON for mobile networks
- **Schema Support**: Built-in schema validation and type safety
- **Streaming Support**: Natural support for partial message parsing
- **Cryptographic Safety**: Deterministic serialization for AAD computation

#### Encoding Rules
```javascript
// All protocol messages use CBOR encoding
const wireFormat = {
  encode: (message) => cbor.encode(message),
  decode: (data) => cbor.decode(data),
  
  // Binary fields remain binary in CBOR (not base64)
  binaryFields: [
    'ephemeralX25519Pub',
    'kyberPub', 
    'kyberCiphertext',
    'ciphertext',
    'iv',
    'authTag',
    'encryptedMessageKey',
    'signatures'
  ]
};
```

#### Message Structure
```javascript
// All messages follow this structure
const messageSchema = {
  version: 1,           // uint, protocol version
  type: "STRING",       // string, message type
  timestamp: 1234567890, // uint, milliseconds since epoch
  sessionId: "STRING",   // string, session identifier
  messageId: "STRING",   // string, message identifier (for encrypted messages)
  senderUserId: "STRING", // string, sender user ID
  senderDeviceId: "STRING", // string, sender device ID
  recipientUserId: "STRING", // string, recipient user ID
  recipientDeviceId: "STRING", // string, recipient device ID
  payload: "BINARY",    // binary, message-specific payload
  signatures: "BINARY"   // binary, concatenated signatures
};
```

### Additional Authenticated Data (AAD)

**All AES-GCM operations authenticate critical message context as AAD to prevent ciphertext splicing and context confusion attacks.**

#### AAD Construction Rules
```
AAD = SHA-256(CBOR.encode({
  version: uint,
  type: string,
  sessionId: string (empty if not applicable),
  messageId: string (empty if not applicable),
  senderUserId: string,
  senderDeviceId: string,
  recipientUserId: string (empty if not applicable),
  recipientDeviceId: string (empty if not applicable),
  timestamp: uint
}))
```

#### AAD Serialization
```javascript
// Secure AAD serialization using CBOR + SHA-256
function serializeAAD(message) {
  const aadStruct = {
    version: message.version,
    type: message.type,
    sessionId: message.sessionId || '',
    messageId: message.messageId || '',
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
    recipientUserId: message.recipientUserId || '',
    recipientDeviceId: message.recipientDeviceId || '',
    timestamp: message.timestamp
  };
  
  // Encode with CBOR for deterministic binary serialization
  const aadBytes = cbor.encode(aadStruct);
  
  // Hash for fixed-size AAD
  return SHA-256(aadBytes);
}

// NOTE: String concatenation AAD serialization has been fully removed from specification
// All implementations MUST use the CBOR + SHA-256 method defined in serializeAAD()
```

#### AAD by Message Type

##### HYBRID_HANDSHAKE_INIT AAD
```
AAD_INIT = SHA-256(CBOR.encode({
  version: 1,
  type: "HYBRID_HANDSHAKE_INIT",
  sessionId: "", // Not applicable for handshakes
  messageId: "", // Not applicable for handshakes
  senderUserId: senderUserId,
  senderDeviceId: senderDeviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  timestamp: timestamp
}))
```

##### HYBRID_HANDSHAKE_RESP AAD
```
AAD_RESP = SHA-256(CBOR.encode({
  version: 1,
  type: "HYBRID_HANDSHAKE_RESP",
  sessionId: "", // Not applicable for handshakes
  messageId: "", // Not applicable for handshakes
  senderUserId: senderUserId,
  senderDeviceId: senderDeviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  timestamp: timestamp
}))
```

##### ENCRYPTED_MESSAGE AAD
```
AAD_MESSAGE = SHA-256(CBOR.encode({
  version: 1,
  type: "ENCRYPTED_MESSAGE",
  sessionId: sessionId,
  messageId: messageId,
  senderUserId: senderUserId,
  senderDeviceId: senderDeviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  timestamp: timestamp
}))
```

##### CONTENT_REPORT AAD
```
AAD_REPORT = SHA-256(CBOR.encode({
  version: 1,
  type: "CONTENT_REPORT",
  sessionId: "", // Not applicable for reports
  messageId: "", // Not applicable for reports
  senderUserId: reporterUserId,
  senderDeviceId: reporterDeviceId,
  recipientUserId: reportedUserId,
  recipientDeviceId: "", // Not applicable for reports
  timestamp: timestamp
}))
```

##### MODERATION_ACTION AAD
```
AAD_MODERATION = SHA-256(CBOR.encode({
  version: 1,
  type: "MODERATION_ACTION",
  sessionId: "", // Not applicable for moderation actions
  messageId: "", // Not applicable for moderation actions
  senderUserId: moderatorUserId,
  senderDeviceId: moderatorDeviceId,
  recipientUserId: "", // Not applicable for moderation actions
  recipientDeviceId: "", // Not applicable for moderation actions
  timestamp: timestamp
}))
```

##### LEGAL_HOLD_REQUEST AAD
```
AAD_LEGAL_HOLD = SHA-256(CBOR.encode({
  version: 1,
  type: "LEGAL_HOLD_REQUEST",
  sessionId: "", // Not applicable for legal holds
  messageId: "", // Not applicable for legal holds
  senderUserId: "", // Not applicable for legal holds
  senderDeviceId: "", // Not applicable for legal holds
  recipientUserId: "", // Not applicable for legal holds
  recipientDeviceId: "", // Not applicable for legal holds
  timestamp: timestamp,
  authorizedBy: authorizedBy // Additional field for legal holds
}))
```

### Wire Format Examples

#### CBOR Message Structure
```javascript
// ENCRYPTED_MESSAGE in CBOR (binary format)
const encryptedMessageCBOR = {
  version: 1,
  type: "ENCRYPTED_MESSAGE",
  timestamp: 1701763200000,
  
  sessionId: "S1234567890ABCDEF",
  messageId: "M1234567890ABCDEF",
  
  senderUserId: "U1234567890ABCDEF",
  senderDeviceId: "DABCDEF1234567890",
  recipientUserId: "UFEDCBA0987654321",
  recipientDeviceId: "D1234567890ABCDEF",
  
  ciphertext: new Uint8Array([/* encrypted data */]),
  iv: new Uint8Array([/* 12-byte IV */]),
  authTag: new Uint8Array([/* 16-byte auth tag */])
};

// Encoded as binary CBOR for transmission
const wireData = cbor.encode(encryptedMessageCBOR);
```

#### JSON Documentation Format
```json
{
  "version": 1,
  "type": "ENCRYPTED_MESSAGE",
  "timestamp": 1701763200000,
  
  "sessionId": "S1234567890ABCDEF",
  "messageId": "M1234567890ABCDEF",
  
  "senderUserId": "U1234567890ABCDEF",
  "senderDeviceId": "DABCDEF1234567890",
  "recipientUserId": "UFEDCBA0987654321",
  "recipientDeviceId": "D1234567890ABCDEF",
  
  "ciphertext": "base64-encoded-binary-data",
  "iv": "base64-encoded-12-byte-iv",
  "authTag": "base64-encoded-16-byte-auth-tag"
}
```

### Cryptographic Operations with AAD

#### Message Encryption and Decryption

Messages are encrypted using AES-256-GCM with Additional Authenticated Data (AAD) that binds the ciphertext to the specific message context. See Appendix A for reference implementation pseudocode.

#### AAD Validation
```javascript
// Verify AAD matches message context
function validateAAD(message) {
  const computedAAD = serializeAAD(message);
  
  // AAD must include all critical context fields
  const requiredFields = [
    'version', 'type', 'senderUserId', 'senderDeviceId', 'timestamp'
  ];
  
  for (const field of requiredFields) {
    if (!message[field]) {
      throw new Error(`Missing required AAD field: ${field}`);
    }
  }
  
  return computedAAD;
}
```

### Security Properties of AAD

#### **Context Binding**
- Ciphertext cannot be moved between different sessions
- Messages cannot be replayed in different contexts
- Prevents cut-and-paste attacks across conversations

#### **Integrity Protection**
- Any modification to message context breaks authentication
- AAD fields are authenticated but not encrypted
- Enables metadata validation without decryption

#### **Replay Prevention**
- Timestamps in AAD prevent old message reuse
- Session IDs prevent cross-session replay
- Message IDs prevent duplicate message acceptance

### Implementation Requirements

#### **Canonical CBOR Encoding Rules**

**All CBOR encoding must follow RFC 8949 canonical encoding rules to ensure identical byte output across all platforms.**

#### **Encoding Requirements**
```javascript
// Canonical CBOR encoding function
function canonicalCBOREncode(data) {
  return cbor.encodeOne(data, {
    canonical: true,
    // Ensure deterministic key ordering
    sortKeys: true,
    // Use shortest length encoding when possible
    highPrecision: false
  });
}
```

#### **Field Type Encoding Rules**
```javascript
const encodingRules = {
  strings: {
    encoding: 'utf8',
    noNullBytes: true,
    // No null bytes in strings (except where explicitly allowed)
    noUndefinedValues: true // No undefined values
  },
  
  numbers: {
    encoding: 'integer', // Use integer encoding when possible
    preferInteger: true, // Prefer integer over floating point
    noFloatingPoint: true // No floating point numbers
  },
  
  maps: {
    sortKeys: true, // Sort keys lexicographically
    rejectDuplicateKeys: true, // Reject duplicate keys
    preferFixedLength: true, // Use fixed-length arrays when possible
    },
  
  arrays: {
    rejectIndefiniteLength: true, // No indefinite length arrays
    preferFixedLength: true // Use fixed-length arrays when possible
    },
  
  binary: {
    preferByteString: true // Use byte strings for binary data
  }
  }
};
```

#### **Deterministic Ordering**
```javascript
// Fields must be encoded in consistent order
const fieldOrder = [
  'version', 'type', 'sessionId', 'messageId', 
  'senderUserId', 'senderDeviceId', 'recipientUserId', 'recipientDeviceId', 'timestamp'
];
```

#### **Test Vectors**
```javascript
// Cross-platform test vectors for canonical encoding
const canonicalEncodingTests = [
  {
    name: "AAD encoding test",
    input: {
      version: 1,
      type: "ENCRYPTED_MESSAGE",
      sessionId: "S123",
      messageId: "M456",
      senderUserId: "U789",
      senderDeviceId: "D012",
      recipientUserId: "U345",
      recipientDeviceId: "D678",
      timestamp: 1701763200000
    },
    expectedHash: "SHA-256-hash-of-canonical-cbor-encoding",
    note: "All implementations must produce identical hash"
  },
  {
    name: "Transcript encoding test",
    input: {
      version: 1,
      type: "HYBRID_HANDSHAKE_INIT",
      handshakeId: "H123",
      senderUserId: "U789",
      senderDeviceId: "D012",
      recipientUserId: "U345",
      recipientDeviceId: "D678",
      ephemeralX25519Pub: new Uint8Array(32),
      kyberPub: new Uint8Array(1184),
      senderNonce: new Uint8Array(32),
      timestamp: 1701763200000
    },
    expectedHash: "SHA-256-hash-of-canonical-cbor-encoding",
    note: "All implementations must produce identical hash"
  }
  }
];
```

#### **Implementation Verification**
```javascript
// Automated test to verify canonical encoding
function verifyCanonicalEncoding() {
  for (const test of canonicalEncodingTests) {
    const encoded = canonicalCBOREncode(test.input);
    const hash = SHA-256(encoded);
    
    if (hash !== test.expectedHash) {
      throw new Error(`Canonical encoding test failed: ${test.name}`);
    }
  }
  return true; // All tests passed
}
```

#### **Cross-Platform Compatibility**
```javascript
// Ensure AAD serialization is identical across platforms
const aadTestVectors = [
  {
    message: {
      version: 1,
      type: "ENCRYPTED_MESSAGE",
      sessionId: "S123",
      messageId: "M456",
      senderUserId: "U789",
      senderDeviceId: "D012",
      recipientUserId: "U345",
      recipientDeviceId: "D678",
      timestamp: 1701763200000
    },
    expectedAADHash: "SHA-256-hash-of-CBOR-encoded-structure",
    note: "All platforms must produce identical SHA-256 hash of CBOR-encoded structure"
  }
];
```

#### **Error Handling**
```javascript
// AAD validation failures must be treated as attacks
function handleAADError(error, message) {
  if (error.type === 'AAD_MISMATCH') {
    // Log potential attack attempt
    securityLogger.log({
      event: 'aad_validation_failed',
      message: message,
      error: error.message,
      timestamp: Date.now()
    });
    
    // Reject message completely
    throw new SecurityError('AAD authentication failed');
  }
}
```

---

## Message Types

### Core Protocol Messages

#### 1. HYBRID_HANDSHAKE_INIT
**Purpose**: Initiate secure session with hybrid key agreement
**Structure**:
```json
{
  "version": 1,
  "type": "HYBRID_HANDSHAKE_INIT",
  "timestamp": 1701763200000,
  "handshakeId": "H1234567890ABCDEF",
  "senderUserId": "U1234567890ABCDEF",
  "senderDeviceId": "DABCDEF1234567890",
  "recipientUserId": "UFEDCBA0987654321",
  "recipientDeviceId": "D1234567890ABCDEF",
  "ephemeralX25519Pub": "base64-encoded-32-bytes",
  "kyberPub": "base64-encoded-kyber-public-key",
  "senderNonce": "base64-encoded-32-byte-random-nonce",
  "deviceSignature": "ed25519-signature-by-sender-device-key",
  "userSignature": "ed25519-signature-by-sender-user-identity"
}
```

**Signature Scope**:
```
deviceSignature = Sign_deviceKey( HASH(
  version || 
  type || 
  handshakeId ||
  senderUserId ||
  senderDeviceId ||
  recipientUserId ||
  recipientDeviceId ||
  ephemeralX25519Pub ||
  kyberPub ||
  senderNonce ||
  timestamp
) )

userSignature = Sign_userIdentity( HASH(
  version || 
  type || 
  handshakeId ||
  senderUserId ||
  senderDeviceId ||
  recipientUserId ||
  recipientDeviceId ||
  ephemeralX25519Pub ||
  kyberPub ||
  senderNonce ||
  timestamp ||
  deviceSignature
) )
```

#### 2. HYBRID_HANDSHAKE_RESP
**Purpose**: Complete hybrid key agreement
**Structure**:
```json
{
  "version": 1,
  "type": "HYBRID_HANDSHAKE_RESP",
  "timestamp": 1701763200000,
  "handshakeId": "H1234567890ABCDEF",
  "senderUserId": "UFEDCBA0987654321",
  "senderDeviceId": "D1234567890ABCDEF",
  "recipientUserId": "U1234567890ABCDEF",
  "recipientDeviceId": "DABCDEF1234567890",
  "ephemeralX25519Pub": "base64-encoded-32-bytes",
  "kyberCiphertext": "base64-encoded-kyber-ciphertext",
  "senderNonce": "base64-encoded-32-byte-random-nonce",
  "recipientNonce": "base64-encoded-32-byte-random-nonce-from-init",
  "deviceSignature": "ed25519-signature-by-sender-device-key",
  "userSignature": "ed25519-signature-by-sender-user-identity"
}
```

**Signature Scope**:
```
deviceSignature = Sign_deviceKey( SHA-256( CBOR.encode({
  version: version,
  type: type,
  handshakeId: handshakeId,
  senderUserId: senderUserId,
  senderDeviceId: senderDeviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  ephemeralX25519Pub: ephemeralX25519Pub,
  kyberCiphertext: kyberCiphertext,
  senderNonce: senderNonce,
  recipientNonce: recipientNonce,
  timestamp: timestamp
}) ) )

userSignature = Sign_userIdentity( SHA-256( CBOR.encode({
  version: version,
  type: type,
  handshakeId: handshakeId,
  senderUserId: senderUserId,
  senderDeviceId: senderDeviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  ephemeralX25519Pub: ephemeralX25519Pub,
  kyberCiphertext: kyberCiphertext,
  senderNonce: senderNonce,
  recipientNonce: recipientNonce,
  timestamp: timestamp,
  deviceSignature: deviceSignature
}) ) )
```

#### 3. ENCRYPTED_MESSAGE
**Purpose**: Secure message delivery with session keys
**Structure**:
```json
{
  "version": 1,
  "type": "ENCRYPTED_MESSAGE",
  "timestamp": 1701763200000,
  
  "sessionId": "S1234567890ABCDEF",
  "messageId": "M1234567890ABCDEF",
  
  "senderUserId": "U1234567890ABCDEF",
  "senderDeviceId": "DABCDEF1234567890",
  "recipientUserId": "UFEDCBA0987654321",
  "recipientDeviceId": "D1234567890ABCDEF",
  
  "ciphertext": "base64-encoded-aes-gcm-ciphertext",
  "iv": "base64-encoded-12-byte-iv",
  "authTag": "base64-encoded-16-byte-auth-tag"
}
```

### Safety & Compliance Messages

#### 4. CONTENT_REPORT
**Purpose**: User-initiated content reporting for moderation
**Structure**:
```json
{
  "version": 1,
  "type": "CONTENT_REPORT",
  "timestamp": 1701763200000,
  "reportId": "R1234567890ABCDEF",
  "reporterUserId": "U1234567890ABCDEF",
  "reporterDeviceId": "DABCDEF1234567890",
  "reportedUserId": "UFEDCBA0987654321",
  "channelId": "channel-id",
  "messageCount": 25,
  "reportReason": "harassment|abuse|illegal",
  "context": "user-provided-context",
  "messageEvidence": [
    {
      "messageId": "M1234567890ABCDEF",
      "originalCiphertext": "base64-encrypted-message-content",
      "encryptedMessageKey": "moderator-only-encrypted-key",
      "iv": "base64-encoded-12-byte-iv",
      "authTag": "base64-encoded-16-byte-auth-tag"
    }
  ],
  "userSignature": "ed25519-signature-by-reporter-user-identity"
}
```

#### 5. MODERATION_ACTION
**Purpose**: Moderator decision on reported content
**Structure**:
```json
{
  "version": 1,
  "type": "MODERATION_ACTION",
  "timestamp": 1701763200000,
  "moderatorUserId": "UMODERATOR123456789",
  "moderatorDeviceId": "DMODERATOR123456789",
  "reportId": "report-identifier",
  "action": "warning|suspension|ban|no-action",
  "duration": "suspension-duration-hours",
  "reason": "detailed-reasoning",
  "appealEligible": true,
  "userSignature": "ed25519-signature-by-moderator-user-identity"
}
```

#### 6. LEGAL_HOLD_REQUEST
**Purpose**: Preserve specific messages during legal investigation
**Structure**:
```json
{
  "version": 1,
  "type": "LEGAL_HOLD_REQUEST",
  "timestamp": 1701763200000,
  "requestId": "LH1234567890ABCDEF",
  "courtOrder": "court-order-reference",
  "targetMessages": ["message-id-1", "message-id-2"],
  "preservationPeriod": 90,
  "authorizedBy": "legal-authority-id",
  "holdType": "ciphertext-only|ciphertext-plus-keys",
  "existingKeySources": ["moderation-reports", "user-exports"],
  "signature": "authority-signature"
}
```

---

## Handshake Transcript Security

### Transcript Binding Requirements

All handshake messages must include comprehensive transcript binding to prevent man-in-the-middle attacks and ensure cryptographic integrity. The transcript includes all fields that could affect the security properties of the resulting session.

### Signature Hierarchy

#### 1. Device-Level Signature
- **Purpose**: Authenticates the specific device initiating the handshake
- **Key**: Device's Ed25519 signing key
- **Scope**: All handshake fields except user signature
- **Verification**: Recipient verifies device is bound to claimed user

#### 2. User-Level Signature  
- **Purpose**: Authenticates the user identity behind the device
- **Key**: User's Ed25519 identity key (hardware-protected)
- **Scope**: All handshake fields including device signature
- **Verification**: Confirms user authorization for this device

### Transcript Fields

#### Required Fields for INIT Message
```
TRANSCRIPT_INIT = {
  version: 1,           // Protocol version (prevents downgrade attacks)
  type: "HYBRID_HANDSHAKE_INIT",             // Message type (prevents type confusion)
  handshakeId: handshakeId,       // Unique handshake identifier (prevents replay)
  senderUserId: senderUserId,     // Initiating user identity
  senderDeviceId: senderDeviceId,   // Initiating device identity  
  recipientUserId: recipientUserId,   // Target user identity
  recipientDeviceId: recipientDeviceId, // Target device identity
  ephemeralX25519Pub: ephemeralX25519Pub, // Ephemeral X25519 public key
  kyberPub: kyberPub,         // Kyber KEM public key
  senderNonce: senderNonce,      // Cryptographic nonce
  timestamp: timestamp         // Timestamp (prevents replay)
}
```

#### Required Fields for RESP Message
```
TRANSCRIPT_RESP = {
  version: 1,           // Protocol version
  type: "HYBRID_HANDSHAKE_RESP",             // Message type
  handshakeId: handshakeId,       // Matching handshake ID
  senderUserId: senderUserId,     // Responding user identity
  senderDeviceId: senderDeviceId,   // Responding device identity
  recipientUserId: recipientUserId,   // Original sender user identity
  recipientDeviceId: recipientDeviceId, // Original sender device identity
  ephemeralX25519Pub: ephemeralX25519Pub, // Ephemeral X25519 public key
  kyberCiphertext: kyberCiphertext,  // Kyber KEM ciphertext
  senderNonce: senderNonce,      // New cryptographic nonce
  recipientNonce: recipientNonce,   // Original nonce from INIT
  timestamp: timestamp         // Timestamp
}
```

### Cryptographic Construction

#### Hash Algorithm
```
TRANSCRIPT_HASH = SHA-256( CBOR.encode(TRANSCRIPT_STRUCT) )
```

#### Signature Generation
```javascript
// Device signature (inner signature)
const deviceSignature = await deviceIdentity.ed25519PrivateKey.sign(
  TRANSCRIPT_HASH
);

// User signature (outer signature)  
const userSignature = await userIdentity.ed25519PrivateKey.sign(
  SHA-256( cbor.encode({ transcriptHash: TRANSCRIPT_HASH, deviceSignature: deviceSignature }) )
);
```

#### Signature Verification
```javascript
// Verify device signature first
const deviceValid = await verifyDeviceSignature(
  deviceSignature,
  TRANSCRIPT_HASH,
  senderDeviceId
);

// Then verify user signature
const userValid = await verifyUserSignature(
  userSignature,
  SHA-256( TRANSCRIPT_HASH || deviceSignature ),
  senderUserId
);
```

### Security Properties

#### **Man-in-the-Middle Prevention**
- All cryptographic material is bound to specific identities
- Attacker cannot modify any field without breaking signatures
- Both parties authenticate each other's identities

#### **Replay Attack Prevention**
- Unique handshakeId prevents message reuse
- Timestamps provide additional replay protection
- Nonces ensure cryptographic freshness

#### **Downgrade Attack Prevention**
- Protocol version included in transcript
- Any version modification breaks signatures
- Both parties must agree on same version

#### **Identity Binding**
- Device keys cryptographically bound to user identity
- Prevents device impersonation attacks
- Enables secure device revocation

### Implementation Requirements

#### **Canonical CBOR Encoding Rules**

**All CBOR encoding must follow RFC 8949 canonical encoding rules to ensure identical byte output across all platforms.**

#### **Encoding Requirements**
```javascript
// Canonical CBOR encoding function
function canonicalCBOREncode(data) {
  // Use RFC 8949 canonical encoding rules
  return cbor.encodeOne(data, {
    canonical: true,
    // Ensure deterministic key ordering
    sortKeys: true,
    // Use shortest length encoding
    highPrecision: false
  });
}

// Field type encoding rules
const encodingRules = {
  strings: {
    encoding: 'utf8',
    // No null bytes in strings (except where explicitly allowed)
    noNullBytes: true
  },
  
  numbers: {
    // Use integer encoding when possible
    preferInteger: true,
    // No floating point unless explicitly required
    noFloatingPoint: true
  },
  
  maps: {
    // Sort keys lexicographically
    sortKeys: true,
    // Reject duplicate keys
    rejectDuplicateKeys: true
  },
  
  arrays: {
    // No indefinite length arrays
    rejectIndefiniteLength: true,
    // Use fixed-length arrays when possible
    preferFixedLength: true
  },
  
  binary: {
    // Use byte strings for binary data
    preferByteString: true
  }
};
```

#### **Deterministic AAD Construction**
```javascript
// AAD must be identical across all implementations
function serializeAAD(message) {
  const aadStruct = {
    version: message.version,
    type: message.type,
    sessionId: message.sessionId || '',
    messageId: message.messageId || '',
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
    recipientUserId: message.recipientUserId || '',
    recipientDeviceId: message.recipientDeviceId || '',
    timestamp: message.timestamp
  };
  
  // Use canonical CBOR encoding for deterministic output
  const aadBytes = canonicalCBOREncode(aadStruct);
  
  // Hash for fixed-size AAD
  return SHA-256(aadBytes);
}
```

#### **Transcript Serialization**
```javascript
// Handshake transcript must be identical across all implementations
function serializeTranscript(fields) {
  const transcriptStruct = {
    version: fields[0],
    type: fields[1],
    handshakeId: fields[2],
    senderUserId: fields[3],
    senderDeviceId: fields[4],
    recipientUserId: fields[5],
    recipientDeviceId: fields[6],
    ephemeralX25519Pub: fields[7],
    kyberPub: fields[8] || null,    // One of these will be null
    kyberCiphertext: fields[8] || null, // One of these will be null
    senderNonce: fields[9],
    recipientNonce: fields[10] || null,
    timestamp: fields[11] || fields[10] // Handle different message types
  };
  
  // Use canonical CBOR encoding for deterministic output
  return canonicalCBOREncode(transcriptStruct);
}
```

#### **Cross-Platform Test Vectors**
```javascript
// Test vectors to ensure identical encoding across platforms
const testVectors = [
  {
    name: "AAD encoding test",
    input: {
      version: 1,
      type: "ENCRYPTED_MESSAGE",
      sessionId: "S123",
      messageId: "M456",
      senderUserId: "U789",
      senderDeviceId: "D012",
      recipientUserId: "U345",
      recipientDeviceId: "D678",
      timestamp: 1701763200000
    },
    expectedHash: "SHA-256-hash-of-canonical-cbor-encoding",
    note: "All implementations must produce identical hash"
  },
  {
    name: "Transcript encoding test",
    input: {
      version: 1,
      type: "HYBRID_HANDSHAKE_INIT",
      handshakeId: "H123",
      senderUserId: "U789",
      senderDeviceId: "D012",
      recipientUserId: "U345",
      recipientDeviceId: "D678",
      ephemeralX25519Pub: new Uint8Array(32),
      kyberPub: new Uint8Array(1184),
      senderNonce: new Uint8Array(32),
      timestamp: 1701763200000
    },
    expectedHash: "SHA-256-hash-of-canonical-cbor-encoding",
    note: "All implementations must produce identical hash"
  }
];
```

#### **Implementation Verification**
```javascript
// Automated test to verify canonical encoding
function verifyCanonicalEncoding() {
  for (const test of testVectors) {
    const encoded = canonicalCBOREncode(test.input);
    const hash = SHA-256(encoded);
    
    if (hash !== test.expectedHash) {
      throw new Error(`Canonical encoding test failed: ${test.name}`);
    }
  }
  return true; // All tests passed
}
```

#### **Error Handling**
```javascript
// Must reject handshake if any verification fails
if (!deviceValid || !userValid) {
  throw new HandshakeError('INVALID_SIGNATURE', {
    handshakeId,
    senderUserId,
    senderDeviceId,
    reason: 'Signature verification failed'
  });
}
```

#### **Audit Logging**
```javascript
// Log all handshake attempts for security monitoring
await auditLog.log({
  event: 'handshake_attempt',
  handshakeId,
  senderUserId,
  senderDeviceId,
  recipientUserId,
  recipientDeviceId,
  timestamp,
  result: deviceValid && userValid ? 'success' : 'failed'
});
```

---

## Cryptographic Operations

### Hybrid Key Agreement

#### Step 1: Prepare Handshake Transcript
```javascript
// Sender (Device A) creates complete transcript
const handshakeId = generateHandshakeId();
const senderNonce = await generateRandomBytes(32);

const transcriptInit = [
  1,                                    // version
  'HYBRID_HANDSHAKE_INIT',              // type
  handshakeId,                          // handshakeId
  deviceIdentity.userId,                 // senderUserId
  deviceIdentity.deviceId,               // senderDeviceId
  recipientUserId,                       // recipientUserId
  recipientDeviceId,                     // recipientDeviceId
  null,                                 // ephemeralX25519Pub (filled later)
  null,                                 // kyberPub (filled later)
  base64Encode(senderNonce),             // senderNonce
  Date.now().toString()                 // timestamp
];
```

#### Step 2: Generate Ephemeral Keys
```javascript
// Generate cryptographic material
const ephemeralX25519 = await generateX25519KeyPair();
const ephemeralKyber = await generateKyberKeyPair(KYBER_768);

// Update transcript with generated keys
transcriptInit[7] = base64Encode(ephemeralX25519.publicKey);
transcriptInit[8] = base64Encode(ephemeralKyber.publicKey);
```

#### Step 3: Create Transcript Signatures
```javascript
// Serialize transcript for signing
const transcriptHash = SHA-256(serializeTranscript(transcriptInit));

// Device signature (inner)
const deviceSignature = await deviceIdentity.ed25519PrivateKey.sign(
  transcriptHash
);

// User signature (outer) - includes device signature
const userSignature = await userIdentity.ed25519PrivateKey.sign(
  SHA-256(transcriptHash + deviceSignature)
);
```

#### Step 4: Send Signed Handshake
```javascript
// Send HYBRID_HANDSHAKE_INIT with complete transcript binding
const handshakeInit = {
  version: 1,
  type: 'HYBRID_HANDSHAKE_INIT',
  timestamp: Date.now(),
  handshakeId: handshakeId,
  senderUserId: deviceIdentity.userId,
  senderDeviceId: deviceIdentity.deviceId,
  recipientUserId: recipientUserId,
  recipientDeviceId: recipientDeviceId,
  ephemeralX25519Pub: base64Encode(ephemeralX25519.publicKey),
  kyberPub: base64Encode(ephemeralKyber.publicKey),
  senderNonce: base64Encode(senderNonce),
  deviceSignature: base64Encode(deviceSignature),
  userSignature: base64Encode(userSignature)
};
```

#### Step 5: Verify Received Handshake
```javascript
// Receiver (Device B) verifies transcript integrity
const receivedTranscript = [
  handshakeInit.version,
  handshakeInit.type,
  handshakeInit.handshakeId,
  handshakeInit.senderUserId,
  handshakeInit.senderDeviceId,
  handshakeInit.recipientUserId,
  handshakeInit.recipientDeviceId,
  handshakeInit.ephemeralX25519Pub,
  handshakeInit.kyberPub,
  handshakeInit.senderNonce,
  handshakeInit.timestamp
];

const receivedHash = SHA-256(serializeTranscript(receivedTranscript));

// Verify device signature first
const deviceValid = await verifyEd25519Signature(
  handshakeInit.deviceSignature,
  receivedHash,
  handshakeInit.senderDeviceId
);

// Then verify user signature
const userValid = await verifyEd25519Signature(
  handshakeInit.userSignature,
  SHA-256(receivedHash + handshakeInit.deviceSignature),
  handshakeInit.senderUserId
);

if (!deviceValid || !userValid) {
  throw new HandshakeError('INVALID_SIGNATURE');
}
```

#### Step 6: Compute Shared Secrets
```javascript
// Receiver (Device B) - verify identity first
await verifyUserSignature(handshakeInit.userSignature, handshakeInit);

// Compute X25519 shared secret
const x25519Shared = await x25519(
  deviceIdentity.x25519PrivateKey,
  handshakeInit.ephemeralX25519Pub
);

// Generate Kyber ciphertext and shared secret using encapsulation
const kyberResult = await kyberEncapsulate(handshakeInit.kyberPub);
const kyberShared = kyberResult.sharedSecret;
const kyberCiphertext = kyberResult.ciphertext;
```

#### Step 7: Create Response with Transcript Binding
```javascript
// Create response transcript
const receiverNonce = await generateRandomBytes(32);
const responseTranscript = [
  1,                                    // version
  'HYBRID_HANDSHAKE_RESP',              // type
  handshakeInit.handshakeId,             // handshakeId
  deviceIdentity.userId,                 // senderUserId (receiver)
  deviceIdentity.deviceId,               // senderDeviceId (receiver)
  handshakeInit.senderUserId,            // recipientUserId (original sender)
  handshakeInit.senderDeviceId,          // recipientDeviceId (original sender)
  base64Encode(receiverEphemeralX25519.publicKey),
  base64Encode(kyberCiphertext),         // Kyber ciphertext from encapsulation
  base64Encode(receiverNonce),           // senderNonce
  handshakeInit.senderNonce,             // recipientNonce (from init)
  Date.now().toString()                 // timestamp
];

// Sign response transcript
const responseHash = SHA-256(serializeTranscript(responseTranscript));
const responseDeviceSig = await deviceIdentity.ed25519PrivateKey.sign(responseHash);
const responseUserSig = await userIdentity.ed25519PrivateKey.sign(
  SHA-256(responseHash + responseDeviceSig)
);
```

#### Step 8: Complete Handshake on Sender Side
```javascript
// Sender (Device A) receives response and completes handshake
const responseMessage = await receiveHandshakeResponse();

// Verify response signatures
const responseValid = await verifyHandshakeResponse(responseMessage);
if (!responseValid) {
  throw new HandshakeError('INVALID_RESPONSE_SIGNATURE');
}

// Compute X25519 shared secret with responder's ephemeral key
const x25519Shared = await x25519(
  ephemeralX25519.privateKey,
  base64Decode(responseMessage.ephemeralX25519Pub)
);

// Decapsulate Kyber ciphertext to get shared secret
const kyberShared = await kyberDecapsulate(
  ephemeralKyber.privateKey,
  base64Decode(responseMessage.kyberCiphertext)
);

// Both parties now have x25519Shared + kyberShared
const sessionKeyMaterial = x25519Shared + kyberShared;
const sessionContext = `FoxWhisper-Session-${responseMessage.handshakeId}-${handshakeInit.senderDeviceId}-${responseMessage.senderDeviceId}`;

const sessionKey = await HKDF(
  'SHA-256',
  sessionKeyMaterial,
  sessionContext,
  32 // 256-bit key
);
```

### Message Encryption

#### AES-256-GCM Encryption
```javascript
const messageData = JSON.stringify(messageContent);
const iv = await generateRandomBytes(12);
const aad = serializeAAD(message);

const encrypted = await aesGCMEncrypt(sessionKey, iv, messageData, aad);

return {
  ciphertext: encrypted.ciphertext,
  iv: iv,
  authTag: encrypted.authTag
};
```

---

## Hardware Integration

### TPM/Secure Enclave Operations

#### User Identity Key Storage
```javascript
// Store long-term user identity key (never leaves hardware)
await tpmStoreKey('user-identity-' + userId, userIdentity.privateKey, {
  permanent: true,
  requiresAuthentication: true
});
```

#### Device Identity Key Storage
```javascript
// Store device identity keys (signed by user identity)
await tpmStoreKey('device-identity-' + deviceId, deviceIdentity.privateKey, {
  permanent: true,
  requiresAuthentication: false // Device-level auth
});
```

#### Session Key Storage
```javascript
// Store session keys temporarily with TTL
await tpmStoreKey('session-' + sessionId, sessionKey, {
  ttl: 3600, // 1 hour
  autoDelete: true
});
```

#### Identity-Based Operations
```javascript
// Sign with user identity key (highest privilege)
const userSignature = await tpmSign('user-identity-' + userId, messageHash);

// Sign with device identity key (device-level operations)
const deviceSignature = await tpmSign('device-identity-' + deviceId, messageHash);

// Decrypt session key (device-pair specific)
const decrypted = await tpmDecrypt('session-' + sessionId, ciphertext);
```

#### Device Registration with Identity Binding
```javascript
// Register new device with user identity signature
const deviceRegistration = {
  userId: userIdentity.userId,
  deviceId: generateDeviceId(),
  x25519KeyPair: await generateX25519KeyPair(),
  ed25519KeyPair: await generateEd25519KeyPair()
};

// Sign device keys with user identity
const deviceBinding = {
  deviceId: deviceRegistration.deviceId,
  x25519PublicKey: deviceRegistration.x25519KeyPair.publicKey,
  ed25519PublicKey: deviceRegistration.ed25519KeyPair.publicKey,
  userSignature: await tpmSign('user-identity-' + userId, 
    deviceRegistration.deviceId + 
    deviceRegistration.x25519KeyPair.publicKey + 
    deviceRegistration.ed25519KeyPair.publicKey)
};

// Store device identity
await tpmStoreKey('device-identity-' + deviceRegistration.deviceId, 
  deviceRegistration.ed25519KeyPair.privateKey);
```

#### Key Operations
```javascript
// Sign with hardware-protected key
const signature = await tpmSign('identity-private', messageHash);

// Decrypt with hardware-protected key
const decrypted = await tpmDecrypt('session-' + sessionId, ciphertext);
```

### Device Management
```javascript
// Register new device
const deviceKeys = await generateDeviceKeys();
await tpmStoreKey('device-' + deviceId, deviceKeys.private);

// Sync across devices
const syncMessage = {
  type: 'DEVICE_SYNC',
  encryptedDeviceKey: await encryptForDevice(deviceKeys.public, newDeviceKey)
};
```

---

## Session Management

### Session Lifecycle

#### 1. Session Establishment
- Perform hybrid key agreement
- Derive session keys using HKDF
- Store session keys in hardware with TTL
- Exchange session confirmation messages

#### 2. Message Exchange
- Use AES-256-GCM for all message encryption
- Include message IDs for deduplication
- Implement message ordering with timestamps

#### 3. Key Rotation
- Rotate session keys every N messages or time period
- Perform re-handshake with new ephemeral keys
- Maintain forward secrecy across rotations

#### 4. Session Termination
- Securely delete session keys from hardware
- Send session close notification
- Clear local session state

### Ratchet Model Decision

**FoxWhisper v1 uses a symmetric ratchet over a hybrid session key, not a full Double Ratchet. Asynchronous messaging is supported via per-device sessions and replay-safe message keys.**

#### Rationale for Symmetric Ratchet Choice

1. **Enterprise Compliance**: Simpler model easier to audit and validate for legal hold requirements
2. **Implementation Complexity**: Reduced attack surface and easier security review
3. **Performance**: Lower computational overhead for high-volume enterprise messaging
4. **Testing**: More straightforward to validate and certify
5. **Legal Hold**: Easier to preserve specific message keys when required

#### Ratchet Architecture

```
Hybrid Handshake (X25519 + Kyber)
            ↓
     Session Key (per device-pair)
            ↓
    ┌─────────────────┬─────────────────┐
    │   Send Chain    │   Recv Chain    │
    │   (ratchets     │   (ratchets     │
    │    when sending) │    when receiving)│
    └─────────────────┴─────────────────┘
            ↓
     Message Key (per-message, from appropriate chain)
```

### Forward Secrecy Implementation

#### Session Key Derivation
```javascript
// Derived from hybrid handshake, one per device-pair
const sessionKey = await HKDF(
  'SHA-256',
  x25519Shared + kyberShared,
  `FoxWhisper-Session-${handshakeId}-${deviceAId}-${deviceBId}`,
  32 // 256-bit key
);
```

#### Symmetric Ratchet
```javascript
// Chain key ratchets forward with each message
const nextChainKey = await HKDF(
  'SHA-256',
  currentChainKey,
  'FoxWhisper-Chain-Ratchet',
  32
);

// Message key derived from current chain key
const messageKey = await HKDF(
  'SHA-256',
  currentChainKey,
  `FoxWhisper-Message-${messageId}`,
  32
);
```

#### Per-Message Key Derivation
```javascript
// Each message gets unique key from chain key
function deriveMessageKey(chainKey, messageId) {
  return HKDF(
    'SHA-256',
    chainKey,
    `FoxWhisper-Message-${messageId}`,
    32
  );
}
```

### Ratchet Lifecycle

#### 1. Session Establishment
```javascript
// Initialize duplex ratchet state with periodic asymmetric rotation
const ratchetState = {
  sessionId: 'S1234567890ABCDEF',
  sessionKey: sessionKey,
  
  // Separate chains for send/receive to prevent race conditions
  sendChainKey: sessionKey,
  recvChainKey: sessionKey,
  sendCounter: 0,
  recvCounter: 0,
  
  // Periodic asymmetric ratchet for post-compromise security
  lastAsymmetricRatchet: Date.now(),
  asymmetricRatchetInterval: 1000 * 60 * 30, // 30 minutes
  currentEphemeralKeyPair: null, // Updated during asymmetric ratchet
  remoteEphemeralPublicKey: null, // Peer's current ephemeral key
  
  // Buffer for out-of-order messages
  skippedKeys: new Map(), // messageId -> messageKey
  
  lastRatchetTime: Date.now()
};
```

#### 2. Message Encryption
```javascript
// Encrypt message with forward secrecy using send chain
function encryptMessage(ratchetState, plaintext) {
  const messageId = generateMessageId();
  
  // Check if periodic asymmetric ratchet is needed
  if (shouldPerformAsymmetricRatchet(ratchetState)) {
    await performAsymmetricRatchet(ratchetState);
  }
  
  // Derive message key from SEND chain (prevents receiver race conditions)
  const messageKey = deriveMessageKey(ratchetState.sendChainKey, messageId);
  
  // Store in skipped keys buffer for potential out-of-order recovery
  ratchetState.skippedKeys.set(messageId, messageKey);
  
  // Encrypt with per-message key
  const aad = serializeAAD(message);
  const encrypted = await aesGCMEncrypt(messageKey, iv, plaintext, aad);
  
  // Ratchet SEND chain forward for next message
  ratchetState.sendChainKey = await HKDF(
    'SHA-256',
    ratchetState.sendChainKey,
    'FoxWhisper-Send-Chain-Ratchet',
    32
  );
  ratchetState.sendCounter++;
  
  return {
    messageId: messageId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    messageCounter: ratchetState.sendCounter // Include for ordering
  };
}

// Periodic asymmetric ratchet for post-compromise security
function shouldPerformAsymmetricRatchet(ratchetState) {
  const now = Date.now();
  const timeSinceLastAsymmetric = now - ratchetState.lastAsymmetricRatchet;
  
  return timeSinceLastAsymmetric >= ratchetState.asymmetricRatchetInterval;
}

async function performAsymmetricRatchet(ratchetState) {
  // Generate new ephemeral key pair
  const newEphemeralKeyPair = await generateX25519KeyPair();
  
  // Update ratchet state with new keys
  ratchetState.currentEphemeralKeyPair = newEphemeralKeyPair;
  ratchetState.lastAsymmetricRatchet = Date.now();
  
  // Derive new chain keys from fresh key agreement
  const newChainKeyMaterial = await x25519(
    newEphemeralKeyPair.privateKey,
    ratchetState.remoteEphemeralPublicKey
  );
  
  const newChainKey = await HKDF(
    'SHA-256',
    newChainKeyMaterial,
    'FoxWhisper-Asymmetric-Ratchet',
    32
  );
  
  // Update both chains with fresh key material
  ratchetState.sendChainKey = newChainKey;
  ratchetState.recvChainKey = newChainKey;
}
```

#### 3. Message Decryption
```javascript
// Decrypt message using receive chain
function decryptMessage(ratchetState, encryptedMessage) {
  // Check if we have buffered key for this message (out-of-order)
  let messageKey = ratchetState.skippedKeys.get(encryptedMessage.messageId);
  
  if (!messageKey) {
    // Derive message key from RECV chain
    messageKey = deriveMessageKey(ratchetState.recvChainKey, encryptedMessage.messageId);
  }
  
  // Decrypt message
  const plaintext = await aesGCMDecrypt(
    messageKey,
    encryptedMessage.ciphertext,
    encryptedMessage.iv,
    encryptedMessage.authTag
  );
  
  // Ratchet RECV chain forward to maintain synchronization
  ratchetState.recvChainKey = await HKDF(
    'SHA-256',
    ratchetState.recvChainKey,
    'FoxWhisper-Recv-Chain-Ratchet',
    32
  );
  ratchetState.recvCounter++;
  
  // Clean up old skipped keys to prevent memory growth
  cleanupSkippedKeys(ratchetState, encryptedMessage.messageId);
  
  return plaintext;
}

// Clean up old keys to prevent memory exhaustion
function cleanupSkippedKeys(ratchetState, currentMessageId) {
  const maxBufferedKeys = 32;
  if (ratchetState.skippedKeys.size > maxBufferedKeys) {
    // Remove oldest keys (simplified FIFO)
    const keysToRemove = Array.from(ratchetState.skippedKeys.keys())
      .slice(0, ratchetState.skippedKeys.size - maxBufferedKeys);
    
    for (const oldMessageId of keysToRemove) {
      ratchetState.skippedKeys.delete(oldMessageId);
    }
  }
}

// Enhanced handshake with asymmetric ratchet support
async function performHybridHandshakeWithAsymmetricRatchet(deviceA, deviceB) {
  // Perform standard hybrid handshake
  const baseHandshake = await performHybridHandshake(deviceA, deviceB);
  
  // Initialize asymmetric ratchet state
  const asymmetricRatchetState = {
    lastAsymmetricRatchet: Date.now(),
    asymmetricRatchetInterval: 1000 * 60 * 30, // 30 minutes
    currentEphemeralKeyPair: await generateX25519KeyPair(),
    remoteEphemeralPublicKey: null // Set during handshake
  };
  
  return {
    ...baseHandshake,
    asymmetricRatchetState: asymmetricRatchetState
  };
}
```

### Asynchronous Messaging Support

#### Per-Device Sessions
```javascript
// Each device maintains separate session with every other device
const deviceSessions = {
  'DABCDEF1234567890': {
    'D1234567890ABCDEF': {
      sessionId: 'S1234567890ABCDEF',
      sendChainKey: '...',
      recvChainKey: '...',
      sendCounter: 0,
      recvCounter: 0,
      skippedKeys: new Map(),
      
      // Replay protection state
      processedMessageIds: new Set(),
      lastProcessedTimestamp: 0,
      maxClockSkew: 5 * 60 * 1000, // 5 minutes
      messageWindow: new Map() // messageId -> {timestamp, counter}
    }
  }
};
```

#### Message Ordering & Deduplication
```javascript
// Comprehensive replay and ordering protection
function validateMessage(message, sessionState) {
  // 1. Basic replay detection
  if (sessionState.processedMessageIds.has(message.messageId)) {
    throw new Error('Message replay detected - duplicate messageId');
  }
  
  // 2. Temporal validation with clock skew tolerance
  const now = Date.now();
  const messageAge = now - message.timestamp;
  const maxMessageAge = 24 * 60 * 60 * 1000; // 24 hours
  
  if (messageAge > maxMessageAge) {
    throw new Error('Message too old - possible replay attack');
  }
  
  // 3. Clock skew detection
  if (messageAge < -sessionState.maxClockSkew) {
    throw new Error('Message timestamp in future - clock skew attack');
  }
  
  // 4. Message counter validation (per direction)
  const direction = message.senderDeviceId === getCurrentDeviceId() ? 'send' : 'recv';
  const expectedCounter = sessionState[direction + 'Counter'];
  
  if (message.messageCounter < expectedCounter) {
    // Allow some out-of-order within tolerance
    const maxGap = 32; // Maximum allowed gap
    if (expectedCounter - message.messageCounter > maxGap) {
      throw new Error('Message too far out-of-order - possible replay');
    }
  }
  
  // 5. Sliding window validation
  const windowKey = `${message.senderDeviceId}:${message.sessionId}`;
  const messageWindow = sessionState.messageWindow.get(windowKey) || [];
  
  // Check if message already processed in window
  if (messageWindow.some(msg => msg.messageId === message.messageId)) {
    throw new Error('Message replay detected in sliding window');
  }
  
  // Update sliding window (keep last 100 messages per direction)
  messageWindow.push({
    messageId: message.messageId,
    timestamp: message.timestamp,
    counter: message.messageCounter
  });
  
  if (messageWindow.length > 100) {
    messageWindow.shift(); // Remove oldest
  }
  
  sessionState.messageWindow.set(windowKey, messageWindow);
  
  // 6. Accept and track message
  sessionState.processedMessageIds.add(message.messageId);
  sessionState.lastProcessedTimestamp = now;
  sessionState[direction + 'Counter'] = Math.max(expectedCounter, message.messageCounter);
  
  return true; // Message accepted
}
```

#### Clock Synchronization & Skew Handling
```javascript
// Clock skew detection and compensation
const clockSync = {
  maxSkew: 5 * 60 * 1000, // 5 minutes tolerance
  skewDetectionWindow: 60 * 60 * 1000, // 1 hour analysis window
  
  detectSkew: function(messages) {
    const timestamps = messages.map(m => m.timestamp);
    const now = Date.now();
    
    // Calculate median timestamp
    const sortedTimestamps = timestamps.sort((a, b) => a - b);
    const median = sortedTimestamps[Math.floor(sortedTimestamps.length / 2)];
    
    const skew = median - now;
    
    if (Math.abs(skew) > this.maxSkew) {
      return {
        detected: true,
        skew: skew,
        recommendation: skew > 0 ? 'client-clock-fast' : 'client-clock-slow'
      };
    }
    
    return { detected: false, skew: 0 };
  },
  
  compensateTimestamp: function(timestamp, detectedSkew) {
    // Adjust timestamp based on detected skew
    return timestamp - detectedSkew;
  }
};
```

#### DoS Protection for Replay Prevention
```javascript
// Prevent replay-based DoS attacks
const replayProtection = {
  maxMessagesPerSecond: 100,
  maxMessagesPerMinute: 1000,
  maxMessagesPerHour: 10000,
  
  messageCounters: new Map(), // deviceId -> {count, lastReset}
  
  checkRateLimit: function(deviceId) {
    const now = Date.now();
    const counter = this.messageCounters.get(deviceId) || { count: 0, lastReset: now };
    
    // Reset counters if needed
    const timeSinceReset = now - counter.lastReset;
    if (timeSinceReset > 60 * 60 * 1000) { // 1 hour
      counter.count = 0;
      counter.lastReset = now;
    }
    
    // Check limits
    if (counter.count >= this.maxMessagesPerHour) {
      throw new Error('Rate limit exceeded - possible DoS');
    }
    
    return true;
  },
  
  incrementCounter: function(deviceId) {
    const counter = this.messageCounters.get(deviceId) || { count: 0, lastReset: Date.now() };
    counter.count++;
    this.messageCounters.set(deviceId, counter);
  }
};
```

#### Message Ordering & Deduplication
```javascript
// Prevent replay and ensure ordering
const messageTracker = {
  processedMessageIds: new Set(),
  expectedMessageCounter: 0
};

function validateMessage(message) {
  // Check for replay
  if (messageTracker.processedMessageIds.has(message.messageId)) {
    throw new Error('Message replay detected');
  }
  
  // Track processed messages
  messageTracker.processedMessageIds.add(message.messageId);
  
  // Optional: enforce message ordering
  if (message.messageCounter < messageTracker.expectedMessageCounter) {
    throw new Error('Out-of-order message');
  }
  
  messageTracker.expectedMessageCounter = message.messageCounter + 1;
}
```

### Key Rotation Policy

#### Time-Based Rotation
```javascript
// Rotate session keys periodically
const SESSION_KEY_TTL = 24 * 60 * 60 * 1000; // 24 hours

function shouldRotateSession(ratchetState) {
  return Date.now() - ratchetState.lastRatchetTime > SESSION_KEY_TTL;
}
```

#### Message-Based Rotation
```javascript
// Rotate after N messages for additional security
const MAX_MESSAGES_PER_SESSION = 1000;

function shouldRotateByCount(ratchetState) {
  return ratchetState.messageCounter >= MAX_MESSAGES_PER_SESSION;
}
```

#### Session Re-establishment
```javascript
// Perform new hybrid handshake for fresh session
async function rotateSession(deviceA, deviceB) {
  const newHandshake = await performHybridHandshake(deviceA, deviceB);
  const newSessionKey = await deriveSessionKey(newHandshake);
  
  return {
    sessionId: generateSessionId(),
    sessionKey: newSessionKey,
    chainKey: newSessionKey,
    messageCounter: 0,
    lastRatchetTime: Date.now()
  };
}
```

### Security Properties

#### **Forward Secrecy**
- Compromise of current chain key doesn't reveal past messages
- Each message uses unique key derived from ratcheted chain key
- Session key compromise limited to messages after compromise

#### **Post-Compromise Security**
- Session rotation provides limited post-compromise security
- New session keys established via fresh hybrid handshake
- Asynchronous messaging maintained through per-device sessions

#### **Replay Protection**
- Unique message IDs prevent message replay
- Message counters provide ordering guarantees
- Timestamps add temporal validation

### Implementation Requirements

#### **State Persistence**
```javascript
// Persist ratchet state across app restarts
await secureStorage.store('ratchet-' + sessionId, {
  chainKey: ratchetState.chainKey,
  messageCounter: ratchetState.messageCounter,
  lastRatchetTime: ratchetState.lastRatchetTime
});
```

#### **State Synchronization & DoS Protection**

##### Maximum Gap Protection
**If a message arrives with a counter more than N steps ahead of current ratchet state, message is either buffered or rejected to avoid unbounded ratchet stepping.**

```javascript
const RATCHET_LIMITS = {
  MAX_GAP: 32,           // Maximum message gap before buffering/rejection
  MAX_BUFFER_SIZE: 100,   // Maximum buffered out-of-order messages
  MAX_RATCHET_STEPS: 1000  // Maximum ratchet steps per message processing
};

function validateMessageGap(ratchetState, message) {
  const gap = message.messageCounter - ratchetState.messageCounter;
  
  if (gap > RATCHET_LIMITS.MAX_GAP) {
    // Option A: Reject to prevent DoS
    if (messageBuffer.size() >= RATCHET_LIMITS.MAX_BUFFER_SIZE) {
      throw new Error('Message gap too large - possible DoS attack');
    }
    
    // Option B: Buffer with limits
    return {
      action: 'buffer',
      reason: 'message-too-far-ahead',
      gap: gap
    };
  }
  
  return { action: 'process', gap: gap };
}
```

##### Skipped Message Keys Buffer
**Signal keeps a small map of "skipped message keys" so if messages arrive out-of-order, you can decrypt old ones without rewinding ratchets. For symmetric ratchet, even a tiny buffer like "remember the last 32 derived keys" would make things more robust.**

```javascript
class SkippedKeysBuffer {
  constructor(maxSize = 32) {
    this.buffer = new Map(); // messageId -> messageKey
    this.maxSize = maxSize;
  }
  
  // Store derived key for potential out-of-order use
  storeKey(messageId, messageKey) {
    if (this.buffer.size >= this.maxSize) {
      // Remove oldest key
      const oldestId = this.buffer.keys().next().value;
      this.buffer.delete(oldestId);
    }
    
    this.buffer.set(messageId, messageKey);
  }
  
  // Retrieve key for out-of-order message
  getKey(messageId) {
    return this.buffer.get(messageId);
  }
  
  // Clean up old keys
  cleanup(currentMessageId) {
    for (const [id, key] of this.buffer) {
      if (isMuchOlder(id, currentMessageId)) {
        this.buffer.delete(id);
      }
    }
  }
}
```

##### Enhanced Out-of-Order Processing
```javascript
function handleOutOfOrderMessage(ratchetState, message, skippedKeys) {
  // Validate gap to prevent DoS
  const gapValidation = validateMessageGap(ratchetState, message);
  
  if (gapValidation.action === 'buffer') {
    messageBuffer.add(message);
    return { status: 'buffered', reason: gapValidation.reason };
  }
  
  // Check if we have buffered key for this message
  const bufferedKey = skippedKeys.getKey(message.messageId);
  if (bufferedKey) {
    // Decrypt with buffered key, no ratchet needed
    const plaintext = await aesGCMDecrypt(
      bufferedKey,
      message.ciphertext,
      message.iv,
      message.authTag
    );
    
    return { status: 'decrypted', plaintext, method: 'buffered-key' };
  }
  
  // Ratchet forward to catch up (with DoS protection)
  let ratchetSteps = 0;
  while (ratchetState.messageCounter < message.messageCounter && 
         ratchetSteps < RATCHET_LIMITS.MAX_RATCHET_STEPS) {
    
    // Store current chain key before ratcheting (for potential buffering)
    const nextMessageId = generateMessageId(ratchetState.messageCounter + 1);
    const nextMessageKey = deriveMessageKey(ratchetState.chainKey, nextMessageId);
    skippedKeys.storeKey(nextMessageId, nextMessageKey);
    
    // Ratchet forward
    ratchetState.chainKey = await HKDF(
      'SHA-256',
      ratchetState.chainKey,
      'FoxWhisper-Chain-Ratchet',
      32
    );
    
    ratchetState.messageCounter++;
    ratchetSteps++;
  }
  
  // Check if we caught up
  if (ratchetState.messageCounter !== message.messageCounter) {
    throw new Error(`Failed to catch up to message ${message.messageId} - too many steps`);
  }
  
  // Decrypt current message
  const currentMessageKey = deriveMessageKey(ratchetState.chainKey, message.messageId);
  const plaintext = await aesGCMDecrypt(
    currentMessageKey,
    message.ciphertext,
    message.iv,
    message.authTag
  );
  
  // Clean up old buffered keys
  skippedKeys.cleanup(message.messageId);
  
  return { status: 'decrypted', plaintext, method: 'ratchet-catchup' };
}
```

##### DoS Attack Prevention
```javascript
// Rate limiting and resource protection
const dosProtection = {
  maxRatchetStepsPerSecond: 1000,
  maxBufferedMessages: 100,
  maxProcessingTimePerMessage: 100 // ms
};

function checkDoSLimits(ratchetState, operation) {
  // Prevent excessive ratchet operations
  if (operation.type === 'ratchet') {
    const now = Date.now();
    const recentSteps = ratchetState.ratchetHistory.filter(
      step => now - step.timestamp < 1000
    );
    
    if (recentSteps.length >= dosProtection.maxRatchetStepsPerSecond) {
      throw new Error('Ratchet rate limit exceeded - possible DoS');
    }
  }
  
  // Prevent memory exhaustion from buffering
  if (operation.type === 'buffer' && 
      messageBuffer.size() >= dosProtection.maxBufferedMessages) {
    throw new Error('Message buffer full - possible DoS');
  }
}
```

### Testing Requirements

#### **Ratchet Correctness**
- Verify forward secrecy with key compromise simulation
- Test message ordering and replay protection
- Validate state synchronization across restarts

#### **Performance Benchmarks**
- Measure ratchet operation latency (<1ms target)
- Test memory usage for session state (<1KB per session)
- Validate throughput for high-volume messaging

#### **Compliance Validation**
- Test legal hold preservation during key rotation
- Verify message key recovery for audit requirements
- Validate session state export for legal compliance

---

## Client-Driven Moderation Model

### **Critical Security Principle**

**All moderation access to message content comes from users voluntarily re-sharing already-decrypted content via their client. The server never sees message keys or can decrypt stored messages.**

### Moderation Architecture

```
User Device (has decrypted messages)
    ↓ 1. User clicks "Report"
    ↓ 2. Client decrypts messages locally
    ↓ 3. Client creates report bundle
    ↓ 4. Client encrypts bundle for moderators
Server (receives encrypted reports only)
    ↓ 5. Stores encrypted report bundles
    ↓ 6. Moderators decrypt reports on their devices
```

### Client-Side Reporting Process

#### Step 1: User Initiates Report
```javascript
// User selects messages to report in their client
const reportRequest = {
  selectedMessages: [
    { messageId: "M123", roomId: "R456" },
    { messageId: "M124", roomId: "R456" }
  ],
  reportReason: "harassment|spam|illegal_content",
  context: "User-provided explanation",
  reporterConsent: true // User explicitly agrees to share content
};
```

#### Step 2: Client Creates Report Bundle
```javascript
// Client decrypts messages locally (already has keys)
async function createReportBundle(reportRequest, localDecryptionKeys) {
  const reportBundle = {
    reportId: generateReportId(),
    reporterUserId: getCurrentUserId(),
    reporterDeviceId: getCurrentDeviceId(),
    timestamp: Date.now(),
    reportReason: reportRequest.reportReason,
    context: reportRequest.context,
    
    // Client decrypts messages locally
    messageContent: await Promise.all(
      reportRequest.selectedMessages.map(async (msg) => {
        const messageKey = localDecryptionKeys.get(msg.messageId);
        const plaintext = await decryptMessageLocally(msg, messageKey);
        
        return {
          messageId: msg.messageId,
          roomId: msg.roomId,
          timestamp: msg.timestamp,
          senderId: msg.senderId,
          plaintext: plaintext, // Already decrypted by client
          originalCiphertext: msg.ciphertext // For verification
        };
      })
    ),
    
    // Metadata for abuse pattern analysis
    metadata: {
      totalMessages: reportRequest.selectedMessages.length,
      timeRange: {
        earliest: Math.min(...reportRequest.selectedMessages.map(m => m.timestamp)),
        latest: Math.max(...reportRequest.selectedMessages.map(m => m.timestamp))
      },
      roomsInvolved: [...new Set(reportRequest.selectedMessages.map(m => m.roomId))]
    }
  };
  
  return reportBundle;
}
```

#### Step 3: Client Encrypts Report for Moderators
```javascript
// Client encrypts entire report bundle (server cannot read)
async function encryptReportForModerators(reportBundle, moderatorPublicKey) {
  const ephemeralKey = await generateX25519KeyPair();
  
  // Encrypt the entire bundle, not individual keys
  const sharedSecret = await x25519(
    ephemeralKey.privateKey,
    moderatorPublicKey
  );
  
  const encryptionKey = await HKDF(
    'SHA-256',
    sharedSecret,
    'FoxWhisper-Report-Bundle',
    32
  );
  
  const encryptedBundle = await aesGCMEncrypt(
    encryptionKey,
    generateRandomBytes(12),
    JSON.stringify(reportBundle), // Entire report as JSON
    'FoxWhisper-Report-Encryption'
  );
  
  return {
    reportId: reportBundle.reportId,
    encryptedReportBundle: encryptedBundle.ciphertext,
    bundleIv: encryptedBundle.iv,
    bundleAuthTag: encryptedBundle.authTag,
    ephemeralPub: ephemeralKey.publicKey,
    reporterSignature: await signWithUserIdentity(reportBundle.reportId)
  };
}
```

### Server-Side Report Handling

#### Step 1: Receive Encrypted Report
```javascript
// Server stores encrypted report without decryption
const serverReport = {
  reportId: encryptedReport.reportId,
  encryptedReportBundle: encryptedReport.encryptedReportBundle,
  bundleIv: encryptedReport.bundleIv,
  bundleAuthTag: encryptedReport.bundleAuthTag,
  ephemeralPub: encryptedReport.ephemeralPub,
  reporterSignature: encryptedReport.reporterSignature,
  receivedAt: Date.now(),
  status: "pending_moderator_review"
};

// Store encrypted bundle - server cannot read content
await reportStore.storeEncrypted(serverReport);
```

#### Step 2: Moderator Decryption (Client-Side)
```javascript
// Moderators decrypt reports on their devices with forward secrecy
async function moderatorDecryptReport(encryptedReport, moderatorPrivateKey) {
  // This happens on moderator's device, NOT on server
  const sharedSecret = await x25519(
    moderatorPrivateKey,
    encryptedReport.reportEphemeralPub
  );
  
  const decryptionKey = await HKDF(
    'SHA-256',
    sharedSecret,
    'FoxWhisper-Report-Bundle',
    32
  );
  
  const bundleJson = await aesGCMDecrypt(
    decryptionKey,
    encryptedReport.encryptedReportBundle,
    encryptedReport.bundleIv,
    encryptedReport.bundleAuthTag
  );
  
  const reportBundle = JSON.parse(bundleJson);
  
  return {
    reportId: reportBundle.reportId,
    decryptedContent: reportBundle.messageContent,
    reporterInfo: {
      userId: reportBundle.reporterUserId,
      deviceId: reportBundle.reporterDeviceId,
      timestamp: reportBundle.timestamp
    },
    
    // Forward secrecy verification
    forwardSecrecyVerified: true,
    keyCompromiseImpact: "limited-to-this-report-only",
    
    // Moderator can now review content
    moderationAction: await reviewReportContent(reportBundle.messageContent)
  };
}
```

### Security Properties

#### **Server Cannot Access Content**
- Server never handles message keys
- Server stores only encrypted report bundles
- Server has no decryption capability for reports
- Compromise of server reveals no message content

#### **User-Controlled Content Sharing**
- Only user can choose to share specific messages
- User must explicitly consent to content sharing
- User can review exactly what content is being shared
- User can cancel report before sending

#### **Moderator Accountability**
- Each moderator decrypts reports on their own device
- Moderator actions are logged with report IDs
- No bulk decryption capability on server side
- Individual moderator keys provide audit trail

#### **Forward Secrecy Maintained**
- No new key export mechanisms introduced
- Existing ratchet forward secrecy preserved
- Past messages remain inaccessible to everyone
- No retroactive access capabilities created

### Implementation Requirements

#### **Client-Side Requirements**
```javascript
// Client must implement local decryption and reporting
const clientRequirements = {
  localDecryption: "Must be able to decrypt stored messages",
  reportGeneration: "Must create report bundles with content",
  userConsent: "Must get explicit user consent before sharing",
  encryption: "Must encrypt reports for moderator public keys",
  offlineReporting: "Must work without server decryption"
};
```

#### **Server-Side Requirements**
```javascript
// Server must handle encrypted reports only
const serverRequirements = {
  encryptedStorage: "Store only encrypted report bundles",
  noDecryption: "Never attempt to decrypt report content",
  metadataOnly: "Log only report metadata (IDs, timestamps, status)",
  moderatorDistribution: "Distribute encrypted reports to moderators",
  auditLogging: "Log report handling without content access"
};
```

#### **Moderator-Side Requirements**
```javascript
// Moderators decrypt reports on their devices
const moderatorRequirements = {
  clientDecryption: "Decrypt reports on moderator device only",
  secureStorage: "Store moderator keys in hardware",
  auditReporting: "Report moderation actions back to server",
  rateLimiting: "Prevent bulk report access abuse",
  revocation: "Support moderator key revocation"
};
```

### Compliance Features

#### **Report Preservation**
```javascript
// Preserve encrypted reports for legal holds
async function preserveReportForLegalHold(reportId, legalHoldRequest) {
  const encryptedReport = await reportStore.getEncrypted(reportId);
  
  await legalHoldStore.mark({
    reportId: reportId,
    encryptedReportBundle: encryptedReport.encryptedReportBundle,
    legalHoldId: legalHoldRequest.requestId,
    courtOrder: legalHoldRequest.courtOrder,
    preservationPeriod: legalHoldRequest.preservationPeriod,
    note: "Preserving user-submitted report content only"
  });
}
```

#### **Audit Trail**
```javascript
// Complete audit trail for report handling
const auditRecord = {
  reportId: reportId,
  moderatorId: moderatorId,
  action: "report_reviewed|action_taken",
  timestamp: Date.now(),
  legalHoldId: legalHoldId || null,
  note: "Moderator action based on user-submitted content"
};
```
Moderation Authority Key (Long-term, organization-specific)
├── Moderator Individual Keys (Per-moderator, signed by authority)
├── Organization Keys (Per-organization, signed by authority)
└── Temporary Report Keys (Per-report, derived from authority)
```

### Key Types & Purposes

#### 1. Moderation Authority Key
- **Type**: X25519 key agreement + Ed25519 signing key
- **Purpose**: Root of trust for moderation system
- **Lifecycle**: Long-term, rotated only on compromise
- **Usage**: Signs moderator keys, organization keys

#### 2. Moderator Individual Key
- **Type**: X25519 key agreement + Ed25519 signing key
- **Purpose**: Individual moderator decryption capability
- **Lifecycle**: Per-moderator, revocable
- **Usage**: Decrypts specific reported messages

#### 3. Organization Key
- **Type**: X25519 key agreement + Ed25519 signing key
- **Purpose**: Organization-level moderation
- **Lifecycle**: Per-organization, revocable
- **Usage**: Enterprise moderation teams

### Message Key Export Process

#### Step 1: Export Message Key from Ratchet State
```javascript
// User's device exports message key ONLY while still available in ratchet state
function exportMessageKeyFromRatchet(ratchetState, messageId) {
  // Check if message key is still available (forward secrecy constraint)
  const availableKey = ratchetState.skippedKeys.get(messageId);
  if (!availableKey) {
    throw new Error(
      'Message key no longer available for export - forward secrecy protection active. ' +
      'Keys can only be exported while present in current ratchet state.'
    );
  }
  
  return availableKey;
}

// CRITICAL: This function CANNOT reconstruct arbitrary old keys
// Past message keys are permanently destroyed to maintain forward secrecy
function reconstructMessageKey_DEPRECATED(sessionKey, messageId) {
  throw new Error(
    'Function removed: Reconstructing arbitrary message keys violates forward secrecy. ' +
    'Use exportMessageKeyFromRatchet() while keys are still available.'
  );
}
```

#### Step 2: Encrypt Message Key for Moderators
```javascript
// Encrypt message key with moderation public key
async function encryptMessageKeyForModerators(messageKey, moderationPublicKey) {
  const ephemeralKey = await generateX25519KeyPair();
  
  // Perform X25519 key agreement
  const sharedSecret = await x25519(
    ephemeralKey.privateKey,
    moderationPublicKey
  );
  
  // Derive encryption key
  const encryptionKey = await HKDF(
    'SHA-256',
    sharedSecret,
    'FoxWhisper-Moderation-Key-Export',
    32
  );
  
  // Encrypt message key
  const encryptedKey = await aesGCMEncrypt(
    encryptionKey,
    generateRandomBytes(12),
    messageKey,
    'FoxWhisper-Moderation-Export'
  );
  
  return {
    encryptedMessageKey: encryptedKey.ciphertext,
    keyEphemeralPub: ephemeralKey.publicKey,
    keyIv: encryptedKey.iv,
    keyAuthTag: encryptedKey.authTag
  };
}
```

#### Step 3: Create Evidence Package
```javascript
// User's device creates complete evidence package
async function createMessageEvidence(message, moderationPublicKey, ratchetState) {
  // Export message key from ratchet state (only while available)
  const messageKey = exportMessageKeyFromRatchet(
    ratchetState,
    message.messageId
  );
  
  // Export message key for moderators
  const keyExport = await encryptMessageKeyForModerators(
    messageKey,
    moderationPublicKey
  );
  
  return {
    messageId: message.messageId,
    originalCiphertext: message.ciphertext,
    encryptedMessageKey: keyExport.encryptedMessageKey,
    keyEphemeralPub: keyExport.keyEphemeralPub,
    iv: message.iv,
    authTag: message.authTag,
    keyIv: keyExport.keyIv,
    keyAuthTag: keyExport.keyAuthTag,
    exportedAt: Date.now(),
    exportMethod: 'ratchet-state-export' // Documents forward secrecy constraint
  };
}
```

### Moderator Decryption Process

#### Step 1: Verify Report Authenticity
```javascript
// Verify report was signed by reporting user
const reportValid = await verifyUserSignature(
  contentReport.userSignature,
  reportTranscriptHash,
  contentReport.reporterUserId
);

if (!reportValid) {
  throw new Error('Invalid content report signature');
}
```

#### Step 2: Decrypt Message Key
```javascript
// Moderator decrypts exported message key
async function decryptMessageKey(evidence, moderatorPrivateKey) {
  // Compute shared secret
  const sharedSecret = await x25519(
    moderatorPrivateKey,
    evidence.keyEphemeralPub
  );
  
  // Derive decryption key
  const decryptionKey = await HKDF(
    'SHA-256',
    sharedSecret,
    'FoxWhisper-Moderation-Key-Export',
    32
  );
  
  // Decrypt message key
  const messageKey = await aesGCMDecrypt(
    decryptionKey,
    evidence.encryptedMessageKey,
    evidence.keyIv,
    evidence.keyAuthTag
  );
  
  return messageKey;
}
```

#### Step 3: Decrypt Message Content
```javascript
// Use decrypted message key to access content
async function decryptReportedMessage(evidence, moderatorPrivateKey) {
  // Get message key
  const messageKey = await decryptMessageKey(evidence, moderatorPrivateKey);
  
  // Decrypt original message
  const plaintext = await aesGCMDecrypt(
    messageKey,
    evidence.originalCiphertext,
    evidence.iv,
    evidence.authTag
  );
  
  return plaintext;
}
```

### Security Properties

#### **No Global Master Key**
- Server never receives reusable decryption keys
- Each report contains only specific message keys
- Compromise of server doesn't enable bulk surveillance

#### **User-Controlled Export**
- Only user's device can reconstruct message keys
- User explicitly chooses which messages to report
- Device must authenticate user before key export

#### **Moderator Access Control**
- Individual moderator keys provide accountability
- Organization keys enable team moderation
- Authority keys provide root of trust

#### **Forward Secrecy Preservation**
- Message keys derived from ratcheted session keys
- Past messages remain secure even if moderator keys compromised
- Key export doesn't compromise session security

### Key Management

#### Moderator Key Registration
```javascript
// Register new moderator with authority
const moderatorRegistration = {
  moderatorId: "UMOD1234567890ABCDEF",
  moderatorPublicKey: moderatorKey.x25519PublicKey,
  organizationId: "ORG1234567890ABCDEF",
  authoritySignature: await authorityKey.sign(
    moderatorId + moderatorPublicKey + organizationId
  )
};
```

#### Organization Key Registration
```javascript
// Register organization moderation key
const orgRegistration = {
  organizationId: "ORG1234567890ABCDEF",
  organizationPublicKey: orgKey.x25519PublicKey,
  authoritySignature: await authorityKey.sign(
    organizationId + organizationPublicKey
  )
};
```

#### Key Revocation
```javascript
// Revoke compromised moderator key
const revocation = {
  moderatorId: "UMOD1234567890ABCDEF",
  revokedAt: Date.now(),
  reason: "key-compromise",
  authoritySignature: await authorityKey.sign(
    "REVOKE:" + moderatorId + ":" + revokedAt
  )
};
```

### Implementation Requirements

#### **Secure Key Storage**
```javascript
// Store moderator keys in hardware
await secureStorage.store('moderator-key-' + moderatorId, {
  privateKey: moderatorPrivateKey,
  requiresAuthentication: true,
  auditLog: true
});
```

#### **Access Logging**
```javascript
// Log all moderation decryption attempts
await auditLog.log({
  event: 'moderation_decryption',
  moderatorId: moderatorId,
  reportId: reportId,
  messageId: messageId,
  timestamp: Date.now(),
  result: 'success' | 'failed'
});
```

#### **Rate Limiting & DoS Protection**

```javascript
// Prevent bulk decryption abuse and service disruption
const rateLimiting = {
  decryptionLimit: {
    perHour: 100,
    perDay: 1000,
    perReport: 50, // Max messages per report
    perDevice: 1000, // Max messages per device per hour
    perSession: 10000   // Max messages per session
  },
  
  dosProtection: {
    maxRatchetStepsPerSecond: 1000, // Prevent CPU exhaustion attacks
    maxBufferedMessages: 100,    // Prevent memory exhaustion
    maxProcessingTimePerMessage: 50,    // Prevent slow loris attacks
    connectionRateLimit: 1000,    // Prevent connection flooding
    messageSizeLimit: 10485760, // 10MB max per message
  },
  
  abuseDetection: {
    spamDetection: {
      metrics: ["messages_per_minute", "rooms_created_per_hour"],
      thresholds: { messagesPerMinute: 30, roomsPerHour: 10 }
    },
    harassmentDetection: {
      metrics: ["unique_users_contacted", "message_frequency_to_same_user"],
      thresholds: { uniqueUsersPerHour: 100, sameUserMessagesPerMinute: 20 }
    },
    coordinationDetection: {
      metrics: ["simultaneous_room_joins", "cross_room_messaging_patterns"],
      thresholds: { simultaneousJoins: 50, crossRoomPattern: 0.8 }
    }
  }
};
```

### Compliance Features

#### **Legal Hold Integration**
```javascript
// Preserve message keys for legal holds
async function preserveForLegalHold(messageEvidence, legalHoldId) {
  await secureStorage.store('legal-hold-' + legalHoldId, {
    encryptedMessageKey: messageEvidence.encryptedMessageKey,
    preservedAt: Date.now(),
    authorizedBy: courtOrderReference,
    expiresAt: legalHoldExpiry
  });
}
```

#### **Audit Trail**
```javascript
// Complete audit trail for moderation actions
const auditRecord = {
  reportId: reportId,
  moderatorId: moderatorId,
  action: 'decrypt_message',
  messageId: messageId,
  timestamp: Date.now(),
  legalHoldId: legalHoldId || null,
  justification: moderationReason
};
```

---

#### Moderator Access
```javascript
// Moderator decrypts reported content using per-message keys
const decryptedContent = await decryptReportedMessage(
  messageEvidence,
  moderatorPrivateKey
);
```

### Zero-Knowledge Moderation

#### Content Analysis Without Decryption
```javascript
// Analyze metadata without accessing content
const analysis = {
  messageFrequency: calculateMessageFrequency(messages),
  patternAnalysis: detectSpamPatterns(messageMetadata),
  networkAnalysis: analyzeConnectionPatterns(userGraph)
};
```

---

## Legal Compliance

### Minimum Retention

#### Automatic Deletion
```javascript
// Schedule deletion based on retention policy
const deletionSchedule = {
  authenticationEvents: 90, // days
  channelParticipation: 365, // days
  routingMetadata: 30 // days
};

await scheduleDeletion(messageData, deletionSchedule[category]);
```

#### Key-Based Data Destruction
```javascript
// Key erasure makes ciphertext permanently undecipherable
await keyBasedDestruction({
  targetData: encryptedMessages,
  method: 'key-invalidation',
  verification: 'ciphertext-unreadable-test'
});

// Delete or invalidate keys; ciphertext becomes permanently undecipherable
async function destroyDataAccess(messageIds) {
  for (const messageId of messageIds) {
    // Delete session keys
    await secureStorage.delete('session-' + getSessionId(messageId));
    
    // Delete message keys
    await secureStorage.delete('message-' + messageId);
    
    // Delete chain keys
    await secureStorage.delete('chain-' + getChainId(messageId));
    
    // Verify ciphertext is now unreadable
    const isUnreadable = await verifyCiphertextUnreadable(messageId);
    if (!isUnreadable) {
      throw new Error('Key destruction failed - data may still be accessible');
    }
  }
}
```

### Legal Hold Capabilities & Limitations

#### **CRITICAL SECURITY PRINCIPLE**

**Legal hold preserves ONLY ciphertext and metadata. Legal hold NEVER grants decryption powers to system does not already have. The server cannot create new access to message content under any circumstances.**

This is a fundamental architectural boundary that preserves end-to-end encryption while enabling legal compliance.

#### Legal Hold Types

##### Type 1: Ciphertext-Only Preservation (ONLY MODE)
- **What is preserved**: Original encrypted messages, metadata, message IDs
- **What is NOT accessible**: Plaintext content, decryption keys
- **Server capability**: Can indefinitely store encrypted messages
- **User privacy**: Complete - no decryption capability created
- **Forward secrecy**: Fully preserved - no key access possible

##### Type 2: Ciphertext Plus User-Submitted Reports
- **What is preserved**: Encrypted messages + user-submitted report bundles
- **Key sources**: ONLY user-voluntarily shared content via reports
- **Server capability**: Can access user-submitted report content only
- **User privacy**: Preserved - no new decryption capability created
- **Forward secrecy**: Fully preserved - no new key generation

#### **FORBIDDEN LEGAL HOLD CAPABILITIES**

The following legal hold capabilities are **ARCHITECTURALLY IMPOSSIBLE** and must never be implemented:

##### ❌ Server-Side Decryption Capability
```javascript
// THIS FUNCTION CANNOT EXIST - would break E2EE
async function decryptForLegalHold(messageId, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Server has no decryption capability - violates E2EE architecture');
}
```

##### ❌ No Key Extraction from Devices
```javascript
// THIS FUNCTION CANNOT EXIST - would violate user privacy
async function extractKeysFromDevice(userId, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Keys are hardware-protected and never leave device');
}
```

##### ❌ No Retroactive Key Export
```javascript
// THIS FUNCTION CANNOT EXIST - would break forward secrecy
async function retroactivelyExportKeys(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Past message keys destroyed by forward secrecy');
}
```

##### ❌ No Bulk Message Access
```javascript
// THIS FUNCTION CANNOT EXIST - would violate E2EE principles
async function bulkDecryptForLegalHold(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: No bulk decryption capability exists');
}
```

##### ❌ No Content Analysis Server-Side
```javascript
// THIS FUNCTION CANNOT EXIST - would require decryption
async function analyzeMessageContentForLegalHold(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Server cannot access message content for analysis');
}
```

#### **⚠️ DANGEROUS: "Ciphertext-Plus-Keys" Mode (FORBIDDEN)**

**The "ciphertext-plus-keys" legal hold mode is explicitly forbidden as it creates forward secrecy erosion:**

```javascript
// THIS MODE IS ARCHITECTURALLY UNSAFE AND MUST NOT BE IMPLEMENTED
const forbiddenLegalHoldMode = {
  name: "ciphertext-plus-keys",
  danger: "Creates retroactive decryption capability",
  forwardSecrecyImpact: "Compromises all past messages if keys are exposed",
  attackSurface: "New attack vector for legal coercion",
  recommendation: "NEVER IMPLEMENT - Use ciphertext-only preservation"
};
```

#### **Forward Secrecy Preservation Requirements**

All legal hold implementations MUST preserve forward secrecy:

```javascript
const forwardSecrecyRequirements = {
  noRetroactiveKeyGeneration: "Cannot generate keys for past messages",
  noKeyDerivationFromSessionKeys: "Cannot derive message keys from session keys",
  noBulkDecryptionCapability: "Cannot decrypt multiple messages at once",
  userControlOnly: "Only user-voluntarily shared content can be accessed",
  temporalLimitation: "Keys exist only while in ratchet state, then destroyed"
};
```

#### **Legal Hold Implementation Verification**

```javascript
// Automated verification that legal hold preserves forward secrecy
function verifyLegalHoldForwardSecrecy(legalHoldImplementation) {
  const violations = [];
  
  // Check for forbidden capabilities
  if (legalHoldImplementation.canDecryptMessages) {
    violations.push("Server has message decryption capability");
  }
  
  if (legalHoldImplementation.canExportKeys) {
    violations.push("Server can export message keys");
  }
  
  if (legalHoldImplementation.canRetroactivelyAccess) {
    violations.push("Server can retroactively access past communications");
  }
  
  if (violations.length > 0) {
    throw new Error(`Legal hold implementation violates forward secrecy: ${violations.join(', ')}`);
  }
  
  return true; // Implementation preserves forward secrecy
}
```

##### ❌ Retroactive Key Export
```javascript
// THIS FUNCTION CANNOT EXIST - Violates forward secrecy
async function retroactivelyExportKeys(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Past keys destroyed by forward secrecy');
}
```

##### ❌ Forced Device Key Extraction
```javascript
// THIS FUNCTION CANNOT EXIST - Violates hardware security
async function extractKeysFromDevice(userId, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Keys are hardware-protected');
}
```

##### ❌ Bulk Decryption Capability
```javascript
// THIS FUNCTION CANNOT EXIST - Violates E2EE architecture
async function decryptMessagesForLegalHold(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Server has no decryption capability');
}
```

#### Legal Hold Implementation

##### Ciphertext-Only Preservation
```javascript
// Preserve encrypted messages without decryption capability
async function placeCiphertextLegalHold(messageIds, legalHoldRequest) {
  for (const messageId of messageIds) {
    // Get encrypted message from storage
    const encryptedMessage = await messageStore.getEncrypted(messageId);
    
    // Mark for preservation with legal hold metadata
    await preservationStore.mark({
      messageId: messageId,
      ciphertext: encryptedMessage.ciphertext,
      metadata: encryptedMessage.metadata,
      legalHoldId: legalHoldRequest.requestId,
      courtOrder: legalHoldRequest.courtOrder,
      preservationPeriod: legalHoldRequest.preservationPeriod,
      holdType: 'ciphertext-only',
      preservedAt: Date.now(),
      expiresAt: Date.now() + (legalHoldRequest.preservationPeriod * 24 * 60 * 60 * 1000)
    });
    
    // Prevent automatic deletion
    await deletionScheduler.exclude(messageId);
  }
}
```

##### Preservation with User-Submitted Reports
```javascript
// Preserve user-submitted report content (only what users voluntarily shared)
async function placeReportPreservationLegalHold(reportIds, legalHoldRequest) {
  for (const reportId of reportIds) {
    // Get user-submitted encrypted report
    const encryptedReport = await reportStore.getEncrypted(reportId);
    
    // Preserve user-voluntarily shared content only
    await preservationStore.mark({
      reportId: reportId,
      encryptedReportBundle: encryptedReport.encryptedReportBundle,
      legalHoldId: legalHoldRequest.requestId,
      courtOrder: legalHoldRequest.courtOrder,
      preservationPeriod: legalHoldRequest.preservationPeriod,
      holdType: 'user-reports-only',
      source: 'user-voluntary-submission',
      preservedAt: Date.now(),
      expiresAt: Date.now() + (legalHoldRequest.preservationPeriod * 24 * 60 * 60 * 1000)
    });
  }
}
```

#### User-Submitted Report Discovery

##### Available Report Sources
```javascript
// Find user-submitted reports for legal hold
async function findUserSubmittedReports(reportId, constraints) {
  const reports = [];
  
  // Check user-submitted content reports
  if (constraints.sources.includes('user-reports')) {
    const userReports = await reportStore.findEncryptedReports(reportId);
    reports.push(...userReports.map(report => ({
      reportId: report.reportId,
      encryptedReportBundle: report.encryptedReportBundle,
      source: 'user-voluntary-report',
      submittedAt: report.timestamp,
      submittedBy: report.reporterUserId,
      reportType: report.reportReason
    })));
  }
  
  // Filter by court order authorization
  return reports.filter(report => 
    isAuthorizedByCourtOrder(report, constraints.courtOrder)
  );
}
```

#### What Legal Hold Cannot Do (ARCHITECTURAL LIMITATIONS)

##### ❌ No Server-Side Decryption Capability
```javascript
// This function CANNOT be implemented - would break E2EE
async function decryptForLegalHold(messageId, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Server has no decryption capability - violates E2EE architecture');
}
```

##### ❌ No Key Extraction from Devices
```javascript
// This function CANNOT be implemented - would violate hardware security
async function extractKeysFromDevice(userId, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Keys are hardware-protected and never leave device');
}
```

##### ❌ No Retroactive Key Export
```javascript
// This function CANNOT be implemented - would break forward secrecy
async function retroactivelyExportKeys(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Past message keys destroyed by forward secrecy');
}
```

##### ❌ No Bulk Message Access
```javascript
// This function CANNOT be implemented - would violate E2EE principles
async function bulkDecryptForLegalHold(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: No bulk decryption capability exists');
}
```

##### ❌ No Content Analysis Server-Side
```javascript
// This function CANNOT be implemented - would require decryption
async function analyzeMessageContentForLegalHold(messageIds, legalHoldRequest) {
  throw new Error('IMPOSSIBLE: Server cannot access message content for analysis');
}
```

#### Voluntary User Cooperation

##### User-Initiated Key Export for Legal Hold
```javascript
// User voluntarily exports message keys for legal proceedings
async function voluntaryKeyExport(messageIds, legalHoldRequest) {
  const userConsent = await requestUserConsent({
    purpose: 'legal-hold-cooperation',
    messageIds: messageIds,
    courtOrder: legalHoldRequest.courtOrder,
    authorizedBy: legalHoldRequest.authorizedBy
  });
  
  if (!userConsent.granted) {
    throw new Error('User consent required for key export');
  }
  
  const exportedKeys = [];
  for (const messageId of messageIds) {
    // User's device reconstructs and exports keys
    const messageKey = reconstructMessageKey(
      getSessionKey(messageId),
      messageId
    );
    
    const keyExport = await encryptForLegalAuthority(
      messageKey,
      legalHoldRequest.authorityPublicKey
    );
    
    exportedKeys.push({
      messageId: messageId,
      encryptedKey: keyExport.encryptedKey,
      exportedAt: Date.now(),
      userConsent: userConsent.recordId
    });
  }
  
  return exportedKeys;
}
```

#### Compliance Verification

##### Legal Hold Audit Trail
```javascript
// Complete audit trail for legal hold actions
const legalHoldAudit = {
  requestId: legalHoldRequest.requestId,
  courtOrder: legalHoldRequest.courtOrder,
  authorizedBy: legalHoldRequest.authorizedBy,
  holdType: legalHoldRequest.holdType,
  targetMessages: legalHoldRequest.targetMessages,
  preservedAt: Date.now(),
  expiresAt: Date.now() + (legalHoldRequest.preservationPeriod * 24 * 60 * 60 * 1000),
  capabilities: {
    canPreserveCiphertext: true,
    canDecryptWithExistingKeys: legalHoldRequest.holdType === 'ciphertext-plus-keys',
    canForceDecryption: false,
    canExtractKeys: false,
    canRetroactivelyExport: false
  }
};
```

##### User Notification
```javascript
// Notify users of legal hold requests affecting their data
async function notifyUserOfLegalHold(userId, legalHoldRequest) {
  await userNotification.send({
    userId: userId,
    type: 'legal-hold-notice',
    content: {
      requestId: legalHoldRequest.requestId,
      courtOrder: legalHoldRequest.courtOrder,
      messageCount: legalHoldRequest.targetMessages.length,
      holdType: legalHoldRequest.holdType,
      preservationPeriod: legalHoldRequest.preservationPeriod,
      capabilities: {
        serverCanPreserveEncryptedMessages: true,
        serverCanDecryptExistingKeys: legalHoldRequest.holdType === 'ciphertext-plus-keys',
        serverCannotForceDecryption: true,
        serverCannotExtractKeys: true
      },
      userRights: {
        canVoluntarilyCooperate: true,
        canChallengeRequest: true,
        canDeleteAfterExpiry: true
      }
    }
  });
}
```

---

## Server Trust Model & Message Routing

### **Critical Security Principle**

**The server operates as a metadata-only routing service. Message content is never accessible server-side, even for moderation or legal compliance. The server cannot decrypt, analyze, or reconstruct message content under any circumstances.**

### Server Capabilities & Limitations

#### **✅ Server CAN:**
- **Route encrypted messages** between devices without decryption
- **Store encrypted payloads** temporarily for delivery (metadata only)
- **Maintain device directories** with signed entries
- **Log authentication events** for security and abuse detection
- **Track participation metadata** (who talks to whom, when)
- **Preserve encrypted messages** for legal holds (ciphertext-only)
- **Handle encrypted user reports** for moderation (no server decryption)
- **Enforce rate limits** and abuse patterns using metadata only

#### **❌ Server CANNOT:**
- **Decrypt any message content** - No technical capability exists
- **Access message keys** - Never stored or accessible server-side
- **Analyze message content** - No content scanning or filtering
- **Retroactively access past communications** - Forward secrecy prevents this
- **Export decryption capabilities** - No key export or generation functions
- **Provide bulk content access** - Even with legal authorization

### Message Routing Architecture

#### **Per-Device Fan-Out Model**
```javascript
// Each device maintains independent sessions with all other devices
const routingModel = {
  messageDelivery: {
    // Server routes encrypted messages to recipient devices
    // No decryption or content inspection during routing
    route: async (encryptedMessage, recipientDeviceIds) => {
      for (const deviceId of recipientDeviceIds) {
        await deliverToDevice(deviceId, encryptedMessage);
      }
    }
  },
  
  sessionManagement: {
    // Server stores only routing metadata, not session keys
    sessionMetadata: {
      sessionId: "S1234567890ABCDEF",
      participants: ["D1", "D2", "D3"], // Device IDs only
      createdAt: 1701763200000,
      lastActivity: 1701766800000,
      messageCount: 150 // Metadata only
    }
  }
};
```

#### **Device Synchronization**
```javascript
// How devices sync message history without server decryption
const deviceSync = {
  // Option A: Per-device direct messaging (recommended)
  directMessaging: {
    description: "Each device sends directly to all other devices",
    serverRole: "routing-only",
    decryption: "client-side-only"
  },
  
  // Option B: Server-assisted metadata routing
  assistedRouting: {
    description: "Server routes messages but cannot decrypt content",
    serverRole: "metadata-routing",
    decryption: "client-side-only",
    messageHistory: "stored-encrypted-only"
  },
  
  // Option C: Hybrid approach
  hybrid: {
    description: "Server routes + stores encrypted messages for offline delivery",
    serverRole: "encrypted-storage-and-routing",
    decryption: "client-side-only",
    storagePolicy: "encrypted-indefinitely-or-until-deletion"
  }
};
```

### Data We Log

#### **Authentication Events**
```javascript
const authLog = {
  userId: "U1234567890ABCDEF",
  deviceId: "DABCDEF1234567890", 
  timestamp: 1701763200000,
  ipAddress: "hashed-ip-for-abuse-detection",
  region: "us-west-2",
  result: "success|failure",
  failureReason: "invalid_credentials|device_revoked"
};
```

#### **Routing & Participation Metadata**
```javascript
const routingLog = {
  userId: "U1234567890ABCDEF",
  roomId: "R1234567890ABCDEF",
  action: "join|leave|message_sent",
  timestamp: 1701763200000,
  messageId: "M1234567890ABCDEF", // for message_sent only
  approximateSize: 1024, // bytes, for resource management
  messageType: "text|file|image" // for abuse pattern detection
};
```

#### **Device Lifecycle Events**
```javascript
const deviceLog = {
  userId: "U1234567890ABCDEF",
  deviceId: "DABCDEF1234567890",
  action: "register|revoke",
  timestamp: 1701763200000,
  deviceType: "ios|android|desktop|web",
  verified: true // for TOFU verification tracking
};
```

### Data We NEVER Log

#### **❌ NEVER LOG - Message Content**
- No plaintext message bodies
- No decrypted message content  
- No message keys or session keys
- No ability to reconstruct message content

#### **❌ NEVER LOG - Cryptographic Material**
- No session keys (even encrypted)
- No message keys (even exported)
- No device private keys
- No user private keys

#### **❌ NEVER LOG - Content Analysis**
- No keyword scanning of message content
- No content-based filtering
- No automated content analysis
- No message content for AI training

### Security Properties

#### **Abuse Pattern Detection**
```javascript
// We can detect abuse patterns without reading content
const abusePatterns = {
  spamDetection: {
    metrics: ["messages_per_minute", "rooms_created_per_hour"],
    thresholds: { messagesPerMinute: 30, roomsPerHour: 10 }
  },
  harassmentDetection: {
    metrics: ["unique_users_contacted", "message_frequency_to_same_user"],
    thresholds: { uniqueUsersPerHour: 100, sameUserMessagesPerMinute: 20 }
  },
  coordinationDetection: {
    metrics: ["simultaneous_room_joins", "cross_room_messaging_patterns"],
    thresholds: { simultaneousJoins: 50, crossRoomPattern: 0.8 }
  }
};
```

#### **Law Enforcement Compliance**
```javascript
// What we can provide to law enforcement
const availableToLawEnforcement = {
  accountInformation: {
    userId: "U1234567890ABCDEF",
    registrationDate: 1701763200000,
    deviceHistory: ["D1", "D2", "D3"], // Device IDs
    lastLoginTimes: [1701763200000, 1701766800000]
  },
  
  routingMetadata: {
    messageIds: ["M123", "M124", "M125"], // Message IDs only
    timestamps: [1701763200000, 1701763260000], // When messages were sent
    roomParticipation: {
      "ROOM1": {joined: 1701763200000, left: 1701766800000},
      "ROOM2": {joined: 1701763400000, left: null} // Still in room
    },
    networkMetadata: {
      ipRegions: ["us-west-2", "eu-central-1"], // Hashed IPs for abuse detection
      messageSizes: [1024, 2048, 512], // Bytes for resource analysis
      messageTypes: ["text", "file", "image"] // For pattern detection
    }
  },
  
  userSubmittedReports: {
    reportIds: ["R123", "R124"], // User voluntarily submitted reports
    submissionTimes: [1701763200000, 1701763300000],
    reportTypes: ["harassment", "spam"], // Report categories
    encryptedContent: "base64-encrypted-user-reports" // Only if user submitted
  },
  
  technicalLimitations: {
    messageContent: "Server cannot decrypt or access message content",
    messageKeys: "Server has no access to message or session keys",
    retroactiveAccess: "Forward secrecy prevents access to past communications",
    bulkDecryption: "No technical capability for bulk content access"
  }
};
```

#### **Routing & Participation Metadata**
```javascript
const routingLog = {
  userId: "U1234567890ABCDEF",
  roomId: "R1234567890ABCDEF",
  action: "join|leave|message_sent",
  timestamp: 1701763200000,
  messageId: "M1234567890ABCDEF", // for message_sent only
  approximateSize: 1024, // bytes, for resource management
  messageType: "text|file|image" // for abuse pattern detection
};
```

#### **Device Lifecycle Events**
```javascript
const deviceLog = {
  userId: "U1234567890ABCDEF",
  deviceId: "DABCDEF1234567890",
  action: "register|revoke",
  timestamp: 1701763200000,
  deviceType: "ios|android|desktop|web",
  verified: true // for TOFU verification tracking
};
```

### Data We NEVER Log

#### **❌ NEVER LOG - Message Content**
- No plaintext message bodies
- No decrypted message content  
- No message keys or session keys
- No ability to reconstruct message content

#### **❌ NEVER LOG - Cryptographic Material**
- No session keys (even encrypted)
- No message keys (even exported)
- No device private keys
- No user private keys

#### **❌ NEVER LOG - Content Analysis**
- No keyword scanning of message content
- No content-based filtering
- No automated content analysis
- No message content for AI training

### Security Properties

#### **Abuse Pattern Detection**
```javascript
// We can detect abuse patterns without reading content
const abusePatterns = {
  spamDetection: {
    metrics: ["messages_per_minute", "rooms_created_per_hour"],
    thresholds: { messagesPerMinute: 30, roomsPerHour: 10 }
  },
  harassmentDetection: {
    metrics: ["unique_users_contacted", "message_frequency_to_same_user"],
    thresholds: { uniqueUsersPerHour: 100, sameUserMessagesPerMinute: 20 }
  },
  coordinationDetection: {
    metrics: ["simultaneous_room_joins", "cross_room_messaging_patterns"],
    thresholds: { simultaneousJoins: 50, crossRoomPattern: 0.8 }
  }
};
```

#### **Law Enforcement Compliance**
```javascript
// What we can provide to law enforcement
const legalCompliance = {
  available: [
    "Account information and registration data",
    "Authentication timestamps and IP regions", 
    "Room participation history (who talked to whom, when)",
    "Message routing metadata (message IDs, timestamps, sizes)",
    "Device registration and revocation history",
    "User-submitted reports with voluntarily shared content"
  ],
  unavailable: [
    "Message content or plaintext",
    "Decryption of stored messages", 
    "Session or message keys",
    "Retroactive access to encrypted communications"
  ]
};
```

---

## Threat Model & Security Analysis

### **Attacker Capabilities**

#### **Passive Surveillance**
- **Capability**: Can intercept and store all communications
- **Attack Surface**: Network traffic monitoring, server compromise, ISP cooperation
- **Mitigation**: Hybrid encryption (X25519 + Kyber-768) requires breaking both classical and post-quantum cryptography
- **Impact**: Can read all future communications if quantum computers become available

#### **Active Network Attacks**
- **Capability**: Can modify, drop, inject, or replay messages
- **Attack Surface**: Man-in-the-middle attacks, protocol downgrade attacks, ciphertext splicing
- **Mitigation**: 
  - **Transcript binding**: All handshake fields signed and hashed
  - **AAD authentication**: Ciphertext bound to specific context prevents splicing
  - **Replay protection**: Message IDs + counters + timestamps
  - **Algorithm agility**: Versioned algorithms prevent downgrade attacks

#### **Quantum Attacks**
- **Capability**: Access to quantum computers capable of breaking classical cryptography
- **Attack Surface**: X25519 discrete logarithm problem, elliptic curve attacks
- **Mitigation**: 
  - **Post-quantum KEM**: Kyber-768 resistant to known quantum algorithms
  - **Hybrid approach**: Even if Kyber is broken, X25519 still provides security
  - **Algorithm agility**: Can migrate to stronger post-quantum schemes

#### **Device Compromise**
- **Capability**: Physical access to user devices or extraction of cryptographic material
- **Attack Surface**: Malware installation, hardware extraction, side-channel attacks
- **Mitigation**:
  - **Hardware-anchored keys**: Private keys never leave TPM/Secure Enclave
  - **Device revocation**: Compromised devices can be immediately revoked
  - **Forward secrecy**: Past messages remain secure even with device compromise

#### **Insider Threats**
- **Capability**: Malicious administrators, moderators, or system operators
- **Attack Surface**: Server-side key access, bulk data export, configuration manipulation
- **Mitigation**:
  - **Zero decryption capability**: Server has no technical ability to decrypt messages
  - **Comprehensive audit logging**: All administrative actions are logged
  - **Role-based access**: Different roles have different privilege levels
  - **Multi-person approval**: Sensitive actions require multiple approvals

### **Security Properties**

#### **Confidentiality**
- **Message Content**: End-to-end encrypted, accessible only to intended recipients
- **Metadata Protection**: Routing metadata is protected but may be accessible for abuse detection
- **Identity Protection**: User identities are cryptographically bound to devices

#### **Integrity**
- **Message Authentication**: AES-256-GCM with AAD prevents tampering
- **Transcript Binding**: Handshake messages are signed and hashed
- **Replay Protection**: Unique message IDs and counters prevent replay attacks

#### **Forward Secrecy**
- **Session Key Rotation**: Periodic ratcheting limits exposure from key compromise
- **Message Key Destruction**: Per-message keys are destroyed after use
- **Post-Compromise Security**: Asymmetric ratcheting provides protection after session compromise

#### **Availability**
- **Denial of Service Protection**: Rate limiting and DoS protection prevent service disruption
- **Secure Key Recovery**: Backup and recovery mechanisms for key material
- **Geographic Distribution**: Multiple server regions prevent single-point failures

### **Vulnerability Resistance**

#### **Protocol Downgrade Resistance**
- **Version Negotiation**: All messages include protocol version in AAD
- **Algorithm Agility**: Support for multiple cryptographic algorithms
- **Backward Compatibility**: Graceful handling of different client versions

#### **Implementation Attacks**
- **Supply Chain Attacks**: Use of well-vetted cryptographic libraries
- **Side-Channel Resistance**: Constant-time implementations and hardware protection
- **Social Engineering**: User education and clear security indicators

### **Risk Assessment**

#### **High Risk Areas**
1. **Quantum Transition**: Migration to post-quantum cryptography while maintaining compatibility
2. **Key Management**: Secure generation, storage, and rotation of cryptographic keys
3. **Protocol Complexity**: Complex state management increases implementation error risk
4. **Side-Channel Attacks**: Implementation vulnerabilities in cryptographic operations

#### **Medium Risk Areas**
1. **Metadata Analysis**: Balancing abuse detection with privacy preservation
2. **Cross-Platform Interoperability**: Ensuring consistent behavior across different implementations
3. **Performance Optimization**: Balancing security with computational efficiency
4. **User Experience**: Security features must not compromise usability

#### **Low Risk Areas**
1. **Algorithm Selection**: Choosing appropriate cryptographic parameters for security vs performance
2. **Configuration Management**: Secure deployment and configuration of security parameters
3. **Testing and Validation**: Comprehensive security testing and code review processes

### **🚫 CRITICAL: No Decrypt On Demand Architecture**

**The FoxWhisper server has NO ABILITY to decrypt stored messages, even with legal authorization. This is a fundamental architectural constraint that cannot be bypassed.**

### **Server Has Zero Decryption APIs**

#### ❌ No Internal Decryption Functions
```javascript
// THESE FUNCTIONS DO NOT EXIST AND CANNOT BE IMPLEMENTED
const serverCapabilities = {
  decryptMessage: false,        // Cannot decrypt any message
  deriveMessageKeys: false,      // Cannot derive keys from session keys
  accessSessionKeys: false,       // Cannot access session keys
  bulkDecryption: false,         // Cannot bulk decrypt messages
  retroactiveAccess: false,       // Cannot access past messages
  contentAnalysis: false,         // Cannot analyze message content
  keyExport: false               // Cannot export any keys
};
```

#### ❌ No Emergency Decryption Procedures
```javascript
// THESE PROCEDURES DO NOT EXIST
const emergencyProcedures = {
  courtOrderDecryption: "IMPOSSIBLE - No decryption capability",
  nationalSecurityRequest: "IMPOSSIBLE - No decryption capability", 
  lawEnforcementAccess: "IMPOSSIBLE - No decryption capability",
  adminOverrideDecryption: "IMPOSSIBLE - No decryption capability"
};
```

#### ❌ No Backdoor Mechanisms
```javascript
// THESE MECHANISMS DO NOT EXIST AND CANNOT BE ADDED
const backdoorChecks = {
  masterKeyExists: false,           // No master decryption key
  debugDecryptionMode: false,       // No debug decryption
  specialAccessFunctions: false,     // No special access APIs
  hiddenDecryptionPaths: false,     // No hidden decryption methods
  emergencyOverrideCodes: false       // No emergency override codes
};
```

### **What Server CAN Provide to Law Enforcement**

#### ✅ Metadata and Routing Information
```javascript
const availableToLawEnforcement = {
  accountInformation: {
    userId: "U1234567890ABCDEF",
    registrationDate: 1701763200000,
    deviceHistory: ["D1", "D2", "D3"], // Device IDs
    lastLoginTimes: [1701763200000, 1701766800000]
  },
  
  routingMetadata: {
    messageIds: ["M123", "M124", "M125"], // Message IDs only
    timestamps: [1701763200000, 1701763260000], // When messages were sent
    roomParticipation: {
      "ROOM1": {joined: 1701763200000, left: 1701766800000},
      "ROOM2": {joined: 1701763400000, left: null} // Still in room
    },
    networkMetadata: {
      ipRegions: ["us-west-2", "eu-central-1"], // Hashed IPs for abuse detection
      messageSizes: [1024, 2048, 512], // Bytes for resource analysis
      messageTypes: ["text", "file", "image"] // For pattern detection
    }
  },
  
  userSubmittedReports: {
    reportIds: ["R123", "R124"], // User voluntarily submitted reports
    submissionTimes: [1701763200000, 1701763300000],
    reportTypes: ["harassment", "spam"], // Report categories
    encryptedContent: "base64-encrypted-user-reports" // Only if user submitted
  }
};
```

### **Legal Response Template**

When served with a subpoena or court order, FoxWhisper can truthfully respond:

```javascript
const legalResponse = {
  available: [
    "Account registration and authentication logs",
    "Device registration and revocation history", 
    "Message routing metadata (IDs, timestamps, room participation)",
    "Network abuse patterns and connection metadata",
    "User-submitted reports with voluntarily shared content"
  ],
  
  unavailable: [
    "Message content or plaintext",
    "Decryption of stored messages",
    "Session or message keys",
    "Retroactive access to encrypted communications",
    "Bulk content analysis or scanning"
  ],
  
  technicalExplanation: "FoxWhisper uses end-to-end encryption with forward secrecy. " +
    "Message content is encrypted with keys that never leave user devices. " +
    "The server has no technical capability to decrypt stored messages, " +
    "even with legal authorization. Only content that users voluntarily " +
    "share via reports can be accessed."
};
```

### **Implementation Verification**

#### ✅ Code Review Requirements
```javascript
// MUST verify these functions DO NOT exist anywhere in codebase
const forbiddenFunctions = [
  'decryptMessage',
  'deriveMessageKey', 
  'accessSessionKeys',
  'bulkDecryptMessages',
  'emergencyDecryption',
  'backdoorAccess',
  'masterKeyDecrypt',
  'debugModeDecrypt'
];

// Automated test to ensure no decryption capabilities
function verifyNoDecryptionCapabilities() {
  for (const funcName of forbiddenFunctions) {
    if (typeof global[funcName] === 'function') {
      throw new Error(`FORBIDDEN: ${funcName} exists - violates E2EE architecture`);
    }
  }
  return true; // All checks passed
}
```

#### ✅ Security Audit Requirements
```javascript
// Must verify in security audits
const auditCheckpoints = {
  codeReview: "No decryption functions found in codebase",
  infrastructureAudit: "No decryption keys stored on servers",
  accessControlAudit: "No admin access to message content",
  networkAudit: "No decryption APIs exposed in network services",
  employeeAccess: "No employee access to decryption tools",
  backupAudit: "No decryption keys in backups (metadata only)"
};
```

---

## Error Handling & Failure Modes

### **Error Classification System**

#### **Critical Errors (Security Critical)**
```javascript
const criticalErrors = {
  HANDSHAKE_INVALID_SIGNATURE: {
    code: 1001,
    severity: "critical",
    retryable: false,
    userAction: "contact-support",
    description: "Handshake signature verification failed - possible attack",
    recovery: "manual-intervention"
  },
  
  SESSION_KEY_COMPROMISE: {
    code: 2001,
    severity: "critical",
    retryable: false,
    userAction: "re-handshake",
    description: "Session key material inconsistent - possible state corruption",
    recovery: "clear-session-state"
  },
  
  DEVICE_REVOKED: {
    code: 3001,
    severity: "critical",
    retryable: false,
    userAction: "verify-device-revocation",
    description: "Device appears in revocation list - possible compromise",
    recovery: "device-recovery-process"
  },
  
  FORWARD_SECRECY_VIOLATION: {
    code: 4001,
    severity: "critical",
    retryable: false,
    userAction: "restart-session",
    description: "Forward secrecy violation detected - possible protocol error",
    recovery: "session-recovery"
  }
};
```

#### **Recoverable Errors (High Priority)**
```javascript
const recoverableErrors = {
  NETWORK_TIMEOUT: {
    code: 2002,
    severity: "high",
    retryable: true,
    userAction: "retry-connection",
    description: "Network timeout - message may be delivered later",
    recovery: "automatic-retry"
  },
  
  TEMPORARY_KEY_UNAVAILABLE: {
    code: 2003,
    severity: "high",
    retryable: true,
    userAction: "wait-and-retry",
    description: "Temporary key unavailability - hardware busy",
    recovery: "wait-for-hardware"
  },
  
  ASYMMETRIC_RATCHET_LIMIT: {
    code: 2004,
    severity: "high",
    retryable: false,
    userAction: "reduce-message-frequency",
    description: "Too many ratchet steps - possible DoS attack",
    recovery: "manual-intervention"
  }
};
```

#### **User Errors (Medium Priority)**
```javascript
const userErrors = {
  DEVICE_NOT_TRUSTED: {
    code: 3001,
    severity: "medium",
    retryable: false,
    userAction: "verify-safety-number",
    description: "Device identity not trusted - verify out-of-band",
    recovery: "manual-verification"
  },
  
  USER_CONSENT_REQUIRED: {
    code: 3002,
    severity: "medium",
    retryable: false,
    userAction: "provide-consent",
    description: "User consent required for this operation",
    recovery: "user-education"
  }
};
```

### **System Errors (Low Priority)**
```javascript
const systemErrors = {
  RATE_LIMIT_EXCEEDED: {
    code: 5001,
    severity: "low",
    retryable: true,
    userAction: "wait-and-retry",
    description: "Rate limit exceeded - please wait",
    recovery: "automatic-backoff"
  },
  
  STORAGE_UNAVAILABLE: {
    code: 5002,
    severity: "low",
    retryable: true,
    userAction: "check-storage-space",
    description: "Storage unavailable - check device storage",
    recovery: "restart-application"
  }
};
```

### **Error Recovery Procedures**

#### **Critical Error Recovery**
```javascript
// Immediate security lockdown
async function handleCriticalError(error, context) {
  // 1. Log security event
  await securityLogger.logCritical({
    event: 'critical_error',
    error: error.code,
    context: context,
    timestamp: Date.now(),
    userAction: error.userAction
  });
  
  // 2. Invalidate potentially compromised state
  if (error.code === SESSION_KEY_COMPROMISE) {
    await invalidateAllSessions();
  }
  
  // 3. Notify user
  await userNotification.show({
    type: 'security_alert',
    title: 'Critical Security Error',
    message: error.description,
    action: error.userAction
  });
  
  // 4. Prevent further operations
  throw new SecurityError(error.code, error.description);
}
```

#### **Recoverable Error Recovery**
```javascript
async function handleRecoverableError(error, context) {
  // 1. Log error with context
  await securityLogger.logError({
    event: 'recoverable_error',
    error: error.code,
    context: context,
    timestamp: Date.now(),
    userAction: error.userAction
  });
  
  // 2. Attempt recovery based on error type
  const recovery = await determineRecoveryStrategy(error);
  await executeRecovery(recovery, context);
  
  // 3. If recovery fails, escalate to critical error
  if (!recovery.success) {
    await handleCriticalError(error, context);
  }
}
```

#### **Recovery Strategy Selection**
```javascript
async function determineRecoveryStrategy(error) {
  switch (error.code) {
    case 'NETWORK_TIMEOUT':
      return {
        strategy: 'automatic-retry',
        maxRetries: 3,
        backoffMs: 5000
      };
    
    case 'TEMPORARY_KEY_UNAVAILABLE':
      return {
        strategy: 'wait-for-hardware',
        maxWaitTime: 30000, // 30 seconds
        checkInterval: 5000
        };
    
    case 'ASYMMETRIC_RATCHET_LIMIT':
      return {
        strategy: 'manual-intervention',
        userAction: 'reduce-message-frequency',
        maxGap: 32
        };
    
    case 'DEVICE_REVOKED':
      return {
        strategy: 'device-recovery-process',
        userAction: 'verify-device-revocation'
        };
    
    default:
      return {
        strategy: 'automatic-retry',
        maxRetries: 3
      };
  }
}
```

#### **Recovery Execution**
```javascript
async function executeRecovery(recovery, context) {
  switch (recovery.strategy) {
    case 'automatic-retry':
      return await automaticRetry(recovery, context);
    
    case 'wait-for-hardware':
      return await waitForHardware(recovery, context);
    
    case 'manual-intervention':
      return await manualIntervention(recovery, context);
    
    case 'device-recovery-process':
      return await deviceRecovery(recovery, context);
    
    default:
      return await automaticRetry(recovery, context);
  }
}
```

### **User Experience Guidelines**

#### **Error Communication**
```javascript
const errorCommunication = {
  critical: {
    title: "Security Alert",
    message: "A critical security error occurred. Your messages remain secure.",
    action: "Please verify your device security settings.",
    icon: "security-alert"
  },
  
  high: {
    title: "Connection Issue",
    message: "Unable to establish secure connection. Retrying...",
    action: "Please check your network connection.",
    icon: "connection-issue"
  },
  
  medium: {
    title: "Device Error",
    message: "A device error occurred. Please restart the app.",
    action: "Please restart the application.",
    icon: "device-error"
  },
  
  low: {
    title: "Temporary Issue",
    message: "A temporary error occurred. Please try again.",
    action: "Please try again in a moment.",
    icon: "temporary-issue"
  }
};
```

#### **Security Education**
```javascript
const securityEducation = {
  deviceSecurity: {
    title: "Device Security",
    message: "Your device's security features are active and protecting your messages.",
    action: "Continue using current security settings.",
    icon: "device-security"
  },
  
  forwardSecrecy: {
    title: "Forward Secrecy",
    message: "FoxWhisper uses forward secrecy to protect your messages. Past messages remain secure even if devices are compromised.",
    action: "Learn more about our security model.",
    icon: "forward-secrecy"
  }
};
```

### Protocol Errors

#### Handshake Failures
```json
{
  "type": "HANDSHAKE_ERROR",
  "code": "INVALID_SIGNATURE",
  "message": "Signature verification failed",
  "retryable": false
}
```

#### Session Errors
```json
{
  "type": "SESSION_ERROR",
  "code": "SESSION_EXPIRED",
  "message": "Session key expired",
  "action": "REHANDSHAKE"
}
```

### Recovery Procedures

#### Automatic Recovery
- Retry failed handshakes with exponential backoff
- Fallback to classical-only if PQC fails
- Re-establish sessions after network interruptions

#### Manual Recovery
- User-initiated session reset
- Device re-authentication
- Key re-provisioning

---

## Performance Considerations

### Optimization Targets

#### Handshake Performance
- X25519: <1ms
- Kyber-768: <3ms
- Combined handshake: <5ms total

#### Message Throughput
- Encryption: <0.1ms per message
- Decryption: <0.1ms per message
- Session key rotation: <10ms

#### Storage Overhead
- Public keys: 32B (X25519) + 1.2KB (Kyber-768)
- Session keys: 32B per session
- Message overhead: 28B (IV + auth tag)

### Scalability

#### Concurrent Sessions
- Support 100+ concurrent sessions per user
- Memory usage: <10MB for session management
- CPU usage: <5% for crypto operations

---

## Security Analysis

### Threat Model

### Adversarial Capabilities
- **Passive Surveillance**: Can intercept and store all communications
- **Active Attacks**: Can modify, drop, or inject messages
- **Quantum Attacks**: Has access to quantum computers
- **Compromised Devices**: Can extract data from user devices
- **Insider Threats**: Malicious moderators or system administrators

### Mitigation Strategies

#### Against Passive Surveillance
- **Hybrid Encryption**: Requires breaking both X25519 and Kyber
- **Forward Secrecy**: Compromise of long-term keys doesn't reveal past messages
- **Hardware Protection**: Keys cannot be extracted from devices
- **Identity Compartmentalization**: Device compromise doesn't reveal user identity

#### Against Active Attacks
- **Message Authentication**: AES-GCM provides integrity protection
- **Identity Verification**: All protocol messages signed by user identity
- **Device Binding**: Device keys cryptographically bound to user identity
- **Replay Protection**: Message IDs prevent replay attacks

#### Against Quantum Attacks
- **Post-Quantum KEM**: Kyber is resistant to known quantum algorithms
- **Hybrid Approach**: Even if Kyber is broken, X25519 provides security
- **Key Sizes**: Large enough to resist Grover's algorithm

#### Against Identity Attacks
- **User Identity Protection**: User identity keys never leave hardware
- **Device Revocation**: Compromised devices can be revoked without account loss
- **Signature Verification**: All identity claims verified through cryptographic signatures
- **Binding Verification**: Device-to-user bindings cryptographically verified

#### Against Legal Compromise
- **No Forced Decryption**: Server cannot decrypt messages without user cooperation
- **No Key Extraction**: Hardware-protected keys cannot be extracted from devices
- **No Retroactive Access**: Forward secrecy prevents access to past messages
- **Limited Legal Hold**: Only preserves existing ciphertext and voluntarily exported keys

---

## Testing Strategy

### Unit Testing

#### Cryptographic Operations
- Test all key generation and agreement operations
- Verify correct encryption/decryption results
- Test edge cases and error conditions

#### Protocol Messages
- Validate message format compliance
- Test serialization/deserialization
- Verify signature generation and verification

### Integration Testing

#### End-to-End Scenarios
- Complete handshake and message exchange
- Multi-device synchronization
- Cross-platform compatibility

#### Safety Features
- Report generation and moderator access
- Legal hold preservation and deletion
- Compliance workflow testing

### Security Testing

#### Penetration Testing
- Attempt to break encryption
- Test for protocol vulnerabilities
- Verify resistance to known attacks

#### Performance Testing
- Measure handshake latency
- Test message throughput
- Validate scalability targets

---

## Roadmap – Crypto & Core Protocol

### Phase 1: Core Cryptographic Foundation (Weeks 1-4)
- [ ] Implement hybrid key agreement (X25519 + Kyber-768)
- [ ] Define message types and CBOR wire format
- [ ] Create session management with symmetric ratchet
- [ ] Implement AAD-based message encryption
- [ ] Add identity hierarchy and device management

### Phase 2: Hardware Integration & Security (Weeks 5-8)
- [ ] TPM/Secure Enclave integration for key storage
- [ ] Hardware-backed identity and device key operations
- [ ] Implement device registration and revocation
- [ ] Add secure key destruction mechanisms
- [ ] Create audit logging for all cryptographic operations

### Phase 3: Privacy-Preserving Safety (Weeks 9-12)
- [ ] Implement moderation key export system
- [ ] Create legal hold with ciphertext-only preservation
- [ ] Add voluntary user cooperation mechanisms
- [ ] Build compliance audit trails
- [ ] Implement key-based data destruction

### Phase 4: Testing & Validation (Weeks 13-16)
- [ ] Comprehensive security testing and penetration testing
- [ ] Performance benchmarking and optimization
- [ ] Cross-platform compatibility validation
- [ ] Formal security review and certification preparation

---

## Roadmap – Product Phases

### Phase 1: Public Demo & Community (Weeks 1-8)
- [ ] **Core Quantum Protocol**
  - [ ] Hybrid key agreement implementation
  - [ ] Cross-platform apps (iOS, Android, Desktop)
  - [ ] Matrix-style room model for groups
  - [ ] Username-only registration system

- [ ] **Privacy-First Features**
  - [ ] Community-driven moderation
  - [ ] Plausible deniability tools
  - [ ] Metadata protection mechanisms
  - [ ] Creative expression and personas

### Phase 2: Enterprise & News Corp (Weeks 9-16)
- [ ] **Reporter Protection System**
  - [ ] Source protection with quantum-resistant messaging
  - [ ] Field operations (offline/low-bandwidth mode)
  - [ ] Emergency safety protocols
  - [ ] Chain of custody tracking

- [ ] **Enterprise Infrastructure**
  - [ ] SSO integration (SAML/OIDC)
  - [ ] Hardware key management (TPM/Secure Enclave)
  - [ ] Admin dashboard and audit systems
  - [ ] Multi-region self-hosting capabilities

### Phase 3: Advanced Features (Weeks 17-24)
- [ ] **Advanced Security**
  - [ ] Quantum-resistant group messaging
  - [ ] Zero-knowledge proof systems
  - [ ] Advanced metadata protection
  - [ ] Cross-device hardware synchronization

- [ ] **Advanced Enterprise**
  - [ ] Newsroom workflow integration
  - [ ] International jurisdiction support
  - [ ] High-availability clustering
  - [ ] Advanced compliance automation

---

## Technical Implementation Priorities

### 1. Core Protocol Foundation (Critical Path)
```javascript
// Implementation order for quantum protocol
const implementationOrder = {
  week1_2: {
    task: "Hybrid Key Agreement",
    deliverable: "X25519 + Kyber-768 KEM working",
    tests: ["unit_tests", "integration_tests"]
  },
  
  week3_4: {
    task: "Session Management", 
    deliverable: "Signal-style ratchet implementation",
    tests: ["session_lifecycle", "forward_secrecy"]
  },
  
  week5_6: {
    task: "Message Encryption",
    deliverable: "AES-256-GCM with proper authentication",
    tests: ["encryption_correctness", "performance_benchmarks"]
  },
  
  week7_8: {
    task: "Basic Apps",
    deliverable: "iOS/Android/Desktop with core messaging",
    tests: ["cross_platform_compatibility", "user_acceptance"]
  }
};
```

### 2. Public Demo Features (Parallel Development)
```javascript
// Community features that test enterprise capabilities
const communityFeatures = {
  privacy: {
    registration: "username_only_system",
    moderation: "community_driven_reporting",
    deniability: "metadata_protection_tools",
    timeline: "weeks_5_8"
  },
  
  community: {
    groups: "invite_only_rooms",
    expression: "creative_tools_and_personas",
    collaboration: "rich_media_sharing",
    timeline: "weeks_6_10"
  }
};
```

### 3. Enterprise Features (Following Core)
```javascript
// News Corp specific implementation
const newsCorpFeatures = {
  reporterProtection: {
    sourceEncryption: "quantum_resistant_messaging",
    fieldOperations: "offline_low_bandwidth_mode",
    emergencyProtocols: "reporter_safety_features",
    timeline: "weeks_9_12"
  },
  
  enterpriseInfrastructure: {
    ssoIntegration: "active_directory_sync",
    hardwareKeys: "tpm_secure_enclave_support",
    complianceTools: "legal_hold_and_audit_systems",
    timeline: "weeks_11_14"
  }
};
```

---

## Algorithm Agility

### Versioned Algorithm Support

**FoxWhisper supports algorithm agility through versioned algorithm identifiers, enabling upgrades from current algorithms (Kyber-768, Ed25519) to future post-quantum schemes without breaking compatibility.**

### Algorithm Identification

#### Message Format with Algorithm Versions
```javascript
const algorithmicMessage = {
  version: 1,
  type: "HYBRID_HANDSHAKE_INIT",
  algorithms: {
    kem_alg: "KYBER-768",
    kem_version: 1,
    sig_alg: "ED25519", 
    sig_version: 1,
    enc_alg: "AES-256-GCM",
    enc_version: 1,
    kdf_alg: "HKDF-SHA256",
    kdf_version: 1
  },
  // ... rest of message
};
```

#### Supported Algorithm Combinations
```javascript
const algorithmRegistry = {
  kem: {
    "KYBER-768": {
      version: 1,
      publicKeySize: 1184,
      ciphertextSize: 1568,
      securityLevel: 128
    },
    "KYBER-1024": {
      version: 1, 
      publicKeySize: 1568,
      ciphertextSize: 2048,
      securityLevel: 192
    },
    "FUTURE-KEM": {
      version: 2,
      upgradePath: "from-KYBER-768"
    }
  },
  
  signature: {
    "ED25519": {
      version: 1,
      signatureSize: 64,
      publicKeySize: 32,
      securityLevel: 128
    },
    "HYBRID-ED25519-DILITHIUM": {
      version: 2,
      signatureSize: 64 + 2420,
      publicKeySize: 32 + 1312,
      securityLevel: 128
    }
  },
  
  encryption: {
    "AES-256-GCM": {
      version: 1,
      keySize: 32,
      ivSize: 12,
      tagSize: 16
    }
  }
};
```

### Algorithm Negotiation

#### Handshake Algorithm Advertisement
```javascript
// Client advertises supported algorithms
const algorithmSupport = {
  supported_kem: ["KYBER-768", "KYBER-1024"],
  supported_sig: ["ED25519"],
  supported_enc: ["AES-256-GCM"],
  supported_kdf: ["HKDF-SHA256"],
  preferred_kem: "KYBER-768",
  preferred_sig: "ED25519"
};
```

#### Algorithm Selection Logic
```javascript
// Server selects strongest mutually supported algorithm
function selectAlgorithms(clientSupport, serverSupport) {
  return {
    kem: selectStrongest(clientSupport.supported_kem, serverSupport.supported_kem),
    sig: selectStrongest(clientSupport.supported_sig, serverSupport.supported_sig),
    enc: selectStrongest(clientSupport.supported_enc, serverSupport.supported_enc),
    kdf: selectStrongest(clientSupport.supported_kdf, serverSupport.supported_kdf)
  };
}
```

### Migration Path

#### Upgrading from Kyber-768 to Future KEM
```javascript
// Phase 1: Support both algorithms during transition
const transitionHandshake = {
  algorithms: {
    kem_alg: "HYBRID-KYBER-768-FUTURE",
    kem_version: 2,
    components: [
      { alg: "KYBER-768", version: 1 },
      { alg: "FUTURE-KEM", version: 1 }
    ]
  }
};

// Phase 2: Deprecate old algorithm
const futureHandshake = {
  algorithms: {
    kem_alg: "FUTURE-KEM",
    kem_version: 1
  }
};
```

#### Upgrading Identity Keys
```javascript
// Hybrid identity during transition
const hybridIdentity = {
  algorithms: {
    sig_alg: "HYBRID-ED25519-DILITHIUM",
    sig_version: 2
  },
  signatures: {
    ed25519_signature: "classical-signature",
    dilithium_signature: "post-quantum-signature"
  }
};
```

### Backward Compatibility

#### Version Negotiation
```javascript
// Ensure older clients can communicate during transition
function ensureCompatibility(messageVersion, clientVersion) {
  if (messageVersion > clientVersion) {
    // Downgrade to supported version
    return {
      supportedVersion: clientVersion,
      fallbackAlgorithms: getLegacyAlgorithms(clientVersion)
    };
  }
  
  return { compatible: true };
}
```

#### Graceful Deprecation
```javascript
// Deprecation timeline for old algorithms
const deprecationSchedule = {
  "KYBER-768": {
    announced: "2025-12-01",
    deprecated: "2026-06-01",
    disabled: "2027-01-01",
    replacement: "FUTURE-KEM"
  }
};
```

### Implementation Requirements

#### Algorithm Registry
```javascript
// Centralized algorithm management
class AlgorithmRegistry {
  static getKEM(algId, version) {
    const kem = this.registry.kem[algId];
    if (!kem || kem.version !== version) {
      throw new Error(`Unsupported KEM: ${algId} v${version}`);
    }
    return kem;
  }
  
  static isSupported(algType, algId, version) {
    const alg = this.registry[algType]?.[algId];
    return alg && alg.version === version;
  }
}
```

#### Security Level Validation
```javascript
// Ensure algorithm combinations meet security requirements
function validateSecurityLevel(algorithms) {
  const minSecurityLevel = 128; // bits
  
  const kemSecurity = getKEMSecurityLevel(algorithms.kem_alg);
  const sigSecurity = getSignatureSecurityLevel(algorithms.sig_alg);
  const encSecurity = getEncryptionSecurityLevel(algorithms.enc_alg);
  
  return Math.min(kemSecurity, sigSecurity, encSecurity) >= minSecurityLevel;
}
```

---

## Trust and Key Discovery

### **Trust Model: TOFU + Optional Server Directory**

**FoxWhisper v1 uses Trust On First Use (TOFU) with server-hosted key directory for key discovery. This provides a tractable implementation while maintaining user security and clear UX patterns.**

#### TOFU Security Limitations

**Directory Compromise Risk**: If the key directory is compromised or coerced, TOFU can distribute malicious keys during first contact. This enables man-in-the-middle attacks against new conversations.

**First Contact Vulnerability**: The initial key exchange is the most vulnerable point. If an attacker controls the directory during first contact, they can substitute keys without detection.

**No Key Transparency**: Unlike systems with transparency logs, there's no way to detect if the directory has distributed different keys to different users over time.

**Enterprise vs Public Risk Profiles**:
- **Enterprise**: Organization-signed directory entries reduce but don't eliminate risk
- **Public**: Users must verify safety numbers out-of-band for high-security communications

**Future Mitigations (planned for v2+)**:
- Key transparency logs (CONIKS-style)
- Multi-perspective notaries for high-risk users
- Auditable directory operations

### Key Discovery Architecture

#### Server Directory Service
```
Key Directory Server
├── User Public Keys
│   ├── userId: "U1234567890ABCDEF"
│   ├── userPublicKey: "ed25519-public-key"
│   └── devices: [
│       ├── { deviceId: "DABCDEF1234567890", publicKey: "x25519-public-key" }
│       ├── { deviceId: "D1234567890ABCDEF", publicKey: "x25519-public-key" }
│   ]
└── Device Revocation List
    ├── { userId: "U1234567890ABCDEF", deviceId: "DABCDEF1234567890", revokedAt: 1701763200000 }
    └── { userId: "UFEDCBA0987654321", deviceId: "D1234567890ABCDEF", revokedAt: 1701763200000 }
```

#### TOFU Trust Process
```javascript
// When Alice first talks to Bob
async function establishTrust(remoteUserId) {
  // 1. Fetch Bob's keys from directory
  const bobKeys = await keyDirectory.fetchUserKeys(remoteUserId);
  
  // 2. Verify directory signature
  const directoryValid = await verifyDirectorySignature(bobKeys);
  if (!directoryValid) {
    throw new Error('Directory signature invalid');
  }
  
  // 3. Check if we've seen these keys before
  const knownKeys = await localKeyStore.get(remoteUserId);
  
  if (!knownKeys) {
    // First time seeing Bob's keys - Trust On First Use
    await localKeyStore.store(remoteUserId, {
      userPublicKey: bobKeys.userPublicKey,
      devices: bobKeys.devices,
      trustLevel: 'TOFU',
      firstSeen: Date.now(),
      verified: false
    });
    
    return { status: 'new-trust', keys: bobKeys };
  }
  
  // 4. Check for key changes
  const keyChanges = detectKeyChanges(knownKeys, bobKeys);
  if (keyChanges.hasChanges) {
    // Show safety warning
    const userAction = await showSafetyWarning({
      type: 'key-change-detected',
      userId: remoteUserId,
      changes: keyChanges,
      previousKeys: knownKeys,
      newKeys: bobKeys
    });
    
    if (userAction === 'reject') {
      throw new Error('User rejected key changes');
    }
    
    if (userAction === 'verify') {
      // Initiate out-of-band verification
      await initiateOutOfBandVerification(remoteUserId, bobKeys);
    }
  }
  
  // 5. Update stored keys
  await localKeyStore.store(remoteUserId, {
    ...bobKeys,
    trustLevel: knownKeys.trustLevel,
    lastSeen: Date.now(),
    verified: knownKeys.verified
  });
  
  return { status: 'existing-trust', keys: bobKeys };
}
```

### Safety Number Verification

#### Safety Number Display
```javascript
// Generate human-readable safety numbers (like Signal)
function generateSafetyNumber(userId, userPublicKey, deviceId, devicePublicKey) {
  // Create fingerprint from user identity + device identity
  const identityFingerprint = SHA-256(
    userPublicKey + devicePublicKey + 'FoxWhisper-Safety-Number'
  );
  
  // Convert to human-readable groups
  return formatSafetyNumber(identityFingerprint);
}

// Example safety number display
const safetyDisplay = {
  userId: "U1234567890ABCDEF",
  safetyNumber: "12345-67890-ABCDE-F1234",
  deviceFingerprints: [
    { deviceId: "DABCDEF1234567890", fingerprint: "98765-43210-FEDC-BA987" },
    { deviceId: "D1234567890ABCDEF", fingerprint: "54321-09876-CDEF-12345" }
  ]
};
```

#### Key Change Detection
```javascript
function detectKeyChanges(previousKeys, newKeys) {
  const changes = {
    userKeyChanged: previousKeys.userPublicKey !== newKeys.userPublicKey,
    devicesChanged: [],
    devicesRemoved: [],
    devicesAdded: []
  };
  
  // Check device changes
  const previousDeviceIds = new Set(previousKeys.devices.map(d => d.deviceId));
  const newDeviceIds = new Set(newKeys.devices.map(d => d.deviceId));
  
  // New devices added
  for (const deviceId of newDeviceIds) {
    if (!previousDeviceIds.has(deviceId)) {
      changes.devicesAdded.push({
        deviceId,
        publicKey: newKeys.devices.find(d => d.deviceId === deviceId).publicKey
      });
    }
  }
  
  // Devices removed
  for (const deviceId of previousDeviceIds) {
    if (!newDeviceIds.has(deviceId)) {
      changes.devicesRemoved.push({ deviceId });
    }
  }
  
  // Device key changes
  for (const device of newKeys.devices) {
    const previousDevice = previousKeys.devices.find(d => d.deviceId === device.deviceId);
    if (previousDevice && previousDevice.publicKey !== device.publicKey) {
      changes.devicesChanged.push({
        deviceId: device.deviceId,
        oldPublicKey: previousDevice.publicKey,
        newPublicKey: device.publicKey
      });
    }
  }
  
  changes.hasChanges = changes.userKeyChanged || 
                   changes.devicesAdded.length > 0 || 
                   changes.devicesRemoved.length > 0 || 
                   changes.devicesChanged.length > 0;
  
  return changes;
}
```

### Out-of-Band Verification (Optional)

#### QR Code Verification
```javascript
// Generate QR code for out-of-band verification
function generateVerificationQR(userId, deviceId, publicKey) {
  const verificationData = {
    protocol: 'FoxWhisper',
    version: 1,
    userId: userId,
    deviceId: deviceId,
    publicKey: publicKey,
    timestamp: Date.now()
  };
  
  const qrData = JSON.stringify(verificationData);
  return qrCode.generate(qrData);
}

// Verify QR code scanned from other device
async function verifyQRCode(qrData) {
  const verification = JSON.parse(qrData);
  
  // Validate QR code format
  if (verification.protocol !== 'FoxWhisper' || 
      verification.version !== 1) {
    throw new Error('Invalid verification QR code');
  }
  
  // Compare with stored keys
  const storedKeys = await localKeyStore.get(verification.userId);
  const storedDevice = storedKeys.devices.find(d => d.deviceId === verification.deviceId);
  
  if (!storedDevice || storedDevice.publicKey !== verification.publicKey) {
    return { verified: false, reason: 'key-mismatch' };
  }
  
  // Mark as verified
  await localKeyStore.markVerified(verification.userId, verification.deviceId);
  
  return { verified: true, userId: verification.userId };
}
```

#### Fingerprint Comparison
```javascript
// Display fingerprint for manual comparison
function displayFingerprint(userId, deviceId) {
  const keys = await localKeyStore.get(userId);
  const device = keys.devices.find(d => d.deviceId === deviceId);
  
  const fingerprint = SHA-256(
    keys.userPublicKey + device.publicKey + 'FoxWhisper-Fingerprint'
  );
  
  return {
    userId: userId,
    deviceId: deviceId,
    fingerprint: formatFingerprint(fingerprint), // e.g., "ABC12 DEF34 GHI56 JKL78"
    qrCode: generateVerificationQR(userId, deviceId, device.publicKey)
  };
}
```

### User Experience Flow

#### First Contact (TOFU)
1. **Alice initiates contact with Bob**
2. **Client fetches Bob's keys from directory**
3. **Client shows "New contact - verify safety number"**
4. **Alice can optionally scan QR code or compare fingerprints**
5. **Keys stored as trusted**

#### Key Change Detection
1. **Bob adds new device or changes keys**
2. **Alice's client detects change during next contact**
3. **Client shows "Safety number changed - verify identity" warning**
4. **Alice can reject changes, verify out-of-band, or accept**
5. **Trust level updated based on user choice**

#### Enterprise Verification
1. **Organization provides key directory with signed entries**
2. **Enterprise clients can auto-trust organization keys**
3. **Admin can push key updates with proper authorization**
4. **Audit trail maintained for all trust changes**

### Security Properties

#### **TOFU Protection**
- **Initial trust**: First use establishes trust baseline
- **Change detection**: All key changes trigger warnings
- **User control**: Users decide whether to accept changes

#### **TOFU Limitations**
- **Directory dependency**: Trust depends on directory integrity during first contact
- **No retroactive detection**: Cannot detect if directory was compromised in the past
- **Single point of failure**: Compromised directory affects all new conversations
- **User verification burden**: High-security communications require out-of-band verification

#### **Directory Security**
- **Signed entries**: Directory signs all key listings
- **Revocation support**: Compromised keys can be revoked
- **Tamper evidence**: Directory signature changes detectable

#### **Directory Threat Model**
- **Compromise scenario**: Attacker controls directory can distribute malicious keys
- **Coercion risk**: Legal pressure could force key substitution
- **Insider threat**: Malicious directory operators can enable surveillance
- **Mitigation**: Users should verify safety numbers for sensitive communications

#### **Verification Options**
- **QR codes**: Easy out-of-band verification
- **Fingerprints**: Manual comparison option
- **Enterprise**: Organization-level trust for corporate environments

---

## Implementation Considerations

### **Platform-Specific Requirements**

#### **Desktop Native Applications**
- **macOS**: Use Keychain for secure key storage with Touch ID/Face ID authentication
- **Windows**: Use Data Protection API (DPAPI) with Windows Hello authentication  
- **Linux**: Use GNOME Keyring, KDE Wallet, or encrypted file store with GPG integration
- **Fallback**: Encrypted file storage with user password authentication

#### **Mobile Native Applications**
- **iOS**: Use Secure Enclave for identity keys, Keychain for device keys
- **Android**: Use hardware-backed Keystore (Strongbox/Keymaster) when available
- **Authentication**: Biometric authentication required for private key access
- **Fallback**: Software Keystore with user authentication

#### **Web Applications**
- **Reduced Security Mode**: Web clients cannot provide same guarantees as native apps
- **Storage**: WebCrypto API for cryptographic operations, IndexedDB for key persistence
- **Authentication**: User password or biometric through browser authentication APIs
- **Limitations**: Keys protected only by browser sandbox, not hardware security

### **Security Level Classifications**

#### **Level 1: Maximum Security (Native Apps with Hardware)**
- **Hardware-protected key storage**: TPM, Secure Enclave, Strongbox
- **OS-level key isolation and protection**
- **Biometric authentication**: Required for private key access
- **Guarantee**: Full protocol security guarantees

#### **Level 2: Standard Security (Native Apps without Hardware)**
- **OS-protected key storage**: Keychain, DPAPI, software keystore
- **OS-level key isolation and protection**
- **Password/biometric authentication**: Required for private key access
- **Guarantee**: Full protocol security guarantees

#### **Level 3: Reduced Security (Web Applications)**
- **Browser sandbox protection only**: WebCrypto-based operations
- **Memory exposure**: Keys may be exposed to browser memory attacks
- **Persistence**: Limited to browser storage, not OS-protected keystores
- **Authentication**: Dependent on browser security, not OS-level authentication
- **Guarantee**: Protocol security with environmental limitations

### **Implementation Requirements**

#### **Security Level Disclosure**
**Applications must clearly disclose their security level to users:**
```javascript
const securityLevel = {
  level: detectSecurityLevel(), // 1, 2, or 3
  capabilities: getSecurityCapabilities(),
  limitations: getSecurityLimitations(),
  recommendation: getSecurityRecommendation()
};

// Example user notification
showSecurityInfo({
  title: "FoxWhisper Security Level",
  level: securityLevel.level,
  description: securityLevel.level === 3 ? 
    "Web app with reduced security guarantees" :
    "Native app with full security guarantees",
  details: securityLevel
});
```

#### **Hardware Detection**
```javascript
function detectHardwareCapabilities() {
  const capabilities = {
    tpm: null,
    secureEnclave: null,
    hardwareKeystore: null,
    biometrics: null
  };
  
  // Desktop detection
  if (platform === 'macos') {
    capabilities.secureEnclave = checkSecureEnclaveAvailability();
    capabilities.biometrics = checkTouchIDAvailability();
  }
  
  if (platform === 'windows') {
    capabilities.tpm = checkTPMAvailability();
    capabilities.biometrics = checkWindowsHelloAvailability();
  }
  
  if (platform === 'linux') {
    capabilities.hardwareKeystore = checkHardwareKeystoreAvailability();
  }
  
  // Mobile detection
  if (platform === 'ios') {
    capabilities.secureEnclave = true; // All modern iOS devices
    capabilities.biometrics = checkBiometricAvailability();
  }
  
  if (platform === 'android') {
    capabilities.hardwareKeystore = checkStrongboxAvailability();
    capabilities.biometrics = checkBiometricAvailability();
  }
  
  return capabilities;
}
```

#### **Key Storage Strategy**
```javascript
function selectKeyStorageStrategy(hardwareCapabilities) {
  // Priority 1: Hardware-backed storage
  if (hardwareCapabilities.secureEnclave || hardwareCapabilities.tpm) {
    return {
      strategy: 'hardware-backed',
      userIdentity: 'hardware-protected',
      deviceKeys: 'hardware-protected',
      sessionKeys: 'hardware-protected-ttl'
    };
  }
  
  // Priority 2: OS-protected storage
  if (platform !== 'web') {
    return {
      strategy: 'os-protected',
      userIdentity: 'os-protected',
      deviceKeys: 'os-protected',
      sessionKeys: 'os-protected-ttl'
    };
  }
  
  // Priority 3: Web application (reduced security)
  return {
    strategy: 'web-reduced',
      userIdentity: 'browser-protected',
      deviceKeys: 'browser-protected',
      sessionKeys: 'memory-only'
    };
  }
}
```

### **Security Guarantees Statement**

**FoxWhisper's strongest guarantees apply to native applications using hardware-backed key stores. Web clients are supported but explicitly documented as operating in a lower-assurance environment with following limitations:**

- **Key Protection**: Limited to browser sandbox, not hardware security
- **Memory Exposure**: Keys may be exposed to browser memory attacks
- **Persistence**: Limited to browser storage, not OS-protected keystores
- **Authentication**: Dependent on browser security, not OS-level authentication

**Users requiring maximum security should use native desktop or mobile applications.**

### **Hardware Security Requirements**

#### **Hard Requirement: OS-Protected Key Storage**
**All implementations must store long-term identity keys and device keys in an OS-protected keystore. This is non-negotiable for maintaining FoxWhisper's security guarantees.**

#### **Best-Effort: Hardware-Backed Security**
**Use TPM/Secure Enclave when available, but gracefully fallback to OS-protected software storage if hardware is unavailable.**

### Platform-Specific Requirements

#### **Desktop Native Applications**
- **macOS**: Use Keychain for secure key storage with Touch ID/Face ID authentication
- **Windows**: Use Data Protection API (DPAPI) with Windows Hello authentication  
- **Linux**: Use GNOME Keyring, KDE Wallet, or encrypted file store with GPG integration
- **Fallback**: Encrypted file storage with user password authentication

#### **Mobile Native Applications**
- **iOS**: Use Secure Enclave for identity keys, Keychain for device keys
- **Android**: Use hardware-backed Keystore (Strongbox/Keymaster) when available
- **Authentication**: Biometric authentication required for private key access
- **Fallback**: Software Keystore with user authentication

#### **Web Applications**
- **Reduced Security Mode**: Web clients cannot provide the same guarantees as native apps
- **Storage**: WebCrypto API for cryptographic operations, IndexedDB for key persistence
- **Authentication**: User password or biometric through browser authentication APIs
- **Limitations**: Keys protected only by browser sandbox, not hardware security

### Security Level Classifications

#### **Level 1: Maximum Security (Native Apps with Hardware)**
- Hardware-protected key storage (TPM, Secure Enclave, Strongbox)
- OS-level key isolation and protection
- Biometric authentication required
- **Guarantee**: Full protocol security guarantees

#### **Level 2: Standard Security (Native Apps without Hardware)**
- OS-protected key storage (Keychain, DPAPI, software keystore)
- OS-level key isolation and protection
- Password/biometric authentication required
- **Guarantee**: Full protocol security guarantees

#### **Level 3: Reduced Security (Web Applications)**
- Browser sandbox protection only
- WebCrypto-based operations
- User authentication through browser
- **Guarantee**: Protocol security with environmental limitations
- **⚠️ CRITICAL WARNING**: Web clients cannot provide hardware-anchored identity protection

#### Web Client Security Limitations

**Key Protection Limitations**:
- Keys protected only by browser sandbox, not TPM/Secure Enclave
- Vulnerable to browser memory attacks, malicious extensions
- No hardware isolation from compromised operating system
- Keys may persist in browser memory beyond intended lifetime

**Authentication Limitations**:
- Dependent on browser security model, not OS-level authentication
- Biometric protection limited to browser WebAuthn implementation
- No integration with platform secure enclaves

**Persistence Limitations**:
- Keys stored in IndexedDB/LocalStorage, not OS keystores
- Vulnerable to browser data theft, cross-site scripting
- No secure deletion guarantees like hardware keystores

**User Experience Requirements**:
```javascript
// Web clients MUST display explicit security warning
const webSecurityWarning = {
  title: "⚠️ Reduced Security Mode",
  message: "Web client provides limited security guarantees. Keys are protected only by browser sandbox, not hardware security.",
  limitations: [
    "No hardware-anchored identity protection",
    "Vulnerable to browser memory attacks", 
    "Keys stored in browser storage only",
    "Dependent on browser security model"
  ],
  recommendation: "For maximum security, use native desktop or mobile applications.",
  userConsent: "I understand and accept reduced security"
};

// Must obtain explicit user consent
const userAccepted = await showSecurityDialog(webSecurityWarning);
if (!userAccepted) {
  throw new Error('User rejected reduced security mode');
}
```

### Implementation Requirements

#### **Security Level Disclosure**
**Applications must clearly disclose their security level to users:**
```javascript
const securityLevel = {
  level: detectSecurityLevel(), // 1, 2, or 3
  capabilities: getSecurityCapabilities(),
  limitations: getSecurityLimitations(),
  recommendation: getSecurityRecommendation()
};

// Example user notification
showSecurityInfo({
  title: "FoxWhisper Security Level",
  level: securityLevel.level,
  description: securityLevel.level === 3 ? 
    "Web app with reduced security guarantees" :
    "Native app with full security guarantees",
  details: securityLevel
});
```

#### **Hardware Detection**
```javascript
function detectHardwareCapabilities() {
  const capabilities = {
    tpm: null,
    secureEnclave: null,
    hardwareKeystore: null,
    biometrics: null
  };
  
  // Desktop detection
  if (platform === 'macos') {
    capabilities.secureEnclave = checkSecureEnclaveAvailability();
    capabilities.biometrics = checkTouchIDAvailability();
  }
  
  if (platform === 'windows') {
    capabilities.tpm = checkTPMAvailability();
    capabilities.biometrics = checkWindowsHelloAvailability();
  }
  
  if (platform === 'linux') {
    capabilities.hardwareKeystore = checkHardwareKeystoreAvailability();
  }
  
  // Mobile detection
  if (platform === 'ios') {
    capabilities.secureEnclave = true; // All modern iOS devices
    capabilities.biometrics = checkBiometricAvailability();
  }
  
  if (platform === 'android') {
    capabilities.hardwareKeystore = checkStrongboxAvailability();
    capabilities.biometrics = checkBiometricAvailability();
  }
  
  return capabilities;
}
```

#### **Key Storage Strategy**
```javascript
function selectKeyStorageStrategy(hardwareCapabilities) {
  // Priority 1: Hardware-backed storage
  if (hardwareCapabilities.secureEnclave || hardwareCapabilities.tpm) {
    return {
      strategy: 'hardware-backed',
      userIdentity: 'hardware-protected',
      deviceKeys: 'hardware-protected',
      sessionKeys: 'hardware-protected-ttl'
    };
  }
  
  // Priority 2: OS-protected storage
  if (platform !== 'web') {
    return {
      strategy: 'os-protected',
      userIdentity: 'os-protected',
      deviceKeys: 'os-protected', 
      sessionKeys: 'os-protected-ttl'
    };
  }
  
  // Priority 3: Web application (reduced security)
  return {
    strategy: 'web-reduced',
    userIdentity: 'browser-protected',
    deviceKeys: 'browser-protected',
    sessionKeys: 'memory-only'
  };
}
```

### Security Guarantees Statement

**FoxWhisper's strongest guarantees apply to native applications using hardware-backed key stores. Web clients are supported but explicitly documented as operating in a lower-assurance environment with the following limitations:**

- **Key Protection**: Limited to browser sandbox, not hardware security
- **Memory Exposure**: Keys may be exposed to browser memory attacks
- **Persistence**: Limited to browser storage, not OS-protected keystores
- **Authentication**: Dependent on browser security, not OS-level authentication
- **Identity Security**: Web clients cannot provide hardware-anchored identity guarantees

**⚠️ SECURITY WARNING**: Web clients should NOT be used for:
- High-risk communications (whistleblowing, journalism, activism)
- Enterprise environments requiring hardware security compliance
- Scenarios requiring maximum security guarantees

**Users requiring maximum security should use native desktop or mobile applications.**

### **Error Handling Requirements**
Comprehensive error taxonomy required for all failure modes:
- **Handshake failures**: Invalid signatures, version mismatches
- **Session errors**: Expired sessions, key rotation failures
- **Hardware errors**: Unavailable TPM/Secure Enclave, fallback triggers
- **Network errors**: Connection failures, message delivery issues

### **Algorithm Migration Path**
Implementation must support algorithm agility through versioned identifiers:
- **KEM upgrades**: Kyber-768 to future post-quantum schemes
- **Signature upgrades**: Ed25519 to hybrid classical/post-quantum
- **Backward compatibility**: Graceful deprecation and transition periods

---

## Appendix A: Reference Implementation Pseudocode

This appendix contains reference pseudocode for common cryptographic operations. All implementations should follow these patterns for consistency.

### Message Encryption with AAD

```javascript
// Encrypt message with proper AAD binding
function encryptMessageWithAAD(message, plaintext) {
  // Serialize AAD from message context
  const aad = serializeAAD(message);
  
  // Generate random IV
  const iv = await generateRandomBytes(12);
  
  // Encrypt with AAD
  const encrypted = await aesGCMEncrypt(
    messageKey,
    iv,
    plaintext,
    aad // Additional Authenticated Data
  );
  
  return {
    ...message,
    ciphertext: encrypted.ciphertext,
    iv: iv,
    authTag: encrypted.authTag
  };
}
```

### Message Decryption with AAD

```javascript
// Decrypt message with AAD verification
function decryptMessageWithAAD(encryptedMessage, messageKey) {
  // Serialize AAD from message context
  const aad = serializeAAD(encryptedMessage);
  
  // Decrypt with AAD verification
  const plaintext = await aesGCMDecrypt(
    messageKey,
    encryptedMessage.iv,
    encryptedMessage.ciphertext,
    encryptedMessage.authTag,
    aad // Must match encryption AAD
  );
  
  return plaintext;
}
```

### AAD Serialization

```javascript
// Secure AAD serialization using CBOR + SHA-256
function serializeAAD(message) {
  const aadStruct = {
    version: message.version,
    type: message.type,
    sessionId: message.sessionId || '',
    messageId: message.messageId || '',
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
    recipientUserId: message.recipientUserId || '',
    recipientDeviceId: message.recipientDeviceId || '',
    timestamp: message.timestamp
  };
  
  // Encode with CBOR for deterministic binary serialization
  const aadBytes = cbor.encode(aadStruct);
  
  // Hash for fixed-size AAD
  return SHA-256(aadBytes);
}
```

### Message Key Derivation

```javascript
// Derive per-message key from session key
function deriveMessageKey(chainKey, messageId) {
  return HKDF(
    'SHA-256',
    chainKey,
    `FoxWhisper-Message-${messageId}`,
    32 // 256-bit key
  );
}
```

### Symmetric Ratchet Operations

```javascript
// Ratchet chain key forward for next message
function ratchetForward(chainKey) {
  return HKDF(
    'SHA-256',
    chainKey,
    'FoxWhisper-Chain-Ratchet',
    32
  );
}

// Complete message processing with ratchet
function processMessageWithRatchet(ratchetState, message) {
  // Derive message key
  const messageKey = deriveMessageKey(ratchetState.chainKey, message.messageId);
  
  // Decrypt message
  const plaintext = decryptMessageWithAAD(message, messageKey);
  
  // Ratchet forward for next message
  ratchetState.chainKey = ratchetForward(ratchetState.chainKey);
  ratchetState.messageCounter++;
  
  return plaintext;
}
```

### Hybrid Key Agreement

```javascript
// Complete hybrid handshake between Device A and Device B
async function performHybridHandshake(deviceA, deviceB) {
  // Device A: Generate ephemeral keys
  const aEphemeralX25519 = await generateX25519KeyPair();
  const aEphemeralKyber = await generateKyberKeyPair(KYBER_768);
  
  // Device A: Send INIT
  const initMessage = {
    version: 1,
    type: 'HYBRID_HANDSHAKE_INIT',
    handshakeId: generateHandshakeId(),
    senderUserId: deviceA.userId,
    senderDeviceId: deviceA.deviceId,
    recipientUserId: deviceB.userId,
    recipientDeviceId: deviceB.deviceId,
    ephemeralX25519Pub: aEphemeralX25519.publicKey,
    kyberPub: aEphemeralKyber.publicKey,
    senderNonce: await generateRandomBytes(32),
    timestamp: Date.now()
  };
  
  // Device B: Receive INIT and create RESP
  const bEphemeralX25519 = await generateX25519KeyPair();
  
  // Compute X25519 shared secret
  const x25519Shared = await x25519(
    bEphemeralX25519.privateKey,
    initMessage.ephemeralX25519Pub
  );
  
  // Encapsulate Kyber and compute shared secret
  const kyberResult = await kyberEncapsulate(initMessage.kyberPub);
  const kyberShared = kyberResult.sharedSecret;
  const kyberCiphertext = kyberResult.ciphertext;
  
  // Device B: Send RESP
  const respMessage = {
    version: 1,
    type: 'HYBRID_HANDSHAKE_RESP',
    handshakeId: initMessage.handshakeId,
    senderUserId: deviceB.userId,
    senderDeviceId: deviceB.deviceId,
    recipientUserId: deviceA.userId,
    recipientDeviceId: deviceA.deviceId,
    ephemeralX25519Pub: bEphemeralX25519.publicKey,
    kyberCiphertext: kyberCiphertext,
    senderNonce: await generateRandomBytes(32),
    recipientNonce: initMessage.senderNonce,
    timestamp: Date.now()
  };
  
  // Device A: Complete handshake
  const aX25519Shared = await x25519(
    aEphemeralX25519.privateKey,
    respMessage.ephemeralX25519Pub
  );
  
  const aKyberShared = await kyberDecapsulate(
    aEphemeralKyber.privateKey,
    respMessage.kyberCiphertext
  );
  
  // Both parties derive session key
  const sessionKeyMaterial = aX25519Shared + aKyberShared;
  const sessionKey = await HKDF(
    'SHA-256',
    sessionKeyMaterial,
    `FoxWhisper-Session-${initMessage.handshakeId}-${deviceA.deviceId}-${deviceB.deviceId}`,
    32
  );
  
  return {
    sessionKey: sessionKey,
    sessionId: initMessage.handshakeId,
    participants: [deviceA.deviceId, deviceB.deviceId]
  };
}
```

### Moderation Key Export

```javascript
// Export message key for moderator access
async function exportMessageKeyForModeration(message, moderationPublicKey) {
  // Reconstruct message key from session state
  const messageKey = reconstructMessageKey(
    getSessionKey(message.sessionId),
    message.messageId
  );
  
  // Generate ephemeral key for key agreement
  const ephemeralKey = await generateX25519KeyPair();
  
  // Perform X25519 key agreement
  const sharedSecret = await x25519(
    ephemeralKey.privateKey,
    moderationPublicKey
  );
  
  // Derive encryption key
  const encryptionKey = await HKDF(
    'SHA-256',
    sharedSecret,
    'FoxWhisper-Moderation-Key-Export',
    32
  );
  
  // Encrypt message key
  const encryptedKey = await aesGCMEncrypt(
    encryptionKey,
    await generateRandomBytes(12),
    messageKey,
    'FoxWhisper-Moderation-Key-Export'
  );
  
  return {
    messageId: message.messageId,
    encryptedMessageKey: encryptedKey.ciphertext,
    keyEphemeralPub: ephemeralKey.publicKey,
    keyIv: encryptedKey.iv,
    keyAuthTag: encryptedKey.authTag
  };
}
```

---

## Open Questions

### Immediate Implementation Questions:
1. **WebSocket Protocol Definition**: What is the exact message format for real-time communication?
2. **Session Persistence**: How to store and retrieve session keys across app restarts?
3. **Message Ordering**: How to ensure message delivery order in distributed system?
4. **Error Recovery**: What are the exact error codes and recovery procedures?
5. **Performance Targets**: What are acceptable latency/bandwidth for target devices?

### Strategic Questions:
1. **Public Demo Launch**: When to launch public beta for community feedback?
2. **News Corp Engagement**: When to approach News Corp with pilot proposal?
3. **Feature Prioritization**: Which public demo features are essential for enterprise validation?
4. **Resource Allocation**: How to split development between community vs enterprise features?

### Technical Architecture Decisions:
1. **Message Transport**: WebSocket vs HTTP/2 vs WebRTC for real-time?
2. **Database Schema**: How to store encrypted messages and session data?
3. **Server Architecture**: Microservices vs monolith for self-hosting?
4. **Deployment Strategy**: Docker containers vs Kubernetes for enterprise distribution?
5. **Testing Strategy**: How to validate quantum resistance claims?

---

## Document Version History

| Version | Date | Changes | Author |
|----------|---------|-----------|---------|
| 1.0 | 2025-12-05 | Initial protocol specification | Party Mode Team |

---

**Status:** 🔄 Draft - Under active development

---

## Next Steps

1. **Review cryptographic choices** with security experts
2. **Validate hardware integration approach** across platforms
3. **Test performance characteristics** on target devices
4. **Refine message types** based on Phase 3 requirements
5. **Create implementation guide** for development team

---

*This protocol specification provides the foundation for FoxWhisper's privacy-preserving safety infrastructure while maintaining quantum-resistant security and hardware-protected key management.*