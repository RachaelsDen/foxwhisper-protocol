#!/usr/bin/env python3
"""
FoxWhisper Epoch Transition Test Vector Generator
Generates epoch transition and fork detection test vectors for FoxWhisper v0.9
"""

import json
import base64
import os
from typing import Dict, List, Any

class EpochTransitionTestVectorGenerator:
    """Generates Epoch Transition test vectors"""
    
    def __init__(self):
        self.test_vectors = {}
        
    def generate_epoch_transition(self) -> Dict[str, Any]:
        """Generate normal epoch transition test vector"""
        
        session_id = base64.b64encode(os.urandom(32)).decode()
        old_epoch_id = base64.b64encode(os.urandom(16)).decode()
        new_epoch_id = base64.b64encode(os.urandom(16)).decode()
        epoch_hash = base64.b64encode(os.urandom(32)).decode()
        
        epoch_transition = {
            "description": "Normal epoch transition with proper chain validation",
            "scenario": "epoch_transition",
            "session_context": {
                "session_id": session_id,
                "current_epoch": old_epoch_id,
                "transition_reason": "message_limit_reached"
            },
            "steps": [
                {
                    "step": 1,
                    "type": "EPOCH_CREATE",
                    "operation": "create_new_epoch",
                    "input": {
                        "old_epoch_id": old_epoch_id,
                        "new_epoch_id": new_epoch_id,
                        "epoch_hash": epoch_hash,
                        "transition_timestamp": 1701763200000
                    },
                    "output": {
                        "new_epoch_created": True,
                        "epoch_chain_extended": True,
                        "previous_epoch_hashed": True
                    },
                    "validation": {
                        "proper_epoch_creation": True,
                        "chain_continuity": True,
                        "hash_correctness": True
                    }
                }
            ],
            "validation_criteria": {
                "epoch_uniqueness": True,
                "chain_integrity": True,
                "proper_hashing": True,
                "transition_authorization": True
            }
        }
        
        return epoch_transition
    
    def generate_epoch_fork_detection(self) -> Dict[str, Any]:
        """Generate epoch fork detection test vector"""
        
        session_id = base64.b64encode(os.urandom(32)).decode()
        legitimate_epoch_id = base64.b64encode(os.urandom(16)).decode()
        fork_epoch_id = base64.b64encode(os.urandom(16)).decode()
        legitimate_hash = base64.b64encode(os.urandom(32)).decode()
        fork_hash = base64.b64encode(os.urandom(32)).decode()
        
        epoch_fork = {
            "description": "Epoch fork detection and resolution",
            "scenario": "epoch_fork_detection",
            "session_context": {
                "session_id": session_id,
                "competing_epochs": [
                    {
                        "epoch_id": legitimate_epoch_id,
                        "epoch_hash": legitimate_hash,
                        "creator": "legitimate_node",
                        "timestamp": 1701763200000
                    },
                    {
                        "epoch_id": fork_epoch_id,
                        "epoch_hash": fork_hash,
                        "creator": "attacker_node",
                        "timestamp": 1701763200500
                    }
                ]
            },
            "steps": [
                {
                    "step": 1,
                    "type": "EPOCH_DETECT_FORK",
                    "operation": "detect_competing_epochs",
                    "input": {
                        "current_epoch": legitimate_epoch_id,
                        "competing_epochs": [
                            {
                                "epoch_id": fork_epoch_id,
                                "epoch_hash": fork_hash,
                                "timestamp": 1701763200500
                            }
                        ]
                    },
                    "output": {
                        "fork_detected": True,
                        "conflict_epochs": [legitimate_epoch_id, fork_epoch_id],
                        "resolution_required": True
                    },
                    "validation": {
                        "fork_detection": True,
                        "conflict_identification": True,
                        "proper_resolution": True
                    }
                },
                {
                    "step": 2,
                    "type": "EPOCH_RESOLVE_FORK",
                    "operation": "resolve_epoch_conflict",
                    "input": {
                        "resolution_strategy": "longest_chain",
                        "selected_epoch": legitimate_epoch_id,
                        "rejected_epoch": fork_epoch_id,
                        "resolution_timestamp": 1701763201000
                    },
                    "output": {
                        "conflict_resolved": True,
                        "consensus_achieved": True,
                        "chain_reorganized": True
                    },
                    "validation": {
                        "proper_resolution": True,
                        "consensus_validation": True,
                        "chain_integrity_maintained": True
                    }
                }
            ],
            "validation_criteria": {
                "fork_detection_accuracy": True,
                "conflict_resolution": True,
                "consensus_mechanism": True,
                "chain_security": True
            }
        }
        
        return epoch_fork
    
    def generate_epoch_recovery(self) -> Dict[str, Any]:
        """Generate epoch recovery after network partition test vector"""
        
        session_id = base64.b64encode(os.urandom(32)).decode()
        partition_epoch_id = base64.b64encode(os.urandom(16)).decode()
        recovery_epoch_id = base64.b64encode(os.urandom(16)).decode()
        partition_proof = base64.b64encode(os.urandom(64)).decode()
        
        epoch_recovery = {
            "description": "Epoch recovery after network partition",
            "scenario": "epoch_recovery",
            "session_context": {
                "session_id": session_id,
                "partition_detected": True,
                "partition_duration": 300,  # 5 minutes
                "lost_epochs": [partition_epoch_id],
                "sync_peers": ["peer1", "peer2", "peer3"]
            },
            "steps": [
                {
                    "step": 1,
                    "type": "EPOCH_PARTITION_DETECT",
                    "operation": "detect_network_partition",
                    "input": {
                        "last_epoch_before_partition": partition_epoch_id,
                        "partition_proof": partition_proof,
                        "partition_timestamp": 1701763200000
                    },
                    "output": {
                        "partition_confirmed": True,
                        "recovery_mode": "active",
                        "sync_peers": ["peer1", "peer2", "peer3"]
                    },
                    "validation": {
                        "partition_detection": True,
                        "recovery_prepared": True,
                        "peer_connectivity": True
                    }
                },
                {
                    "step": 2,
                    "type": "EPOCH_RECOVERY_SYNC",
                    "operation": "synchronize_after_partition",
                    "input": {
                        "recovery_epoch_id": recovery_epoch_id,
                        "sync_peers": ["peer1", "peer2", "peer3"],
                        "recovery_timestamp": 1701763203000
                    },
                    "output": {
                        "sync_completed": True,
                        "convergence_achieved": True,
                        "chain_recovered": True
                    },
                    "validation": {
                        "proper_recovery": True,
                        "chain_convergence": True,
                        "data_integrity": True
                    }
                }
            ],
            "validation_criteria": {
                "partition_handling": True,
                "recovery_mechanism": True,
                "data_consistency": True,
                "network_resilience": True
            }
        }
        
        return epoch_recovery
    
    def save_test_vectors(self, filename: str):
        """Save all epoch transition test vectors to file"""
        
        self.test_vectors["epoch_transition"] = self.generate_epoch_transition()
        self.test_vectors["epoch_fork_detection"] = self.generate_epoch_fork_detection()
        self.test_vectors["epoch_recovery"] = self.generate_epoch_recovery()
        
        # Add metadata
        self.test_vectors["_metadata"] = {
            "version": "0.9",
            "generated_by": "FoxWhisper Epoch Transition Test Vector Generator",
            "description": "Epoch transition and fork detection test vectors for FoxWhisper E2EE",
            "test_categories": [
                "epoch_transition",
                "epoch_fork_detection",
                "epoch_recovery"
            ],
            "validation_features": [
                "epoch_chain_management",
                "fork_detection_resolution",
                "network_partition_recovery",
                "consensus_mechanisms"
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(self.test_vectors, f, indent=2)
        
        print(f"✅ Epoch transition test vectors saved to {filename}")
        print(f"📊 Generated {len(self.test_vectors)-1} epoch transition test scenarios")
    
    def validate_test_vectors(self, filename: str):
        """Validate generated epoch transition test vectors"""
        
        with open(filename, 'r') as f:
            vectors = json.load(f)
        
        validation_results = {
            "epoch_transition": self._validate_epoch_transition(vectors.get("epoch_transition", {})),
            "epoch_fork_detection": self._validate_epoch_fork_detection(vectors.get("epoch_fork_detection", {})),
            "epoch_recovery": self._validate_epoch_recovery(vectors.get("epoch_recovery", {}))
        }
        
        return validation_results
    
    def _validate_epoch_transition(self, transition: Dict[str, Any]) -> Dict[str, Any]:
        """Validate epoch transition test vector"""
        
        if not transition:
            return {"valid": False, "errors": ["Missing epoch transition test vector"]}
        
        errors = []
        steps = transition.get("steps", [])
        
        # Validate epoch transition steps
        for step in steps:
            if not step.get("type"):
                errors.append("Missing step type in epoch transition")
            if not step.get("operation"):
                errors.append("Missing operation in epoch transition")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "steps_validated": len(steps)
        }
    
    def _validate_epoch_fork_detection(self, fork: Dict[str, Any]) -> Dict[str, Any]:
        """Validate epoch fork detection test vector"""
        
        if not fork:
            return {"valid": False, "errors": ["Missing epoch fork detection test vector"]}
        
        errors = []
        session_context = fork.get("session_context", {})
        
        # Check competing epochs
        competing_epochs = session_context.get("competing_epochs", [])
        if len(competing_epochs) < 2:
            errors.append("Fork detection requires at least 2 competing epochs")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "competing_epochs": len(competing_epochs)
        }
    
    def _validate_epoch_recovery(self, recovery: Dict[str, Any]) -> Dict[str, Any]:
        """Validate epoch recovery test vector"""
        
        if not recovery:
            return {"valid": False, "errors": ["Missing epoch recovery test vector"]}
        
        errors = []
        session_context = recovery.get("session_context", {})
        
        # Check recovery context
        if not session_context.get("partition_detected"):
            errors.append("Recovery test requires partition detection")
        
        sync_peers = session_context.get("sync_peers", [])
        if len(sync_peers) < 1:
            errors.append("Recovery test requires sync peers")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "sync_peers": len(sync_peers)
        }

def main():
    print("FoxWhisper Epoch Transition Test Vector Generator")
    print("=" * 55)
    
    generator = EpochTransitionTestVectorGenerator()
    
    # Generate test vectors
    output_file = "../test-vectors/handshake/epoch_transition_test_vectors.json"
    generator.save_test_vectors(output_file)
    
    # Validate generated vectors
    print("\nValidating generated test vectors...")
    validation_results = generator.validate_test_vectors(output_file)
    
    for category, result in validation_results.items():
        if result["valid"]:
            print(f"✅ {category}: VALID ({result.get('steps_validated', result.get('competing_epochs', result.get('sync_peers', 0)))} steps/peers)")
        else:
            print(f"❌ {category}: INVALID")
            for error in result["errors"]:
                print(f"   Error: {error}")
    
    print(f"\n🎉 Epoch transition test vector generation completed!")
    print(f"📁 Saved to: {output_file}")

if __name__ == "__main__":
    main()