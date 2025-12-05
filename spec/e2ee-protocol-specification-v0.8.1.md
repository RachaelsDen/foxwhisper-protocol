# FoxWhisper v0.8.1 — Threat Model & Key Schedule Refinements

*Prepared by ChatGPT — formal verification framework, media cryptographic core, security invariants*
*Expanded by GLM 4.6 — complete specification with formal proofs, performance architecture, and conformance testing*
*Refined v0.8.1 — Unified threat model, cleaner key schedule, deterministic IV strategy, SFU auth binding, epoch skew tolerance, tightened theorem wording*

---

# 0. Preface

FoxWhisper v0.8.1 represents critical refinements to the v0.8 specification, focusing on threat model standardization, cryptographic hygiene, and implementation clarity. This version maintains all security guarantees while improving formal verification friendliness and operational robustness.

## 0.1 Version Goals

v0.8.1 achieves six specific refinement objectives:

- **Threat Model Unification**: Replace fragmented adversary definitions with a single Dolev-Yao adversary model for formal verification clarity
- **Key Schedule Hygiene**: Clean up media key derivation hierarchy to eliminate frame_counter from epoch key computation
- **IV Strategy Standardization**: Implement deterministic GCM nonce construction to prevent catastrophic nonce reuse
- **SFU Authentication Binding**: Anchor SFU authentication to existing trust graph with explicit key derivations
- **Epoch Skew Tolerance**: Add bounded tolerance for cross-layer epoch mismatches to improve real-world robustness
- **Theorem Wording Precision**: Tighten formal property language to accurately reflect security guarantees

## 0.2 Relationship to Previous Versions

v0.8.1 is a refinement release building directly on v0.8's foundation:

- **v0.8**: Formal verification + media integration
- **v0.8.1**: Threat model cleanup + key schedule refinements + implementation robustness

This is a compatibility-preserving update - all v0.8 implementations remain valid, with v0.8.1 providing clearer specifications for new implementations.

## 0.3 Scope and Applicability

FoxWhisper v0.8.1 maintains the same scope as v0.8 with enhanced clarity:

**Enterprise Deployments**: Now with standardized threat model for compliance certification
**High-Security Applications**: Improved formal verification friendliness for government/financial use
**Media-Intensive Platforms**: Cleaner key schedule for media encryption implementations
**Standards Development**: More precise theorem statements for academic analysis

---

# 1. Introduction

FoxWhisper v0.8.1 introduces critical refinements to the v0.8 specification, focusing on threat model standardization, cryptographic hygiene, and implementation clarity without changing core security guarantees.

## 1.1 Version Goals

v0.8.1 achieves six specific refinement objectives:

**Threat Model Unification**: Replace fragmented adversary definitions with a single Dolev-Yao adversary model for formal verification clarity

**Key Schedule Hygiene**: Clean up media key derivation hierarchy to eliminate frame_counter from epoch key computation

**IV Strategy Standardization**: Implement deterministic GCM nonce construction to prevent catastrophic nonce reuse

**SFU Authentication Binding**: Anchor SFU authentication to existing trust graph with explicit key derivations

**Epoch Skew Tolerance**: Add bounded tolerance for cross-layer epoch mismatches to improve real-world robustness

**Theorem Wording Precision**: Tighten formal property language to accurately reflect security guarantees

## 1.2 Relationship to Previous Versions

v0.8.1 is a refinement release building directly on v0.8's foundation:

- **v0.8**: Formal verification + media integration
- **v0.8.1**: Threat model cleanup + key schedule refinements + implementation robustness

This is a compatibility-preserving update - all v0.8 implementations remain valid, with v0.8.1 providing clearer specifications for new implementations.

## 1.3 Scope and Applicability

FoxWhisper v0.8.1 maintains the same scope as v0.8 with enhanced clarity:

**Enterprise Deployments**: Now with standardized threat model for compliance certification
**High-Security Applications**: Improved formal verification friendliness for government/financial use
**Media-Intensive Platforms**: Cleaner key schedule for media encryption implementations
**Standards Development**: More precise theorem statements for academic analysis

---

# 2. Formal Verification Framework

FoxWhisper v0.8.1 refines the formal verification framework with a unified threat model and clearer security properties.

## 2.1 System Model

### 2.1.1 Actors

| Actor | Capabilities | Trust Model |
|--------|-------------|------------|
| Client Device C | Cryptographic operations, state management | Honest or compromised |
| Group Controller G | Membership management, epoch authority | Honest |
| Metadata Server S | Message routing, metadata storage | Dolev-Yao adversary |
| SFU F | Media frame forwarding, participant management | Dolev-Yao adversary |
| Network Attacker A | Full network control, Byzantine behavior | Dolev-Yao adversary |

### 2.1.2 Unified Dolev-Yao Adversary Model

**Adversary Capabilities**:
The attacker controls the network and may fully control the metadata server and SFU. They can intercept, replay, drop, reorder, and inject messages at will, and may cause the server and SFU to behave arbitrarily (Byzantine behavior).

