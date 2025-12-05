# FoxWhisper CBOR Validation Schema & Documentation

*Conformance Test Suite - Section 4.1.1*

## Overview

This document provides comprehensive CBOR validation schema and documentation for FoxWhisper v0.9 implementations. It defines the exact rules, constraints, and validation procedures required for cross-platform compatibility.

---

## 1. CBOR Schema Definition

### 1.1 Message Type Registry

```yaml
# FoxWhisper CBOR Message Schema
message_types:
  HANDSHAKE_INIT:
    tag: 0xD1
    description: "Post-quantum handshake initiation"
    required_fields: ["type", "version", "client_id", "x25519_public_key", "kyber_public_key", "timestamp", "nonce"]
    
  HANDSHAKE_RESPONSE:
    tag: 0xD2
    description: "Post-quantum handshake response"
    required_fields: ["type", "version", "server_id", "x25519_public_key", "kyber_ciphertext", "timestamp", "nonce"]
    
  HANDSHAKE_COMPLETE:
    tag: 0xD3
    description: "Handshake completion confirmation"
    required_fields: ["type", "version", "session_id", "handshake_hash", "timestamp"]
    
  DR_BACKUP:
    tag: 0xD4
    description: "Device Record backup"
    required_fields: ["type", "version", "device_id", "dr_data", "backup_version", "timestamp"]
    
  DR_RESTORE:
    tag: 0xD5
    description: "Device Record restoration"
    required_fields: ["type", "version", "device_id", "restore_token", "timestamp"]
    
  DR_RESET:
    tag: 0xD6
    description: "Device Record reset"
    required_fields: ["type", "version", "device_id", "reset_reason", "timestamp"]
    
  GROUP_CREATE:
    tag: 0xD7
    description: "Group creation"
    required_fields: ["type", "version", "group_id", "creator_device_id", "initial_members", "group_name", "timestamp"]
    
  GROUP_JOIN:
    tag: 0xD8
    description: "Group member join"
    required_fields: ["type", "version", "group_id", "joining_device_id", "device_public_key", "timestamp"]
    
  GROUP_LEAVE:
    tag: 0xD9
    description: "Group member leave"
    required_fields: ["type", "version", "group_id", "leaving_device_id", "leave_reason", "timestamp"]
    
  GROUP_KEY_DISTRIBUTION:
    tag: 0xDA
    description: "Sender key distribution"
    required_fields: ["type", "version", "group_id", "epoch_id", "sender_device_id", "group_sender_ck_0", "signature"]
    
  EPOCH_AUTHENTICITY_RECORD:
    tag: 0xDB
    description: "Epoch authenticity record"
    required_fields: ["type", "version", "group_id", "epoch_id", "previous_epoch_hash", "members", "admin_device_ids", "timestamp", "reason", "admin_signatures"]
    
  MEDIA_KEY_DISTRIBUTION:
    tag: 0xDC
    description: "Media stream key distribution"
    required_fields: ["type", "version", "call_id", "participant_id", "stream_keys", "media_epoch", "timestamp"]
    
  MEDIA_FRAME:
    tag: 0xDD
    description: "Encrypted media frame"
    required_fields: ["type", "version", "header", "ciphertext", "auth_tag", "iv"]
```

### 1.2 Field Type Definitions

