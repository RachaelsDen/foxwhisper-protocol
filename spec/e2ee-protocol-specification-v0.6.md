# FoxWhisper End-to-End Encryption Protocol
## Version 0.6 — Security Hardened + Hybrid PQ Handshake + Double Ratchet + Group Messaging

This specification defines FoxWhisper End-to-End Encryption (E2EE) protocol v0.6. It incorporates comprehensive security hardening based on expert cryptographic review while maintaining backward compatibility with v0.5 core architecture. No previous version was deployed. This document constitutes a production-ready protocol specification.

---

# 1. Goals & Overview

FoxWhisper aims to provide:

- Strong end-to-end confidentiality and integrity across multiple devices
- Post-quantum–resistant initial key agreement
- Forward secrecy & post-compromise security via Double Ratchet
- A clear identity hierarchy (User → Device → Session → Message)
- Support for client-side moderation and legal compliance workflows
- Scalable group messaging via sender-key architecture
- Extensibility for future group messaging modes (MLS)

The server is an untrusted transport entity. All sensitive cryptographic operations occur on clients.

---

# 2. Identity Model

FoxWhisper identities are hierarchical:

```
User Identity (long-term)
 └── Device Identities (per device)
       └── Sessions (per device pair)
            └── Message Keys (per message)
```

### 2.1 User Identity Keys
- Ed25519 keypair
- Must be generated inside a hardware security module when available (TPM / Secure Enclave).
- Not exportable in raw form (best effort; platform dependent).
- Signs device keys and sensitive account actions.

### 2.2 Device Identity Keys
Each device has:

- Ed25519 device identity key (signature)
- X25519 + Kyber (ML-KEM) keypairs for handshake

Signed by user identity key during device registration.

### 2.3 Device Revocation
Revoking a device immediately:

- Invalidates all sessions involving that device
- Invalidates any group sender keys it contributed
- Requires peers to tear down DR state and trigger a new handshake
- MUST be included in user metadata so peers can verify revocation status

### 2.4 Multi-Device Coordination

Users may have multiple active devices, each treated as a separate sender in group messaging. Proper coordination is essential to prevent security issues.

#### 2.4.1 Sender Chain Coordination

**Problem**: Multiple devices from the same user need to coordinate their group sender chains to avoid conflicts and ensure proper message ordering.

**Coordination Rules:**

1. **Independent Chain Keys**: Each device maintains its own `groupSenderCK_0` per epoch, independent of other devices from the same user.

2. **Index Coordination**: Devices MUST coordinate `groupMessageIndex` to avoid collisions:
   - **Preferred**: Use device ID as index offset (e.g., device1 starts at 0, device2 at 1,000,000)
   - **Alternative**: Include device ID in message headers to distinguish overlapping indices

3. **State Synchronization**: Devices SHOULD synchronize group state (current epoch, membership) through secure user-controlled channels.

#### 2.4.2 Device Reset and Reinstallation

**Security Risks**: Device reinstallation or reset can cause:
- Loss of sender chain keys
- Inability to decrypt past messages
- Potential key reuse if not handled properly

**Mandatory Procedures:**

1. **Device Reset Detection**: Implementations MUST detect when a device is being reset or reinstalled.

2. **Safe Reset Protocol**:
   ```
   // Before reset
   notifyOtherDevices("DEVICE_RESET_IMMINENT", deviceId)
   securelyDeleteAllSenderKeys()
   
   // After reset  
   generateNewDeviceIdentity()
   requestResyncFromOtherDevices()
   ```

3. **Epoch Transition**: Device reset SHOULD trigger a new epoch to ensure clean state separation.

4. **Peer Notification**: Other devices MUST be notified of device reset to update their security expectations.

#### 2.4.3 Backup and Restore Security

**Backup Requirements:**

1. **Encrypted Backups**: All group state backups MUST be encrypted with user-controlled keys.

2. **Key Exclusion**: Backups MUST NOT include:
   - Current `groupSenderCK_n` chain keys (only `groupSenderCK_0` is acceptable)
   - Skipped message keys
   - DR chain keys beyond current state

3. **Timestamp Validation**: Restored backups MUST be validated for temporal consistency.

**Restore Procedures:**

1. **Version Check**: Verify backup is not older than current epoch - 1.

2. **State Validation**: Ensure restored state doesn't conflict with current group membership.

3. **Key Regeneration**: If backup is too old, generate new sender keys for current epoch.

#### 2.4.4 Cross-Device Message Ordering

**Challenge**: Messages from multiple devices of the same user may appear out of order to recipients.

**Solutions:**

1. **Device ID Headers**: Include `senderDeviceId` in all group message headers.

2. **Timestamp Ordering**: Use message timestamps for cross-device ordering within reasonable clock skew.

3. **Application-Level Ordering**: Applications may implement additional ordering logic based on device IDs.

#### 2.4.5 Security Considerations

1. **Compromise Isolation**: Compromise of one device MUST NOT compromise other devices' sender keys.

2. **Forward Secrecy**: Device reset MUST maintain forward secrecy for past messages.

3. **State Consistency**: All devices MUST maintain consistent view of current epoch and membership.

4. **Audit Trail**: Device additions, removals, and resets SHOULD be logged for security auditing.

---

# 3. Canonical CBOR Encoding Rules