**Trust Boundaries**:
- **Trusted Parties**: Clients and group controllers are the only trusted parties
- **Untrusted Parties**: Metadata server and SFU are "logically untrusted; modelled as if fully controlled by the adversary"

**Formal Adversary Definition**:
```
Adversary A ∈ Dolev-Yao:
  - Can read, modify, drop, reorder, inject all network messages
  - Can control metadata server S and SFU F completely
  - Cannot compromise honest client devices or group controller
  - Has unlimited computational power (cryptographic security only)
```

This unified model makes formal verification more standard and easier to reason about.

### 2.1.3 Event System

**Cryptographic Events**:
- `HandshakeInit(C, S, params)` - Initiate PQ handshake
- `HandshakeComplete(C, S, session_key)` - Establish shared secret
- `EpochAdvance(G, epoch_id, EARE)` - Transition to new epoch
- `SendMessage(D, G, msg)` - Send encrypted message
- `ReceiveMessage(D, G, msg)` - Receive encrypted message

**Media Events**:
- `SendMediaFrame(C, F, frame)` - Send encrypted media frame
- `ReceiveMediaFrame(C, F, frame)` - Receive encrypted media frame
- `DeviceJoin(C, call_id, participant)` - Participant joins call
- `DeviceLeave(C, call_id, participant)` - Participant leaves call

**State Events**:
- `DeviceReset(D)` - Device loses state and rejoins
- `DeviceCompromise(D)` - Device confirmed compromised

## 2.2 Formal State Machines

### 2.2.1 Double Ratchet State Machine

```
DR_State = {
  root_key: K_R,
  dh_private: k_dh_priv,
  dh_public: k_dh_pub,
  send_chain_key: K_CK_s,
  recv_chain_key: K_CK_r,
  send_counter: N_s,
  recv_counter: N_r,
  skipped_keys: Map<uint, K_msg>
}

Transitions:
- DR_AdvanceSendingChain(DR_State) -> DR_State'
- DR_AdvanceReceivingChain(DR_State) -> DR_State'
- DR_DHRatchetStep(DR_State, dh_pub_remote) -> DR_State'
```

### 2.2.2 Group Messaging State Machine

```
Group_State = {
  group_id: GID,
  epoch_id: EID,
  members: Set<Device>,
  eare_chain: EARE_0, EARE_1, ..., EARE_n,
  sender_keys: Map<Device, GroupSenderCK_0>,
  message_indices: Map<Device, uint>
}

Transitions:
- Group_AddMember(Group_State, Device) -> Group_State'
- Group_RemoveMember(Group_State, Device) -> Group_State'
- Group_EpochAdvance(Group_State, EARE) -> Group_State'
- Group_ReceiveMessage(Group_State, Message) -> Group_State'
```

### 2.2.3 Media State Machine

```
Media_State = {
  call_id: CallID,
  call_key: K_call,
  participants: Set<Device>,
  stream_keys: Map<Device, Map<StreamID, K_stream>>,
  media_epoch: MEID
}

Transitions:
- Media_AddParticipant(Media_State, Device) -> Media_State'
- Media_RemoveParticipant(Media_State, Device) -> Media_State'
- Media_Rekey(Media_State) -> Media_State'
```

## 2.3 Security Properties

### 2.3.1 Confidentiality

**Theorem**: An adversary cannot learn the plaintext of a message unless it compromises at least one endpoint device that legitimately holds the corresponding session or group keys.

**Formal Statement**:
```
forall msg, A: 
  (msg ∈ Messages ∧ A ∉ CompromisedDevices) =>
    A ⊬ plaintext(msg)
```

**Proof Sketch**: Uses standard IND-CPA security of AEAD construction combined with DH key exchange secrecy.

### 2.3.2 Forward Secrecy

**Theorem**: Compromise of a device at time t does not reveal message keys for messages sent after t.

**Formal Statement**:
```
forall t, msg, D:
  (msg.time > t ∧ D ∈ CompromisedAt(t)) =>
    D ⊬ msg_key(msg)
```

**Proof Sketch**: Ratchet advancement ensures new key material is derived after each message, preventing backward key derivation.

### 2.3.3 Post-Compromise Security

**Theorem**: After a device compromise at time t, an attacker cannot forge messages that appear to come from the compromised device for times > t. Healing events are triggered by: (a) a new DH ratchet step, (b) a new epoch with fresh sender keys, or (c) a device reset/rejoin with fresh keys.

**Formal Statement**:
```
forall t, msg, A:
  (CompromiseDetected(t) ∧ msg.time > t ∧ msg.sender = D) =>
    A ⊬ forge(msg, D)
```

**Proof Sketch**: Device identity keys and message signatures prevent post-compromise forgery, with explicit healing triggers.

### 2.3.4 Epoch Integrity

**Theorem**: All honest devices have identical views of group membership for each epoch.

**Formal Statement**:
```
forall epoch, D1, D2:
  (D1, D2 ∈ HonestDevices) =>
    membership_view(D1, epoch) = membership_view(D2, epoch)
```

**Proof Sketch**: Hash-chained Epoch Authenticity Records (EARE) prevent membership forking attacks.

### 2.3.5 Replay Security