```yaml
field_types:
  # String fields
  string_fields:
    type: "UTF-8 string"
    encoding: "definite-length"
    max_length: 255
    examples: ["type", "group_name", "reset_reason", "leave_reason", "reason", "stream_id"]
    
  # Binary fields (base64url encoded in JSON)
  binary_fields:
    type: "byte string"
    encoding: "definite-length"
    sizes:
      client_id: 32
      server_id: 32
      device_id: 32
      session_id: 32
      handshake_hash: 32
      x25519_public_key: 32
      group_sender_ck_0: 32
      signature: 64
      nonce: 16
      iv: 12
      auth_tag: 16
      kyber_public_key: 1568
      kyber_ciphertext: 1568
      dr_data: "variable (max 4096)"
      restore_token: 32
      
  # Numeric fields
  numeric_fields:
    version:
      type: "unsigned integer"
      range: [1, 255]
      encoding: "smallest possible"
      
    timestamp:
      type: "unsigned integer"
      range: [0, 18446744073709551615]  # 64-bit
      encoding: "smallest possible"
      description: "Unix timestamp in milliseconds"
      
    epoch_id:
      type: "unsigned integer"
      range: [0, 4294967295]  # 32-bit
      encoding: "smallest possible"
      
    media_epoch:
      type: "unsigned integer"
      range: [0, 4294967295]  # 32-bit
      encoding: "smallest possible"
      
    backup_version:
      type: "unsigned integer"
      range: [1, 255]
      encoding: "smallest possible"
      
  # Complex fields
  array_fields:
    initial_members:
      type: "array"
      item_type: "member_object"
      min_items: 1
      max_items: 1000
      
    admin_device_ids:
      type: "array"
      item_type: "binary (device_id)"
      min_items: 1
      max_items: 100
      
    stream_keys:
      type: "array"
      item_type: "stream_key_object"
      min_items: 1
      max_items: 100
      
    admin_signatures:
      type: "array"
      item_type: "signature_object"
      min_items: 1
      max_items: 100
```

### 1.3 Object Definitions

```yaml
object_types:
  member_object:
    type: "map"
    required_fields: ["user_id", "device_id", "device_public_key"]
    field_types:
      user_id: "binary (32 bytes)"
      device_id: "binary (32 bytes)"
      device_public_key: "binary (32 bytes)"
      
  stream_key_object:
    type: "map"
    required_fields: ["stream_id", "stream_key"]
    field_types:
      stream_id: "string (max 255 chars)"
      stream_key: "binary (32 bytes)"
      
  signature_object:
    type: "map"
    required_fields: ["admin_device_id", "signature"]
    field_types:
      admin_device_id: "binary (32 bytes)"
      signature: "binary (64 bytes)"
      
  media_frame_header:
    type: "map"
    required_fields: ["call_id", "participant_id", "stream_id", "frame_sequence", "media_epoch", "timestamp", "payload_type"]
    field_types:
      call_id: "binary (32 bytes)"
      participant_id: "binary (32 bytes)"
      stream_id: "string (max 255 chars)"
      frame_sequence: "unsigned integer (64-bit)"
      media_epoch: "unsigned integer (32-bit)"
      timestamp: "unsigned integer (64-bit)"
      payload_type: "unsigned integer (8-bit)"
```

---

## 2. Canonical CBOR Encoding Rules

### 2.1 Integer Encoding

```yaml
integer_encoding:
  rule: "Use smallest possible representation"
  examples:
    value_0: "0x00"           # Single byte
    value_23: "0x17"          # Single byte
    value_24: "0x18 0x18"     # Two bytes
    value_255: "0x18 0xFF"    # Two bytes
    value_256: "0x19 0x01 0x00"  # Three bytes
    value_65535: "0x19 0xFF 0xFF"  # Three bytes
    value_65536: "0x1A 0x00 0x01 0x00 0x00"  # Five bytes
    
  negative_integers:
    value_neg1: "0x20"        # -1
    value_neg24: "0x37"       # -24
    value_neg25: "0x38 0x18"  # -25
```

### 2.2 String Encoding

```yaml
string_encoding:
  rule: "UTF-8 with definite-length encoding"
  examples:
    empty_string: "0x60"
    short_string: "0x68 'hello'"  # 5 chars
    medium_string: "0x78 0x20 [32 bytes]"
    long_string: "0x79 0x01 0x00 [256 bytes]"
    
  utf8_handling:
    rule: "Encode as UTF-8 byte sequence"
    example_hello: "0x65 'hello'"
    example_unicode: "0x63 '☃'"  # Snowman emoji
```

### 2.3 Binary Encoding

