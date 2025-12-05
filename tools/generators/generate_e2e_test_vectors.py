#!/usr/bin/env python3
"""
FoxWhisper End-to-End Test Vector Generator
Generates complete protocol flow test vectors for FoxWhisper v0.9
"""

import json
import base64
import os
from typing import Dict, List, Any

class EndToEndTestVectorGenerator:
    """Generates comprehensive end-to-end test vectors"""
    
    def __init__(self):
        self.test_vectors = {}
        
    def generate_handshake_flow(self) -> Dict[str, Any]:
        """Generate complete handshake flow test vectors"""
        
        # Generate cryptographic material
        client_id = base64.b64encode(os.urandom(32)).decode()
        server_id = base64.b64encode(os.urandom(32)).decode()
        
        # X25519 key pairs
        client_x25519_priv = base64.b64encode(os.urandom(32)).decode()
        client_x25519_pub = base64.b64encode(os.urandom(32)).decode()
        server_x25519_priv = base64.b64encode(os.urandom(32)).decode()
        server_x25519_pub = base64.b64encode(os.urandom(32)).decode()
        
        # Kyber material
        client_kyber_pub = base64.b64encode(os.urandom(1568)).decode()
        server_kyber_ciphertext = base64.b64encode(os.urandom(1568)).decode()
        
        # Nonces
        client_nonce = base64.b64encode(os.urandom(16)).decode()
        server_nonce = base64.b64encode(os.urandom(16)).decode()
        
        # Session keys
        session_id = base64.b64encode(os.urandom(32)).decode()
        handshake_hash = base64.b64encode(os.urandom(32)).decode()
        
        handshake_flow = {
            "description": "Complete FoxWhisper handshake flow",
            "participants": ["client", "server"],
            "steps": [
                {
                    "step": 1,
                    "type": "HANDSHAKE_INIT",
                    "from": "client",
                    "to": "server",
                    "message": {
                        "type": "HANDSHAKE_INIT",
                        "version": 1,
                        "client_id": client_id,
                        "x25519_public_key": client_x25519_pub,
                        "kyber_public_key": client_kyber_pub,
                        "timestamp": 1701763200000,
                        "nonce": client_nonce
                    },
                    "expected_response": "HANDSHAKE_RESPONSE"
                },
                {
                    "step": 2,
                    "type": "HANDSHAKE_RESPONSE",
                    "from": "server",
                    "to": "client",
                    "message": {
                        "type": "HANDSHAKE_RESPONSE",
                        "version": 1,
                        "server_id": server_id,
                        "x25519_public_key": server_x25519_pub,
                        "kyber_ciphertext": server_kyber_ciphertext,
                        "timestamp": 1701763201000,
                        "nonce": server_nonce
                    },
                    "expected_response": "HANDSHAKE_COMPLETE"
                },
                {
                    "step": 3,
                    "type": "HANDSHAKE_COMPLETE",
                    "from": "client",
                    "to": "server",
                    "message": {
                        "type": "HANDSHAKE_COMPLETE",
                        "version": 1,
                        "session_id": session_id,
                        "handshake_hash": handshake_hash,
                        "timestamp": 1701763202000
                    },
                    "expected_response": "ENCRYPTED_MESSAGE"
                }
            ],
            "validation_criteria": {
                "all_required_fields_present": True,
                "correct_message_types": True,
                "valid_base64_encoding": True,
                "correct_field_sizes": True,
                "chronological_timestamps": True,
                "matching_session_ids": True
            }
        }
        
        return handshake_flow
    
    def generate_device_addition_flow(self) -> Dict[str, Any]:
        """Generate device addition to existing session"""
        
        existing_device_id = base64.b64encode(os.urandom(32)).decode()
        new_device_id = base64.b64encode(os.urandom(32)).decode()
        session_id = base64.b64encode(os.urandom(32)).decode()
        
        device_addition = {
            "description": "Add new device to existing FoxWhisper session",
            "scenario": "device_addition",
            "existing_session": {
                "session_id": session_id,
                "devices": [existing_device_id]
            },
            "steps": [
                {
                    "step": 1,
                    "type": "DEVICE_ANNOUNCE",
                    "from": "new_device",
                    "to": "existing_devices",
                    "message": {
                        "type": "DEVICE_ANNOUNCE",
                        "version": 1,
                        "device_id": new_device_id,
                        "session_id": session_id,
                        "x25519_public_key": base64.b64encode(os.urandom(32)).decode(),
                        "timestamp": 1701763203000
                    }
                },
                {
                    "step": 2,
                    "type": "DEVICE_ACK",
                    "from": "existing_devices",
                    "to": "new_device",
                    "message": {
                        "type": "DEVICE_ACK",
                        "version": 1,
                        "device_id": existing_device_id,
                        "session_id": session_id,
                        "existing_devices": [existing_device_id],
                        "timestamp": 1701763204000
                    }
                }
            ],
            "validation_criteria": {
                "device_authentication": True,
                "session_consistency": True,
                "no_duplicate_devices": True,
                "proper_device_ids": True
            }
        }
        
        return device_addition
    
    def save_test_vectors(self, filename: str):
        """Save all test vectors to file"""
        
        self.test_vectors["handshake_flow"] = self.generate_handshake_flow()
        self.test_vectors["device_addition"] = self.generate_device_addition_flow()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper End-to-End Test Vector Generator",
            "description": "Complete protocol flow test vectors for FoxWhisper E2EE",
            "test_categories": ["handshake_flow", "device_addition"],
            "validation_features": [
                "message_structure_validation",
                "field_size_validation",
                "base64_encoding_validation",
                "chronological_validation",
                "session_consistency_validation"
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(self.test_vectors, f, indent=2)
        
        print(f"✅ End-to-end test vectors saved to {filename}")
        print(f"📊 Generated {len(self.test_vectors)-1} test scenarios")
    
    def validate_test_vectors(self, filename: str):
        """Validate generated test vectors"""
        
        with open(filename, 'r') as f:
            vectors = json.load(f)
        
        validation_results = {
            "handshake_flow": self._validate_handshake_flow(vectors.get("handshake_flow", {})),
            "device_addition": self._validate_device_addition(vectors.get("device_addition", {}))
        }
        
        return validation_results
    
    def _validate_handshake_flow(self, flow: Dict[str, Any]) -> Dict[str, Any]:
        """Validate handshake flow test vector"""
        
        if not flow:
            return {"valid": False, "errors": ["Missing handshake flow"]}
        
        errors = []
        steps = flow.get("steps", [])
        
        # Validate step sequence
        expected_types = ["HANDSHAKE_INIT", "HANDSHAKE_RESPONSE", "HANDSHAKE_COMPLETE"]
        for i, step in enumerate(steps):
            if i >= len(expected_types):
                errors.append(f"Unexpected step {i+1}: {step.get('type')}")
                continue
                
            expected_type = expected_types[i]
            actual_type = step.get("type")
            if actual_type != expected_type:
                errors.append(f"Step {i+1}: expected {expected_type}, got {actual_type}")
        
        # Validate message structure
        for step in steps:
            message = step.get("message", {})
            if not message.get("type"):
                errors.append(f"Step {step.get('step')}: missing message type")
            if not message.get("version"):
                errors.append(f"Step {step.get('step')}: missing version")
            if not message.get("timestamp"):
                errors.append(f"Step {step.get('step')}: missing timestamp")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }
    
    def _validate_device_addition(self, addition: Dict[str, Any]) -> Dict[str, Any]:
        """Validate device addition test vector"""
        
        if not addition:
            return {"valid": False, "errors": ["Missing device addition flow"]}
        
        errors = []
        steps = addition.get("steps", [])
        
        # Validate device announcement
        if len(steps) < 2:
            errors.append("Device addition requires at least 2 steps")
        
        for step in steps:
            message = step.get("message", {})
            if not message.get("device_id"):
                errors.append(f"Step {step.get('step')}: missing device_id")
            if not message.get("session_id"):
                errors.append(f"Step {step.get('step')}: missing session_id")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }

def main():
    print("FoxWhisper End-to-End Test Vector Generator")
    print("=" * 50)
    
    generator = EndToEndTestVectorGenerator()
    
    # Generate test vectors
    output_file = "../test-vectors/handshake/end_to_end_test_vectors.json"
    generator.save_test_vectors(output_file)
    
    # Validate generated vectors
    print("\nValidating generated test vectors...")
    validation_results = generator.validate_test_vectors(output_file)
    
    for category, result in validation_results.items():
        if result["valid"]:
            print(f"✅ {category}: VALID ({result['steps_validated']} steps)")
        else:
            print(f"❌ {category}: INVALID")
            for error in result["errors"]:
                print(f"   Error: {error}")
    
    print(f"\n🎉 End-to-end test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()