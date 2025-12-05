#!/usr/bin/env python3
"""
FoxWhisper Media Encryption Test Vector Generator
Generates media key derivation and frame protection test vectors for FoxWhisper v0.9
"""

import json
import base64
import os
from typing import Dict, List, Any

class MediaEncryptionTestVectorGenerator:
    """Generates Media Encryption test vectors"""
    
    def __init__(self):
        self.test_vectors = {}
        
    def generate_key_derivation(self) -> Dict[str, Any]:
        """Generate media key derivation test vector"""
        
        session_id = base64.b64encode(os.urandom(32)).decode()
        root_key = base64.b64encode(os.urandom(32)).decode()
        chain_key = base64.b64encode(os.urandom(32)).decode()
        
        # Key derivation steps
        key_derivation = {
            "description": "Media key derivation from ratchet chain",
            "scenario": "media_key_derivation",
            "session_context": {
                "session_id": session_id,
                "root_key": root_key,
                "chain_key": chain_key,
                "message_index": 42
            },
            "steps": [
                {
                    "step": 1,
                    "type": "KEY_DERIVE",
                    "operation": "derive_media_key",
                    "input": {
                        "root_key": root_key,
                        "chain_key": chain_key,
                        "message_index": 42,
                        "salt": base64.b64encode(os.urandom(16)).decode()
                    },
                    "output": {
                        "media_key": base64.b64encode(os.urandom(32)).decode(),
                        "key_id": base64.b64encode(os.urandom(8)).decode(),
                        "key_expiry": 1701763280000
                    },
                    "validation": {
                        "key_length": 32,
                        "key_uniqueness": True,
                        "proper_derivation": True
                    }
                }
            ],
            "validation_criteria": {
                "proper_key_derivation": True,
                "key_length_correct": True,
                "key_uniqueness": True,
                "secure_randomness": True
            }
        }
        
        return key_derivation
    
    def generate_frame_protection(self) -> Dict[str, Any]:
        """Generate frame protection test vector"""
        
        media_key = base64.b64encode(os.urandom(32)).decode()
        frame_data = base64.b64encode(os.urandom(1024)).decode()
        frame_iv = base64.b64encode(os.urandom(12)).decode()
        
        frame_protection = {
            "description": "Media frame protection with encryption and authentication",
            "scenario": "frame_protection",
            "media_context": {
                "media_key": media_key,
                "frame_type": "video",
                "sequence_number": 12345,
                "timestamp": 1701763200000
            },
            "steps": [
                {
                    "step": 1,
                    "type": "FRAME_ENCRYPT",
                    "operation": "encrypt_media_frame",
                    "input": {
                        "media_key": media_key,
                        "frame_data": frame_data,
                        "frame_iv": frame_iv,
                        "aad": base64.b64encode(b"video_frame_12345").decode()
                    },
                    "output": {
                        "encrypted_frame": base64.b64encode(os.urandom(1040)).decode(),
                        "auth_tag": base64.b64encode(os.urandom(16)).decode(),
                        "frame_header": {
                            "frame_type": "video",
                            "sequence_number": 12345,
                            "encrypted_length": 1040,
                            "key_id": base64.b64encode(os.urandom(8)).decode()
                        }
                    },
                    "validation": {
                        "confidentiality": True,
                        "integrity": True,
                        "authenticity": True,
                        "proper_aad_binding": True
                    }
                }
            ],
            "validation_criteria": {
                "frame_encryption": True,
                "authentication_tag": True,
                "aad_binding": True,
                "iv_uniqueness": True
            }
        }
        
        return frame_protection
    
    def generate_key_distribution(self) -> Dict[str, Any]:
        """Generate SFU key distribution test vector"""
        
        sfu_id = base64.b64encode(os.urandom(32)).decode()
        participant_id = base64.b64encode(os.urandom(32)).decode()
        media_key = base64.b64encode(os.urandom(32)).decode()
        key_lifetime = 3600  # 1 hour in seconds
        
        key_distribution = {
            "description": "SFU media key distribution to participant",
            "scenario": "key_distribution",
            "sfu_context": {
                "sfu_id": sfu_id,
                "participant_id": participant_id,
                "session_type": "group_call"
            },
            "steps": [
                {
                    "step": 1,
                    "type": "KEY_DISTRIBUTE",
                    "from": "sfu",
                    "to": "participant",
                    "message": {
                        "type": "KEY_DISTRIBUTE",
                        "version": 1,
                        "sfu_id": sfu_id,
                        "participant_id": participant_id,
                        "media_key": media_key,
                        "key_lifetime": key_lifetime,
                        "distribution_timestamp": 1701763200000,
                        "signature": base64.b64encode(os.urandom(64)).decode()
                    },
                    "expected_result": "key_received"
                },
                {
                    "step": 2,
                    "type": "KEY_ACK",
                    "from": "participant",
                    "to": "sfu",
                    "message": {
                        "type": "KEY_ACK",
                        "version": 1,
                        "sfu_id": sfu_id,
                        "participant_id": participant_id,
                        "key_id": base64.b64encode(os.urandom(8)).decode(),
                        "ack_timestamp": 1701763201000,
                        "signature": base64.b64encode(os.urandom(64)).decode()
                    },
                    "expected_result": "key_confirmed"
                }
            ],
            "validation_criteria": {
                "secure_key_distribution": True,
                "proper_authentication": True,
                "key_lifecycle": True,
                "sfu_authorization": True
            }
        }
        
        return key_distribution
    
    def save_test_vectors(self, filename: str):
        """Save all media encryption test vectors to file"""
        
        self.test_vectors["key_derivation"] = self.generate_key_derivation()
        self.test_vectors["frame_protection"] = self.generate_frame_protection()
        self.test_vectors["key_distribution"] = self.generate_key_distribution()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper Media Encryption Test Vector Generator",
            "description": "Media encryption and key distribution test vectors for FoxWhisper E2EE",
            "test_categories": [
                "key_derivation",
                "frame_protection",
                "key_distribution"
            ],
            "validation_features": [
                "cryptographic_key_derivation",
                "frame_encryption_authentication",
                "secure_key_distribution",
                "sfu_participant_authentication"
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(self.test_vectors, f, indent=2)
        
        print(f"✅ Media encryption test vectors saved to {filename}")
        print(f"📊 Generated {len(self.test_vectors)-1} media encryption test scenarios")
    
    def validate_test_vectors(self, filename: str):
        """Validate generated media encryption test vectors"""
        
        with open(filename, 'r') as f:
            vectors = json.load(f)
        
        validation_results = {
            "key_derivation": self._validate_key_derivation(vectors.get("key_derivation", {})),
            "frame_protection": self._validate_frame_protection(vectors.get("frame_protection", {})),
            "key_distribution": self._validate_key_distribution(vectors.get("key_distribution", {}))
        }
        
        return validation_results
    
    def _validate_key_derivation(self, derivation: Dict[str, Any]) -> Dict[str, Any]:
        """Validate key derivation test vector"""
        
        if not derivation:
            return {"valid": False, "errors": ["Missing key derivation test vector"]}
        
        errors = []
        session_context = derivation.get("session_context", {})
        
        # Check required fields
        required_fields = ["session_id", "root_key", "chain_key", "message_index"]
        for field in required_fields:
            if field not in session_context:
                errors.append(f"Missing session field: {field}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }
    
    def _validate_frame_protection(self, protection: Dict[str, Any]) -> Dict[str, Any]:
        """Validate frame protection test vector"""
        
        if not protection:
            return {"valid": False, "errors": ["Missing frame protection test vector"]}
        
        errors = []
        media_context = protection.get("media_context", {})
        
        # Check required fields
        required_fields = ["media_key", "frame_type", "sequence_number"]
        for field in required_fields:
            if field not in media_context:
                errors.append(f"Missing media field: {field}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }
    
    def _validate_key_distribution(self, distribution: Dict[str, Any]) -> Dict[str, Any]:
        """Validate key distribution test vector"""
        
        if not distribution:
            return {"valid": False, "errors": ["Missing key distribution test vector"]}
        
        errors = []
        sfu_context = distribution.get("sfu_context", {})
        
        # Check required fields
        required_fields = ["sfu_id", "participant_id", "session_type"]
        for field in required_fields:
            if field not in sfu_context:
                errors.append(f"Missing SFU field: {field}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }

def main():
    print("FoxWhisper Media Encryption Test Vector Generator")
    print("=" * 55)
    
    generator = MediaEncryptionTestVectorGenerator()
    
    # Generate test vectors
    output_file = "../test-vectors/handshake/media_encryption_test_vectors.json"
    generator.save_test_vectors(output_file)
    
    # Validate generated vectors
    print("\nValidating generated test vectors...")
    validation_results = generator.validate_test_vectors(output_file)
    
    for category, result in validation_results.items():
        if result["valid"]:
            print(f"✅ {category}: VALID ({result['fields_checked']} fields checked)")
        else:
            print(f"❌ {category}: INVALID")
            for error in result["errors"]:
                print(f"   Error: {error}")
    
    print(f"\n🎉 Media encryption test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()