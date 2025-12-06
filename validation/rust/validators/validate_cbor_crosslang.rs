use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

// FoxWhisper CBOR Cross-Language Validator (Rust)
// Runs validators in multiple languages and compares results

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LanguageResult {
    pub language: String,
    pub success: bool,
    pub output: String,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrossLanguageValidator {
    pub results: HashMap<String, LanguageResult>,
}

impl CrossLanguageValidator {
    pub fn new() -> Self {
        Self {
            results: HashMap::new(),
        }
    }

    pub fn run_language_validator(&mut self, language: &str) -> LanguageResult {
        let repo_root = env!("CARGO_MANIFEST_DIR");
        let (cmd, args, working_dir) = match language {
            "python" => ("python3", vec!["validation/python/validators/validate_cbor_python.py"], Some(repo_root)),
            "node" => ("node", vec!["validation/nodejs/validators/validate_cbor_node.js"], Some(repo_root)),
            "go" => ("go", vec!["run", "validation/go/validators/validate_cbor_go.go"], Some(repo_root)),
            "rust" => ("cargo", vec!["run", "--bin", "validate_cbor_rust"], Some(repo_root)),
            _ => {
                return LanguageResult {
                    language: language.to_string(),
                    success: false,
                    output: String::new(),
                    errors: vec![format!("Unsupported language: {}", language)],
                };
            }
        };

        let mut command = Command::new(cmd);
        command.args(&args);
        if let Some(dir) = working_dir {
            command.current_dir(dir);
        }
        let output = command.output();

        let result = match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let combined_output = format!("{}\n{}", stdout, stderr);
                
                let success = output.status.success() && 
                    (combined_output.contains("All messages passed") || 
                     combined_output.contains("All messages passed CBOR validation") ||
                     combined_output.contains("All Python CBOR validation tests passed") ||
                     combined_output.contains("All Node.js CBOR validation tests passed"));

                let mut errors = Vec::new();
                if !output.status.success() {
                    errors.push(format!("Process exited with code: {}", output.status));
                }
                if !stderr.is_empty() {
                    errors.push(stderr);
                }

                LanguageResult {
                    language: language.to_string(),
                    success,
                    output: combined_output,
                    errors,
                }
            }
            Err(e) => LanguageResult {
                language: language.to_string(),
                success: false,
                output: String::new(),
                errors: vec![format!("Failed to execute command: {}", e)],
            },
        };

        self.results.insert(language.to_string(), result.clone());
        result
    }

    pub fn run_all_validators(&mut self) {
        let languages = vec!["python", "node", "go", "rust"];

        for language in languages {
            println!("\nRunning {} validator...", language);
            println!("{}", "-".repeat(30));

            let result = self.run_language_validator(language);

            if result.success {
                println!("✅ {} validation successful", language);
            } else {
                println!("❌ {} validation failed", language);
                for error in &result.errors {
                    println!("   Error: {}", error);
                }
            }
        }
    }

    pub fn print_summary(&self) {
        println!("\n{}", "=".repeat(40));
        println!("CROSS-LANGUAGE SUMMARY");
        println!("{}", "=".repeat(40));

        let mut success_count = 0;
        for (lang, result) in &self.results {
            if result.success {
                success_count += 1;
            }
            let status = if result.success { "✅ SUCCESS" } else { "❌ FAILED" };
            println!("{} {}", status, lang.to_uppercase());
        }

        println!("\nOverall: {}/{} languages successful", success_count, self.results.len());

        if success_count == self.results.len() {
            println!("🎉 All validators passed!");
        } else {
            println!("⚠️  Some validators failed");
        }
    }

    pub fn save_results(&self) -> Result<(), Box<dyn Error>> {
        let results_json = serde_json::to_string_pretty(&self.results)?;

        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let results_dir = repo_root.join("results");
        fs::create_dir_all(&results_dir)?;
        let output_path = results_dir.join("cross_language_validation_results.json");

        fs::write(&output_path, results_json)?;
        println!("\n📄 Results saved to {}", output_path.display());
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("FoxWhisper CBOR Cross-Language Validation (Rust)");
    println!("{}", "=".repeat(50));

    let mut validator = CrossLanguageValidator::new();

    // Run all validators
    validator.run_all_validators();

    // Print summary
    validator.print_summary();

    // Save results
    validator.save_results()?;

    println!("\n📄 Rust cross-language validation completed successfully");
    Ok(())
}