**Theorem**: An adversary cannot successfully replay a message outside its acceptable replay window.

**Formal Statement**:
```
forall msg, A:
  (msg.replay ∧ now - msg.timestamp > REPLAY_WINDOW) =>
    msg.accepted = false
```

**Proof Sketch**: Message indices and timestamps create unique, non-replayable identifiers.

## 2.4 Tamarin/ProVerif Model Hooks

### 2.4.1 Protocol Rules for Tamarin

```
rule Handshake_Init:
  [ Frac(~ltkA @ A), !HandshakeStarted(A, B) ]
  --[ HandshakeInit(A, B, params) ]
  -> [ HandshakeStarted(A, B), Frac(ltkA @ A) ]

rule DR_Send_Message:
  [ SendReady(D), DR_State(D, ck, n) ]
  --[ SendMessage(D, encrypt(plaintext, ck), n) ]
  -> [ SendReady(D), DR_State(D, ck', n+1) ]

rule Group_Epoch_Advance:
  [ EpochReady(G), EARE(E), Group_State(G, epoch) ]
  --[ EpochAdvance(G, epoch+1, EARE') ]
  -> [ EpochReady(G), Group_State(G, epoch+1), EARE'(E) ]
```

### 2.4.2 ProVerif Equations

```
function derive_message_key(chain_key, index):
  return HKDF(chain_key, "FW-Message", 32, index)

function verify_epoch_integrity(eare_current, eare_previous):
  return SHA256(eare_previous) == eare_current.previous_epoch_hash

function check_sender_key_uniqueness(sender_id, epoch, new_key):
  existing_key = get_sender_key(sender_id, epoch)
  return existing_key == NULL || existing_key == new_key
```

### 2.4.3 Lemmas for Automated Proofs

**Lemma 1 (Key Separation)**: Message keys derived from different chain keys are computationally independent.

**Lemma 2 (Epoch Monotonicity)**: Epoch IDs strictly increase and never repeat.

**Lemma 3 (Sender Uniqueness)**: Each sender can have only one root key per epoch.

These lemmas enable automated theorem proving for core security properties.

---

# 3. FoxWhisper Media Profile v1 (SFU-Based)

FoxWhisper Media Profile v1 provides a complete, secure media encryption framework designed for Selective Forwarding Units (SFUs) while maintaining end-to-end security. The profile integrates seamlessly with FoxWhisper messaging protocol and enables real-time voice/video communication with formal security guarantees.

## 3.1 Design Principles

**SFU Trust Model**: The SFU is a trusted-but-untrusted network element that routes encrypted media frames without accessing plaintext content.

**End-to-End Security**: Media encryption and decryption occur only on endpoint devices, never on SFU or intermediate network elements.

**Scalability**: Support for large group calls (100+ participants) with efficient bandwidth usage and minimal latency.

**Forward Secrecy**: Compromise of stream keys does not reveal past or future media frames from other streams.

## 3.2 Cryptographic Foundations

### 3.2.1 Key Hierarchy

```
User Identity Key (Ed25519)
    └── Device Identity Keys (Ed25519)
        └── Call Keys (per-call)
            └── Stream Keys (per-participant, per-stream)
                └── Frame Keys (per-frame, derived from stream keys)
```

### 3.2.2 Media Key Schedule (Refined)

**Call Key Derivation**:
```
callKey = HKDF(
    input_key_material = handshake_secret || participant_list || call_context,
    salt = 0x00,
    info = "FoxWhisper-CallKey" || call_id || participant_count,
    L = 32
)
```

**Stream Key Derivation**:
```
streamKey[i] = HKDF(
    input_key_material = callKey || participant_id[i] || stream_id[i],
    salt = 0x00,
    info = "FoxWhisper-StreamKey" || call_id || participant_id[i] || stream_id[i],
    L = 32
)
```

**Media Epoch Key Derivation (Refined)**:
```
mediaEpochKey[i] = HKDF(
    input_key_material = streamKey[i],
    salt = media_epoch,
    info = "FW-MediaEpochKey",
    L = 32
)
```

**Frame Key Derivation (Refined)**:
```
frameKey[i][n] = HKDF(
    input_key_material = mediaEpochKey[i],
    salt = frame_sequence[n],
    info = "FW-FrameKey",
    L = 32
)
```

**Key Hierarchy Clarifications**:
- `mediaEpochKey` depends only on `streamKey` + `media_epoch` (one key per epoch)
- `frameKey` depends on `mediaEpochKey` + `frame_sequence`
- `frame_counter` is removed from epoch key derivation entirely
- Clean separation between epoch-level and frame-level key derivation

### 3.2.3 Security Properties

**Participant Isolation**: Stream keys are derived per-participant, preventing cross-participant key leakage.

**Temporal Separation**: Media epoch keys provide forward secrecy within calls, with automatic rekeying on epoch boundaries.

**Frame-Level Security**: Each media frame is encrypted with unique frame keys, preventing frame replay attacks.

**Key Compromise Containment**: Compromise of a participant's stream key reveals only their media, not other participants' content.

## 3.3 SFU Authentication Framework (Refined)

### 3.3.1 Authentication Model

