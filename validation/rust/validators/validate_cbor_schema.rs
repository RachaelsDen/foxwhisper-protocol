use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose};

// FoxWhisper CBOR Schema Validator (Rust)
// Validates CBOR messages against FoxWhisper protocol schema

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchemaValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub message_type: Option<String>,
    pub schema_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldDefinition {
    pub field_type: String,
    pub required: bool,
    pub size_bytes: Option<usize>,
    pub min_size: Option<usize>,
    pub max_size: Option<usize>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageSchema {
    pub message_type: String,
    pub tag: u32,
    pub required_fields: Vec<String>,
    pub optional_fields: Vec<String>,
    pub field_definitions: HashMap<String, FieldDefinition>,
}

pub struct SchemaValidator {
    schemas: HashMap<String, MessageSchema>,
    schema_version: String,
}

impl SchemaValidator {
    pub fn new() -> Self {
        let mut validator = Self {
            schemas: HashMap::new(),
            schema_version: "0.9".to_string(),
        };
        
        validator.initialize_schemas();
        validator
    }

    fn initialize_schemas(&mut self) {
        // HANDSHAKE_INIT schema
        let mut handshake_init_fields = HashMap::new();
        handshake_init_fields.insert("type".to_string(), FieldDefinition {
            field_type: "string".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Message type identifier".to_string(),
        });
        handshake_init_fields.insert("version".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Protocol version".to_string(),
        });
        handshake_init_fields.insert("client_id".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "Client identifier (32 bytes)".to_string(),
        });
        handshake_init_fields.insert("x25519_public_key".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "X25519 public key (32 bytes)".to_string(),
        });
        handshake_init_fields.insert("kyber_public_key".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(1568),
            min_size: None,
            max_size: None,
            description: "Kyber public key (1568 bytes)".to_string(),
        });
        handshake_init_fields.insert("timestamp".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Unix timestamp".to_string(),
        });
        handshake_init_fields.insert("nonce".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(16),
            min_size: None,
            max_size: None,
            description: "Random nonce (16 bytes)".to_string(),
        });

        self.schemas.insert("HANDSHAKE_INIT".to_string(), MessageSchema {
            message_type: "HANDSHAKE_INIT".to_string(),
            tag: 0xD1,
            required_fields: vec![
                "type".to_string(), "version".to_string(), "client_id".to_string(),
                "x25519_public_key".to_string(), "kyber_public_key".to_string(),
                "timestamp".to_string(), "nonce".to_string()
            ],
            optional_fields: vec![],
            field_definitions: handshake_init_fields,
        });

        // HANDSHAKE_RESPONSE schema
        let mut handshake_response_fields = HashMap::new();
        handshake_response_fields.insert("type".to_string(), FieldDefinition {
            field_type: "string".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Message type identifier".to_string(),
        });
        handshake_response_fields.insert("version".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Protocol version".to_string(),
        });
        handshake_response_fields.insert("server_id".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "Server identifier (32 bytes)".to_string(),
        });
        handshake_response_fields.insert("x25519_public_key".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "X25519 public key (32 bytes)".to_string(),
        });
        handshake_response_fields.insert("kyber_ciphertext".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(1568),
            min_size: None,
            max_size: None,
            description: "Kyber ciphertext (1568 bytes)".to_string(),
        });
        handshake_response_fields.insert("timestamp".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Unix timestamp".to_string(),
        });
        handshake_response_fields.insert("nonce".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(16),
            min_size: None,
            max_size: None,
            description: "Random nonce (16 bytes)".to_string(),
        });

        self.schemas.insert("HANDSHAKE_RESPONSE".to_string(), MessageSchema {
            message_type: "HANDSHAKE_RESPONSE".to_string(),
            tag: 0xD2,
            required_fields: vec![
                "type".to_string(), "version".to_string(), "server_id".to_string(),
                "x25519_public_key".to_string(), "kyber_ciphertext".to_string(),
                "timestamp".to_string(), "nonce".to_string()
            ],
            optional_fields: vec![],
            field_definitions: handshake_response_fields,
        });

        // HANDSHAKE_COMPLETE schema
        let mut handshake_complete_fields = HashMap::new();
        handshake_complete_fields.insert("type".to_string(), FieldDefinition {
            field_type: "string".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Message type identifier".to_string(),
        });
        handshake_complete_fields.insert("version".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Protocol version".to_string(),
        });
        handshake_complete_fields.insert("session_id".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "Session identifier (32 bytes)".to_string(),
        });
        handshake_complete_fields.insert("handshake_hash".to_string(), FieldDefinition {
            field_type: "base64".to_string(),
            required: true,
            size_bytes: Some(32),
            min_size: None,
            max_size: None,
            description: "Handshake hash (32 bytes)".to_string(),
        });
        handshake_complete_fields.insert("timestamp".to_string(), FieldDefinition {
            field_type: "integer".to_string(),
            required: true,
            size_bytes: None,
            min_size: None,
            max_size: None,
            description: "Unix timestamp".to_string(),
        });

        self.schemas.insert("HANDSHAKE_COMPLETE".to_string(), MessageSchema {
            message_type: "HANDSHAKE_COMPLETE".to_string(),
            tag: 0xD3,
            required_fields: vec![
                "type".to_string(), "version".to_string(), "session_id".to_string(),
                "handshake_hash".to_string(), "timestamp".to_string()
            ],
            optional_fields: vec![],
            field_definitions: handshake_complete_fields,
        });
    }

    pub fn validate_message(&self, message_data: &HashMap<String, serde_json::Value>) -> SchemaValidationResult {
        let mut result = SchemaValidationResult {
            valid: false,
            errors: Vec::new(),
            warnings: Vec::new(),
            message_type: None,
            schema_version: self.schema_version.clone(),
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

        result.message_type = Some(message_type_str.to_string());

        // Get schema for this message type
        let schema = match self.schemas.get(message_type_str) {
            Some(s) => s,
            None => {
                result.errors.push(format!("Unknown message type: {}", message_type_str));
                return result;
            }
        };

        // Check required fields
        for field in &schema.required_fields {
            if !message_data.contains_key(field) {
                result.errors.push(format!("Missing required field: {}", field));
            }
        }

        // Check for unknown fields
        for field_name in message_data.keys() {
            if !schema.required_fields.contains(field_name) && !schema.optional_fields.contains(field_name) {
                result.warnings.push(format!("Unknown field: {}", field_name));
            }
        }

        // Validate each field
        for (field_name, field_value) in message_data {
            if let Some(field_def) = schema.field_definitions.get(field_name) {
                self.validate_field(field_name, field_value, field_def, &mut result);
            }
        }

        result.valid = result.errors.is_empty();
        result
    }

    fn validate_field(&self, field_name: &str, value: &serde_json::Value, field_def: &FieldDefinition, result: &mut SchemaValidationResult) {
        match field_def.field_type.as_str() {
            "string" => {
                if !value.is_string() {
                    result.errors.push(format!("Field {} must be string", field_name));
                }
            }
            "integer" => {
                if !value.is_number() {
                    result.errors.push(format!("Field {} must be integer", field_name));
                }
            }
            "base64" => {
                if let Err(e) = self.validate_base64_field(field_name, value, field_def) {
                    result.errors.push(e);
                }
            }
            _ => {
                result.warnings.push(format!("Unknown field type: {} for field {}", field_def.field_type, field_name));
            }
        }
    }

    fn validate_base64_field(&self, field_name: &str, value: &serde_json::Value, field_def: &FieldDefinition) -> Result<(), String> {
        let str_value = match value.as_str() {
            Some(s) => s,
            None => return Err(format!("Field {} must be string", field_name)),
        };

        // Try standard base64 first
        let bytes = general_purpose::STANDARD.decode(str_value)
            .or_else(|_| general_purpose::URL_SAFE.decode(str_value))
            .map_err(|e| format!("Field {} must be valid base64 (error: {})", field_name, e))?;

        // Check size constraints
        if let Some(expected_size) = field_def.size_bytes {
            if bytes.len() != expected_size {
                return Err(format!("Field {} wrong size: {} != {}", field_name, bytes.len(), expected_size));
            }
        }

        if let Some(min_size) = field_def.min_size {
            if bytes.len() < min_size {
                return Err(format!("Field {} too small: {} < {}", field_name, bytes.len(), min_size));
            }
        }

        if let Some(max_size) = field_def.max_size {
            if bytes.len() > max_size {
                return Err(format!("Field {} too large: {} > {}", field_name, bytes.len(), max_size));
            }
        }

        Ok(())
    }

    pub fn validate_test_vectors(&self) -> Result<Vec<SchemaValidationResult>, Box<dyn Error>> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let possible_paths = [
            "tests/common/handshake/cbor_test_vectors_fixed.json",
            "tests/common/handshake/cbor_test_vectors.json",
        ];

        let mut loaded_data: Option<String> = None;
        for relative in &possible_paths {
            let candidate = manifest_dir.join(relative);
            if candidate.exists() {
                loaded_data = Some(fs::read_to_string(candidate)?);
                break;
            }
        }

        let data = loaded_data.ok_or("Could not find test vectors file")?;
        let test_vectors: HashMap<String, serde_json::Value> = serde_json::from_str(&data)?;
        
        let mut results = Vec::new();

        for (test_name, test_value) in test_vectors {
            if let Some(test_obj) = test_value.as_object() {
                if let Some(message_data_value) = test_obj.get("data") {
                    if let Some(message_data) = message_data_value.as_object() {
                        println!("\nValidating: {}", test_name);
                        println!("{}", "-".repeat(30));

                        let result = self.validate_message(&message_data.iter()
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect());

                        results.push(result.clone());

                        if result.valid {
                            println!("✅ {} - VALID", test_name);
                            if let Some(ref msg_type) = result.message_type {
                                println!("   Message Type: {}", msg_type);
                            }
                        } else {
                            println!("❌ {} - INVALID", test_name);
                            for error in &result.errors {
                                println!("   Error: {}", error);
                            }
                        }

                        for warning in &result.warnings {
                            println!("   Warning: {}", warning);
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    pub fn print_summary(results: &[SchemaValidationResult]) {
        println!("\n{}", "=".repeat(40));
        println!("SCHEMA VALIDATION SUMMARY");
        println!("{}", "=".repeat(40));

        let mut valid_count = 0;
        let mut total_errors = 0;
        let mut total_warnings = 0;

        for (i, result) in results.iter().enumerate() {
            if result.valid {
                valid_count += 1;
            }
            total_errors += result.errors.len();
            total_warnings += result.warnings.len();
            
            let status = if result.valid { "✅ VALID" } else { "❌ INVALID" };
            println!("{} Test {}", status, i + 1);
        }

        println!("\nOverall: {}/{} messages valid", valid_count, results.len());
        println!("Total errors: {}", total_errors);
        println!("Total warnings: {}", total_warnings);

        if valid_count == results.len() {
            println!("🎉 All messages passed schema validation!");
        } else {
            println!("⚠️  Some messages failed validation");
        }
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("FoxWhisper CBOR Schema Validator - Rust Implementation");
    println!("{}", "=".repeat(50));

    let validator = SchemaValidator::new();

    // Validate test vectors
    let results = validator.validate_test_vectors()?;

    // Print summary
    SchemaValidator::print_summary(&results);

    println!("\n📄 Rust schema validation completed successfully");
    println!("📝 Schema version: {}", validator.schema_version);

    Ok(())
}