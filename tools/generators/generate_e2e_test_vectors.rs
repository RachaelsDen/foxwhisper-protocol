use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs;

// FoxWhisper End-to-End Test Vector Generator (Rust)
// Generates complete protocol flow test vectors for FoxWhisper v0.9

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandshakeMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub version: i32,
    #[serde(rename = "client_id", skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(rename = "server_id", skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(rename = "session_id", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(rename = "x25519_public_key")]
    pub x25519_public_key: String,
    #[serde(rename = "kyber_public_key", skip_serializing_if = "Option::is_none")]
    pub kyber_public_key: Option<String>,
    #[serde(rename = "kyber_ciphertext", skip_serializing_if = "Option::is_none")]
    pub kyber_ciphertext: Option<String>,
    #[serde(rename = "handshake_hash", skip_serializing_if = "Option::is_none")]
    pub handshake_hash: Option<String>,
    pub timestamp: i64,
    #[serde(rename = "nonce", skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandshakeStep {
    pub step: i32,
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(rename = "from")]
    pub from: String,
    #[serde(rename = "to")]
    pub to: String,
    pub message: HandshakeMessage,
    #[serde(rename = "expected_response")]
    pub expected_response: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HandshakeFlow {
    pub description: String,
    pub participants: Vec<String>,
    pub steps: Vec<HandshakeStep>,
}

pub struct EndToEndTestVectorGenerator {
    test_vectors: HashMap<String, serde_json::Value>,
}

impl EndToEndTestVectorGenerator {
    pub fn new() -> Self {
        Self {
            test_vectors: HashMap::new(),
        }
    }

    pub fn generate_handshake_flow(&mut self) -> HandshakeFlow {
        // Generate cryptographic material
        let client_id = Some(generate_random_base64(32));
        let server_id = Some(generate_random_base64(32));
        let client_x25519_pub = generate_random_base64(32);
        let server_x25519_pub = generate_random_base64(32);
        let client_kyber_pub = Some(generate_random_base64(1568));
        let server_kyber_cipher = Some(generate_random_base64(1568));
        let client_nonce = Some(generate_random_base64(16));
        let server_nonce = Some(generate_random_base64(16));
        let session_id = Some(generate_random_base64(32));
        let handshake_hash = Some(generate_random_base64(32));

        HandshakeFlow {
            description: "Complete FoxWhisper handshake flow".to_string(),
            participants: vec!["client".to_string(), "server".to_string()],
            steps: vec![
                HandshakeStep {
                    step: 1,
                    step_type: "HANDSHAKE_INIT".to_string(),
                    from: "client".to_string(),
                    to: "server".to_string(),
                    message: HandshakeMessage {
                        message_type: "HANDSHAKE_INIT".to_string(),
                        version: 1,
                        client_id: client_id.clone(),
                        server_id: None,
                        session_id: None,
                        x25519_public_key: client_x25519_pub,
                        kyber_public_key: client_kyber_pub,
                        kyber_ciphertext: None,
                        handshake_hash: None,
                        timestamp: 1701763200000,
                        nonce: client_nonce,
                    },
                    expected_response: "HANDSHAKE_RESPONSE".to_string(),
                },
                HandshakeStep {
                    step: 2,
                    step_type: "HANDSHAKE_RESPONSE".to_string(),
                    from: "server".to_string(),
                    to: "client".to_string(),
                    message: HandshakeMessage {
                        message_type: "HANDSHAKE_RESPONSE".to_string(),
                        version: 1,
                        client_id: None,
                        server_id: server_id.clone(),
                        session_id: None,
                        x25519_public_key: server_x25519_pub,
                        kyber_public_key: None,
                        kyber_ciphertext: server_kyber_cipher,
                        handshake_hash: None,
                        timestamp: 1701763201000,
                        nonce: server_nonce,
                    },
                    expected_response: "HANDSHAKE_COMPLETE".to_string(),
                },
                HandshakeStep {
                    step: 3,
                    step_type: "HANDSHAKE_COMPLETE".to_string(),
                    from: "client".to_string(),
                    to: "server".to_string(),
                    message: HandshakeMessage {
                        message_type: "HANDSHAKE_COMPLETE".to_string(),
                        version: 1,
                        client_id: None,
                        server_id: None,
                        session_id: session_id,
                        x25519_public_key: String::new(), // Empty for this message type
                        kyber_public_key: None,
                        kyber_ciphertext: None,
                        handshake_hash: handshake_hash,
                        timestamp: 1701763202000,
                        nonce: None,
                    },
                    expected_response: "ENCRYPTED_MESSAGE".to_string(),
                },
            ],
        }
    }

    pub fn save_test_vectors(&mut self, filename: &str) -> Result<(), Box<dyn Error>> {
        let handshake_flow = self.generate_handshake_flow();
        self.test_vectors.insert(
            "handshake_flow".to_string(),
            serde_json::to_value(&handshake_flow)?,
        );

        // Add metadata
        let metadata = serde_json::json!({
            "version": "0.9",
            "generated_by": "FoxWhisper End-to-End Test Vector Generator (Rust)",
            "description": "Complete protocol flow test vectors for FoxWhisper E2EE",
            "test_categories": ["handshake_flow"],
            "validation_features": [
                "message_structure_validation",
                "field_size_validation",
                "base64_encoding_validation",
                "chronological_validation",
                "session_consistency_validation"
            ]
        });

        self.test_vectors.insert("_metadata".to_string(), metadata);

        // Save to file
        let json_data = serde_json::to_string_pretty(&self.test_vectors)?;
        fs::write(filename, json_data)?;

        println!("✅ End-to-end test vectors saved to {}", filename);
        println!(
            "📊 Generated {} test scenarios",
            self.test_vectors.len() - 1
        );

        Ok(())
    }
}

fn generate_random_base64(size: usize) -> String {
    use rand::thread_rng;
    use rand::RngCore;

    let mut bytes = vec![0u8; size];
    let mut rng = thread_rng();
    rng.fill_bytes(&mut bytes);
    general_purpose::STANDARD.encode(bytes)
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("FoxWhisper End-to-End Test Vector Generator (Rust)");
    println!("{}", "=".repeat(50));

    let mut generator = EndToEndTestVectorGenerator::new();

    // Generate test vectors
    let output_file = "../test-vectors/handshake/end_to_end_test_vectors_rust.json";
    generator.save_test_vectors(output_file)?;

    println!("\n🎉 End-to-end test vector generation completed!");
    println!("📁 Saved to: {}", output_file);

    Ok(())
}
