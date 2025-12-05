#!/usr/bin/env python3
"""
FoxWhisper Device Record (DR) Test Vector Generator
Generates DR backup, restore, and reset test vectors for FoxWhisper v0.9
"""

import json
import base64
import os
from typing import Dict, List, Any

class DeviceRecordTestVectorGenerator:
    """Generates Device Record test vectors"""
    
    def __init__(self):
        self.test_vectors = {}
        
    def generate_dr_backup(self) -> Dict[str, Any]:
        """Generate Device Record backup test vector"""
        
        user_id = base64.b64encode(os.urandom(32)).decode()
        device_id = base64.b64encode(os.urandom(32)).decode()
        device_private_key = base64.b64encode(os.urandom(32)).decode()
        
        # Device record structure
        device_record = {
            "type": "DEVICE_RECORD_BACKUP",
            "version": 1,
            "user_id": user_id,
            "device_id": device_id,
            "device_private_key": device_private_key,
            "device_public_key": base64.b64encode(os.urandom(32)).decode(),
            "device_info": {
                "device_type": "mobile",
                "platform": "iOS",
                "version": "1.0.0",
                "created_at": 1701763200000
            },
            "timestamp": 1701763200000
        }
        
        return {
            "description": "Device Record backup for secure storage",
            "scenario": "dr_backup",
            "device_record": device_record,
            "validation_criteria": {
                "valid_device_structure": True,
                "proper_key_encryption": True,
                "required_fields_present": True,
                "device_info_complete": True
            }
        }
    
    def generate_dr_restore(self) -> Dict[str, Any]:
        """Generate Device Record restore test vector"""
        
        user_id = base64.b64encode(os.urandom(32)).decode()
        device_id = base64.b64encode(os.urandom(32)).decode()
        backup_data = base64.b64encode(os.urandom(256)).decode()
        
        dr_restore = {
            "description": "Device Record restore from backup",
            "scenario": "dr_restore",
            "backup_data": backup_data,
            "restore_request": {
                "type": "DEVICE_RECORD_RESTORE",
                "version": 1,
                "user_id": user_id,
                "device_id": device_id,
                "restore_timestamp": 1701763201000,
                "verification_code": base64.b64encode(os.urandom(16)).decode()
            },
            "expected_result": {
                "device_active": True,
                "keys_restored": True,
                "session_sync": True
            },
            "validation_criteria": {
                "valid_restore_request": True,
                "proper_verification": True,
                "backup_integrity": True,
                "device_authentication": True
            }
        }
        
        return dr_restore
    
    def generate_dr_reset(self) -> Dict[str, Any]:
        """Generate Device Record reset test vector"""
        
        user_id = base64.b64encode(os.urandom(32)).decode()
        device_id = base64.b64encode(os.urandom(32)).decode()
        reset_reason = "device_lost"
        
        dr_reset = {
            "description": "Device Record reset for lost device",
            "scenario": "dr_reset",
            "reset_request": {
                "type": "DEVICE_RECORD_RESET",
                "version": 1,
                "user_id": user_id,
                "device_id": device_id,
                "reset_reason": reset_reason,
                "reset_timestamp": 1701763202000,
                "verification_code": base64.b64encode(os.urandom(16)).decode()
            },
            "expected_result": {
                "device_deactivated": True,
                "sessions_invalidated": True,
                "new_device_allowed": True
            },
            "validation_criteria": {
                "valid_reset_request": True,
                "proper_authorization": True,
                "correct_reason_code": True,
                "security_measures_applied": True
            }
        }
        
        return dr_reset
    
    def generate_multi_device_sync(self) -> Dict[str, Any]:
        """Generate multi-device synchronization test vector"""
        
        user_id = base64.b64encode(os.urandom(32)).decode()
        device_ids = [
            base64.b64encode(os.urandom(32)).decode() for _ in range(3)
        ]
        
        multi_device_sync = {
            "description": "Multi-device synchronization test",
            "scenario": "multi_device_sync",
            "devices": device_ids,
            "sync_operations": [
                {
                    "operation": "MESSAGE_SYNC",
                    "from_device": device_ids[0],
                    "to_devices": device_ids[1:],
                    "message_id": base64.b64encode(os.urandom(16)).decode(),
                    "timestamp": 1701763200000
                },
                {
                    "operation": "KEY_SYNC",
                    "from_device": device_ids[1],
                    "to_devices": [device_ids[0], device_ids[2]],
                    "key_material": base64.b64encode(os.urandom(64)).decode(),
                    "timestamp": 1701763201000
                }
            ],
            "validation_criteria": {
                "all_devices_reachable": True,
                "sync_consistency": True,
                "no_duplicate_messages": True,
                "proper_key_distribution": True
            }
        }
        
        return multi_device_sync
    
    def save_test_vectors(self, filename: str):
        """Save all DR test vectors to file"""
        
        self.test_vectors["dr_backup"] = self.generate_dr_backup()
        self.test_vectors["dr_restore"] = self.generate_dr_restore()
        self.test_vectors["dr_reset"] = self.generate_dr_reset()
        self.test_vectors["multi_device_sync"] = self.generate_multi_device_sync()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper Device Record Test Vector Generator",
            "description": "Device Record (DR) test vectors for FoxWhisper E2EE",
            "test_categories": [
                "dr_backup",
                "dr_restore", 
                "dr_reset",
                "multi_device_sync"
            ],
            "validation_features": [
                "device_record_structure",
                "backup_integrity",
                "restore_verification",
                "reset_authorization",
                "multi_device_synchronization"
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(self.test_vectors, f, indent=2)
        
        print(f"✅ DR test vectors saved to {filename}")
        print(f"📊 Generated {len(self.test_vectors)-1} DR test scenarios")
    
    def validate_test_vectors(self, filename: str):
        """Validate generated DR test vectors"""
        
        with open(filename, 'r') as f:
            vectors = json.load(f)
        
        validation_results = {
            "dr_backup": self._validate_dr_backup(vectors.get("dr_backup", {})),
            "dr_restore": self._validate_dr_restore(vectors.get("dr_restore", {})),
            "dr_reset": self._validate_dr_reset(vectors.get("dr_reset", {})),
            "multi_device_sync": self._validate_multi_device_sync(vectors.get("multi_device_sync", {}))
        }
        
        return validation_results
    
    def _validate_dr_backup(self, backup: Dict[str, Any]) -> Dict[str, Any]:
        """Validate DR backup test vector"""
        
        if not backup:
            return {"valid": False, "errors": ["Missing DR backup test vector"]}
        
        errors = []
        device_record = backup.get("device_record", {})
        
        # Check required fields
        required_fields = ["type", "version", "user_id", "device_id", "device_private_key"]
        for field in required_fields:
            if field not in device_record:
                errors.append(f"Missing required field: {field}")
        
        # Validate device info
        device_info = device_record.get("device_info", {})
        if not device_info.get("device_type"):
            errors.append("Missing device_type in device_info")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }
    
    def _validate_dr_restore(self, restore: Dict[str, Any]) -> Dict[str, Any]:
        """Validate DR restore test vector"""
        
        if not restore:
            return {"valid": False, "errors": ["Missing DR restore test vector"]}
        
        errors = []
        restore_request = restore.get("restore_request", {})
        
        # Check restore request structure
        required_fields = ["type", "user_id", "device_id", "verification_code"]
        for field in required_fields:
            if field not in restore_request:
                errors.append(f"Missing restore field: {field}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }
    
    def _validate_dr_reset(self, reset: Dict[str, Any]) -> Dict[str, Any]:
        """Validate DR reset test vector"""
        
        if not reset:
            return {"valid": False, "errors": ["Missing DR reset test vector"]}
        
        errors = []
        reset_request = reset.get("reset_request", {})
        
        # Check reset request structure
        required_fields = ["type", "user_id", "device_id", "reset_reason"]
        for field in required_fields:
            if field not in reset_request:
                errors.append(f"Missing reset field: {field}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "fields_checked": len(required_fields)
        }
    
    def _validate_multi_device_sync(self, sync: Dict[str, Any]) -> Dict[str, Any]:
        """Validate multi-device sync test vector"""
        
        if not sync:
            return {"valid": False, "errors": ["Missing multi-device sync test vector"]}
        
        errors = []
        devices = sync.get("devices", [])
        sync_operations = sync.get("sync_operations", [])
        
        # Validate devices list
        if len(devices) < 2:
            errors.append("Multi-device sync requires at least 2 devices")
        
        # Validate sync operations
        for i, op in enumerate(sync_operations):
            if not op.get("operation"):
                errors.append(f"Sync operation {i}: missing operation type")
            if not op.get("from_device"):
                errors.append(f"Sync operation {i}: missing from_device")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "devices_count": len(devices),
            "operations_checked": len(sync_operations)
        }

def main():
    print("FoxWhisper Device Record Test Vector Generator")
    print("=" * 50)
    
    generator = DeviceRecordTestVectorGenerator()
    
    # Generate test vectors
    output_file = "../test-vectors/handshake/dr_test_vectors.json"
    generator.save_test_vectors(output_file)
    
    # Validate generated vectors
    print("\nValidating generated test vectors...")
    validation_results = generator.validate_test_vectors(output_file)
    
    for category, result in validation_results.items():
        if result["valid"]:
            print(f"✅ {category}: VALID")
        else:
            print(f"❌ {category}: INVALID")
            for error in result["errors"]:
                print(f"   Error: {error}")
    
    print(f"\n🎉 DR test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()