The SFU must authenticate both clients and media frames to prevent unauthorized access and frame injection attacks. All SFU authentication is rooted in the existing trust graph.

### 3.3.2 Client Authentication (Refined)

**Client SFU Auth Key Derivation**:
```
client_sf_auth_key = HKDF(
    input_key_material = handshake_secret,
    salt = 0x00,
    info = "FW-SFU-ClientAuth" || client_id,
    L = 32
)
```

**Client → SFU Authentication**:
```
auth_token = HMAC-SHA256(
    key = client_sf_auth_key,
    message = call_id || client_id || timestamp || nonce
)
```

**SFU Secret Key Derivation**:
```
// Option A: SFU with long-term identity key
sfu_secret_key = HKDF(
    input_key_material = sfu_identity_privkey,
    salt = 0x00,
    info = "FW-SFU-AuthKey",
    L = 32
)

// Option B: SFU with pre-shared secret
sfu_secret_key = pre_shared_secret_managed_by_infrastructure
```

**SFU → Client Authentication**:
```
sfu_token = HMAC-SHA256(
    key = sfu_secret_key,
    message = call_id || sfu_session_id || expiry || client_capabilities
)
```

**Token Lifetime and Replay Window**:
- Tokens MUST have a short expiry (e.g., ≤ 5 minutes)
- Tokens MUST include a nonce and timestamp
- Clients MUST reject tokens outside a ±Δ clock skew window
- Replays of the same (token, nonce) MUST be rejected

### 3.3.3 Media Frame Authentication

**Frame Authentication Tags**:
```
auth_tag = HMAC-SHA256(
    key = frameKey,
    message = frame_header || encrypted_payload || frame_sequence
)
```

**Authentication Verification**:
- SFU verifies client authentication tokens before routing media
- Clients verify SFU authentication tokens before accepting media
- Media frames include authentication tags for integrity verification

## 3.4 Media Frame Structure

### 3.4.1 Frame Header

```
media_frame_header = {
    version: 1,
    call_id: 128-bit identifier,
    participant_id: 128-bit identifier,
    stream_id: 32-bit identifier,
    frame_sequence: 64-bit sequence number,
    media_epoch: 32-bit epoch number,
    timestamp: 64-bit unix timestamp,
    payload_type: 8-bit type identifier,
    flags: 8-bit control flags
}
```

### 3.4.2 Frame Payload

**Payload Types**:
- `0x01`: Audio payload (Opus, AAC, etc.)
- `0x02`: Video payload (H.264, VP9, AV1, etc.)
- `0x03`: Data channel messages
- `0x04`: Control messages (key frame requests, rekeying)

### 3.4.3 Frame Encryption with Deterministic IV

**Deterministic IV Construction (Preferred)**:
```
iv = Truncate_96bits(
    H( call_id || participant_id || stream_id || frame_sequence )
)
```

**Frame Encryption**:
```
frame_plaintext = canonicalCBOR(frame_header || payload)
frame_ciphertext = AES-256-GCM(
    key = frameKey,
    plaintext = frame_plaintext,
    aad = frame_header,
    iv = deterministic_iv
)
```

**Nonce Reuse Considerations**:
IV is deterministic and unique per frame under a given frameKey. No (frameKey, iv) pair may repeat. This deterministic approach eliminates the risk of catastrophic nonce reuse that can occur with poor randomness.

**Frame Output**:
```
media_frame = {
    header: frame_header,
    ciphertext: base64(frame_ciphertext.ciphertext),
    auth_tag: base64(frame_ciphertext.auth_tag),
    iv: base64(frame_ciphertext.iv)
}
```

## 3.5 Call Management

### 3.5.1 Call Establishment

**Call Initiation**:
1. Initiator generates `callKey` and `call_id`
2. Initiator sends call invitation to all participants via FoxWhisper messaging
3. Participants accept call and derive their `streamKey`
4. All participants authenticate with SFU using refined authentication
5. SFU establishes media routing for the call

### 3.5.2 Participant Management

**Join During Active Call**:
```
join_protocol:
    new_participant -> {
        authenticate_with_sfu()
        derive_stream_key(callKey, participant_id)
        send_stream_key_to_sfu_for_distribution()
        sfu_route_media_to_participant()
    }
```

**Leave During Active Call**:
```
leave_protocol:
    leaving_participant -> {
        revoke_stream_keys()
        sfu_stop_routing_to_participant()
        increment_media_epoch()
    }
```

### 3.5.3 Media Epoch Management

**Automatic Rekeying**:
- Media epoch advances every 10 minutes or 1000 frames, whichever comes first
- Epoch advance triggers new `mediaEpochKey` derivation for all participants
- Old epoch keys are securely deleted after transition

**Manual Rekeying**:
- Any participant can request immediate epoch advance
- Group consensus required for manual rekeying in group calls

## 3.6 Security Analysis

### 3.6.1 Threat Model (Unified)

**SFU Compromise**: SFU learns routing information but cannot decrypt media content.

**Network Attacker**: Can inject, modify, or replay media frames but cannot forge valid authentication.