These rules apply to all AAD, all signed structures, and all structured payloads.

1. Deterministic / canonical CBOR per RFC 8949 Section 4.2
2. Map keys sorted lexicographically by UTF-8 byte order
3. No floating-point encodings
4. No duplicate keys
5. Only definite-length arrays and maps
6. Byte strings encoded exactly; no base64 or custom packing

Canonical CBOR is essential to prevent AAD ambiguity, replay splicing, and signature malleability.

---

# 4. Handshake Protocol (Hybrid PQ)

Each device performs a one-shot authenticated key agreement using:

- X25519 ECDH
- Kyber (ML-KEM) key encapsulation
- Ed25519 signatures for authentication

### 4.1 Shared Secret Derivation

```
x25519Shared = X25519(local.X25519_priv, remote.X25519_pub)
kyberShared  = Kyber.Decapsulate(local.Kyber_priv, remote.Kyber_ciphertext)

handshakeSecret = HKDF(
    salt = 0,
    input = x25519Shared || kyberShared,
    info = "FoxWhisper-Handshake-Root",
    length = 32
)
```

Output: Root Key (RK₀) for Double Ratchet.

This handshake is post-quantum secure against Harvest-Now-Decrypt-Later attacks assuming Kyber remains unbroken.

---

# 5. Double Ratchet Session (1:1 Messaging)

FoxWhisper adopts classical Signal Double Ratchet, seeded from RK₀.

State consists of:

```
rootKey      RK
DHs, DHr     (current DH sending/receiving keys)
CKs, CKr     (chain keys)
Ns, Nr       (send/recv message counters)
PN           (previous chain length)
skippedKeys  (bounded map)
```

### 5.1 Header Fields

Each encrypted message includes:

```
dhPublicKey
messageNumber
previousChainLength
timestamp
sessionVersion = 1
```

These fields are integrated into AAD.

### 5.2 AAD Construction

```
aadStruct = {
  "version": 1,
  "type": "ENCRYPTED_MESSAGE",
  "sessionId": sessionId,
  "senderUserId": ...,
  "senderDeviceId": ...,
  "receiverUserId": ...,
  "receiverDeviceId": ...,
  "dhPublicKey": ...,
  "messageNumber": ...,
  "previousChainLength": ...,
  "timestamp": ...
}

AAD = SHA256(canonicalCBOR(aadStruct))
```

### 5.3 DR Behavior Requirements

Clients MUST:

- Reject messages with impossible header values
- Enforce a maximum skipped-key limit (e.g., 128)
- Enforce maximum ratchet gap (e.g., 200 DH steps)
- Treat inconsistent state as fatal corruption → trigger session reset
- Destroy old chain keys after deriving message keys

### 5.4 Session Reset Trigger Conditions

Clients MUST reset session (new handshake) if:

- Message numbers move backward
- DH public keys repeat unexpectedly
- Gaps exceed protocol-defined limits
- Device revocation is detected

---

# 6. Message Key Classes (FS-Compatible Legal Hold Design)

FoxWhisper defines two message key classes:

### 6.1 Ephemeral Messages (default)
- Fully forward-secret
- Message keys deleted immediately after decryption
- Never recoverable
- Cannot be included in legal hold

### 6.2 Hold-Eligible Messages (optional)
- Derived from DR chain exactly as ephemeral messages
- BUT client retains per-message key for:
  - Content reports
  - Legal hold exports
  - Audit bundles

Important:

The DR chain key is never retained. Only message keys for chosen messages may be exported.

This preserves Double Ratchet security for all non-exported messages.

---

# 7. Message Encryption

Each message uses:

```
msgKey = HKDF(CK, "FoxWhisper-Message", 32)
iv     = random(12 bytes)
ciphertext, authTag = AES-GCM(msgKey, plaintext, AAD)
```

On receiving:

- Use DH ratchet (if needed)
- Derive appropriate CKr → msgKey
- Verify AAD
- Decrypt

---

# 8. Group Messaging

FoxWhisper v1.0 defines a **group messaging core profile** based on sender keys. This profile is designed for scalable channels and servers, and is layered on top of 1:1 Double Ratchet sessions described in Section 5.

Additional group profiles (e.g., MLS-based) MAY be defined in future documents, but are out of scope for v1.0.

---

## 8.1 Group Model

A group is identified by a stable `groupId` and a sequence of **epochs**:

```
Group G
  groupId: opaque identifier
  members: set of (userId, deviceId)
  epochs:  epochId → GroupEpochState
```

Each `GroupEpochState` represents a membership era:

- `epochId` (monotonic integer)
- `members` (devices active in this epoch)
- `createdAt`, `reason` (join/leave/kick/rotation metadata)
- Per-sender group chain keys (see 8.2)
- `adminDeviceIds` (set of devices authorized to make membership changes)

Security goals:

- A device removed from group MUST NOT receive keys for future epochs.
- A device joining the group MUST NOT receive keys that decrypt past epochs.

---

## 8.2 Sender-Key Group Profile (FW-Group-SK)

FoxWhisper's primary group mode is a **sender-key profile** inspired by Signal's sender keys and Matrix's Megolm. It is optimized for large groups and channels.

### 8.2.1 Per-Sender Group Chain Keys

For each `(groupId, epochId, senderDeviceId)` tuple, sender device generates a random 32-byte chain key:

