# FoxWhisper End-to-End Encryption Protocol — v0.7 Draft

*This is a working draft. It builds on v0.6, strengthening formal properties, clarifying multi-device and epoch invariants, adding performance and concurrency semantics, and introducing the first formal modeling hooks.*

---

# 1. Introduction

FoxWhisper is a modern end-to-end encrypted communication protocol designed for multi-device users, scalable group messaging, PQ-hardness, and future integration with secure voice/video media layers.

This version (v0.7):

- finalizes structural invariants
- defines complete message validity rules
- specifies adversarial behaviors and device-reset semantics
- introduces timing, ordering, and consistency requirements
- defines a formal semantics layer for future machine verification
- adds interface hooks for SFU-based media encryption

---

# 2. Cryptographic Primitives (v0.7 Baseline Suite)

Mandatory algorithms:

| Purpose | Algorithm | Notes |
|--------|-----------|-------|
| PQ/KEM | Kyber-1024 | Hybrid with X25519 |
| DH Ratchet | X25519 | Standard |
| Signature | Ed25519 | Identity + message signatures |
| AEAD | AES-256-GCM | Future agility supported |
| Hash | SHA-256 | Canonical |
| KDF | HKDF-SHA256 | Uniform across protocol |
| Encoding | CBOR | Canonical ordering required |

Cipher suite ID for v0.7:

```
FW-CIPHERSUITE-1 = {
  kem: Kyber-1024,
  dh: X25519,
  aead: AES-256-GCM,
  hash: SHA256
}
```

Future suites MUST follow the agility rules in section 14.

---

# 3. Identity System

Exactly as defined in v0.6, with the following new invariant:

> **Invariant 3.1: Device Identity Binding**  
> A device’s Ed25519 identity key MUST be bound to its user account at time of registration via a signed server receipt that clients use to anchor trust.

This prevents “device shadowing” attacks introduced in multi-device configurations.

---

# 4. Handshake Protocol (PQXDH-FW)

Identical to v0.6 except:

### 4.7 Formalized Transcript Construction

For each handshake, define:

```
transcript = SHA256(
    canonicalCBOR({
        clientHello,
        serverHello,
        kemCiphertext,
        dh1_pub,
        dh2_pub,
        aeadCiphertext
    })
)
```

This transcript is referenced:

- in security proofs,
- for consistency checks,
- for optional transparency logging.

---

# 5. 1:1 Sessions (Double Ratchet)

The DR state definitions from v0.6 remain unchanged.

Enhancements in v0.7:

### 5.9 Formal DR Event Model

To support formal verification, define three events:

```
DR_AdvanceSendingChain
DR_AdvanceReceivingChain
DR_DHRatchetStep
```

Each MUST be modeled as a deterministic state transition function:

```
state' = DR_Event(state, eventData)
```

### 5.10 L Liveness Requirements

A client MUST trigger a DHRatchetStep after at most *N* messages without a peer DH update (default N=500), to guarantee forward secrecy over long-lived sessions.

---

# 6. Group Messaging (FW-Group-SK)

Fully inherited from v0.6, with the following critical refinements:

### 6.1 Sender-Key Root Uniqueness (Strong Form)

Add:

> A client MUST reject any `groupSenderCK_0` that arrives **after** that sender has already emitted or accepted a message in the epoch.

This closes a narrow poisoning hole around race conditions.

### 6.2 Epoch Authenticity Record (EARE) — v0.7 Formalization

Define:

```
EpochAuthenticityRecord = {
  groupId,
  epochId,
  members: [ (userId, deviceId, devicePubKey) ],
  previousEpochHash,
  timestamp,
  adminSignature
}
```

Clients MUST verify:

```
SHA256(EARE_prev) == EARE_current.previousEpochHash
```

This creates a **hash chain** of epochs, preventing forking attacks.

### 6.3 Membership Consistency Check

On receiving a group message:

```
if senderDeviceId ∉ EARE.members:
    reject("Invalid sender for epoch")
```

---

# 7. Message Signatures (Optional but Recommended)

v0.7 introduces a formal signature payload:

```
MessageSignaturePayload = {
  groupId?,
  sessionId?,
  epochId?,
  senderDeviceId,
  messageIndex?,
  ciphertextHash,
  headerHash,
  timestamp
}
```

Signature:

```
sig = Ed25519_sign(deviceIdentityKey, canonicalCBOR(payload))
```

A message with an invalid signature MUST be rejected.

---

# 8. Multi-Device Semantics (v0.7 Final Form)

### 8.1 Device Reset Behavior

If a device loses its state:

- it MUST NOT reuse previous sender-key chains  
- it MUST emit a rejoin request  
- the group MUST enter a new epoch  
- other devices MUST discard any cached message keys for that sender  

### 8.2 Index Synchronization

Devices MUST maintain a persistent mapping:

```
(senderDeviceId → highestSeenMessageIndex)
```

### 8.3 Backup Restrictions

Backups MUST NOT contain:

- DR chain keys  
- sender-key chain states  
- any messageKey_n  

Backups MAY contain:

- EAREs  
- membership lists  
- device identity keys (encrypted)  
- local settings  

---

# 9. Replay Protection (v0.7 Expanded)

A message is invalid if:

- `epochId < localEpoch`  
- timestamp outside allowed window (default ±10 minutes)  
- a `(senderDeviceId, messageIndex)` tuple already processed  
- signature is invalid  
- chain index is beyond max gap window  

This section is now complete for formal proofs.

---

# 10. Consistency Requirements & Error Semantics

Define explicit behaviors:

### 10.1 Hard Failures

Must terminate session or group:

- invalid EARE signature  
- tampered hash chain  
- repeated SenderKey roots  

### 10.2 Soft Failures

May recover:

- out-of-order packets  
- unsigned messages in groups that do not require signatures  
- missing cached keys  
- timestamp skew  

---

# 11. Formal Verification Hooks

v0.7 introduces a structured model suitable for ProVerif or Tamarin.

### 11.1 Actors

```
User U
Device D ∈ U.devices
Server S (untrusted)
Network attacker A (Dolev–Yao)
```

### 11.2 Security Properties

Formal goals:

- **Confidentiality:** No A can obtain plaintext of any ciphertext.  
- **FS:** Compromise of current state does not reveal future messages.  
- **PCS:** Compromise does not reveal past messages after rekey.  
- **Group Sender Integrity:** Only valid members can produce a message.  
- **Epoch Integrity:** Membership proofs are globally verifiable.

### 11.3 Events for Proofs

```
event SendMessage(sender, groupId, epochId)
event ReceiveMessage(receiver, groupId, epochId)
event EpochChange(groupId, epochId)
event DeviceCompromised(deviceId)
```

---

# 12. Performance & Concurrency Semantics

### 12.1 Batched Key Distribution

Servers MAY batch distribute EARE + sender roots to reduce load.

### 12.2 Parallel Decryption

Clients SHOULD:

- maintain parallel DR and group pipelines  
- cache derived message keys per message window  
- prune expired keys on epoch change  

### 12.3 SFU Routing Prep

To allow encrypted media in v0.8:

```
callKey = HKDF(groupMasterSecret, "FW-CallKey" || callId, 32)
```

Group callKey derivation MUST be per-epoch.

---

# 13. Persistence Format (v0.7 Final)

Define canonical CBOR schemas for:

- Device State  
- Session State  
- Group State  
- EpochAuthenticityRecord  
- Replay Cache  

All MUST use deterministic CBOR encoding.

---

