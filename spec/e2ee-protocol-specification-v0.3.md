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

# 8. Group Messaging (Profile Placeholder)

FoxWhisper v1.0 defines only the 1:1 DR mode. Group messaging will be specified in profile documents:

### Profile A: FW-Group-DR (small groups)
Pairwise fan-out on DR channels.

### Profile B: FW-Group-SK (recommended)
Sender-key group messaging (Megolm-style):
- Each sender device holds a group chain key
- One encryption per message
- Uses DR for distributing sender keys
- Scales well for large groups

### Profile C: FW-Group-MLS (future)
MLS tree-based group mode for high-security environments.

Group profiles are layered on top of this v1.0 core.

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