```
groupSenderCK_0 = random(32)
```

This key is distributed to all devices in group **over existing 1:1 DR sessions** using authenticated group key distribution messages (Section 8.2.6). The payload is bound to:

- `groupId`
- `epochId`
- `senderDeviceId`

Receivers store:

```
(groupId, epochId, senderDeviceId) → groupSenderCK_0
```

### 8.2.2 Group Message Encryption

To send a group message in epoch `epochId`, sender device `D` with current chain key `groupSenderCK_n` performs:

1. Derive a message key and next chain key:

```
groupMsgKey_n = HKDF(groupSenderCK_n, "FoxWhisper-Group-Message", 32)

// advance chain
groupSenderCK_{n+1} = HKDF(groupSenderCK_n, "FoxWhisper-Group-Chain", 32)
```

2. Construct a group header:

```
header = {
  "version": 1,
  "type": "GROUP_ENCRYPTED_MESSAGE",
  "groupId": groupId,
  "epochId": epochId,
  "senderUserId": ..., 
  "senderDeviceId": senderDeviceId,
  "groupMessageIndex": n,
  "timestamp": ...
}
```

3. Compute AAD and encrypt:

```
AAD = SHA256(canonicalCBOR(header))
iv  = random(12 bytes)

ciphertext, authTag = AES-GCM(groupMsgKey_n, plaintext, AAD)
```

4. **Optional but Recommended**: Add per-message signature for transcript authentication:

```
messageSignature = Ed25519_sign(
  senderDevicePrivKey,
  canonicalCBOR({
    "groupId": groupId,
    "epochId": epochId,
    "senderDeviceId": senderDeviceId,
    "groupMessageIndex": n,
    "ciphertextHash": SHA256(ciphertext || authTag),
    "timestamp": ...
  })
)
```

5. Transmit message payload to server:

```
groupMessage = {
  "header": header,
  "ciphertext": base64(ciphertext),
  "authTag": base64(authTag),
  "iv": base64(iv),
  "messageSignature": base64(messageSignature)  // Optional but recommended
}
```

Server fan-outs this same payload to all group members.

### 8.2.3.1 Message Signature Verification (Optional)

**When `messageSignature` is present, receivers MUST:**

1. Verify signature using sender's device identity key
2. Verify signed fields match message header and ciphertext
3. Reject message if signature verification fails

**Security Benefits:**
- **Transcript Integrity**: Prevents retroactive message forgeries by compromised devices
- **Non-Repudiation**: Sender cannot deny sending specific messages
- **Binding**: Cryptographically binds message content to sender identity
- **Audit Trail**: Provides verifiable evidence of message authorship

**Implementation Note**: Signatures are optional to maintain performance for large groups, but highly recommended for security-sensitive applications.

### 8.2.3 Group Message Decryption

On receiving a group message, a device:

1. Parses header and computes AAD as above.
2. **MUST reject messages whose AAD groupId does not match local group context.**
3. **MUST perform epoch and replay validation (see 8.2.3.1).**
4. Looks up `groupSenderCK_0` for `(groupId, epochId, senderDeviceId)`.
5. Advances chain key from index 0 to `groupMessageIndex` using same HKDF-based chain derivation, caching any intermediate message keys if necessary.
6. Uses `groupMsgKey_n` to decrypt.

Implementations MUST:

- Maintain a bounded map of skipped group message keys (similar to `skippedKeys` in DR)
- Enforce a maximum forward ratchet gap per sender in a group (e.g., 1000 messages)
- Treat inconsistent or impossible indices as potential corruption and require re-synchronization

Group message keys MAY be treated as **ephemeral** or **hold-eligible** exactly as in Section 6, depending on policy.

### 8.2.3.1 Epoch Expiry and Replay Protection

**Threat Model**: Malicious servers or compromised devices may attempt to replay old group messages or messages from previous epochs to cause confusion or disrupt group operation.

**Mandatory Validation Rules:**

1. **Epoch Validation**:
   ```
   if (message.epochId < currentEpochId - 1) {
     reject("Message from too old epoch")
   }
   
   if (message.epochId > currentEpochId) {
     reject("Message from future epoch")
   }
   ```

2. **Timestamp Validation**:
   ```
   maxAge = 7 * 24 * 60 * 60 * 1000  // 7 days in milliseconds
   now = currentUnixTime()
   
   if (now - message.timestamp > maxAge) {
     reject("Message timestamp too old")
   }
   
   if (message.timestamp - now > CLOCK_SKEW_LIMIT) {
     reject("Message timestamp too far in future")
   }
   ```

3. **Replay Detection**:
   ```
   messageKey = (groupId, epochId, senderDeviceId, groupMessageIndex)
   
   if (recentlySeenMessages.contains(messageKey)) {
     reject("Duplicate message")
   }
   
   recentlySeenMessages.add(messageKey, TTL_24_HOURS)
   ```

4. **Epoch Transition Grace Period**:
   - Messages from `currentEpochId - 1` are accepted for up to 5 minutes after epoch transition
   - This accounts for network delays and clock skew during epoch changes
   - After grace period, only `currentEpochId` messages are accepted

**Implementation Requirements:**

