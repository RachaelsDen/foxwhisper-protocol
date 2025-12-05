# FoxWhisper End-to-End Encryption Protocol
## Version 1.0 — Hybrid PQ Handshake + Double Ratchet + Group Messaging

This specification defines FoxWhisper End-to-End Encryption (E2EE) protocol. It replaces all earlier drafts. No previous version was deployed. This document therefore constitutes first stable version of protocol.

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

4. Transmit a single ciphertext to server, which fan-outs this same payload to all group members.

### 8.2.3 Group Message Decryption

On receiving a group message, a device:

1. Parses header and computes AAD as above.
2. **MUST reject messages whose AAD groupId does not match local group context.**
3. Looks up `groupSenderCK_0` for `(groupId, epochId, senderDeviceId)`.
4. Advances chain key from index 0 to `groupMessageIndex` using same HKDF-based chain derivation, caching any intermediate message keys if necessary.
5. Uses `groupMsgKey_n` to decrypt.

Implementations MUST:

- Maintain a bounded map of skipped group message keys (similar to `skippedKeys` in DR)
- Enforce a maximum forward ratchet gap per sender in a group (e.g., 1000 messages)
- Treat inconsistent or impossible indices as potential corruption and require re-synchronization

Group message keys MAY be treated as **ephemeral** or **hold-eligible** exactly as in Section 6, depending on policy.

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

Clients MUST persist group state in canonical CBOR format:

```
groupState = {
  "groupId": "...",
  "currentEpochId": 42,
  "epochs": {
    "42": {
      "epochId": 42,
      "members": [...],
      "adminDeviceIds": [...],
      "createdAt": 1701763200000,
      "reason": "member_added"
    }
  },
  "perSenderChainIndex": {
    "userA_device1": 15,
    "userB_device2": 8
  },
  "senderChainKeys": {
    "userA_device1": "base64-encoded-key",
    "userB_device2": "base64-encoded-key"
  }
}
```

**Recovery Rule**: If group state is missing or corrupted, clients MUST request re-sync from peers or server to recover the current epoch state.

### 8.2.6 Authenticated Group Key Distribution

Group chain key distribution messages MUST be authenticated:

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
4. Reject if any check fails

### 8.2.7 Epoch Synchronization (Authoritative Model)

FoxWhisper uses an **authoritative epoch model** for simplicity and reliability:

- Server maintains authoritative epoch number for each group (metadata-only)
- Server cannot decrypt any group content
- Clients sign membership-change requests and send to server
- Server broadcasts epoch change notifications to all group members
- Clients verify epoch-change notifications using admin signatures

This approach avoids consensus protocols, distributed voting, and MLS-level complexity while providing reliable group operation.

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

# 11. Versioning

This document **is** FoxWhisper Protocol v1.0.

Earlier internal drafts were never deployed and have no compatibility requirements.

Future versions will negotiate via `sessionVersion`.

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