```yaml
binary_encoding:
  rule: "Definite-length byte strings"
  examples:
    empty_bytes: "0x40"
    short_bytes: "0x44 [4 bytes]"
    medium_bytes: "0x58 0x20 [32 bytes]"
    long_bytes: "0x59 0x01 0x00 [256 bytes]"
    
  padding:
    rule: "No padding unless part of cryptographic data"
    note: "Cryptographic padding is part of the data, not CBOR padding"
```

### 2.4 Map Encoding

```yaml
map_encoding:
  rule: "Keys sorted by length, then lexicographically"
  sorting_algorithm: |
    keys.sort(key=lambda k: (len(k), k))
    
  examples:
    simple_map: |
      # Input: {"b": 2, "a": 1, "c": 3}
      # Sorted keys: ["a", "b", "c"]
      # Encoding: 0xA3 0x61 "a" 0x01 0x61 "b" 0x02 0x61 "c" 0x03
      
    complex_map: |
      # Input: {"type": "HANDSHAKE_INIT", "version": 1, "timestamp": 1701763200000}
      # Sorted keys: ["type", "timestamp", "version"]
      # Encoding follows this order
```

### 2.5 Array Encoding

```yaml
array_encoding:
  rule: "Fixed-length arrays preferred"
  examples:
    empty_array: "0x80"
    short_array: "0x83 [3 items]"
    medium_array: "0x98 0x20 [32 items]"
    long_array: "0x99 0x01 0x00 [256 items]"
```

### 2.6 Tag Encoding

```yaml
tag_encoding:
  rule: "Semantic tags for message types"
  tag_ranges:
    handshake: [0xD1, 0xD3]
    device_record: [0xD4, 0xD6]
    group_management: [0xD7, 0xDA]
    epoch_management: 0xDB
    media: [0xDC, 0xDD]
    
  encoding_examples:
    tag_small: "0xD1 [data]"     # Tag 0xD1 (single byte)
    tag_large: "0xDA 0x00 0x01 [data]"  # Tag 0xDA (two bytes)
```

---

## 3. Validation Procedures

### 3.1 Schema Validation

```python
def validate_message_schema(cbor_data, expected_tag):
    """Validate CBOR message against schema"""
    
    # Check tag
    if not isinstance(cbor_data, cbor.Tagged):
        raise ValidationError("Missing semantic tag")
    if cbor_data.tag != expected_tag:
        raise ValidationError(f"Wrong tag: expected {expected_tag}, got {cbor_data.tag}")
    
    # Check it's a map
    if not isinstance(cbor_data.value, dict):
        raise ValidationError("Message must be a map")
    
    # Get message type schema
    message_type = cbor_data.value.get('type')
    schema = MESSAGE_TYPES[message_type]
    
    # Validate required fields
    for field in schema['required_fields']:
        if field not in cbor_data.value:
            raise ValidationError(f"Missing required field: {field}")
    
    # Validate field types
    for field_name, field_value in cbor_data.value.items():
        validate_field_type(field_name, field_value, schema)
    
    return True
```

### 3.2 Canonical Encoding Validation

```python
def validate_canonical_encoding(encoded_bytes, expected_structure):
    """Validate CBOR follows canonical encoding rules"""
    
    # Parse and re-encode with canonical rules
    parsed = cbor.loads(encoded_bytes)
    canonical_encoded = cbor.dumps(parsed, canonical=True)
    
    # Compare byte-for-byte
    if encoded_bytes != canonical_encoded:
        raise ValidationError("Non-canonical encoding detected")
    
    # Validate specific rules
    validate_integer_encoding(encoded_bytes)
    validate_map_key_ordering(parsed)
    validate_string_encoding(encoded_bytes)
    validate_binary_encoding(encoded_bytes)
    
    return True
```

### 3.3 Cross-Platform Validation

```python
def cross_platform_validate(test_vector):
    """Validate across multiple implementations"""
    
    results = {}
    
    # Test Python implementation
    results['python'] = validate_with_python(test_vector)
    
    # Test Node.js implementation
    results['nodejs'] = validate_with_nodejs(test_vector)
    
    # Test Go implementation (if available)
    results['go'] = validate_with_go(test_vector)
    
    # Test Rust implementation (if available)
    results['rust'] = validate_with_rust(test_vector)
    
    # Compare all results
    all_hexes = [r['hex'] for r in results.values() if r['success']]
    if len(set(all_hexes)) != 1:
        raise ValidationError("Implementations produce different encodings")
    
    return results
```