```
// Pseudocode for message validation
function validateGroupMessage(message) {
  // Epoch validation
  if (message.epochId < currentEpochId - 1) {
    throw new SecurityError("Message from expired epoch")
  }
  
  if (message.epochId > currentEpochId) {
    throw new SecurityError("Message from future epoch")
  }
  
  // Timestamp validation
  now = Date.now()
  maxAge = 7 * 24 * 60 * 60 * 1000  // 7 days
  skewLimit = 5 * 60 * 1000  // 5 minutes
  
  if (now - message.timestamp > maxAge) {
    throw new SecurityError("Message too old")
  }
  
  if (message.timestamp - now > skewLimit) {
    throw new SecurityError("Message timestamp too far in future")
  }
  
  // Replay detection
  messageKey = `${message.groupId}:${message.epochId}:${message.senderDeviceId}:${message.groupMessageIndex}`
  if (messageCache.has(messageKey)) {
    throw new SecurityError("Duplicate message")
  }
  
  messageCache.set(messageKey, true)
  return true
}
```

**Security Properties:**

- **Epoch Isolation**: Messages cannot be replayed across epoch boundaries
- **Temporal Boundaries**: Old messages are rejected after reasonable time limits
- **Replay Prevention**: Duplicate messages are detected and rejected
- **Graceful Transitions**: Short grace period handles network delays during epoch changes

**Operational Considerations:**

- **Clock Skew**: Implementations should handle reasonable clock differences between devices
- **Network Delays**: Grace period accounts for message delivery delays during epoch transitions
- **Storage Efficiency**: Replay cache should use LRU eviction with 24-hour TTL
- **User Experience**: Rejected messages should be logged for debugging but not shown to users

### 8.2.4 Membership Changes and Epochs

When a group membership change occurs (join, leave, kick, ban, or device revocation of a member), group enters a new epoch:

1. **Admin Authorization Check**: Verify the membership change request is signed by a device in `epoch.adminDeviceIds`
2. Increment `epochId`.
3. For each remaining sender device in group, generate a new `groupSenderCK_0` for the new epoch.
4. Distribute new epoch chain keys using authenticated group key distribution messages (Section 8.2.6).
5. Update `GroupEpochState` with new membership and admin device list.

Security properties:

- Removed devices do not receive new epoch chain keys, and thus cannot decrypt future group messages.
- Newly added devices receive only the current epoch chain keys, and thus cannot decrypt past group messages.

### 8.2.5 Group State Persistence

Clients MUST persist group state in canonical CBOR format following strict serialization rules to ensure cross-platform compatibility.

#### 8.2.5.1 Canonical CBOR Serialization Format

**Encoding Requirements:**
1. Follow canonical CBOR rules from Section 3 verbatim
2. All map keys sorted lexicographically by UTF-8 byte order
3. Use definite-length arrays and maps only
4. Encode binary data as byte strings (not base64 strings)
5. Use integer types for all numeric fields

#### 8.2.5.2 Group State Structure

```
groupState = {
  // Core identification
  "groupId": "byte_string",           // 32-byte group identifier
  "currentEpochId": 42,             // Current active epoch
  "stateVersion": 1,                  // Format version for migration
  
  // Epoch history (keep last 10 epochs for rollback protection)
  "epochs": {
    "42": {                          // String key for CBOR map compatibility
      "epochId": 42,
      "members": [                    // Array of member objects
        {
          "userId": "byte_string",     // 32-byte user identifier  
          "deviceId": "byte_string"    // 32-byte device identifier
        }
      ],
      "adminDeviceIds": ["byte_string"], // Array of admin device identifiers
      "createdAt": 1701763200000,     // Unix timestamp in milliseconds
      "reason": "member_added",        // Human-readable reason
      "authenticityRecord": "byte_string" // Serialized epoch authenticity record
    }
  },
  
  // Per-sender chain state
  "senderChainState": {
    "userA_device1": {
      "currentChainKey": "byte_string",     // Current groupSenderCK_n
      "messageIndex": 15,                  // Current groupMessageIndex
      "lastReceivedIndex": 14,             // Last processed message index
      "createdAt": 1701763200000           // When this chain was established
    }
  },
  
  // Security metadata
  "lastMessageTimestamp": 1701763200000,   // Last seen message time
  "replayCache": [                         // Recent messages for replay protection
    {
      "senderDeviceId": "byte_string",
      "epochId": 42,
      "messageIndex": 15,
      "timestamp": 1701763200000
    }
  ],
  
  // Integrity protection
  "stateSignature": "byte_string",          // Ed25519 signature over entire state
  "signedAt": 1701763200000               // When signature was created
}
```

#### 8.2.5.3 State Signature Protection

**Purpose**: Prevent tampering with persisted group state and detect corruption.

**Signature Process:**
```
stateForSignature = canonicalCBOR(groupState_without_stateSignature_and_signedAt)
stateSignature = Ed25519_sign(
  deviceIdentityPrivateKey,
  SHA256(stateForSignature)
)
```

**Verification on Load:**
1. Deserialize state from CBOR
2. Verify `stateSignature` using known device identity key
3. Check `signedAt` timestamp is within reasonable bounds
4. Reject state if any verification fails

#### 8.2.5.4 Persistence Operations

