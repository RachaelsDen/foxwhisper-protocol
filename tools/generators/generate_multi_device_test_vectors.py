#!/usr/bin/env python3

import json
import base64
import secrets
import hashlib
import time
from typing import Dict, List, Any

class MultiDeviceSyncTestVectorGenerator:
    """
    Generates test vectors for multi-device synchronization scenarios
    in FoxWhisper v0.9 protocol
    """
    
    def __init__(self):
        self.test_vectors = {}
        self.devices = {}
        self.sessions = {}
        
    def generate_device_id(self) -> str:
        """Generate a random device identifier"""
        return base64.b64encode(secrets.token_bytes(32)).decode('utf-8')
    
    def generate_session_id(self) -> str:
        """Generate a random session identifier"""
        return base64.b64encode(secrets.token_bytes(32)).decode('utf-8')
    
    def generate_x25519_keypair(self) -> tuple:
        """Generate X25519 key pair (simplified for test vectors)"""
        private_key = secrets.token_bytes(32)
        public_key = secrets.token_bytes(32)  # Simplified - would be actual X25519 derivation
        return (
            base64.b64encode(private_key).decode('utf-8'),
            base64.b64encode(public_key).decode('utf-8')
        )
    
    def generate_kyber_keypair(self) -> tuple:
        """Generate Kyber key pair (simplified for test vectors)"""
        private_key = secrets.token_bytes(3168)
        public_key = secrets.token_bytes(1568)
        return (
            base64.b64encode(private_key).decode('utf-8'),
            base64.b64encode(public_key).decode('utf-8')
        )
    
    def generate_handshake_hash(self, session_data: Dict[str, Any]) -> str:
        """Generate handshake hash from session data"""
        hash_input = json.dumps(session_data, sort_keys=True).encode('utf-8')
        return base64.b64encode(hashlib.sha256(hash_input).digest()).decode('utf-8')
    
    def create_device_record(self, device_id: str, device_name: str) -> Dict[str, Any]:
        """Create a device record for backup/restore scenarios"""
        priv_x25519, pub_x25519 = self.generate_x25519_keypair()
        priv_kyber, pub_kyber = self.generate_kyber_keypair()
        
        return {
            "device_id": device_id,
            "device_name": device_name,
            "x25519_private_key": priv_x25519,
            "x25519_public_key": pub_x25519,
            "kyber_private_key": priv_kyber,
            "kyber_public_key": pub_kyber,
            "created_at": int(time.time() * 1000),
            "last_seen": int(time.time() * 1000),
            "device_status": "active"
        }
    
    def generate_device_addition_scenario(self) -> Dict[str, Any]:
        """Generate test vectors for adding a new device to existing session"""
        print("Generating device addition scenario...")
        
        # Primary device setup
        primary_device_id = self.generate_device_id()
        session_id = self.generate_session_id()
        
        # Create primary device
        primary_device = self.create_device_record(primary_device_id, "primary_device")
        
        # New device to add
        new_device_id = self.generate_device_id()
        new_device = self.create_device_record(new_device_id, "new_device")
        
        # Step 1: Primary device initiates device addition
        device_add_init = {
            "type": "DEVICE_ADD_INIT",
            "version": 1,
            "session_id": session_id,
            "primary_device_id": primary_device_id,
            "new_device_id": new_device_id,
            "new_device_public_key": new_device["x25519_public_key"],
            "timestamp": int(time.time() * 1000),
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 2: New device responds with acknowledgment
        device_add_response = {
            "type": "DEVICE_ADD_RESPONSE",
            "version": 1,
            "session_id": session_id,
            "device_id": new_device_id,
            "primary_device_id": primary_device_id,
            "acknowledgment": True,
            "timestamp": int(time.time() * 1000) + 1000,
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 3: Primary device confirms addition
        device_add_complete = {
            "type": "DEVICE_ADD_COMPLETE",
            "version": 1,
            "session_id": session_id,
            "device_id": new_device_id,
            "primary_device_id": primary_device_id,
            "device_status": "active",
            "timestamp": int(time.time() * 1000) + 2000,
            "handshake_hash": self.generate_handshake_hash({
                "session_id": session_id,
                "devices": [primary_device_id, new_device_id]
            })
        }
        
        return {
            "description": "Multi-device addition scenario - adding new device to existing session",
            "scenario_type": "device_addition",
            "devices": {
                "primary_device": primary_device,
                "new_device": new_device
            },
            "session_id": session_id,
            "steps": [
                {
                    "step": 1,
                    "type": "DEVICE_ADD_INIT",
                    "from": "primary_device",
                    "to": "new_device",
                    "message": device_add_init,
                    "expected_response": "DEVICE_ADD_RESPONSE"
                },
                {
                    "step": 2,
                    "type": "DEVICE_ADD_RESPONSE",
                    "from": "new_device",
                    "to": "primary_device",
                    "message": device_add_response,
                    "expected_response": "DEVICE_ADD_COMPLETE"
                },
                {
                    "step": 3,
                    "type": "DEVICE_ADD_COMPLETE",
                    "from": "primary_device",
                    "to": "new_device",
                    "message": device_add_complete,
                    "expected_response": "SYNC_ACK"
                }
            ]
        }
    
    def generate_device_removal_scenario(self) -> Dict[str, Any]:
        """Generate test vectors for removing a device from session"""
        print("Generating device removal scenario...")
        
        # Setup two devices
        primary_device_id = self.generate_device_id()
        secondary_device_id = self.generate_device_id()
        session_id = self.generate_session_id()
        
        primary_device = self.create_device_record(primary_device_id, "primary_device")
        secondary_device = self.create_device_record(secondary_device_id, "secondary_device")
        
        # Step 1: Primary device initiates removal
        device_remove_init = {
            "type": "DEVICE_REMOVE_INIT",
            "version": 1,
            "session_id": session_id,
            "primary_device_id": primary_device_id,
            "target_device_id": secondary_device_id,
            "removal_reason": "user_request",
            "timestamp": int(time.time() * 1000),
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 2: Target device acknowledges removal
        device_remove_ack = {
            "type": "DEVICE_REMOVE_ACK",
            "version": 1,
            "session_id": session_id,
            "device_id": secondary_device_id,
            "primary_device_id": primary_device_id,
            "acknowledgment": True,
            "timestamp": int(time.time() * 1000) + 1000,
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 3: Primary device confirms removal
        device_remove_complete = {
            "type": "DEVICE_REMOVE_COMPLETE",
            "version": 1,
            "session_id": session_id,
            "removed_device_id": secondary_device_id,
            "primary_device_id": primary_device_id,
            "remaining_devices": [primary_device_id],
            "timestamp": int(time.time() * 1000) + 2000,
            "handshake_hash": self.generate_handshake_hash({
                "session_id": session_id,
                "devices": [primary_device_id],
                "removed": secondary_device_id
            })
        }
        
        return {
            "description": "Multi-device removal scenario - removing device from existing session",
            "scenario_type": "device_removal",
            "devices": {
                "primary_device": primary_device,
                "secondary_device": secondary_device
            },
            "session_id": session_id,
            "steps": [
                {
                    "step": 1,
                    "type": "DEVICE_REMOVE_INIT",
                    "from": "primary_device",
                    "to": "secondary_device",
                    "message": device_remove_init,
                    "expected_response": "DEVICE_REMOVE_ACK"
                },
                {
                    "step": 2,
                    "type": "DEVICE_REMOVE_ACK",
                    "from": "secondary_device",
                    "to": "primary_device",
                    "message": device_remove_ack,
                    "expected_response": "DEVICE_REMOVE_COMPLETE"
                },
                {
                    "step": 3,
                    "type": "DEVICE_REMOVE_COMPLETE",
                    "from": "primary_device",
                    "to": "all_devices",
                    "message": device_remove_complete,
                    "expected_response": "SYNC_UPDATE"
                }
            ]
        }
    
    def generate_sync_conflict_scenario(self) -> Dict[str, Any]:
        """Generate test vectors for synchronization conflict resolution"""
        print("Generating sync conflict scenario...")
        
        # Three devices with conflicting states
        device_a_id = self.generate_device_id()
        device_b_id = self.generate_device_id()
        device_c_id = self.generate_device_id()
        session_id = self.generate_session_id()
        
        device_a = self.create_device_record(device_a_id, "device_a")
        device_b = self.create_device_record(device_b_id, "device_b")
        device_c = self.create_device_record(device_c_id, "device_c")
        
        # Conflict: Device A and B try to update session simultaneously
        conflict_update_a = {
            "type": "SESSION_UPDATE",
            "version": 1,
            "session_id": session_id,
            "device_id": device_a_id,
            "update_type": "participant_list",
            "update_data": {
                "action": "add_participant",
                "participant_id": "new_user_123"
            },
            "timestamp": int(time.time() * 1000),
            "sequence_number": 42,
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        conflict_update_b = {
            "type": "SESSION_UPDATE",
            "version": 1,
            "session_id": session_id,
            "device_id": device_b_id,
            "update_type": "participant_list",
            "update_data": {
                "action": "remove_participant",
                "participant_id": "old_user_456"
            },
            "timestamp": int(time.time() * 1000) + 500,  # Slightly later
            "sequence_number": 42,  # Same sequence number - conflict!
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Conflict detection and resolution
        conflict_detected = {
            "type": "SYNC_CONFLICT",
            "version": 1,
            "session_id": session_id,
            "conflicting_devices": [device_a_id, device_b_id],
            "conflict_type": "sequence_number_collision",
            "conflicting_updates": [conflict_update_a, conflict_update_b],
            "timestamp": int(time.time() * 1000) + 1000,
            "resolution_strategy": "last_writer_wins"
        }
        
        # Resolution: Device C acts as arbitrator
        conflict_resolution = {
            "type": "SYNC_RESOLUTION",
            "version": 1,
            "session_id": session_id,
            "arbitrator_device_id": device_c_id,
            "resolution": {
                "accepted_update": conflict_update_b,  # Later timestamp wins
                "rejected_update": conflict_update_a,
                "new_sequence_number": 43,
                "resolution_reason": "timestamp_based_resolution"
            },
            "timestamp": int(time.time() * 1000) + 2000,
            "handshake_hash": self.generate_handshake_hash({
                "session_id": session_id,
                "resolution": "conflict_resolved",
                "sequence": 43
            })
        }
        
        return {
            "description": "Multi-device sync conflict scenario - conflicting simultaneous updates",
            "scenario_type": "sync_conflict",
            "devices": {
                "device_a": device_a,
                "device_b": device_b,
                "device_c": device_c
            },
            "session_id": session_id,
            "steps": [
                {
                    "step": 1,
                    "type": "SESSION_UPDATE",
                    "from": "device_a",
                    "to": "all_devices",
                    "message": conflict_update_a,
                    "expected_response": "SYNC_ACK"
                },
                {
                    "step": 2,
                    "type": "SESSION_UPDATE",
                    "from": "device_b",
                    "to": "all_devices",
                    "message": conflict_update_b,
                    "expected_response": "SYNC_CONFLICT"
                },
                {
                    "step": 3,
                    "type": "SYNC_CONFLICT",
                    "from": "arbitrator",
                    "to": "conflicting_devices",
                    "message": conflict_detected,
                    "expected_response": "SYNC_RESOLUTION"
                },
                {
                    "step": 4,
                    "type": "SYNC_RESOLUTION",
                    "from": "device_c",
                    "to": "all_devices",
                    "message": conflict_resolution,
                    "expected_response": "SYNC_COMPLETE"
                }
            ]
        }
    
    def generate_backup_restore_scenario(self) -> Dict[str, Any]:
        """Generate test vectors for device backup and restore"""
        print("Generating backup/restore scenario...")
        
        source_device_id = self.generate_device_id()
        target_device_id = self.generate_device_id()
        session_id = self.generate_session_id()
        
        source_device = self.create_device_record(source_device_id, "source_device")
        
        # Step 1: Create device backup
        device_backup = {
            "type": "DEVICE_BACKUP",
            "version": 1,
            "session_id": session_id,
            "device_id": source_device_id,
            "backup_data": {
                "device_record": source_device,
                "session_state": {
                    "participants": [source_device_id],
                    "message_count": 150,
                    "last_message_timestamp": int(time.time() * 1000)
                },
                "encryption_keys": {
                    "x25519_private": source_device["x25519_private_key"],
                    "kyber_private": source_device["kyber_private_key"]
                }
            },
            "backup_format": "encrypted_json",
            "timestamp": int(time.time() * 1000),
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 2: Transfer backup to new device
        backup_transfer = {
            "type": "BACKUP_TRANSFER",
            "version": 1,
            "session_id": session_id,
            "source_device_id": source_device_id,
            "target_device_id": target_device_id,
            "backup_data": device_backup["backup_data"],
            "transfer_method": "qr_code",
            "timestamp": int(time.time() * 1000) + 1000,
            "nonce": base64.b64encode(secrets.token_bytes(16)).decode('utf-8')
        }
        
        # Step 3: Restore on target device
        device_restore = {
            "type": "DEVICE_RESTORE",
            "version": 1,
            "session_id": session_id,
            "device_id": target_device_id,
            "restore_data": device_backup["backup_data"],
            "restore_verification": {
                "device_id_match": True,
                "session_integrity": "verified",
                "key_recovery": "successful"
            },
            "timestamp": int(time.time() * 1000) + 2000,
            "handshake_hash": self.generate_handshake_hash({
                "session_id": session_id,
                "restore_complete": True,
                "target_device": target_device_id
            })
        }
        
        return {
            "description": "Multi-device backup/restore scenario - transferring device state",
            "scenario_type": "backup_restore",
            "devices": {
                "source_device": source_device,
                "target_device": target_device_id
            },
            "session_id": session_id,
            "steps": [
                {
                    "step": 1,
                    "type": "DEVICE_BACKUP",
                    "from": "source_device",
                    "to": "local_storage",
                    "message": device_backup,
                    "expected_response": "BACKUP_COMPLETE"
                },
                {
                    "step": 2,
                    "type": "BACKUP_TRANSFER",
                    "from": "source_device",
                    "to": "target_device",
                    "message": backup_transfer,
                    "expected_response": "TRANSFER_ACK"
                },
                {
                    "step": 3,
                    "type": "DEVICE_RESTORE",
                    "from": "target_device",
                    "to": "session",
                    "message": device_restore,
                    "expected_response": "RESTORE_COMPLETE"
                }
            ]
        }
    
    def generate_all_test_vectors(self) -> Dict[str, Any]:
        """Generate all multi-device synchronization test vectors"""
        print("Generating multi-device synchronization test vectors...")
        
        self.test_vectors["device_addition"] = self.generate_device_addition_scenario()
        self.test_vectors["device_removal"] = self.generate_device_removal_scenario()
        self.test_vectors["sync_conflict"] = self.generate_sync_conflict_scenario()
        self.test_vectors["backup_restore"] = self.generate_backup_restore_scenario()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper Multi-Device Sync Test Vector Generator (Python)",
            "description": "Multi-device synchronization test vectors for FoxWhisper E2EE v0.9",
            "test_categories": [
                "device_addition",
                "device_removal", 
                "sync_conflict",
                "backup_restore"
            ],
            "validation_features": [
                "multi_device_coordination",
                "session_state_synchronization",
                "conflict_detection_and_resolution",
                "backup_and_restore_integrity",
                "device_lifecycle_management"
            ],
            "total_scenarios": 4,
            "total_steps": 14
        }
        
        return self.test_vectors
    
    def save_test_vectors(self, filename: str) -> None:
        """Save test vectors to JSON file"""
        test_vectors = self.generate_all_test_vectors()
        
        with open(filename, 'w') as f:
            json.dump(test_vectors, f, indent=2)
        
        print(f"✅ Multi-device sync test vectors saved to {filename}")
        print(f"📊 Generated {len(test_vectors) - 1} test scenarios")  # -1 for metadata
        
        # Print summary
        for scenario_name, scenario_data in test_vectors.items():
            if scenario_name != "_metadata":
                steps_count = len(scenario_data.get("steps", []))
                print(f"   {scenario_name}: {steps_count} steps")

def main():
    print("FoxWhisper Multi-Device Sync Test Vector Generator")
    print("=" * 50)
    
    generator = MultiDeviceSyncTestVectorGenerator()
    
    # Generate test vectors
    output_file = "test-vectors/handshake/multi_device_sync_test_vectors.json"
    generator.save_test_vectors(output_file)
    
    print("\n🎉 Multi-device sync test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()