---

## 4. Error Handling

### 4.1 Validation Error Types

```yaml
error_types:
  schema_errors:
    - "Missing semantic tag"
    - "Invalid message type"
    - "Missing required field"
    - "Invalid field type"
    - "Field size out of range"
    
  canonical_errors:
    - "Non-canonical integer encoding"
    - "Incorrect map key ordering"
    - "Indefinite-length encoding used"
    - "Invalid string encoding"
    - "Tag encoding error"
    
  security_errors:
    - "Oversized message"
    - "Malformed binary data"
    - "Invalid cryptographic material"
    - "Timestamp out of range"
    - "Replay detected"
```

### 4.2 Error Recovery

```yaml
error_recovery:
  schema_validation_failures:
    action: "Reject message"
    log_level: "ERROR"
    response: "ValidationError with specific field"
    
  canonical_encoding_failures:
    action: "Attempt canonicalization"
    log_level: "WARN"
    response: "Canonicalized version if possible"
    
  security_violations:
    action: "Reject and report"
    log_level: "CRITICAL"
    response: "SecurityAlert with details"
```

---

## 5. Test Vectors

### 5.1 Valid Message Test Vectors

```yaml
valid_test_vectors:
  handshake_complete:
    input:
      type: "HANDSHAKE_COMPLETE"
      version: 1
      session_id: "YWJjZGVmZ2hpams="
      handshake_hash: "ODlBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZQ=="
      timestamp: 1701763202000
    expected_hex: "D8D3A564747970657248414E445348414B455F434F4D504C4554456776657273696F6E01016A73657373696F6E5F696478206162636465666768696A6B6C6D6E6F707172737475767778797A30313233346D68616E647368616B655F68617368782038394142434445464748494A4B4C4D4E4F505152535455565758595A61626364656974696D657374616D701A0000018E5F5E10C8"
    expected_length: 129
    
  handshake_init:
    input:
      type: "HANDSHAKE_INIT"
      version: 1
      client_id: "ABCDEFGHijklmnopqrstuvwxyz1234567890"
      x25519_public_key: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Oj8="
      kyber_public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
      timestamp: 1701763200000
      nonce: "ABERhnd4uJrq67z7"
    expected_hex: "D8D1A764747970656E48414E445348414B455F494E4954656E6F6E63650111636C69656E745F696478204142434445464748496A6B6C6D6E6F707172737475767778797A313233343536373839306F7832353531395F7075626C69635F6B65797820415144424155474267674A4377734D44513550452553455851564668635947526F624830654879416869496D6B4A53596E4B43716B4179744C69384D545A7A4E677A394F6A383D6E6B797265725F7075626C69635F6B65795820414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141414141646E6F6E6365582041424552686E6434754A727136377A376974696D657374616D701A0000018E5F5E1000"
    expected_length: 239
```

### 5.2 Invalid Message Test Vectors

```yaml
invalid_test_vectors:
  missing_tag:
    description: "Message without semantic tag"
    input: {"type": "HANDSHAKE_COMPLETE", "version": 1}
    expected_error: "Missing semantic tag"
    
  wrong_tag:
    description: "Message with wrong semantic tag"
    input: "Tagged(0xFF, handshake_complete_data)"
    expected_error: "Wrong tag"
    
  missing_field:
    description: "Message missing required field"
    input: "Tagged(0xD3, {type: HANDSHAKE_COMPLETE, version: 1})"
    expected_error: "Missing required field: session_id"
    
  non_canonical_int:
    description: "Integer not using smallest encoding"
    input: "Tagged(0xD3, {type: HANDSHAKE_COMPLETE, version: 0x18 0x01})"  # 1 encoded as 0x18 0x01 instead of 0x01
    expected_error: "Non-canonical integer encoding"
    
  wrong_map_order:
    description: "Map keys not properly sorted"
    input: "Tagged(0xD3, {version: 1, type: HANDSHAKE_COMPLETE})"  # version before type
    expected_error: "Incorrect map key ordering"
```