**Save Operation:**
```
function saveGroupState(groupState, deviceKey) {
  // Update timestamps and signature
  groupState.signedAt = Date.now()
  stateForSignature = canonicalCBOR(groupState_without_signature)
  groupState.stateSignature = Ed25519_sign(deviceKey, SHA256(stateForSignature))
  
  // Serialize to canonical CBOR
  serializedState = canonicalCBOR(groupState)
  
  // Encrypt with device-local storage key
  encryptedState = encryptWithStorageKey(serializedState)
  
  // Write to secure storage
  secureStorage.write(groupState.groupId, encryptedState)
}
```

**Load Operation:**
```
function loadGroupState(groupId, deviceKey) {
  // Read from secure storage
  encryptedState = secureStorage.read(groupId)
  if (!encryptedState) return null
  
  // Decrypt and deserialize
  serializedState = decryptWithStorageKey(encryptedState)
  groupState = CBOR.decode(serializedState)
  
  // Verify integrity
  stateForSignature = canonicalCBOR(groupState_without_signature)
  expectedSignature = Ed25519_sign(deviceKey, SHA256(stateForSignature))
  
  if (!constantTimeEqual(groupState.stateSignature, expectedSignature)) {
    throw new SecurityError("Group state signature verification failed")
  }
  
  return groupState
}
```

#### 8.2.5.5 Recovery and Migration

**Recovery Rule**: If group state is missing, corrupted, or signature verification fails, clients MUST request re-sync from peers or server to recover the current epoch state.

**Migration Support**: 
- `stateVersion` field allows future format changes
- Implementations MUST support version 1 format
- Migration between versions should preserve security properties

**Security Requirements:**
- All sensitive data MUST be encrypted at rest using platform secure storage
- State files MUST be protected with file system permissions
- Memory containing group state MUST be zeroed after use
- Backup operations MUST follow the same encryption and signature procedures

**Recovery Rule**: If group state is missing or corrupted, clients MUST request re-sync from peers or server to recover the current epoch state.

### 8.2.6 Authenticated Group Key Distribution

Group chain key distribution messages MUST be authenticated and enforce uniqueness:

```
groupKeyDistribution = {
  "type": "GROUP_KEY_DISTRIBUTION",
  "groupId": "...",
  "epochId": 42,
  "senderDeviceId": "...",
  "groupSenderCK_0": "base64-encoded-32-byte-key",
  "signature": "Ed25519_sign(senderDevicePrivKey, canonicalCBOR(payload_without_signature))
}
```

**Verification Procedure:**
1. Check signature using known sender device identity key
2. Check membership: `senderDeviceId ∈ epoch.members`
3. Verify epoch matches current group context
4. **CRITICAL**: Enforce sender-key uniqueness (see below)
5. Reject if any check fails

### 8.2.6.1 Sender-Key Poisoning Protection

**Sender-key poisoning attacks** occur when a malicious device attempts to distribute multiple different `groupSenderCK_0` values for the same `(groupId, epochId, senderDeviceId)` tuple, causing group fragmentation.

**Mandatory Enforcement Rules:**

1. **Uniqueness Constraint**: For any given `(groupId, epochId, senderDeviceId)`, exactly ONE `groupSenderCK_0` is permitted per epoch.

2. **First-Key Wins**: Clients MUST accept the first valid `groupKeyDistribution` message for a given sender in an epoch and reject all subsequent ones.

3. **Protocol Violation**: Receiving a second `groupKeyDistribution` with different `groupSenderCK_0` from the same sender in the same epoch MUST be treated as a protocol violation:
   - Log security event
   - Reject the message
   - Optionally report malicious behavior to group admins

4. **Epoch Reset Exception**: New epochs allow new `groupSenderCK_0` values from all senders, as expected by normal epoch transitions.

**Implementation Requirements:**

```
// Pseudocode for sender-key validation
function validateGroupKeyDistribution(message) {
  key = (message.groupId, message.epochId, message.senderDeviceId)
  
  if (senderKeyCache.has(key)) {
    // This sender already provided a key for this epoch
    if (senderKeyCache.get(key) !== message.groupSenderCK_0) {
      // ATTEMPTED POISONING ATTACK
      throw new ProtocolViolation("Multiple sender keys for same epoch")
    }
    // Duplicate of same key - ignore (retransmission)
    return false
  }
  
  // First key from this sender for this epoch
  senderKeyCache.set(key, message.groupSenderCK_0)
  return true
}
```

**Security Properties:**
- **Group Cohesion**: Prevents malicious devices from splitting group into subgroups
- **Deterministic State**: All honest clients maintain identical sender-key mappings
- **Attack Detection**: Clear protocol violation signal for malicious behavior
- **Backward Compatibility**: Doesn't affect normal epoch transition behavior

### 8.2.7 Epoch Authenticity Records

To prevent server-induced "split epoch" attacks, each epoch transition MUST include a cryptographically signed **Epoch Authenticity Record**:

```
epochAuthenticityRecord = {
  "type": "EPOCH_AUTHENTICITY_RECORD",
  "groupId": "...",
  "epochId": 42,
  "previousEpochId": 41,
  "members": [
    {"userId": "...", "deviceId": "..."},
    {"userId": "...", "deviceId": "..."}
  ],
  "adminDeviceIds": ["...", "..."],
  "createdAt": 1701763200000,
  "reason": "member_added",
  "adminSignatures": [
    {
      "adminDeviceId": "...",
      "signature": "Ed25519_sign(adminDevicePrivKey, canonicalCBOR(record_without_signatures))"
    }
  ]
}
```

