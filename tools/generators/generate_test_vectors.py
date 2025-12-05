#!/usr/bin/env python3
"""
Generate proper FoxWhisper CBOR test vectors with correct binary sizes
"""

import base64
import json
import os

def generate_test_vectors():
    """Generate test vectors with correct binary field sizes"""
    
    # Generate proper binary data
    test_vectors = {
        "HANDSHAKE_COMPLETE": {
            "tag": 0xD3,
            "data": {
                "type": "HANDSHAKE_COMPLETE",
                "version": 1,
                "session_id": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "handshake_hash": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "timestamp": 1701763202000
            }
        },
        "HANDSHAKE_INIT": {
            "tag": 0xD1,
            "data": {
                "type": "HANDSHAKE_INIT",
                "version": 1,
                "client_id": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "x25519_public_key": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "kyber_public_key": base64.urlsafe_b64encode(os.urandom(1568)).decode('ascii'),
                "timestamp": 1701763200000,
                "nonce": base64.urlsafe_b64encode(os.urandom(16)).decode('ascii')
            }
        },
        "HANDSHAKE_RESPONSE": {
            "tag": 0xD2,
            "data": {
                "type": "HANDSHAKE_RESPONSE",
                "version": 1,
                "server_id": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "x25519_public_key": base64.urlsafe_b64encode(os.urandom(32)).decode('ascii'),
                "kyber_ciphertext": base64.urlsafe_b64encode(os.urandom(1568)).decode('ascii'),
                "timestamp": 1701763201000,
                "nonce": base64.urlsafe_b64encode(os.urandom(16)).decode('ascii')
            }
        }
    }
    
    return test_vectors

def main():
    """Generate and save test vectors"""
    
    print("Generating FoxWhisper CBOR Test Vectors")
    print("=" * 40)
    
    test_vectors = generate_test_vectors()
    
    # Save test vectors
    with open('cbor_test_vectors_fixed.json', 'w') as f:
        json.dump(test_vectors, f, indent=2)
    
    print("✅ Test vectors saved to cbor_test_vectors_fixed.json")
    
    # Show field sizes
    for message_name, test_vector in test_vectors.items():
        print(f"\n{message_name}:")
        print("-" * 30)
        data = test_vector['data']
        
        for field_name, field_value in data.items():
            if isinstance(field_value, str) and field_name not in ['type']:
                try:
                    decoded = base64.urlsafe_b64decode(field_value)
                    print(f"  {field_name}: {len(decoded)} bytes")
                except:
                    print(f"  {field_name}: {len(field_value)} chars")
            else:
                print(f"  {field_name}: {field_value}")

if __name__ == "__main__":
    main()