**Participant Compromise**: Compromised participant can only decrypt their own stream keys and media frames.

**Insider Threat**: Malicious participant cannot access other participants' media due to per-participant key isolation.

### 3.6.2 Security Guarantees

**Confidentiality**: Media frames are readable only by intended participants and SFU (routing only).

**Integrity**: Any modification of media frames is detectable through authentication tags.

**Authenticity**: Media frames can be cryptographically attributed to specific participants.

**Forward Secrecy**: Compromise of current media epoch keys does not reveal past or future media frames.

**Replay Protection**: Frame sequence numbers and media epochs prevent successful replay attacks.

## 3.7 Performance Considerations

### 3.7.1 Bandwidth Optimization

**Frame Batching**: SFU can batch multiple media frames in single network packet to reduce overhead.

**Key Distribution Optimization**: Stream keys are distributed once per call, with frame keys derived locally.

**Compression**: Media payloads can be compressed before encryption to reduce bandwidth usage.

### 3.7.2 Latency Optimization

**Frame Size Limits**: Maximum frame size of 1200 bytes to ensure timely delivery.

**Key Derivation Caching**: Frequently used HKDF results are cached to reduce computational overhead.

**Parallel Processing**: Multiple media streams can be processed in parallel on multi-core devices.

---

# 4. Performance Architecture Framework

FoxWhisper v0.8.1 provides a comprehensive performance architecture enabling high-throughput, low-latency operation across diverse deployment scenarios from mobile devices to enterprise servers.

## 4.1 Design Principles

**Concurrency-First Design**: All operations are designed for parallel execution with minimal blocking and deterministic resource management.

**Resource Awareness**: Clear bounds on memory usage, CPU utilization, and network bandwidth to enable predictable performance at scale.

**Scalability Focus**: Architecture supports from small group chats (2-3 participants) to large enterprise channels (10,000+ members) with linear performance characteristics.

## 4.2 Messaging Performance Architecture

### 4.2.1 Double Ratchet Pipeline

**Pipeline Stages**:
```
incoming_message_queue → signature_verification → aad_validation → dr_ratchet_step → 
key_derivation → decryption → plaintext_processing → outgoing_message_queue
```

**Concurrency Model**:
```
class DRPipeline {
    // Thread-safe state management
    atomic<DR_State> dr_state;
    concurrent_queue<Message> incoming_queue;
    thread_pool<WorkerThread> decryption_workers;
    
    // Non-blocking message processing
    void processMessage(Message msg) {
        incoming_queue.enqueue(msg);
        if (dr_state.compare_exchange_weak()) {
            schedule_ratchet_step();
        }
    }
    
    // Parallel decryption
    void processBatch() {
        batch = incoming_queue.dequeue_batch(BATCH_SIZE);
        workers.parallel_process(batch);
    }
}
```

**Performance Optimizations**:
- **Batched Ratchet Steps**: Multiple DH ratchets combined into single computation
- **Key Caching**: Frequently used message keys cached with LRU eviction
- **Speculative Decryption**: Pre-derive keys for anticipated message indices
- **Memory Pooling**: Reuse cryptographic buffers to reduce allocation overhead

### 4.2.2 Sender-Key Batching System

**Batch Distribution Protocol**:
```
class SenderKeyBatch {
    struct BatchedDistribution {
        epoch_id: uint32,
        sender_roots: Map<DeviceID, GroupSenderCK_0>,
        batch_signature: Ed25519_signature,
        timestamp: uint64
    }
    
    // Server-side aggregation
    void distributeBatch(List<Device> recipients) {
        batch = collect_pending_sender_keys();
        batch.batch_signature = sign_batch(batch);
        broadcast_to_group(batch);
    }
}
```

**Client-Side Processing**:
```
void processBatchedDistribution(BatchedDistribution batch) {
    verify_batch_signature(batch);
    for_each (sender_root in batch.sender_roots) {
        if (is_first_root_for_sender(batch.epoch_id, sender_root.device_id)) {
            store_sender_key(sender_root);
        } else {
            handle_sender_key_poisoning_attempt(sender_root);
        }
    }
}
```

**Performance Benefits**:
- **O(1) Network Complexity**: Single broadcast per epoch regardless of group size
- **Reduced Latency**: Batch processing eliminates per-key round trips
- **Lower CPU Usage**: Signature verification amortized across batch

### 4.2.3 Epoch Distribution Optimization

**Efficient Epoch Change Protocol**:
```
class EpochManager {
    // Parallel epoch preparation
    void prepareEpochTransition() {
        workers.parallel_generate([
            generate_new_eare(),
            generate_all_sender_keys(),
            compute_epoch_hash()
        ]);
    }
    
    // Atomic epoch switch
    void commitEpochTransition() {
        atomic_swap_epoch_state();
        broadcast_epoch_commit();
    }
}
```

## 4.3 Resource Management and Bounds

### 4.3.1 Memory Constraints

**Skipped Keys Cache**:
```
class SkippedKeysCache {
    max_entries_per_sender: 1000;
    max_total_entries: 10000;
    eviction_policy: LRU_WITH_TIMEOUT(24_hours);
    
    // Memory-efficient storage
    struct CacheEntry {
        message_key: bytes[32];
        timestamp: uint64;
        access_count: uint16;
    }
}
```