**Verification Requirements:**
1. **Signature Verification**: At least one valid signature from current `adminDeviceIds`
2. **Membership Binding**: `members` list exactly matches devices authorized for this epoch
3. **Epoch Continuity**: `previousEpochId` matches locally stored epoch (or 0 for first epoch)
4. **Monotonicity**: `epochId` > `previousEpochId`
5. **Timestamp Reasonableness**: `createdAt` within acceptable clock skew (±5 minutes)

**Distribution Protocol:**
- Admin devices sign and submit epoch change requests to server
- Server broadcasts `epochAuthenticityRecord` to all group members
- Clients verify signatures before accepting new epoch
- Server cannot modify membership lists without valid admin signatures

**Security Properties:**
- **Server Binding**: Server cannot create different membership lists for different clients
- **Epoch Integrity**: All clients have identical, verifiable view of group composition
- **Non-Repudiation**: Admin signatures provide audit trail of membership changes
- **Replay Protection**: Timestamp and epoch ID prevent replay of old records

### 8.2.8 Epoch Synchronization (Authoritative Model)

FoxWhisper uses an **authoritative epoch model** enhanced with authenticity records:

- Server maintains authoritative epoch number for each group (metadata-only)
- Server cannot decrypt any group content or modify membership without admin signatures
- Clients sign membership-change requests and send to server
- Server broadcasts signed `epochAuthenticityRecord` to all group members
- Clients verify epoch authenticity records before accepting changes

This approach avoids consensus protocols, distributed voting, and MLS-level complexity while providing cryptographically verifiable group operation.

### 8.2.8 Small-Group DR Profile (Optional)

For very small groups (e.g., 2–3 members), implementations MAY use pure DR fan-out instead of sender-key profile. This is defined as:

- A distinct 1:1 DR session between each device pair in group
- One encrypted copy of each message per recipient device

This mode is simple but does not scale. It is RECOMMENDED only for ad-hoc, small, private groups.

---

## 8.3 Scalability and Performance

### 8.3.1 Recommended Limits

- **Maximum group size**: 10,000 members per group
- **Maximum skipped group keys**: 1,000 per sender
- **Maximum group message gap**: 1,000 messages per sender
- **Epoch transition timeout**: 30 seconds
- **Maximum groupMessageIndex**: 2^32 - 1 (4,294,967,295)

### 8.3.2 Group Message Index Overflow Semantics

**Problem**: `groupMessageIndex` is a monotonically increasing counter that will eventually reach its maximum value (2^32 - 1). Without defined overflow behavior, implementations may fail unpredictably.

**Mandatory Overflow Handling:**

1. **Index Type**: `groupMessageIndex` MUST be treated as a 32-bit unsigned integer.

2. **Maximum Index**: Implementations MUST reject messages with `groupMessageIndex > 2^32 - 1`.

3. **Epoch Rotation Trigger**: When any sender's `groupMessageIndex` approaches the limit (within 1,000,000 messages), group admins SHOULD initiate a new epoch to reset all counters.

4. **Emergency Rollover**: If epoch rotation is not possible and a sender reaches `groupMessageIndex = 2^32 - 1`:
   - Sender MUST generate a new `groupSenderCK_0` for the current epoch
   - Sender MUST reset `groupMessageIndex` to 0
   - Sender MUST distribute new `groupSenderCK_0` to all group members
   - Receivers MUST accept the new chain key and reset their stored index for that sender

**Implementation Requirements:**

```
// Pseudocode for index management
function advanceGroupMessageIndex(senderKey) {
  if (senderKey.messageIndex >= MAX_SAFE_INDEX) {  // 2^32 - 1,000,000
    // Approaching limit - trigger epoch rotation
    requestEpochRotation()
    throw new NearIndexLimit("Message index approaching maximum")
  }
  
  if (senderKey.messageIndex == MAX_INDEX) {  // 2^32 - 1
    // Emergency rollover
    senderKey.chainKey = generateNewChainKey()
    senderKey.messageIndex = 0
    distributeNewChainKey(senderKey)
    return senderKey.chainKey
  }
  
  senderKey.messageIndex++
  return deriveMessageKey(senderKey.chainKey, senderKey.messageIndex)
}
```

**Security Considerations:**

1. **Key Separation**: Emergency rollover MUST generate a fresh `groupSenderCK_0`, not continue the existing chain.

2. **Distribution Security**: New chain keys during rollover MUST follow standard authenticated group key distribution procedures.

3. **State Consistency**: All group members MUST receive and accept the new chain key before the sender can use it.

4. **Audit Trail**: Emergency rollovers SHOULD be logged as security events for group administrators.

**Operational Impact:**

- **Normal Usage**: With typical group messaging patterns, index overflow should never occur in practice
- **High-Volume Groups**: Very active groups may approach limits over years of operation
- **Epoch Rotation**: Preferred approach over emergency rollover for operational simplicity
- **Backward Compatibility**: Existing implementations must add overflow handling to interoperate with future versions

### 8.3.2 Storage Impact Analysis

Per device storage requirements for group with N members:

- **Sender chain keys**: N × 32 bytes (one per member)
- **Chain index state**: N × 8 bytes (current index per member)
- **Group metadata**: ~1 KB (epoch history, membership lists)
- **Total**: ~41 bytes per member + metadata

