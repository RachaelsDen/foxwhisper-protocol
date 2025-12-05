#!/usr/bin/env python3
"""
FoxWhisper CBOR Schema Validator
Validates CBOR messages against the official FoxWhisper schema
"""

import json
import base64
import struct
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass
from enum import Enum

# Import our CBOR encoder
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Simple CBOR encoder (copy from validate_cbor_python_fixed.py)
class SimpleCBOR:
    """Simple CBOR encoder for validation purposes"""
    
    @staticmethod
    def encode_canonical(data):
        """Encode data using canonical CBOR rules"""
        if isinstance(data, dict):
            return SimpleCBOR._encode_map(data)
        elif isinstance(data, list):
            return SimpleCBOR._encode_array(data)
        elif isinstance(data, str):
            return SimpleCBOR._encode_string(data)
        elif isinstance(data, bytes):
            return SimpleCBOR._encode_bytes(data)
        elif isinstance(data, int):
            return SimpleCBOR._encode_int(data)
        elif isinstance(data, bool):
            return SimpleCBOR._encode_bool(data)
        else:
            raise ValueError(f"Unsupported type: {type(data)}")
    
    @staticmethod
    def _encode_int(value):
        """Encode integer with smallest possible representation"""
        if value >= 0:
            if value <= 23:
                return bytes([value])
            elif value <= 0xFF:
                return bytes([0x18, value])
            elif value <= 0xFFFF:
                return bytes([0x19]) + struct.pack('>H', value)
            elif value <= 0xFFFFFFFF:
                return bytes([0x1A]) + struct.pack('>I', value)
            elif value <= 0xFFFFFFFFFFFFFFFF:
                return bytes([0x1B]) + struct.pack('>Q', value)
        else:
            # Negative integers
            abs_val = abs(value) - 1
            if abs_val <= 23:
                return bytes([0x20 + abs_val])
            elif abs_val <= 0xFF:
                return bytes([0x38, abs_val])
            elif abs_val <= 0xFFFF:
                return bytes([0x39]) + struct.pack('>H', abs_val)
            elif abs_val <= 0xFFFFFFFF:
                return bytes([0x3A]) + struct.pack('>I', abs_val)
            elif abs_val <= 0xFFFFFFFFFFFFFFFF:
                return bytes([0x3B]) + struct.pack('>Q', abs_val)
        raise ValueError(f"Integer too large: {value}")
    
    @staticmethod
    def _encode_string(value):
        """Encode UTF-8 string"""
        utf8_bytes = value.encode('utf-8')
        length = len(utf8_bytes)
        if length <= 23:
            return bytes([0x60 + length]) + utf8_bytes
        elif length <= 0xFF:
            return bytes([0x78, length]) + utf8_bytes
        elif length <= 0xFFFF:
            return bytes([0x79]) + struct.pack('>H', length) + utf8_bytes
        elif length <= 0xFFFFFFFF:
            return bytes([0x7A]) + struct.pack('>I', length) + utf8_bytes
        else:
            raise ValueError(f"String too long: {length}")
    
    @staticmethod
    def _encode_bytes(value):
        """Encode byte string"""
        length = len(value)
        if length <= 23:
            return bytes([0x40 + length]) + value
        elif length <= 0xFF:
            return bytes([0x58, length]) + value
        elif length <= 0xFFFF:
            return bytes([0x59]) + struct.pack('>H', length) + value
        elif length <= 0xFFFFFFFF:
            return bytes([0x5A]) + struct.pack('>I', length) + value
        else:
            raise ValueError(f"Byte string too long: {length}")
    
    @staticmethod
    def _encode_array(value):
        """Encode array with fixed length"""
        length = len(value)
        if length <= 23:
            header = bytes([0x80 + length])
        elif length <= 0xFF:
            header = bytes([0x98, length])
        elif length <= 0xFFFF:
            header = bytes([0x99]) + struct.pack('>H', length)
        elif length <= 0xFFFFFFFF:
            header = bytes([0x9A]) + struct.pack('>I', length)
        else:
            raise ValueError(f"Array too long: {length}")
        
        result = header
        for item in value:
            result += SimpleCBOR.encode_canonical(item)
        return result
    
    @staticmethod
    def _encode_map(value):
        """Encode map with sorted keys"""
        # Sort keys by length, then lexicographically
        sorted_keys = sorted(value.keys(), key=lambda k: (len(k), k))
        length = len(sorted_keys)
        
        if length <= 23:
            header = bytes([0xA0 + length])
        elif length <= 0xFF:
            header = bytes([0xB8, length])
        elif length <= 0xFFFF:
            header = bytes([0xB9]) + struct.pack('>H', length)
        elif length <= 0xFFFFFFFF:
            header = bytes([0xBA]) + struct.pack('>I', length)
        else:
            raise ValueError(f"Map too long: {length}")
        
        result = header
        for key in sorted_keys:
            result += SimpleCBOR.encode_canonical(key)
            result += SimpleCBOR.encode_canonical(value[key])
        return result
    
    @staticmethod
    def _encode_bool(value):
        """Encode boolean"""
        return bytes([0xF5]) if value else bytes([0xF4])
    
    @staticmethod
    def encode_tagged(tag, data):
        """Encode tagged value"""
        if tag <= 23:
            tag_header = bytes([0xC0 + tag])
        elif tag <= 0xFF:
            tag_header = bytes([0xD8, tag])
        elif tag <= 0xFFFF:
            tag_header = bytes([0xD9]) + struct.pack('>H', tag)
        elif tag <= 0xFFFFFFFF:
            tag_header = bytes([0xDA]) + struct.pack('>I', tag)
        else:
            raise ValueError(f"Tag too large: {tag}")
        
        return tag_header + SimpleCBOR.encode_canonical(data)