**State Persistence**:
```
// Memory usage bounds
MAX_DR_STATE_SIZE = 2_KB;           // Per session
MAX_GROUP_STATE_SIZE = 100_KB;         // Per 1000-member group  
MAX_MEDIA_STATE_SIZE = 50_KB;           // Per active call
MAX_CONCURRENT_SESSIONS = 100;           // Per device
```

### 4.3.2 CPU Utilization Optimization

**Cryptographic Operation Batching**:
```
// Batch HKDF operations
batch_hkdf(inputs: List<HKDFInput>) -> List<bytes> {
    // Use SIMD-accelerated HKDF when available
    return hardware_accelerated_hkdf(inputs);
}

// Batch signature verification
batch_verify(signatures: List<Signature>) -> List<bool> {
    // Use Ed25519 batch verification when available
    return ed25519_batch_verify(signatures);
}
```

**Asynchronous Processing**:
```
// Non-blocking cryptographic operations
async void processMessage(Message msg) {
    // Queue heavy operations to worker threads
    if (requires_heavy_crypto(msg)) {
        crypto_worker_queue.enqueue(msg);
        return;  // Process asynchronously
    }
    // Process light messages immediately
    return process_lightweight_message(msg);
}
```

## 4.4 Network Performance Optimization

### 4.4.1 Bandwidth Efficiency

**Message Compression**:
```
// Compress plaintext before encryption
compressed_plaintext = zstd_compress(plaintext);
encrypted_message = aes_gcm_encrypt(compressed_plaintext, aad);
```

**Header Optimization**:
```
// Minimal AAD structure
optimized_aad = {
    version: 1,
    message_type: 1,
    group_id: group_id,
    epoch_id: epoch_id,
    sender_id: sender_id,
    message_index: message_index,
    timestamp: timestamp
    // Total: 32 bytes fixed size
}
```

### 4.4.2 Latency Reduction

**Pipeline Parallelization**:
```
// Overlap network I/O with computation
void processWithPipeline(Message msg) {
    // Stage 1: Network I/O (non-blocking)
    network_thread.receive_async(msg);
    
    // Stage 2: Cryptographic operations (parallel)
    crypto_pool.process_async(msg);
    
    // Stage 3: Application processing (main thread)
    app_thread.deliver_to_user(msg);
}
```

**Connection Reuse**:
```
// Maintain persistent connections for reduced handshake overhead
class ConnectionManager {
    connection_pool: Map<ServerID, PersistentConnection>;
    
    Connection getConnection(ServerID server) {
        return connection_pool.get_or_create(server);
    }
}
```

## 4.5 Performance Monitoring and Metrics

### 4.5.1 Key Performance Indicators

**Throughput Metrics**:
- Messages per second (per device and per group)
- Cryptographic operations per second
- Network bandwidth utilization (bytes/second)
- CPU utilization percentage

**Latency Metrics**:
- Message processing latency (receive → deliver)
- Handshake completion time
- Epoch transition duration
- Media frame processing latency

**Resource Metrics**:
- Memory usage by component
- Skipped keys cache hit rate
- Thread pool utilization
- Network connection efficiency

### 4.5.2 Adaptive Performance

**Dynamic Scaling**:
```
class PerformanceManager {
    void adjustForLoad() {
        load = measure_current_load();
        
        if (load > HIGH_THRESHOLD) {
            increase_batch_sizes();
            enable_aggressive_caching();
            reduce_concurrent_operations();
        } else if (load < LOW_THRESHOLD) {
            decrease_batch_sizes();
            reduce_memory_usage();
            increase_concurrent_operations();
        }
    }
}
```

**Platform-Specific Optimizations**:
- **Mobile**: Reduced memory usage, battery-aware processing
- **Server**: High throughput, connection pooling
- **Desktop**: Maximum parallelization, hardware acceleration

This performance architecture enables FoxWhisper to scale from small group chats to enterprise channels while maintaining security guarantees and providing excellent user experience across all deployment scenarios.

---

# 5. Cross‑Layer Integration

FoxWhisper v0.8.1 refines cross-layer integration with bounded epoch skew tolerance for improved real-world robustness.

## 5.1 Messaging ↔ Media Epoch Alignment (Refined)

**Epoch Skew Tolerance Rules**:

If |messagingEpoch − mediaEpoch| <= 1:
- Allow a small tolerance window
- Client SHOULD attempt resynchronization (request updated EARE/callKey)
- Continue processing with warning logs

If mismatch persists for more than N frames or T seconds, or if difference > 1:
- MUST treat as protocol error
- Tear down the call
- Trigger epoch resync

**Rationale**: A strict "must match exactly always" rule is too brittle in real networks. This tolerance does not weaken security, only improves liveness.

## 5.2 Error Propagation

- Media errors MAY trigger epoch advance
- Messaging ratchet failures MUST NOT break media unless keys overlap
- Cross-layer error states MUST be propagated with appropriate severity levels

## 5.3 State Synchronization