---

## 6. Implementation Guidelines

### 6.1 Language-Specific Recommendations

```yaml
implementation_guidelines:
  python:
    recommended_library: "cbor2"
    canonical_encoding: "cbor.dumps(data, canonical=True)"
    tag_handling: "Use cbor.Tagged class"
    validation: "Custom schema validation recommended"
    
  javascript:
    recommended_library: "cbor"
    canonical_encoding: "cbor.encodeCanonical(data)"
    tag_handling: "new cbor.Tagged(tag, value)"
    validation: "JSON Schema + custom validation"
    
  go:
    recommended_library: "fxamacker/cbor/v2"
    canonical_encoding: "cbor.EncOptions{Canonical: true}"
    tag_handling: "cbor.TagOptions{EncTag: cbor.EncTagRequired}"
    validation: "Struct-based validation"
    
  rust:
    recommended_library: "serde_cbor"
    canonical_encoding: "serde_cbor::to_vec_packed()"
    tag_handling: "Custom enum with tags"
    validation: "Serde derive + custom validation"
```

### 6.2 Performance Considerations

```yaml
performance_guidelines:
  encoding:
    recommendation: "Use streaming for large messages"
    buffer_size: "8KB default, configurable"
    memory_usage: "Minimize allocations"
    
  validation:
    recommendation: "Early validation on critical fields"
    schema_caching: "Cache compiled schemas"
    error_handling: "Fast path for common errors"
    
  cross_platform:
    recommendation: "Use same test vectors"
    deterministic_testing: "Fixed random seeds"
    benchmarking: "Include in CI/CD"
```

---

## 7. Compliance Certification

### 7.1 Certification Requirements

```yaml
certification_requirements:
  mandatory_tests:
    - "All 13 message types must validate"
    - "Canonical encoding must be byte-for-byte identical"
    - "Cross-platform compatibility must be demonstrated"
    - "Security validation must pass"
    - "Performance benchmarks must meet minimums"
    
  optional_tests:
    - "Fuzzing resistance testing"
    - "Memory leak validation"
    - "Concurrent access testing"
    - "Resource exhaustion testing"
```

### 7.2 Certification Process

```yaml
certification_process:
  step_1:
    name: "Schema Validation"
    description: "Validate all message types against schema"
    tools: "validate_cbor_schema.py"
    
  step_2:
    name: "Canonical Encoding"
    description: "Verify canonical CBOR encoding rules"
    tools: "validate_cbor_canonical.py"
    
  step_3:
    name: "Cross-Platform Testing"
    description: "Test across multiple implementations"
    tools: "validate_cbor_cross_platform.py"
    
  step_4:
    name: "Security Validation"
    description: "Test against malformed inputs"
    tools: "validate_cbor_security.py"
    
  step_5:
    name: "Performance Testing"
    description: "Benchmark encoding/decoding"
    tools: "benchmark_cbor.py"
```

---

## 8. Maintenance and Updates

### 8.1 Version Compatibility

```yaml
version_compatibility:
  backward_compatibility:
    rule: "New versions must decode old messages"
    strategy: "Optional fields with defaults"
    
  forward_compatibility:
    rule: "Old versions should handle new messages gracefully"
    strategy: "Ignore unknown fields, log warnings"
    
  deprecation:
    rule: "Fields deprecated for at least one version before removal"
    process: "Deprecation warning -> Error -> Removal"
```

### 8.2 Schema Evolution

```yaml
schema_evolution:
  adding_fields:
    rule: "New fields must be optional"
    impact: "No breaking changes"
    
  removing_fields:
    rule: "Remove only after deprecation period"
    impact: "Breaking change, version bump required"
    
  changing_types:
    rule: "Type changes require new field name"
    impact: "Breaking change, version bump required"
```

---

*This CBOR validation schema and documentation provides the foundation for FoxWhisper v0.9 conformance testing and ensures cross-platform compatibility across all implementations.*