class ValidationError(Exception):
    """CBOR validation error"""
    pass

class MessageType(Enum):
    """FoxWhisper message types with their tags"""
    HANDSHAKE_INIT = (0xD1, "HANDSHAKE_INIT")
    HANDSHAKE_RESPONSE = (0xD2, "HANDSHAKE_RESPONSE")
    HANDSHAKE_COMPLETE = (0xD3, "HANDSHAKE_COMPLETE")
    DR_BACKUP = (0xD4, "DR_BACKUP")
    DR_RESTORE = (0xD5, "DR_RESTORE")
    DR_RESET = (0xD6, "DR_RESET")
    GROUP_CREATE = (0xD7, "GROUP_CREATE")
    GROUP_JOIN = (0xD8, "GROUP_JOIN")
    GROUP_LEAVE = (0xD9, "GROUP_LEAVE")
    GROUP_KEY_DISTRIBUTION = (0xDA, "GROUP_KEY_DISTRIBUTION")
    EPOCH_AUTHENTICITY_RECORD = (0xDB, "EPOCH_AUTHENTICITY_RECORD")
    MEDIA_KEY_DISTRIBUTION = (0xDC, "MEDIA_KEY_DISTRIBUTION")
    MEDIA_FRAME = (0xDD, "MEDIA_FRAME")
    
    @classmethod
    def from_tag(cls, tag: int) -> Optional['MessageType']:
        """Get message type from tag"""
        for msg_type in cls:
            if msg_type.value[0] == tag:
                return msg_type
        return None
    
    @classmethod
    def from_name(cls, name: str) -> Optional['MessageType']:
        """Get message type from name"""
        for msg_type in cls:
            if msg_type.value[1] == name:
                return msg_type
        return None

@dataclass
class FieldDefinition:
    """Field definition for validation"""
    name: str
    field_type: str
    required: bool = True
    min_size: Optional[int] = None
    max_size: Optional[int] = None
    fixed_size: Optional[int] = None
    valid_values: Optional[List[str]] = None