**Synchronization Points**:
- Call establishment: Both layers initialize with synchronized epochs
- Member changes: Both layers advance epochs atomically
- Network recovery: Graceful resynchronization with bounded tolerance

---

# 6. Preliminary Conformance Hooks

FoxWhisper v0.8.1 establishes foundation for comprehensive conformance testing and ecosystem development, providing test vectors and validation procedures essential for multi-implementation compatibility.

## 6.1 Canonical CBOR Test Vectors

### 6.1.1 Handshake Test Vectors

**Complete PQ Handshake Example**:
```
// Input parameters
client_x25519_priv = 0x...
client_x25519_pub = 0x...
client_kyber_priv = 0x...
client_kyber_pub = 0x...
server_x25519_priv = 0x...
server_x25519_pub = 0x...
server_kyber_ciphertext = base64_decode("...")

// Expected intermediate values
x25519_shared = X25519(client_x25519_priv, server_x25519_pub)
kyber_shared = Kyber.Decapsulate(client_kyber_priv, server_kyber_ciphertext)
handshake_secret = HKDF(x25519_shared || kyber_shared, "FoxWhisper-Handshake-Root", 32)

// Expected outputs
root_key = handshake_secret
session_id = SHA256(canonicalCBOR({client_pub, server_pub, handshake_secret}))
```

**Canonical CBOR Representation**:
```
handshake_transcript = {
  "type": "HANDSHAKE_TRANSCRIPT",
  "client_x25519_pub": base64_encode(client_x25519_pub),
  "server_x25519_pub": base64_encode(server_x25519_pub),
  "kyber_ciphertext": base64_encode(server_kyber_ciphertext),
  "handshake_secret": base64_encode(handshake_secret),
  "session_id": base64_encode(session_id)
}
```

### 6.1.2 Double Ratchet Test Vectors

**DR Message Encryption Example**:
```
// Input state
dr_state = {
  root_key: 0x...,
  send_chain_key: 0x...,
  send_counter: 42,
  dh_private: 0x...,
  dh_public: 0x...
}

// Input message
plaintext = "Hello, FoxWhisper!"

// Expected operations
message_key = HKDF(dr_state.send_chain_key, "FoxWhisper-Message", 32, dr_state.send_counter)
next_chain_key = HKDF(dr_state.send_chain_key, "FoxWhisper-Chain", 32)
iv = Truncate_96bits(H(call_id || participant_id || stream_id || frame_sequence))
aad = SHA256(canonicalCBOR(message_header))

// Expected outputs
ciphertext, auth_tag = AES-256-GCM(message_key, plaintext, aad, iv)
next_dr_state = {
  root_key: dr_state.root_key,
  send_chain_key: next_chain_key,
  send_counter: dr_state.send_counter + 1,
  dh_private: dr_state.dh_private,
  dh_public: dr_state.dh_public
}
```

### 6.1.3 Group Messaging Test Vectors

**Sender Key Distribution Example**:
```
// Input parameters
group_id = base64_decode("...")
epoch_id = 42
sender_device_id = base64_decode("...")
group_sender_ck_0 = random(32 bytes)

// Expected group key distribution message
group_key_distribution = {
  "type": "GROUP_KEY_DISTRIBUTION",
  "group_id": group_id,
  "epoch_id": epoch_id,
  "sender_device_id": sender_device_id,
  "group_sender_ck_0": base64_encode(group_sender_ck_0),
  "signature": ed25519_sign(sender_device_priv_key, canonicalCBOR(distribution_without_signature))
}
```

## 6.2 Epoch Authenticity Record Examples

### 6.2.1 Complete EARE Structure

**EARE Creation Example**:
```
// Input parameters
group_id = "group-12345"
epoch_id = 42
members = [
  {"user_id": "user1", "device_id": "device1", "device_pub_key": "0x..."},
  {"user_id": "user2", "device_id": "device1", "device_pub_key": "0x..."}
]
admin_device_ids = ["device1", "device2"]
previous_epoch_hash = SHA256(canonicalCBOR(previous_eare))

// Expected EARE structure
epoch_authenticity_record = {
  "type": "EPOCH_AUTHENTICITY_RECORD",
  "group_id": group_id,
  "epoch_id": epoch_id,
  "previous_epoch_hash": previous_epoch_hash,
  "members": members,
  "admin_device_ids": admin_device_ids,
  "timestamp": 1701763200000,
  "reason": "member_added",
  "admin_signatures": [
    {
      "admin_device_id": "device1",
      "signature": ed25519_sign(device1_priv_key, canonicalCBOR(eare_without_signatures))
    },
    {
      "admin_device_id": "device2", 
      "signature": ed25519_sign(device2_priv_key, canonicalCBOR(eare_without_signatures))
    }
  ]
}
```

## 6.3 Media Frame Test Vectors

### 6.3.1 Media Frame Encryption with Refined Key Schedule

