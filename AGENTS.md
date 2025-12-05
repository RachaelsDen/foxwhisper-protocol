# FoxWhisper Protocol - Agent Development Guide

## Build/Test Commands
- **Full validation**: `./scripts/validate-ci.sh` (runs all language tests)
- **Quick validation**: `./scripts/validate-ci-simple.sh` (core tests only)
- **Python**: `cd validation/python/validators && python3 validate_cbor_python.py`
- **Node.js**: `cd validation/nodejs/validators && node validate_cbor_node.js`
- **Go**: `cd validation/go/validators && go run validate_cbor_go.go`
- **Rust**: `cargo run --bin validate_cbor_rust`

## Code Style Guidelines
- **Python**: Use type hints, snake_case, docstrings, PEP 8 formatting
- **Go**: Use gofmt, camelCase for exports, snake_case for private, package comments
- **Rust**: Use rustfmt, snake_case, cargo clippy for linting
- **Node.js**: Use camelCase, JSDoc comments, ES6+ syntax
- **All languages**: Use canonical CBOR encoding (RFC 8949), constant-time crypto ops

## Repository Structure
- `spec/` - Protocol specifications (primary documentation)
- `validation/` - Multi-language CBOR validation tools
- `tests/common/handshake/` - Cross-language test vectors
- `tools/generators/` - Test vector generation scripts

## Security Requirements
- Hardware-backed key storage required for identity keys
- Forward secrecy must be maintained for all message keys
- AAD must bind ciphertext to message context
- No hardcoded secrets or insecure random usage