For 1,000 member group: ~41 KB storage per device.

### 8.3.3 Bandwidth Requirements

- **Group messages**: O(1) - single ciphertext to server
- **Key distribution**: O(N) during epoch changes (N = group size)
- **Epoch transitions**: O(N) messages every membership change

---

## 8.4 Media Integration Hooks (Non-Normative)

FoxWhisper v1.0 does not define a media (voice/video) protocol. However, group and 1:1 messaging state is designed to support future media profiles.

Non-normative guidance:

- **1:1 calls:** A future media profile MAY derive per-call media keys from 1:1 DR root key or a dedicated call key:

  ```
  callKey = HKDF(rootKey, "FoxWhisper-Call-" || callId, 32)
  ```

- **Group calls:** A future media profile MAY derive group call keys from a group epoch-level secret (e.g., a group master key derived from sender keys or a dedicated group-call key) and distribute call participation over existing encrypted channels.

- **SFU model:** It is RECOMMENDED that media use an SFU (Selective Forwarding Unit) topology where the server merely routes encrypted media frames without access to media keys.

The exact wire format, codecs, and key schedule for media will be defined in separate **Media Profiles** that reference this specification.

---

# 9. Moderation, Reporting, and Legal Hold

Moderation operates entirely client-side.

## 9.1 Content Reports (1:1 and Group)

To report content:

1. Client decrypts message locally
2. Packages plaintext + message key + metadata
3. Encrypts the report for moderator key(s)
4. Sends report as a signed structure

### 9.1.1 1:1 Message Report Structure

```
{
  "type": "CONTENT_REPORT",
  "reportedMessageId": "...",
  "messageKey": "...?",
  "plaintext": "...",
  "context": "...",
  "reporterDevice": "...",
  "signature": "..."
}
```

### 9.1.2 Group Message Report Structure

```
{
  "type": "CONTENT_REPORT",
  "reportedMessageId": "...",
  "groupId": "...",
  "epochId": 42,
  "senderDeviceId": "...",
  "messageKey": "...?",
  "plaintext": "...",
  "context": "...",
  "reporterDevice": "...",
  "membershipSnapshot": {...}, // Optional: epoch membership for legal context
  "signature": "..."
}
```

## 9.2 Legal Hold

Legal hold operates ONLY on:

- Ciphertext provided by client
- Optionally: exported per-message keys (if hold-eligible)

The protocol explicitly forbids:

- Chain-key escrow
- Session-key escrow
- Server recovery keys
- Silent or automatic retention of message keys

Legal holds are "client-attested evidence bundles," not retroactive decryption.

### 9.2.1 Group Legal Hold

For group messages, legal holds include additional context:

- `groupId`, `epochId`, `senderDeviceId` for message identification
- Optional `membershipSnapshot` of the relevant epoch for legal context
- Group conversation threading and context preservation

---

# 10. Threat Model

### 10.1 Network Attacker
The system protects against:

- Active MITM
- Server tampering
- Replay / splicing via AAD
- Future PQ attackers (via Kyber)
- Group message replay across groups (via groupId validation)

### 10.2 Malicious Server
The server cannot:

- Read messages (1:1 or group)
- Forge user identities
- Inject undetectable modifications
- Break forward secrecy
- Unilaterally create evidence or legal holds
- Manipulate group epochs without admin authorization

### 10.3 Temporary Device Compromise
A fully compromised device can:

- Read plaintext
- Access message keys
- Act on behalf of user while compromise persists
- Access group messages for epochs where device is member

But cannot:

- Recover past ephemeral messages
- Access other devices' keys
- Break future secrecy once DR progresses past compromise
- Access group messages from epochs after device removal

### 10.4 Endpoint Compromise (Full Device Tampering)
Out of scope for confidentiality. Protocol provides rapid post-compromise security restoration via DR and epoch transitions.

---

# 11. Algorithm Agility and Versioning

FoxWhisper is designed to evolve with cryptographic advances while maintaining backward compatibility and security guarantees.

## 11.1 Versioning

This document **is** FoxWhisper Protocol v1.0.

Earlier internal drafts were never deployed and have no compatibility requirements.

Future versions will negotiate via `sessionVersion`.

## 11.2 Algorithm Agility Framework

### 11.2.1 Supported Algorithms Registry

FoxWhisper maintains a registry of supported algorithms with unique identifiers:

```
ALGORITHM_REGISTRY = {
  // KEM (Key Encapsulation Mechanisms)
  "KEM_X25519": 1,
  "KEM_KYBER768": 2,
  "KEM_KYBER1024": 3,
  
  // Signature Algorithms  
  "SIG_ED25519": 1,
  "SIG_ED448": 2,
  "SIG_P256_DSA": 3,
  
  // Symmetric Ciphers
  "AES_256_GCM": 1,
  "CHACHA20_POLY1305": 2,
  
  // Hash Functions
  "SHA256": 1,
  "SHA384": 2,
  "SHA512": 3,
  
  // KDF Functions
  "HKDF_SHA256": 1,
  "HKDF_SHA384": 2
}
```

### 11.2.2 Ciphersuite Negotiation