**Complete Media Frame Example**:
```
// Input parameters
call_id = "call-67890"
participant_id = "participant-123"
stream_id = "audio-main"
stream_key = 0x...
media_epoch = 42
frame_sequence = 15
payload_type = 0x01  // Audio payload
payload = {"audio_data": "base64_encoded_audio_data"}

// Expected operations with refined key schedule
media_epoch_key = HKDF(
    input_key_material = stream_key,
    salt = media_epoch,
    info = "FW-MediaEpochKey",
    L = 32
)

frame_key = HKDF(
    input_key_material = media_epoch_key,
    salt = frame_sequence,
    info = "FW-FrameKey",
    L = 32
)

deterministic_iv = Truncate_96bits(H(call_id || participant_id || stream_id || frame_sequence))

frame_plaintext = canonicalCBOR({
  "version": 1,
  "call_id": call_id,
  "participant_id": participant_id,
  "stream_id": stream_id,
  "frame_sequence": frame_sequence,
  "payload_type": payload_type,
  "payload": payload
})

aad = SHA256(canonicalCBOR(frame_header))

// Expected outputs
frame_ciphertext, frame_auth_tag = AES-256-GCM(frame_key, frame_plaintext, aad, deterministic_iv)

// Complete media frame structure
media_frame = {
  "header": {
    "version": 1,
    "call_id": call_id,
    "participant_id": participant_id,
    "stream_id": stream_id,
    "frame_sequence": frame_sequence,
    "media_epoch": 42,
    "timestamp": 1701763200000,
    "payload_type": payload_type
  },
  "ciphertext": base64_encode(frame_ciphertext),
  "auth_tag": base64_encode(frame_auth_tag),
  "iv": base64_encode(deterministic_iv)
}
```

## 6.4 Validation Procedures

### 6.4.1 Canonical Encoding Validation

**CBOR Canonicalization Test**:
```
// Test that canonical CBOR produces identical results
test_data = {"a": 1, "b": 2, "c": [3, 4, 5]}
canonical_bytes = canonicalCBOR(test_data)

// Verify multiple encodings produce identical results
for i in 1..100:
    encoded = cbor_encode(test_data)
    assert(encoded == canonical_bytes)
```

### 6.4.2 Cross-Platform Compatibility

**Implementation Validation Test**:
```
// Test vector for cross-platform verification
compatibility_test = {
  "handshake_input": handshake_test_vector,
  "expected_dr_state": expected_dr_result,
  "expected_group_state": expected_group_result,
  "expected_media_frame": expected_media_result
}

// Implementations must produce identical results
implementation_result = run_implementation_test(compatibility_test)
assert(implementation_result.matches_expected())
```

## 6.5 Error Handling Test Cases

### 6.5.1 Malformed Input Handling

**Invalid CBOR Structures**:
```
malformed_cbor_tests = [
  {"description": "Truncated CBOR", "data": truncated_byte_sequence},
  {"description": "Invalid map key type", "data": invalid_key_type_cbor},
  {"description": "Duplicate map keys", "data": duplicate_keys_cbor},
  {"description": "Invalid array length", "data": invalid_array_length_cbor}
]

// Each test must be rejected with appropriate error
for test_case in malformed_cbor_tests:
    result = parse_cbor(test_case.data)
    assert(result.error == EXPECTED_ERROR)
```

### 6.5.2 Cryptographic Validation

**Signature Verification Tests**:
```
signature_tests = [
  {"description": "Invalid signature", "signature": invalid_signature},
  {"description": "Wrong signing key", "signature": wrong_key_signature},
  {"description": "Modified message", "signature": valid_signature_modified_message}
]

// Verify signature validation catches all attacks
for test_case in signature_tests:
    verification = verify_signature(test_case.signature, test_case.message)
    assert(verification.result == test_case.expected_result)
```

### 6.5.3 Epoch Skew Tolerance Tests

**Epoch Mismatch Handling**:
```
epoch_skew_tests = [
  {"description": "Small skew (1)", "messaging_epoch": 42, "media_epoch": 43, "expected": "allow_with_warning"},
  {"description": "Large skew (5)", "messaging_epoch": 42, "media_epoch": 47, "expected": "reject_and_resync"},
  {"description": "Persistent skew", "messaging_epoch": 42, "media_epoch": 43, "frames": 100, "expected": "reject_and_resync"}
]

// Verify epoch skew tolerance behavior
for test_case in epoch_skew_tests:
    result = handle_epoch_mismatch(test_case)
    assert(result.action == test_case.expected)
```

These conformance hooks provide foundation for automated testing, cross-platform compatibility verification, and security validation essential for FoxWhisper ecosystem development.

---

# 7. Final Instructions to GLM

GLM, when expanding this skeleton:
1. Preserve all cryptographic meaning and invariants from v0.8
2. Implement the six specific refinements outlined in v0.8.1
3. Transform placeholders into full prose and structured sections
4. Add diagrams, examples, and formal explanation
5. Prepare document so ChatGPT can perform a security audit afterward
6. Keep messaging, media, and formal verification layers distinct but integrated
7. Ensure compatibility with v0.6, v0.7, and v0.8 semantics
8. Do not invent new primitives unless required for clarification
9. Emphasize the threat model unification and key schedule hygiene improvements

---

# End of v0.8.1 Specification (Ready for Implementation)