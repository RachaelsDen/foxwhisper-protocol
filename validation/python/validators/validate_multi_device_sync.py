#!/usr/bin/env python3

import json
import base64
import hashlib
import sys
from pathlib import Path
from typing import Dict, List, Any

ROOT_DIR = Path(__file__).resolve().parents[3]

class MultiDeviceSyncValidator:
    """
    Validates multi-device synchronization test vectors for FoxWhisper v0.9
    """
    
    def __init__(self):
        self.validation_results = {}
        
    def validate_base64_field(self, field_name: str, value: str, expected_size: int) -> List[str]:
        """Validate a base64-encoded binary field"""
        errors = []
        
        if not isinstance(value, str):
            errors.append(f"Field {field_name} must be string")
            return errors
            
        try:
            # Try standard base64 first
            decoded_bytes = base64.b64decode(value)
        except Exception:
            try:
                # Try URL-safe base64 as fallback
                decoded_bytes = base64.urlsafe_b64decode(value)
            except Exception as e:
                errors.append(f"Field {field_name} must be valid base64: {e}")
                return errors
        
        if len(decoded_bytes) != expected_size:
            errors.append(f"Field {field_name} wrong size: {len(decoded_bytes)} != {expected_size}")
            
        return errors
    
    def validate_message_structure(self, message: Dict[str, Any], message_type: str) -> List[str]:
        """Validate message structure based on type"""
        errors = []
        
        # Common fields for all messages
        if "type" not in message:
            errors.append("Missing 'type' field")
        elif message["type"] != message_type:
            errors.append(f"Message type mismatch: expected {message_type}, got {message['type']}")
            
        if "version" not in message:
            errors.append("Missing 'version' field")
        elif not isinstance(message["version"], int):
            errors.append("Version field must be integer")
            
        if "timestamp" not in message:
            errors.append("Missing 'timestamp' field")
        elif not isinstance(message["timestamp"], int):
            errors.append("Timestamp field must be integer")
            
        if "nonce" in message:
            nonce_errors = self.validate_base64_field("nonce", message["nonce"], 16)
            errors.extend(nonce_errors)
            
        return errors
    
    def validate_device_addition(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """Validate device addition scenario"""
        print("Validating device addition scenario...")
        errors = []
        warnings = []
        
        steps = scenario.get("steps", [])
        if len(steps) != 3:
            errors.append(f"Expected 3 steps, got {len(steps)}")
        
        # Validate each step
        for i, step in enumerate(steps):
            step_type = step.get("type", "")
            message = step.get("message", {})
            
            step_errors = self.validate_message_structure(message, step_type)
            errors.extend([f"Step {i+1}: {err}" for err in step_errors])
            
            # Step-specific validation
            if step_type == "DEVICE_ADD_INIT":
                required_fields = ["session_id", "primary_device_id", "new_device_id", "new_device_public_key"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                
                if "new_device_public_key" in message:
                    key_errors = self.validate_base64_field("new_device_public_key", message["new_device_public_key"], 32)
                    errors.extend([f"Step {i+1}: {err}" for err in key_errors])
                    
            elif step_type == "DEVICE_ADD_RESPONSE":
                required_fields = ["session_id", "device_id", "primary_device_id", "acknowledgment"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "acknowledgment" in message and not isinstance(message["acknowledgment"], bool):
                    errors.append(f"Step {i+1}: Acknowledgment field must be boolean")
                    
            elif step_type == "DEVICE_ADD_COMPLETE":
                required_fields = ["session_id", "device_id", "primary_device_id", "device_status", "handshake_hash"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "handshake_hash" in message:
                    hash_errors = self.validate_base64_field("handshake_hash", message["handshake_hash"], 32)
                    errors.extend([f"Step {i+1}: {err}" for err in hash_errors])
        
        return {
            "scenario": "device_addition",
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def validate_device_removal(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """Validate device removal scenario"""
        print("Validating device removal scenario...")
        errors = []
        warnings = []
        
        steps = scenario.get("steps", [])
        if len(steps) != 3:
            errors.append(f"Expected 3 steps, got {len(steps)}")
        
        for i, step in enumerate(steps):
            step_type = step.get("type", "")
            message = step.get("message", {})
            
            step_errors = self.validate_message_structure(message, step_type)
            errors.extend([f"Step {i+1}: {err}" for err in step_errors])
            
            if step_type == "DEVICE_REMOVE_INIT":
                required_fields = ["session_id", "primary_device_id", "target_device_id", "removal_reason"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
            elif step_type == "DEVICE_REMOVE_ACK":
                required_fields = ["session_id", "device_id", "primary_device_id", "acknowledgment"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
            elif step_type == "DEVICE_REMOVE_COMPLETE":
                required_fields = ["session_id", "removed_device_id", "primary_device_id", "remaining_devices", "handshake_hash"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "remaining_devices" in message and not isinstance(message["remaining_devices"], list):
                    errors.append(f"Step {i+1}: Remaining devices field must be list")
        
        return {
            "scenario": "device_removal",
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def validate_sync_conflict(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """Validate sync conflict scenario"""
        print("Validating sync conflict scenario...")
        errors = []
        warnings = []
        
        steps = scenario.get("steps", [])
        if len(steps) != 4:
            errors.append(f"Expected 4 steps, got {len(steps)}")
        
        for i, step in enumerate(steps):
            step_type = step.get("type", "")
            message = step.get("message", {})
            
            step_errors = self.validate_message_structure(message, step_type)
            errors.extend([f"Step {i+1}: {err}" for err in step_errors])
            
            if step_type == "SESSION_UPDATE":
                required_fields = ["session_id", "device_id", "update_type", "update_data", "sequence_number"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "sequence_number" in message and not isinstance(message["sequence_number"], int):
                    errors.append(f"Step {i+1}: Sequence number must be integer")
                    
            elif step_type == "SYNC_CONFLICT":
                required_fields = ["session_id", "conflicting_devices", "conflict_type", "conflicting_updates", "resolution_strategy"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "conflicting_updates" in message and not isinstance(message["conflicting_updates"], list):
                    errors.append(f"Step {i+1}: Conflicting updates must be list")
                    
            elif step_type == "SYNC_RESOLUTION":
                required_fields = ["session_id", "arbitrator_device_id", "resolution", "handshake_hash"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "resolution" in message:
                    resolution = message["resolution"]
                    resolution_fields = ["accepted_update", "rejected_update", "new_sequence_number", "resolution_reason"]
                    for field in resolution_fields:
                        if field not in resolution:
                            errors.append(f"Step {i+1}: Missing resolution field {field}")
        
        return {
            "scenario": "sync_conflict",
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def validate_backup_restore(self, scenario: Dict[str, Any]) -> Dict[str, Any]:
        """Validate backup/restore scenario"""
        print("Validating backup/restore scenario...")
        errors = []
        warnings = []
        
        steps = scenario.get("steps", [])
        if len(steps) != 3:
            errors.append(f"Expected 3 steps, got {len(steps)}")
        
        for i, step in enumerate(steps):
            step_type = step.get("type", "")
            message = step.get("message", {})
            
            step_errors = self.validate_message_structure(message, step_type)
            errors.extend([f"Step {i+1}: {err}" for err in step_errors])
            
            if step_type == "DEVICE_BACKUP":
                required_fields = ["session_id", "device_id", "backup_data", "backup_format"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "backup_data" in message:
                    backup_data = message["backup_data"]
                    backup_fields = ["device_record", "session_state", "encryption_keys"]
                    for field in backup_fields:
                        if field not in backup_data:
                            errors.append(f"Step {i+1}: Missing backup data field {field}")
                            
            elif step_type == "BACKUP_TRANSFER":
                required_fields = ["session_id", "source_device_id", "target_device_id", "backup_data", "transfer_method"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
            elif step_type == "DEVICE_RESTORE":
                required_fields = ["session_id", "device_id", "restore_data", "restore_verification"]
                for field in required_fields:
                    if field not in message:
                        errors.append(f"Step {i+1}: Missing required field {field}")
                        
                if "restore_verification" in message:
                    verification = message["restore_verification"]
                    verification_fields = ["device_id_match", "session_integrity", "key_recovery"]
                    for field in verification_fields:
                        if field not in verification:
                            errors.append(f"Step {i+1}: Missing verification field {field}")
        
        return {
            "scenario": "backup_restore",
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def validate_all_scenarios(self, test_vectors: Dict[str, Any]) -> Dict[str, Any]:
        """Validate all multi-device sync scenarios"""
        print("FoxWhisper Multi-Device Sync Validation")
        print("=" * 50)
        
        results = {}
        
        # Validate each scenario
        scenarios = {
            "device_addition": self.validate_device_addition,
            "device_removal": self.validate_device_removal,
            "sync_conflict": self.validate_sync_conflict,
            "backup_restore": self.validate_backup_restore
        }
        
        for scenario_name, validator_func in scenarios.items():
            if scenario_name in test_vectors and scenario_name != "_metadata":
                scenario_data = test_vectors[scenario_name]
                result = validator_func(scenario_data)
                results[scenario_name] = result
                
                if result["valid"]:
                    print(f"✅ {scenario_name} - VALID")
                else:
                    print(f"❌ {scenario_name} - INVALID")
                    for error in result["errors"]:
                        print(f"   Error: {error}")
                
                for warning in result["warnings"]:
                    print(f"   Warning: {warning}")
        
        return results
    
    def print_summary(self, results: Dict[str, Any]):
        """Print validation summary"""
        print("\n" + "=" * 40)
        print("MULTI-DEVICE SYNC VALIDATION SUMMARY")
        print("=" * 40)
        
        valid_count = 0
        for scenario_name, result in results.items():
            if result["valid"]:
                valid_count += 1
            status = "✅ VALID" if result["valid"] else "❌ INVALID"
            print(f"{status} {scenario_name}")
        
        print(f"\nOverall: {valid_count}/{len(results)} scenarios valid")
        
        if valid_count == len(results):
            print("🎉 All multi-device sync scenarios passed validation!")
        else:
            print("⚠️  Some scenarios failed validation")
    
    def save_results(self, results: Dict[str, Any], filename: str):
        """Save validation results to JSON file"""
        output_dir = ROOT_DIR / "results"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / filename
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"\n📄 Results saved to {output_file}")

def main():
    if len(sys.argv) != 2:
        print("Usage: python3 validate_multi_device_sync.py <test_vectors_file>")
        sys.exit(1)
    
    test_vectors_file = sys.argv[1]
    
    try:
        with open(test_vectors_file, 'r') as f:
            test_vectors = json.load(f)
    except Exception as e:
        print(f"Error loading test vectors: {e}")
        sys.exit(1)
    
    validator = MultiDeviceSyncValidator()
    results = validator.validate_all_scenarios(test_vectors)
    validator.print_summary(results)
    validator.save_results(results, "multi_device_sync_validation_results.json")

if __name__ == "__main__":
    main()