**Handshake Algorithm Selection:**
```
handshakeOffer = {
  "supportedKEMs": [1, 2, 3],           // Algorithm IDs
  "supportedSignatures": [1, 2],
  "supportedCiphers": [1, 2],
  "supportedHashes": [1, 2, 3],
  "supportedKDFs": [1, 2]
}

handshakeResponse = {
  "selectedKEM": 2,                     // Kyber768
  "selectedSignature": 1,                 // Ed25519
  "selectedCipher": 1,                    // AES-256-GCM
  "selectedHash": 1,                     // SHA256
  "selectedKDF": 1                       // HKDF-SHA256
}
```

**Selection Rules:**
1. Both parties MUST agree on algorithms from their intersection
2. If no intersection exists, handshake fails
3. Preference order: highest security level within intersection
4. Fallback to v1.0 defaults if negotiation fails

### 11.2.3 Algorithm Migration Protocol

**Gradual Migration Process:**

1. **Introduction Phase**:
   - New algorithms added to registry with experimental status
   - Implementations MAY support experimental algorithms
   - Production systems continue using stable algorithms

2. **Stabilization Phase**:
   - After security review, algorithms promoted to stable
   - New implementations MUST support stable algorithms
   - Existing implementations encouraged to upgrade

3. **Deprecation Phase**:
   - Old algorithms marked deprecated with sunset date
   - New sessions MUST NOT use deprecated algorithms
   - Existing sessions may continue until natural termination

4. **Removal Phase**:
   - Deprecated algorithms removed from registry
   - Implementations MAY remove support for removed algorithms

### 11.2.4 Version Compatibility Matrix

| Version | Handshake | DR | Groups | Compliance | Status |
|---------|------------|----|--------|-------------|---------|
| v1.0 | X25519+Kyber | ✓ | ✓ | ✓ | Stable |
| v1.1 | Negotiable | ✓ | ✓ | ✓ | Future |
| v2.0 | PQ-Hybrid | ✓ | ✓ | ✓ | Research |

### 11.2.5 Implementation Requirements

**Mandatory Support (v1.0):**
- `KEM_X25519` and `KEM_KYBER768`
- `SIG_ED25519`
- `AES_256_GCM`
- `SHA256`
- `HKDF_SHA256`

**Optional Support:**
- Additional KEMs for future PQ algorithms
- Alternative signature schemes
- Different cipher modes

**Security Requirements:**
- New algorithms MUST undergo security review before inclusion
- Implementation MUST provide test vectors for all supported algorithms
- Side-channel resistant implementations REQUIRED for all algorithms

### 11.2.6 Forward Compatibility

**Message Format Evolution:**
```
message = {
  "version": 1,
  "algorithms": {
    "kem": 2,
    "cipher": 1,
    "hash": 1
  },
  "payload": "encrypted_content"
}
```

**Handling Unknown Versions:**
- Reject messages from future major versions
- Attempt compatibility with minor version increments
- Log unknown algorithm identifiers for debugging

### 11.2.7 Security Considerations

**Algorithm Selection Criteria:**
1. **Security Level**: Minimum 128-bit post-quantum security
2. **Performance**: Reasonable performance on target platforms
3. **Implementation**: Available in vetted cryptographic libraries
4. **Standardization**: Preference for NIST/ISO standards

**Migration Risks:**
- **Implementation Bugs**: New algorithms may have implementation flaws
- **Performance Regression**: Some algorithms may be slower
- **Compatibility Issues**: Mixed algorithm environments during transition
- **Security Reduction**: Poorly chosen algorithms may reduce overall security

**Mitigation Strategies:**
- Extensive testing before algorithm promotion
- Gradual rollout with fallback options
- Continuous monitoring of security research
- Clear deprecation timelines

---

# 12. Summary of Security Guarantees

FoxWhisper v1.0 provides:

- PQ-resistant handshake
- Double Ratchet forward secrecy
- Post-compromise security
- Clear device isolation
- Client-driven moderation & legal evidence
- Zero server decryption capability
- Scalable group messaging via sender keys
- Extensibility to sender-keys and MLS for group messaging
- Group replay protection via groupId validation
- Authenticated group key distribution
- Authoritative epoch synchronization

---

# 13. Implementation Guidelines

### 13.1 Testing Requirements

Implementations MUST provide test vectors for:

- Hybrid handshake (X25519 + Kyber)
- Double Ratchet state transitions
- Group key distribution and verification
- Epoch transition procedures
- Group message encryption/decryption
- Cross-platform compatibility for all CBOR structures

### 13.2 Error Handling

Implementations MUST handle:

- DR state corruption (session reset)
- Group state desynchronization (re-sync request)
- Epoch transition failures (rollback and retry)
- Authentication failures in group key distribution
- Membership verification failures

### 13.3 Performance Recommendations

- Use hardware acceleration for AES-GCM when available
- Implement efficient skipped key maps with LRU eviction
- Batch group key distribution during epoch changes
- Compress group metadata before persistence

---

# 14. Compliance and Legal Considerations

FoxWhisper v1.0 is designed to comply with:

- **Forward secrecy requirements** via DR and message key classes
- **Legal hold capabilities** via client-side evidence bundles
- **Content moderation** via encrypted reporting system
- **Audit trail requirements** via signed structures and metadata
- **Cross-border data protection** via client-side processing only

Server operators receive only encrypted content and metadata necessary for message routing, with no capability to access plaintext communications.