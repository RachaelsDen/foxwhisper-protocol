# FoxWhisper End-to-End Encryption Protocol
## Version 1.0 — Hybrid PQ Handshake + Double Ratchet Messaging

This specification defines the FoxWhisper End-to-End Encryption (E2EE) protocol. It replaces all earlier drafts. No previous version was deployed. This document therefore constitutes the first stable version of the protocol.

---

# 1. Goals & Overview

FoxWhisper aims to provide:

- Strong end-to-end confidentiality and integrity across multiple devices
- Post-quantum–resistant initial key agreement
- Forward secrecy & post-compromise security via Double Ratchet
- A clear identity hierarchy (User → Device → Session → Message)
- Support for client-side moderation and legal compliance workflows
- Extensibility for future group messaging modes (sender-key / MLS)

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

Signed by the user identity key during device registration.

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

FoxWhisper adopts the classical Signal Double Ratchet, seeded from RK₀.

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

Clients MUST reset the session (new handshake) if:

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
- Derived from the DR chain exactly as ephemeral messages
- BUT the client retains the per-message key for:
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

FoxWhisper v1.0 defines a **group messaging core profile** based on sender keys. This profile is designed for scalable channels and servers, and is layered on top of the 1:1 Double Ratchet sessions described in Section 5.

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

Security goals:

- A device removed from the group MUST NOT receive keys for future epochs.
- A device joining the group MUST NOT receive keys that decrypt past epochs.

---

## 8.2 Sender-Key Group Profile (FW-Group-SK)

FoxWhisper’s primary group mode is a **sender-key profile** inspired by Signal’s sender keys and Matrix’s Megolm. It is optimized for large groups and channels.

### 8.2.1 Per-Sender Group Chain Keys

For each `(groupId, epochId, senderDeviceId)` tuple, the sender device generates a random 32-byte chain key:

```
groupSenderCK_0 = random(32)
```

This key is distributed to all devices in the group **over existing 1:1 DR sessions** using normal FoxWhisper encrypted messages (Section 5). The payload type for such distribution is an implementation detail, but MUST be authenticated and bound to:

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

4. Transmit a single ciphertext to the server, which fan-outs this same payload to all group members.

### 8.2.3 Group Message Decryption

On receiving a group message, a device:

1. Parses the header and computes AAD as above.
2. Looks up `groupSenderCK_0` for `(groupId, epochId, senderDeviceId)`.
3. Advances the chain key from index 0 to `groupMessageIndex` using the same HKDF-based chain derivation, caching any intermediate message keys if necessary.
4. Uses `groupMsgKey_n` to decrypt.

Implementations MUST:

- Maintain a bounded map of skipped group message keys (similar to `skippedKeys` in DR)
- Enforce a maximum forward ratchet gap per sender in a group
- Treat inconsistent or impossible indices as potential corruption and require re-synchronization

Group message keys MAY be treated as **ephemeral** or **hold-eligible** exactly as in Section 6, depending on policy.

### 8.2.4 Membership Changes and Epochs

When a group membership change occurs (join, leave, kick, ban, or device revocation of a member), the group enters a new epoch:

1. Increment `epochId`.
2. For each remaining sender device in the group, generate a new `groupSenderCK_0` for the new epoch.
3. Distribute new epoch chain keys using 1:1 DR channels.

Security properties:

- Removed devices do not receive new epoch chain keys, and thus cannot decrypt future group messages.
- Newly added devices receive only the current epoch chain keys, and thus cannot decrypt past group messages.

### 8.2.5 Small-Group DR Profile (Optional)

For very small groups (e.g., 2–3 members), implementations MAY use pure DR fan-out instead of the sender-key profile. This is defined as:

- A distinct 1:1 DR session between each device pair in the group
- One encrypted copy of each message per recipient device

This mode is simple but does not scale. It is RECOMMENDED only for ad-hoc, small, private groups.

---

## 8.3 Media Integration Hooks (Non-Normative)

FoxWhisper v1.0 does not define a media (voice/video) protocol. However, group and 1:1 messaging state is designed to support future media profiles.

Non-normative guidance:

- **1:1 calls:** A future media profile MAY derive per-call media keys from the 1:1 DR root key or a dedicated call key:

  ```
  callKey = HKDF(rootKey, "FoxWhisper-Call-" || callId, 32)
  ```

- **Group calls:** A future media profile MAY derive group call keys from a group epoch-level secret (e.g., a group master key derived from sender keys or a dedicated group-call key) and distribute call participation over existing encrypted channels.

- **SFU model:** It is RECOMMENDED that media use an SFU (Selective Forwarding Unit) topology where the server merely routes encrypted media frames without access to media keys.

The exact wire format, codecs, and key schedule for media will be defined in separate **Media Profiles** that reference this specification.

---

# 9. Moderation, Reporting, and Legal Hold

Moderation operates entirely client-side.

### 9.1 Content Reports

To report content:

1. Client decrypts the message locally
2. Packages plaintext + message key + metadata
3. Encrypts the report for moderator key(s)
4. Sends report as a signed structure

Report structure:

```
{
  "type": "CONTENT_REPORT",
  "reportedMessageId": ...,
  "messageKey": ...?,
  "plaintext": ...,
  "context": ...,
  "reporterDevice": ...,
  "signature": ...
}
```

### 9.2 Legal Hold

Legal hold operates ONLY on:

- Ciphertext provided by the client
- Optionally: exported per-message keys (if hold-eligible)

The protocol explicitly forbids:

- Chain-key escrow
- Session-key escrow
- Server recovery keys
- Silent or automatic retention of message keys

Legal holds are "client-attested evidence bundles," not retroactive decryption.

---

# 10. Threat Model

### 10.1 Network Attacker
The system protects against:

- Active MITM
- Server tampering
- Replay / splicing via AAD
- Future PQ attackers (via Kyber)

### 10.2 Malicious Server
The server cannot:

- Read messages
- Forge user identities
- Inject undetectable modifications
- Break forward secrecy
- Unilaterally create evidence or legal holds

### 10.3 Temporary Device Compromise
A fully compromised device can:

- Read plaintext
- Access message keys
- Act on behalf of the user while compromise persists

But cannot:

- Recover past ephemeral messages
- Access other devices' keys
- Break future secrecy once DR progresses past compromise

### 10.4 Endpoint Compromise (Full Device Tampering)
Out of scope for confidentiality. Protocol provides rapid post-compromise security restoration via DR.

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
- Extensibility to sender-keys and MLS for group messaging

