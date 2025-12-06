use serde_json;
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::PathBuf;

// FoxWhisper Multi-Device Sync Validator (Rust) - Simple Version
// Validates multi-device synchronization test vectors for FoxWhisper v0.9

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ValidationResult {
    pub scenario: String,
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

pub struct MultiDeviceSyncValidator;

impl MultiDeviceSyncValidator {
    pub fn new() -> Self {
        Self
    }

    pub fn validate_scenario(&self, scenario_name: &str, scenario_data: &serde_json::Value) -> ValidationResult {
        println!("Validating {} scenario...", scenario_name);
        let mut errors = Vec::new();
        let warnings = Vec::new();

        // Check if scenario has steps
        if let Some(steps) = scenario_data.get("steps").and_then(|v| v.as_array()) {
            if steps.len() < 3 {
                errors.push(format!("Expected at least 3 steps, got {}", steps.len()));
            }

            // Validate each step
            for (i, step) in steps.iter().enumerate() {
                if let Some(step_obj) = step.as_object() {
                    // Check required step fields
                    let required_fields = vec!["step", "type", "from", "to", "message"];
                    for field in &required_fields {
                        if !step_obj.contains_key(&field.to_string()) {
                            errors.push(format!("Step {}: Missing field {}", i + 1, field));
                        }
                    }

                    // Check message structure
                    if let Some(message) = step_obj.get("message") {
                        if let Some(msg_obj) = message.as_object() {
                            // Check common message fields
                            let common_fields = vec!["type", "version", "timestamp"];
                            for field in &common_fields {
                                if !msg_obj.contains_key(&field.to_string()) {
                                    errors.push(format!("Step {}: Missing message field {}", i + 1, field));
                                }
                            }

                            // Validate nonce if present
                            if let Some(nonce) = msg_obj.get("nonce").and_then(|v| v.as_str()) {
                                if nonce.len() != 24 {  // Base64 should be 24 chars for 16 bytes
                                    errors.push(format!("Step {}: Invalid nonce length", i + 1));
                                }
                            }
                        } else {
                            errors.push(format!("Step {}: Message must be object", i + 1));
                        }
                    } else {
                        errors.push(format!("Step {}: Missing message", i + 1));
                    }
                } else {
                    errors.push(format!("Step {}: Must be object", i + 1));
                }
            }
        } else {
            errors.push("Missing or invalid steps array".to_string());
        }

        ValidationResult {
            scenario: scenario_name.to_string(),
            valid: errors.is_empty(),
            errors,
            warnings,
        }
    }

    pub fn validate_all_scenarios(&mut self, test_vectors: &serde_json::Value) -> Result<HashMap<String, ValidationResult>, Box<dyn Error>> {
        println!("FoxWhisper Multi-Device Sync Validation (Rust)");
        println!("{}", "=".repeat(50));

        let test_vectors_obj = test_vectors.as_object()
            .ok_or("Test vectors must be object")?;

        let mut results = HashMap::new();

        // Validate each scenario
        let scenario_names = vec!["device_addition", "device_removal", "sync_conflict", "backup_restore"];
        
        for scenario_name in &scenario_names {
            if let Some(scenario_data) = test_vectors_obj.get(&scenario_name.to_string()) {
                let result = self.validate_scenario(scenario_name, scenario_data);
                
                if result.valid {
                    println!("✅ {} - VALID", scenario_name);
                } else {
                    println!("❌ {} - INVALID", scenario_name);
                    for error in &result.errors {
                        println!("   Error: {}", error);
                    }
                }

                for warning in &result.warnings {
                    println!("   Warning: {}", warning);
                }

                results.insert(scenario_name.to_string(), result);
            }
        }

        Ok(results)
    }

    pub fn print_summary(results: &HashMap<String, ValidationResult>) {
        println!("\n{}", "=".repeat(40));
        println!("MULTI-DEVICE SYNC VALIDATION SUMMARY");
        println!("{}", "=".repeat(40));

        let mut valid_count = 0;
        for (scenario_name, result) in results {
            if result.valid {
                valid_count += 1;
            }
            let status = if result.valid { "✅ VALID" } else { "❌ INVALID" };
            println!("{} {}", status, scenario_name);
        }

        println!("\nOverall: {}/{} scenarios valid", valid_count, results.len());

        if valid_count == results.len() {
            println!("🎉 All multi-device sync scenarios passed validation!");
        } else {
            println!("⚠️  Some scenarios failed validation");
        }
    }

    pub fn save_results(results: &HashMap<String, ValidationResult>, filename: &str) -> Result<(), Box<dyn Error>> {
        let mut output_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        output_dir.push("results");
        if !output_dir.exists() {
            fs::create_dir_all(&output_dir)?;
        }
        let file_path = output_dir.join(filename);
        let results_json = serde_json::to_string_pretty(results)?;
        fs::write(&file_path, results_json)?;
        println!("\n📄 Results saved to {}", file_path.display());
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        println!("Usage: cargo run --bin validate_multi_device_sync_rust <test_vectors_file>");
        std::process::exit(1);
    }

    let test_vectors_file = &args[1];
    let test_vectors_content = fs::read_to_string(test_vectors_file)?;
    let test_vectors: serde_json::Value = serde_json::from_str(&test_vectors_content)?;

    let mut validator = MultiDeviceSyncValidator::new();
    let results = validator.validate_all_scenarios(&test_vectors)?;
    MultiDeviceSyncValidator::print_summary(&results);
    MultiDeviceSyncValidator::save_results(&results, "multi_device_sync_validation_results_rust.json")?;

    println!("\n📄 Rust multi-device sync validation completed successfully");
    Ok(())
}