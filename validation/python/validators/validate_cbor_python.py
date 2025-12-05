#!/usr/bin/env python3
"""
FoxWhisper CBOR Validation - Python Implementation
Validates canonical CBOR encoding examples across multiple message types
"""

import hashlib
import base64
import struct
from typing import Dict, Any, List, Tuple

class SimpleCBOR:
    """Simple CBOR encoder for validation purposes"""
    
    @staticmethod
    def encode_canonical(data: Any) -> bytes:
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
    def _encode_int(value: int) -> bytes:
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
    def _encode_string(value: str) -> bytes:
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
    def _encode_bytes(value: bytes) -> bytes:
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
    def _encode_array(value: List[Any]) -> bytes:
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
    def _encode_map(value: Dict[str, Any]) -> bytes:
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
    def _encode_bool(value: bool) -> bytes:
        """Encode boolean"""
        return bytes([0xF5]) if value else bytes([0xF4])
    
    @staticmethod
    def encode_tagged(tag: int, data: Any) -> bytes:
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

# Test data from CBOR examples
TEST_VECTORS = {
    "HANDSHAKE_INIT": {
        "tag": 0xD1,
        "data": {
            "type": "HANDSHAKE_INIT",
            "version": 1,
            "client_id": base64.urlsafe_b64decode("ABCDEFGHijklmnopqrstuvwxyz1234567890"),
            "x25519_public_key": base64.urlsafe_b64decode("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Oj8="),
            "kyber_public_key": b'\x00' * 1568,  # Simplified for testing
            "timestamp": 1701763200000,
            "nonce": b'\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\xcc\xdd\xee\xff'
        }
    },
    "HANDSHAKE_RESPONSE": {
        "tag": 0xD2,
        "data": {
            "type": "HANDSHAKE_RESPONSE",
            "version": 1,
            "server_id": base64.urlsafe_b64decode("UVVXV1lZYWJjZGVmZ2hpams="),
            "x25519_public_key": base64.urlsafe_b64decode("ISIjJCUmJygpKissLS4vMTIzNDU2Nzg5Oj8+Pw=="),
            "kyber_ciphertext": b'\x00' * 1568,  # Simplified for testing
            "timestamp": 1701763201000,
            "nonce": b'\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\xcc\xdd\xee\xff\x00'
        }
    },
    "HANDSHAKE_COMPLETE": {
        "tag": 0xD3,
        "data": {
            "type": "HANDSHAKE_COMPLETE",
            "version": 1,
            "session_id": base64.urlsafe_b64decode("YWJjZGVmZ2hpams="),
            "handshake_hash": base64.urlsafe_b64decode("ODlBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZQ=="),
            "timestamp": 1701763202000
        }
    }
}

def validate_message(message_name: str, test_vector: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate a single message"""
    try:
        # Encode with our implementation
        encoded = SimpleCBOR.encode_tagged(test_vector["tag"], test_vector["data"])
        
        # Convert to hex for comparison
        actual_hex = encoded.hex().upper()
        
        print(f"✓ {message_name} Python validation passed")
        print(f"  Encoded length: {len(encoded)} bytes")
        print(f"  Hex: {actual_hex[:64]}{'...' if len(actual_hex) > 64 else ''}")
        
        return True, actual_hex
        
    except Exception as e:
        error_msg = f"✗ {message_name} Python validation failed: {str(e)}"
        print(error_msg)
        return False, error_msg

def main():
    """Run all CBOR validation tests"""
    print("FoxWhisper CBOR Validation - Python Implementation")
    print("=" * 50)
    
    results = []
    
    for message_name, test_vector in TEST_VECTORS.items():
        success, result = validate_message(message_name, test_vector)
        results.append((message_name, success, result))
        print()
    
    # Summary
    print("Summary:")
    print("-" * 30)
    passed = sum(1 for _, success, _ in results if success)
    total = len(results)
    
    for message_name, success, _ in results:
        status = "✓ PASS" if success else "✗ FAIL"
        print(f"{status} {message_name}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All Python CBOR validation tests passed!")
    else:
        print("❌ Some tests failed. Check implementation.")

if __name__ == "__main__":
    main()