class FoxWhisperSchema:
    """FoxWhisper CBOR message schema validator"""
    
    # Field size definitions
    FIELD_SIZES = {
        'client_id': 32,
        'server_id': 32,
        'device_id': 32,
        'session_id': 32,
        'handshake_hash': 32,
        'x25519_public_key': 32,
        'group_sender_ck_0': 32,
        'signature': 64,
        'nonce': 16,
        'iv': 12,
        'auth_tag': 16,
        'kyber_public_key': 1568,
        'kyber_ciphertext': 1568,
        'restore_token': 32,
    }
    
    # Message type schemas
    MESSAGE_SCHEMAS = {
        MessageType.HANDSHAKE_INIT: [
            FieldDefinition("type", "string", True, valid_values=["HANDSHAKE_INIT"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("client_id", "binary", True, fixed_size=32),
            FieldDefinition("x25519_public_key", "binary", True, fixed_size=32),
            FieldDefinition("kyber_public_key", "binary", True, fixed_size=1568),
            FieldDefinition("timestamp", "integer", True),
            FieldDefinition("nonce", "binary", True, fixed_size=16),
        ],
        MessageType.HANDSHAKE_RESPONSE: [
            FieldDefinition("type", "string", True, valid_values=["HANDSHAKE_RESPONSE"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("server_id", "binary", True, fixed_size=32),
            FieldDefinition("x25519_public_key", "binary", True, fixed_size=32),
            FieldDefinition("kyber_ciphertext", "binary", True, fixed_size=1568),
            FieldDefinition("timestamp", "integer", True),
            FieldDefinition("nonce", "binary", True, fixed_size=16),
        ],
        MessageType.HANDSHAKE_COMPLETE: [
            FieldDefinition("type", "string", True, valid_values=["HANDSHAKE_COMPLETE"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("session_id", "binary", True, fixed_size=32),
            FieldDefinition("handshake_hash", "binary", True, fixed_size=32),
            FieldDefinition("timestamp", "integer", True),
        ],
        MessageType.DR_BACKUP: [
            FieldDefinition("type", "string", True, valid_values=["DR_BACKUP"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("device_id", "binary", True, fixed_size=32),
            FieldDefinition("dr_data", "binary", True, min_size=1, max_size=4096),
            FieldDefinition("backup_version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("timestamp", "integer", True),
        ],
        MessageType.DR_RESTORE: [
            FieldDefinition("type", "string", True, valid_values=["DR_RESTORE"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("device_id", "binary", True, fixed_size=32),
            FieldDefinition("restore_token", "binary", True, fixed_size=32),
            FieldDefinition("timestamp", "integer", True),
        ],
        MessageType.DR_RESET: [
            FieldDefinition("type", "string", True, valid_values=["DR_RESET"]),
            FieldDefinition("version", "integer", True, min_size=1, max_size=255),
            FieldDefinition("device_id", "binary", True, fixed_size=32),
            FieldDefinition("reset_reason", "string", True, valid_values=["user_initiated", "security_breach", "device_lost"]),
            FieldDefinition("timestamp", "integer", True),
        ],
    }
    
    @classmethod
    def validate_field(cls, field_def: FieldDefinition, value: Any) -> bool:
        """Validate a single field against its definition"""
        
        # Type validation
        if field_def.field_type == "string":
            if not isinstance(value, str):
                raise ValidationError(f"Field {field_def.name} must be string, got {type(value)}")
            
            if field_def.valid_values and value not in field_def.valid_values:
                raise ValidationError(f"Field {field_def.name} has invalid value: {value}")
            
            if field_def.min_size and len(value) < field_def.min_size:
                raise ValidationError(f"Field {field_def.name} too short: {len(value)} < {field_def.min_size}")
            
            if field_def.max_size and len(value) > field_def.max_size:
                raise ValidationError(f"Field {field_def.name} too long: {len(value)} > {field_def.max_size}")
        
        elif field_def.field_type == "integer":
            if not isinstance(value, int):
                raise ValidationError(f"Field {field_def.name} must be integer, got {type(value)}")
            
            if field_def.min_size and value < field_def.min_size:
                raise ValidationError(f"Field {field_def.name} too small: {value} < {field_def.min_size}")
            
            if field_def.max_size and value > field_def.max_size:
                raise ValidationError(f"Field {field_def.name} too large: {value} > {field_def.max_size}")
        
        elif field_def.field_type == "binary":
            if not isinstance(value, bytes):
                raise ValidationError(f"Field {field_def.name} must be bytes, got {type(value)}")
            
            if field_def.fixed_size and len(value) != field_def.fixed_size:
                raise ValidationError(f"Field {field_def.name} wrong size: {len(value)} != {field_def.fixed_size}")
            
            if field_def.min_size and len(value) < field_def.min_size:
                raise ValidationError(f"Field {field_def.name} too short: {len(value)} < {field_def.min_size}")
            
            if field_def.max_size and len(value) > field_def.max_size:
                raise ValidationError(f"Field {field_def.name} too long: {len(value)} > {field_def.max_size}")
        
        return True
    
    @classmethod
    def validate_message_structure(cls, message_type: MessageType, data: Dict[str, Any]) -> bool:
        """Validate message structure against schema"""
        
        if message_type not in cls.MESSAGE_SCHEMAS:
            raise ValidationError(f"Unknown message type: {message_type}")
        
        schema = cls.MESSAGE_SCHEMAS[message_type]
        
        # Check required fields
        for field_def in schema:
            if field_def.required and field_def.name not in data:
                raise ValidationError(f"Missing required field: {field_def.name}")
        
        # Validate all present fields
        for field_name, field_value in data.items():
            # Find field definition
            field_def = None
            for fd in schema:
                if fd.name == field_name:
                    field_def = fd
                    break
            
            if not field_def:
                raise ValidationError(f"Unknown field: {field_name}")
            
            # Validate field
            cls.validate_field(field_def, field_value)
        
        return True
    
    @classmethod
    def validate_cbor_encoding(cls, encoded_bytes: bytes) -> bool:
        """Validate CBOR follows canonical encoding rules"""
        
        # This is a simplified validation - in practice, you'd want
        # a more thorough CBOR parser to check all canonical rules
        
        # Check for common non-canonical patterns
        i = 0
        while i < len(encoded_bytes):
            major_type = (encoded_bytes[i] >> 5) & 0x07
            additional_info = encoded_bytes[i] & 0x1F
            
            if major_type == 0:  # Unsigned integer
                if additional_info == 0x18:  # One-byte length
                    if i + 2 > len(encoded_bytes):
                        raise ValidationError("Truncated integer encoding")
                    value = encoded_bytes[i + 1]
                    if value <= 23:  # Should have used single-byte encoding
                        raise ValidationError(f"Non-canonical integer: {value} should use single byte")
                    i += 2
                elif additional_info == 0x19:  # Two-byte length
                    if i + 3 > len(encoded_bytes):
                        raise ValidationError("Truncated integer encoding")
                    value = struct.unpack('>H', encoded_bytes[i+1:i+3])[0]
                    if value <= 255:  # Should have used one-byte length
                        raise ValidationError(f"Non-canonical integer: {value} should use one byte")
                    i += 3
                elif additional_info <= 23:  # Direct encoding
                    i += 1
                else:
                    i += 1  # Skip for simplicity in this validator
            
            elif major_type == 2:  # Byte string
                if additional_info == 0x5F:  # Indefinite length
                    raise ValidationError("Indefinite-length byte string not canonical")
                # Skip length and data for simplicity
                if additional_info <= 23:
                    length = additional_info
                    i += 1 + length
                elif additional_info == 0x58:
                    if i + 1 >= len(encoded_bytes):
                        raise ValidationError("Truncated length byte")
                    length = encoded_bytes[i + 1]
                    i += 2 + length
                else:
                    i += 1  # Skip for simplicity
            
            elif major_type == 3:  # UTF-8 string
                if additional_info == 0x7F:  # Indefinite length
                    raise ValidationError("Indefinite-length string not canonical")
                # Skip for simplicity
                i += 1
            
            elif major_type == 5:  # Map
                if additional_info == 0xBF:  # Indefinite length
                    raise ValidationError("Indefinite-length map not canonical")
                # Skip for simplicity - would need to parse map structure
                i += 1
            
            elif major_type == 6:  # Semantic tag
                if additional_info <= 23:
                    i += 1
                elif additional_info == 0xD8:  # One-byte tag
                    i += 2
                else:
                    i += 1  # Skip for simplicity
            
            else:
                i += 1  # Skip other types
        
        return True

def validate_message(message_data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a complete FoxWhisper message"""
    
    result = {
        'valid': False,
        'errors': [],
        'warnings': [],
        'message_type': None,
        'tag': None
    }
    
    try:
        # Extract message type
        if 'type' not in message_data:
            result['errors'].append("Missing 'type' field")
            return result
        
        message_type_name = message_data['type']
        message_type = MessageType.from_name(message_type_name)
        
        if not message_type:
            result['errors'].append(f"Unknown message type: {message_type_name}")
            return result
        
        result['message_type'] = message_type_name
        result['tag'] = message_type.value[0]
        
        # Validate message structure
        FoxWhisperSchema.validate_message_structure(message_type, message_data)
        
        # Convert to CBOR and validate encoding
        cbor_data = SimpleCBOR.encode_tagged(message_type.value[0], message_data)
        FoxWhisperSchema.validate_cbor_encoding(cbor_data)
        
        result['valid'] = True
        result['cbor_size'] = len(cbor_data)
        result['cbor_hex'] = cbor_data.hex().upper()
        
    except ValidationError as e:
        result['errors'].append(str(e))
    except Exception as e:
        result['errors'].append(f"Unexpected error: {str(e)}")
    
    return result

def main():
    """Run schema validation tests"""
    
    print("FoxWhisper CBOR Schema Validator")
    print("=" * 40)
    
    # Load test vectors
    try:
        with open('../../../tests/common/handshake/cbor_test_vectors_fixed.json', 'r') as f:
            test_vectors = json.load(f)
    except FileNotFoundError:
        print("Error: cbor_test_vectors_fixed.json not found")
        return
    
    results = []
    
    for message_name, test_vector in test_vectors.items():
        print(f"\nValidating: {message_name}")
        print("-" * 30)
        
        # Convert base64 strings to bytes for validation
        message_data = test_vector['data'].copy()
        for key, value in message_data.items():
            if isinstance(value, str) and key in ['session_id', 'handshake_hash', 'client_id', 'server_id', 'x25519_public_key', 'kyber_public_key', 'kyber_ciphertext', 'nonce']:
                try:
                    message_data[key] = base64.urlsafe_b64decode(value)
                except:
                    pass  # Keep as string if not valid base64
        
        result = validate_message(message_data)
        result['test_name'] = message_name
        results.append(result)
        
        if result['valid']:
            print(f"✅ {message_name} - VALID")
            print(f"   CBOR Size: {result['cbor_size']} bytes")
            print(f"   CBOR Hex: {result['cbor_hex'][:64]}...")
        else:
            print(f"❌ {message_name} - INVALID")
            for error in result['errors']:
                print(f"   Error: {error}")
    
    # Summary
    print("\n" + "=" * 40)
    print("VALIDATION SUMMARY")
    print("=" * 40)
    
    valid_count = sum(1 for r in results if r['valid'])
    total_count = len(results)
    
    for result in results:
        status = "✅ VALID" if result['valid'] else "❌ INVALID"
        print(f"{status} {result['test_name']}")
    
    print(f"\nOverall: {valid_count}/{total_count} messages valid")
    
    if valid_count == total_count:
        print("🎉 All messages passed schema validation!")
    else:
        print("⚠️  Some messages failed validation")
    
    # Save results
    with open('schema_validation_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("\n📄 Results saved to schema_validation_results.json")

if __name__ == "__main__":
    main()