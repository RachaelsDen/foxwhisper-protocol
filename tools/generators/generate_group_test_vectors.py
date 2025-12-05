#!/usr/bin/env python3
"""
FoxWhisper Group Messaging Test Vector Generator
Generates group creation, join, leave, and messaging test vectors for FoxWhisper v0.9
"""

import json
import base64
import os
from typing import Dict, List, Any

class GroupMessagingTestVectorGenerator:
    """Generates Group Messaging test vectors"""
    
    def __init__(self):
        self.test_vectors = {}
        
    def generate_group_creation(self) -> Dict[str, Any]:
        """Generate group creation test vector"""
        
        creator_id = base64.b64encode(os.urandom(32)).decode()
        group_id = base64.b64encode(os.urandom(16)).decode()
        group_name = "Test Group"
        
        group_creation = {
            "description": "Group creation with initial member",
            "scenario": "group_creation",
            "creator": creator_id,
            "group_info": {
                "group_id": group_id,
                "group_name": group_name,
                "created_at": 1701763200000,
                "group_type": "standard",
                "max_members": 100
            },
            "steps": [
                {
                    "step": 1,
                    "type": "GROUP_CREATE",
                    "from": "creator",
                    "to": "system",
                    "message": {
                        "type": "GROUP_CREATE",
                        "version": 1,
                        "creator_id": creator_id,
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_type": "standard",
                        "max_members": 100,
                        "timestamp": 1701763200000
                    },
                    "expected_result": "group_created"
                }
            ],
            "validation_criteria": {
                "valid_group_structure": True,
                "proper_creator_authentication": True,
                "unique_group_id": True,
                "valid_group_parameters": True
            }
        }
        
        return group_creation
    
    def generate_group_join(self) -> Dict[str, Any]:
        """Generate group member join test vector"""
        
        group_id = base64.b64encode(os.urandom(16)).decode()
        existing_member_id = base64.b64encode(os.urandom(32)).decode()
        new_member_id = base64.b64encode(os.urandom(32)).decode()
        join_request_id = base64.b64encode(os.urandom(16)).decode()
        
        group_join = {
            "description": "New member joining existing group",
            "scenario": "group_join",
            "group_context": {
                "group_id": group_id,
                "existing_members": [existing_member_id],
                "group_admin": existing_member_id
            },
            "steps": [
                {
                    "step": 1,
                    "type": "GROUP_JOIN_REQUEST",
                    "from": "new_member",
                    "to": "group_admin",
                    "message": {
                        "type": "GROUP_JOIN_REQUEST",
                        "version": 1,
                        "group_id": group_id,
                        "member_id": new_member_id,
                        "join_request_id": join_request_id,
                        "timestamp": 1701763201000
                    },
                    "expected_result": "join_approved"
                },
                {
                    "step": 2,
                    "type": "GROUP_JOIN_APPROVAL",
                    "from": "group_admin",
                    "to": "new_member",
                    "message": {
                        "type": "GROUP_JOIN_APPROVAL",
                        "version": 1,
                        "group_id": group_id,
                        "member_id": new_member_id,
                        "join_request_id": join_request_id,
                        "approval": True,
                        "timestamp": 1701763202000
                    },
                    "expected_result": "member_added"
                }
            ],
            "validation_criteria": {
                "proper_join_flow": True,
                "admin_authorization": True,
                "unique_member_ids": True,
                "valid_group_context": True
            }
        }
        
        return group_join
    
    def generate_group_leave(self) -> Dict[str, Any]:
        """Generate group member leave test vector"""
        
        group_id = base64.b64encode(os.urandom(16)).decode()
        leaving_member_id = base64.b64encode(os.urandom(32)).decode()
        admin_member_id = base64.b64encode(os.urandom(32)).decode()
        
        group_leave = {
            "description": "Member leaving group gracefully",
            "scenario": "group_leave",
            "group_context": {
                "group_id": group_id,
                "members": [leaving_member_id, admin_member_id],
                "group_admin": admin_member_id
            },
            "steps": [
                {
                    "step": 1,
                    "type": "GROUP_LEAVE_REQUEST",
                    "from": "leaving_member",
                    "to": "group_system",
                    "message": {
                        "type": "GROUP_LEAVE_REQUEST",
                        "version": 1,
                        "group_id": group_id,
                        "member_id": leaving_member_id,
                        "leave_reason": "voluntary",
                        "timestamp": 1701763201000
                    },
                    "expected_result": "leave_processed"
                },
                {
                    "step": 2,
                    "type": "GROUP_MEMBER_REMOVE",
                    "from": "group_system",
                    "to": "all_members",
                    "message": {
                        "type": "GROUP_MEMBER_REMOVE",
                        "version": 1,
                        "group_id": group_id,
                        "member_id": leaving_member_id,
                        "removed_by": "system",
                        "timestamp": 1701763202000
                    },
                    "expected_result": "member_removed"
                }
            ],
            "validation_criteria": {
                "proper_leave_flow": True,
                "member_authentication": True,
                "graceful_removal": True,
                "group_integrity_maintained": True
            }
        }
        
        return group_leave
    
    def generate_group_messaging(self) -> Dict[str, Any]:
        """Generate group messaging test vector"""
        
        group_id = base64.b64encode(os.urandom(16)).decode()
        sender_id = base64.b64encode(os.urandom(32)).decode()
        message_id = base64.b64encode(os.urandom(16)).decode()
        message_content = "Hello group members!"
        
        group_messaging = {
            "description": "Encrypted group message to all members",
            "scenario": "group_messaging",
            "group_context": {
                "group_id": group_id,
                "member_count": 5,
                "message_encryption": "group_key"
            },
            "steps": [
                {
                    "step": 1,
                    "type": "GROUP_MESSAGE_ENCRYPT",
                    "from": "sender",
                    "to": "group",
                    "message": {
                        "type": "GROUP_MESSAGE_ENCRYPT",
                        "version": 1,
                        "group_id": group_id,
                        "sender_id": sender_id,
                        "message_id": message_id,
                        "message_content": base64.b64encode(message_content.encode()).decode(),
                        "encryption_type": "group_key",
                        "timestamp": 1701763200000
                    },
                    "expected_result": "message_encrypted"
                },
                {
                    "step": 2,
                    "type": "GROUP_MESSAGE_DISTRIBUTE",
                    "from": "sender",
                    "to": "group_members",
                    "message": {
                        "type": "GROUP_MESSAGE_DISTRIBUTE",
                        "version": 1,
                        "group_id": group_id,
                        "sender_id": sender_id,
                        "message_id": message_id,
                        "encrypted_message": base64.b64encode(os.urandom(256)).decode(),
                        "timestamp": 1701763201000
                    },
                    "expected_result": "message_delivered"
                }
            ],
            "validation_criteria": {
                "proper_encryption": True,
                "message_integrity": True,
                "group_key_usage": True,
                "sender_authentication": True
            }
        }
        
        return group_messaging
    
    def save_test_vectors(self, filename: str):
        """Save all group messaging test vectors to file"""
        
        self.test_vectors["group_creation"] = self.generate_group_creation()
        self.test_vectors["group_join"] = self.generate_group_join()
        self.test_vectors["group_leave"] = self.generate_group_leave()
        self.test_vectors["group_messaging"] = self.generate_group_messaging()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper Group Messaging Test Vector Generator",
            "description": "Group messaging test vectors for FoxWhisper E2EE",
            "test_categories": [
                "group_creation",
                "group_join", 
                "group_leave",
                "group_messaging"
            ],
            "validation_features": [
                "group_management",
                "member_authentication",
                "message_encryption",
                "access_control",
                "group_integrity"
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(self.test_vectors, f, indent=2)
        
        print(f"✅ Group messaging test vectors saved to {filename}")
        print(f"📊 Generated {len(self.test_vectors)-1} group test scenarios")
    
    def validate_test_vectors(self, filename: str):
        """Validate generated group messaging test vectors"""
        
        with open(filename, 'r') as f:
            vectors = json.load(f)
        
        validation_results = {
            "group_creation": self._validate_group_creation(vectors.get("group_creation", {})),
            "group_join": self._validate_group_join(vectors.get("group_join", {})),
            "group_leave": self._validate_group_leave(vectors.get("group_leave", {})),
            "group_messaging": self._validate_group_messaging(vectors.get("group_messaging", {}))
        }
        
        return validation_results
    
    def _validate_group_creation(self, creation: Dict[str, Any]) -> Dict[str, Any]:
        """Validate group creation test vector"""
        
        if not creation:
            return {"valid": False, "errors": ["Missing group creation test vector"]}
        
        errors = []
        steps = creation.get("steps", [])
        
        # Validate group creation steps
        for step in steps:
            message = step.get("message", {})
            if not message.get("group_id"):
                errors.append("Missing group_id in group creation")
            if not message.get("creator_id"):
                errors.append("Missing creator_id in group creation")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }
    
    def _validate_group_join(self, join: Dict[str, Any]) -> Dict[str, Any]:
        """Validate group join test vector"""
        
        if not join:
            return {"valid": False, "errors": ["Missing group join test vector"]}
        
        errors = []
        steps = join.get("steps", [])
        
        # Validate group join steps
        for step in steps:
            message = step.get("message", {})
            if not message.get("group_id"):
                errors.append("Missing group_id in group join")
            if not message.get("member_id"):
                errors.append("Missing member_id in group join")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }
    
    def _validate_group_leave(self, leave: Dict[str, Any]) -> Dict[str, Any]:
        """Validate group leave test vector"""
        
        if not leave:
            return {"valid": False, "errors": ["Missing group leave test vector"]}
        
        errors = []
        steps = leave.get("steps", [])
        
        # Validate group leave steps
        for step in steps:
            message = step.get("message", {})
            if not message.get("group_id"):
                errors.append("Missing group_id in group leave")
            if not message.get("member_id"):
                errors.append("Missing member_id in group leave")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }
    
    def _validate_group_messaging(self, messaging: Dict[str, Any]) -> Dict[str, Any]:
        """Validate group messaging test vector"""
        
        if not messaging:
            return {"valid": False, "errors": ["Missing group messaging test vector"]}
        
        errors = []
        steps = messaging.get("steps", [])
        
        # Validate group messaging steps
        for step in steps:
            message = step.get("message", {})
            if not message.get("group_id"):
                errors.append("Missing group_id in group messaging")
            if step.get("type") == "GROUP_MESSAGE_ENCRYPT" and not message.get("sender_id"):
                errors.append("Missing sender_id in group message encryption")
            if step.get("type") == "GROUP_MESSAGE_DISTRIBUTE" and not message.get("sender_id"):
                errors.append("Missing sender_id in group message distribution")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }

def main():
    print("FoxWhisper Group Messaging Test Vector Generator")
    print("=" * 55)
    
    generator = GroupMessagingTestVectorGenerator()
    
    # Generate test vectors
    output_file = "../test-vectors/handshake/group_messaging_test_vectors.json"
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
    
    print(f"\n🎉 Group messaging test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()