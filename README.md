# FoxWhisper Protocol Specification (FWP)

A formally verified, quantum-resistant end-to-end encryption protocol designed for privacy-preserving safety infrastructure with media capabilities and multi-device synchronization.

## Overview

FoxWhisper is a comprehensive E2EE protocol specification that has evolved through rigorous formal verification to provide enterprise-grade secure messaging with built-in compliance, moderation, and real-time media capabilities.

### Key Features

- **🔒 Quantum-Resistant Security**: Hybrid key agreement with post-quantum cryptography
- **🛡️ Hardware-Protected Keys**: Long-term identity keys stored in TPM/Secure Enclave
- **🔄 Double Ratchet**: Enhanced forward secrecy and asynchronous messaging
- **👥 Group Messaging**: Sender-key based group communication with epoch management
- **🎥 Media Integration**: Real-time audio/video with SFU authentication
- **⚖️ Privacy-Preserving Moderation**: Content moderation without bulk surveillance
- **📋 Legal Compliance**: Legal holds and audit trails with cryptographic proofs
- **📱 Multi-Device**: Cross-device synchronization with backup/restore

## Protocol Versions

### v0.8.1 (Latest) - Threat Model & Key Schedule Refinements
- **Unified Threat Model**: Dolev-Yao adversary model for formal verification
- **Key Schedule Hygiene**: Cleaned media key derivation hierarchy
- **IV Strategy**: Deterministic GCM nonce construction
- **SFU Authentication**: Anchored to existing trust graph
- **Epoch Skew Tolerance**: Bounded tolerance for real-world robustness

### v0.8 - Formal Verification & Media Integration
- **Formal Verification**: Tamarin/ProVerif compatible specification
- **Media Layer**: Real-time communication with SFU integration
- **Epoch Authenticity**: Hash-chained epoch transitions
- **Multi-Device**: Complete synchronization semantics

## Quick Start

### For Implementers

1. **Read Specifications**
   - [v0.8.1 Specification](spec/e2ee-protocol-specification-v0.8.1.md) - Latest stable version
   - [Development Roadmap](docs/foxwhisper_roadmap.md) - Project trajectory and status

2. **Review Implementation Guidelines**
   - [Agent Development Guide](AGENTS.md) - Development guidelines and code style
   - [Repository Organization](docs/repository-organization.md) - Structure and conventions

3. **Run Validation Tests**
   ```bash
   # Full validation suite
   ./scripts/validate-ci.sh
   
   # Quick validation
   ./scripts/validate-ci-simple.sh
   
   # Language-specific tests
   cd validation/python/validators && python3 validate_cbor_python.py
   cd validation/nodejs/validators && node validate_cbor_node.js
   cd validation/go/validators && go run validate_cbor_go.go
   cargo run --bin validate_cbor_rust
   ```

### For Security Reviewers

1. **Security Properties**
   - Forward secrecy across all key layers
   - Post-quantum resistance via hybrid key agreement
   - Hardware-anchored identity protection
   - Replay attack prevention

2. **Compliance Features**
   - Privacy-preserving content reporting
   - Legal hold support with minimal data exposure
   - Audit trail with cryptographic proofs
   - Device revocation with cryptographic evidence

## Architecture

### Identity Model

```
User Identity Key (Long-term, Hardware-anchored)
├── Device Identity Key A (Long-lived, per-device)
│   └── Double Ratchet Session A↔B (Per device-pair)
│       ├── Root Key (from hybrid handshake)
│       ├── DH Ratchet State
│       ├── Send/Recv Chain Keys
│       └── Message Keys (per-message)
├── Device Identity Key B (Long-lived, per-device)
│   └── Double Ratchet Session B↔C (Per device-pair)
└── Device Identity Key C (Long-lived, per-device)
    └── Double Ratchet Session C↔A (Per device-pair)
```

