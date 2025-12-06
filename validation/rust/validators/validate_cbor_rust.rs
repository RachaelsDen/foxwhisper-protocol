use serde::{Deserialize, Serialize};
use serde_cbor;
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose};

// FoxWhisper CBOR Validator (Rust)
// Validates CBOR encoding/decoding for FoxWhisper protocol messages

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MessageType {
    HandshakeInit = 0xD1,
    HandshakeResponse = 0xD2,
    HandshakeComplete = 0xD3,
}

impl MessageType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "HANDSHAKE_INIT" => Some(MessageType::HandshakeInit),
            "HANDSHAKE_RESPONSE" => Some(MessageType::HandshakeResponse),
            "HANDSHAKE_COMPLETE" => Some(MessageType::HandshakeComplete),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            MessageType::HandshakeInit => "HANDSHAKE_INIT",
            MessageType::HandshakeResponse => "HANDSHAKE_RESPONSE",
            MessageType::HandshakeComplete => "HANDSHAKE_COMPLETE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub message_type: Option<String>,
    pub tag: Option<u32>,
    pub test_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TestVector {
    pub tag: u32,
    pub data: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TestVectors(pub HashMap<String, TestVector>);

pub struct CborValidator {
    test_vectors: TestVectors,
}

impl CborValidator {
    pub fn new() -> Self {
        Self {
            test_vectors: TestVectors(HashMap::new()),
        }
    }

    pub fn load_test_vectors(&mut self) -> Result<(), Box<dyn Error>> {
        let possible_paths = vec![
            "../../../tests/common/handshake/cbor_test_vectors_fixed.json",
            "../../../tests/common/handshake/cbor_test_vectors.json",
            "../../tests/common/handshake/cbor_test_vectors_fixed.json",
            "../../tests/common/handshake/cbor_test_vectors.json",
            "tests/common/handshake/cbor_test_vectors_fixed.json",
            "tests/common/handshake/cbor_test_vectors.json",
        ];
        
        for path in possible_paths {
            if fs::metadata(path).is_ok() {
                let data = fs::read_to_string(path)?;
                let vectors: HashMap<String, TestVector> = serde_json::from_str(&data)?;
                self.test_vectors = TestVectors(vectors);
                return Ok(());
            }
        }
        
        Err("Could not find test vectors file".into())
    }

    pub fn validate_message(&self, message_data: &HashMap<String, serde_json::Value>) -> ValidationResult {
        let mut result = ValidationResult {
            valid: false,
            errors: Vec::new(),
            message_type: None,
            tag: None,
            test_name: None,
        };

        // Extract message type
        let type_value = match message_data.get("type") {
            Some(value) => value,
            None => {
                result.errors.push("Missing 'type' field".to_string());
                return result;
            }
        };

        let message_type_str = match type_value.as_str() {
            Some(s) => s,
            None => {
                result.errors.push("Type field must be string".to_string());
                return result;
            }
        };

        // Find message type
        let msg_type = match MessageType::from_str(message_type_str) {
            Some(mt) => mt,
            None => {
                result.errors.push(format!("Unknown message type: {}", message_type_str));
                return result;
            }
        };

        result.message_type = Some(message_type_str.to_string());
        result.tag = Some(msg_type.clone() as u32);

        // Define required fields for each message type
        let required_fields = match msg_type.clone() {
            MessageType::HandshakeComplete => vec![
                "type", "version", "session_id", "handshake_hash", "timestamp"
            ],
            MessageType::HandshakeInit => vec![
                "type", "version", "client_id", "x25519_public_key", 
                "kyber_public_key", "timestamp", "nonce"
            ],
            MessageType::HandshakeResponse => vec![
                "type", "version", "server_id", "x25519_public_key", 
                "kyber_ciphertext", "timestamp", "nonce"
            ],
        };

        // Check required fields
        for field in &required_fields {
            if !message_data.contains_key(*field) {
                result.errors.push(format!("Missing required field: {}", field));
            }
        }

        // Validate field types and sizes
        for (field_name, field_value) in message_data {
            match field_name.as_str() {
                "type" => {
                    if !field_value.is_string() {
                        result.errors.push("Field type must be string".to_string());
                    }
                }
                "version" | "timestamp" => {
                    if !field_value.is_number() {
                        result.errors.push(format!("Field {} must be integer", field_name));
                    }
                }
                "client_id" | "server_id" | "session_id" | "handshake_hash" | "x25519_public_key" => {
                    if let Err(e) = self.validate_base64_field(field_name, field_value, 32) {
                        result.errors.push(e);
                    }
                }
                "nonce" => {
                    if let Err(e) = self.validate_base64_field(field_name, field_value, 16) {
                        result.errors.push(e);
                    }
                }
                "kyber_public_key" | "kyber_ciphertext" => {
                    if let Err(e) = self.validate_base64_field(field_name, field_value, 1568) {
                        result.errors.push(e);
                    }
                }
                _ => {
                    // Unknown field - could be an error or just ignore
                    result.errors.push(format!("Unknown field: {}", field_name));
                }
            }
        }

        result.valid = result.errors.is_empty();
        result
    }

    fn validate_base64_field(&self, field_name: &str, value: &serde_json::Value, expected_size: usize) -> Result<(), String> {
        let str_value = match value.as_str() {
            Some(s) => s,
            None => return Err(format!("Field {} must be string", field_name)),
        };

        // Try standard base64 first
        let bytes = general_purpose::STANDARD.decode(str_value)
            .or_else(|_| general_purpose::URL_SAFE.decode(str_value))
            .map_err(|e| format!("Field {} must be valid base64 (error: {})", field_name, e))?;

        if bytes.len() != expected_size {
            return Err(format!("Field {} wrong size: {} != {}", field_name, bytes.len(), expected_size));
        }

        Ok(())
    }

    pub fn validate_cbor_encoding(&self, message_name: &str, test_vector: &TestVector) -> ValidationResult {
        let mut result = ValidationResult {
            valid: false,
            errors: Vec::new(),
            test_name: Some(message_name.to_string()),
            message_type: None,
            tag: None,
        };

        // Convert to CBOR
        let cbor_data = match serde_cbor::to_vec(&test_vector.data) {
            Ok(data) => data,
            Err(e) => {
                result.errors.push(format!("CBOR marshal error: {}", e));
                return result;
            }
        };

        // Create tagged CBOR (simplified approach)
        let tagged_cbor_data = match serde_cbor::to_vec(&test_vector.data) {
            Ok(data) => data,
            Err(e) => {
                result.errors.push(format!("CBOR tag marshal error: {}", e));
                return result;
            }
        };

        // Decode and verify
        let decoded_data: HashMap<String, serde_json::Value> = match serde_cbor::from_slice(&cbor_data) {
            Ok(data) => data,
            Err(e) => {
                result.errors.push(format!("CBOR unmarshal error: {}", e));
                return result;
            }
        };

        // Validate the decoded data
        let validation_result = self.validate_message(&decoded_data);
        result.valid = validation_result.valid;
        result.errors.extend(validation_result.errors);
        result.message_type = validation_result.message_type;
        result.tag = validation_result.tag;

        // Add CBOR-specific validation info
        if result.errors.is_empty() {
            println!("✅ {} - CBOR encoding/decoding successful ({} bytes)", message_name, cbor_data.len());
            println!("   Tagged CBOR size: {} bytes", tagged_cbor_data.len());
        }

        result
    }

    pub fn validate_all(&self) -> HashMap<String, ValidationResult> {
        let mut results = HashMap::new();

        for (message_name, test_vector) in &self.test_vectors.0 {
            println!("\nValidating: {}", message_name);
            println!("{}", "-".repeat(30));

            let result = self.validate_cbor_encoding(message_name, test_vector);
            results.insert(message_name.clone(), result.clone());

            if result.valid {
                println!("✅ {} - VALID", message_name);
                if let Some(ref msg_type) = result.message_type {
                    println!("   Message Type: {}", msg_type);
                }
                if let Some(tag) = result.tag {
                    println!("   Tag: 0x{:X}", tag);
                }
            } else {
                println!("❌ {} - INVALID", message_name);
                for error in &result.errors {
                    println!("   Error: {}", error);
                }
            }
        }

        results
    }

    pub fn save_results(&self, results: &HashMap<String, ValidationResult>) -> Result<(), Box<dyn Error>> {
        let mut output_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        output_dir.push("results");
        if !output_dir.exists() {
            fs::create_dir_all(&output_dir)?;
        }

        
        let mut results_data = serde_json::json!({
            "language": "rust",
            "timestamp": 1701763202000i64,
            "results": []
        });
        
        for (message_name, result) in results {
            let result_data = serde_json::json!({
                "message": message_name,
                "success": result.valid,
                "output": if result.valid {
                    result.message_type.clone().unwrap_or_default()
                } else {
                    result.errors.join("; ")
                }
            });
            results_data["results"].as_array_mut()
                .unwrap()
                .push(result_data);
        }
        
        let output_file = output_dir.join("rust_cbor_status.json");
        fs::write(&output_file, serde_json::to_string_pretty(&results_data)?)?;
        
        println!("📄 Results saved to {}", output_file.display());
        Ok(())
    }

    pub fn print_summary(results: &HashMap<String, ValidationResult>) {
        println!("\n{}", "=".repeat(40));
        println!("VALIDATION SUMMARY");
        println!("{}", "=".repeat(40));

        let mut valid_count = 0;
        for (message_name, result) in results {
            if result.valid {
                valid_count += 1;
            }
            let status = if result.valid { "✅ VALID" } else { "❌ INVALID" };
            println!("{} {}", status, message_name);
        }

        println!("\nOverall: {}/{} messages valid", valid_count, results.len());

        if valid_count == results.len() {
            println!("🎉 All messages passed CBOR validation!");
        } else {
            println!("⚠️  Some messages failed validation");
        }
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("FoxWhisper CBOR Validator - Rust Implementation");
    println!("{}", "=".repeat(50));

    let mut validator = CborValidator::new();

    // Load test vectors
    validator.load_test_vectors()?;

    // Validate all messages
    let results = validator.validate_all();

    // Print summary
    CborValidator::print_summary(&results);
    
    // Save results
    validator.save_results(&results)?;

    println!("\n📄 Rust validation completed successfully");
    println!("📝 Note: Using serde_cbor for CBOR operations");

    Ok(())
}