### Protocol Flow

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
     | 3. Derive Double Ratchet Root Key      |
     |    root_key = HKDF(shared, "DR-Root") |
     |<=====================================>|
     |                                       |
     | 4. ENCRYPTED_MESSAGES (with DR header)|
     |    - DH public key (when ratcheting)  |
     |    - Message counters                  |
     |    - Standard ciphertext               |
     |<=====================================>|
```

## Security Properties

### Cryptographic Guarantees

- **🔐 Forward Secrecy**: Compromise of long-term keys doesn't reveal past messages
- **⚡ Post-Compromise Security**: DH ratchet steps recover from key compromise
- **🌐 Post-Quantum Resistance**: Hybrid key agreement withstands quantum attacks
- **🎯 Message Authentication**: AAD binds ciphertext to message context
- **🔄 Replay Protection**: Unique message IDs and counters prevent replay attacks

### Compliance & Safety

- **👁️ Privacy-Preserving Moderation**: Content reporting without bulk surveillance
- **⚖️ Legal Hold Support**: Targeted message preservation with court orders
- **📊 Audit Trail**: Cryptographic proofs of all protocol operations
- **🚫 Device Revocation**: Secure device removal with cryptographic evidence

## Implementation Status

**Current Status: v0.9 Development - Conformance & Tooling Phase**

The FoxWhisper protocol is in active development with comprehensive validation tooling:

### ✅ **Completed (v0.8.1)**
- **Formal Verification**: Tamarin/ProVerif compatible specification
- **Security Architecture**: Complete threat model and cryptographic constructions
- **Media Integration**: Real-time communication with SFU authentication
- **Multi-Device**: Synchronization, backup, and restore semantics

### 🚧 **In Progress (v0.9)**
- **CBOR Validation Suite**: Multi-language validators (Go, Python, Node.js, Rust) - 100% Complete
- **Test Vector Generation**: Comprehensive cross-platform test coverage - 100% Complete
- **Cross-Language Compatibility**: All validators produce identical results - 100% Complete
- **Performance Benchmarking**: Implementation optimization and profiling - In Progress
- **Security Auditing**: Automated security validation and compliance checking - In Progress

### 📋 **Next Steps (v1.0)**
- Reference implementations for major platforms
- Integration testing frameworks
- Deployment and operational tooling
- Ecosystem documentation and tutorials

## Key Components

### Cryptographic Primitives

- **X25519**: Classical elliptic curve Diffie-Hellman
- **ML-KEM/Kyber**: Post-quantum key encapsulation mechanism
- **Ed25519**: Digital signatures for identity verification
- **AES-256-GCM**: Symmetric encryption with authentication
- **HKDF-SHA256**: Key derivation function
- **CBOR**: Canonical binary encoding for wire format

### Message Types

- **HYBRID_HANDSHAKE_INIT/RESP**: Quantum-resistant session establishment
- **ENCRYPTED_MESSAGE**: Secure message delivery with Double Ratchet
- **CONTENT_REPORT**: Privacy-preserving content reporting
- **MODERATION_ACTION**: Moderator decisions with cryptographic proof
- **LEGAL_HOLD_REQUEST**: Court-ordered message preservation

## Wire Format

All protocol messages use **CBOR encoding** for efficient binary transmission:

```javascript
// Example ENCRYPTED_MESSAGE structure
const encryptedMessage = {
  version: 2,
  type: "ENCRYPTED_MESSAGE",
  timestamp: 1701763200000,
  sessionId: "S1234567890ABCDEF",
  messageId: "M1234567890ABCDEF",
  senderUserId: "U1234567890ABCDEF",
  senderDeviceId: "DABCDEF1234567890",
  recipientUserId: "UFEDCBA0987654321",
  recipientDeviceId: "D1234567890ABCDEF",
  dhPublicKey: "base64-encoded-x25519-public-key",
  messageNumber: 42,
  previousChainLength: 38,
  ciphertext: "base64-encoded-aes-gcm-ciphertext",
  iv: "base64-encoded-12-byte-iv",
  authTag: "base64-encoded-16-byte-auth-tag"
};
```

## Development Resources

### Documentation

- **[v0.8.1 Specification](spec/e2ee-protocol-specification-v0.8.1.md)** - Latest stable protocol
- **[All Specifications](spec/)** - Complete version history (v0.1 - v0.8.1)
- **[Agent Development Guide](AGENTS.md)** - Development guidelines and code style
- **[Development Roadmap](docs/foxwhisper_roadmap.md)** - Project trajectory and status
- **[Repository Organization](docs/repository-organization.md)** - Structure and conventions
- **[v0.9 Todo List](docs/v0.9-comprehensive-todo-list.md)** - Current development tasks

### Validation & Testing

#### Multi-Language Support
- **Python**: CBOR validation, schema checking, test vector generation
- **Node.js**: Cross-language compatibility, validation tools
- **Go**: High-performance validators, test generation
- **Rust**: Memory-safe implementations, comprehensive validation

#### Test Coverage
- **Handshake Messages**: Hybrid key agreement validation
- **Double Ratchet**: Forward secrecy and post-compromise security
- **Group Messaging**: Sender-key distribution and epoch management
- **Media Encryption**: SFU authentication and media key distribution
- **Multi-Device Sync**: Backup, restore, and device management

### Code Style & Security

#### Implementation Requirements
- Use canonical CBOR encoding (RFC 8949) for all wire formats
- Implement constant-time cryptographic operations
- Hardware-backed key storage for identity keys
- AAD must bind ciphertext to message context
- Follow language-specific guidelines in AGENTS.md

#### Security Guarantees
- Forward secrecy across all key layers
- Post-quantum resistance via hybrid key agreement
- Replay attack prevention with unique message IDs
- Privacy-preserving moderation with minimal data exposure

## Compliance & Legal

### Privacy-Preserving Moderation

The protocol enables content moderation without compromising user privacy:

- **Content Reports**: Users can report specific messages with encrypted evidence
- **Moderator Access**: Limited decryption capability for reported content only
- **Audit Trail**: All moderation actions cryptographically signed and verifiable

### Legal Hold Support

Court-ordered message preservation with minimal privacy impact:

- **Targeted Preservation**: Only specific messages are preserved
- **Ciphertext-First**: Default preservation is ciphertext-only
- **Key Escrow**: Keys released only with proper legal authorization
- **Audit Logs**: All access cryptographically recorded and verifiable

## Contributing

### For Security Researchers

- Review formal verification models and security proofs
- Test validation tools and cross-language compatibility
- Report security issues through responsible disclosure channels
- Contribute to threat model refinement and analysis

### For Implementers

- Follow development guidelines in [AGENTS.md](AGENTS.md)
- Run validation suite: `./scripts/validate-ci.sh`
- Contribute test vectors for additional platforms
- Provide feedback on implementation challenges via issues

### For Tooling Developers

- Extend validation tools to new languages
- Improve test coverage and edge case handling
- Optimize performance benchmarks
- Enhance CI/CD integration and automation

## License

This protocol specification is provided under the terms specified in the [LICENSE](LICENSE) file.

## Contact & Community

For questions about FoxWhisper Protocol:

- **Security Issues**: Report through responsible disclosure channels
- **Implementation Questions**: Check [AGENTS.md](AGENTS.md) and validation tools first
- **Protocol Clarifications**: Review [v0.8.1 specification](spec/e2ee-protocol-specification-v0.8.1.md)
- **Development Status**: See [roadmap](docs/foxwhisper_roadmap.md) and [v0.9 todo list](docs/v0.9-comprehensive-todo-list.md)

---

**Note**: This is a specification repository with comprehensive validation tooling. For implementation examples, see the multi-language validators in `validation/` directory and run `./scripts/validate-ci.sh` to explore the test suite.