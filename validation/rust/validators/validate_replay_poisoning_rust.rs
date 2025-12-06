use serde::{Deserialize, Serialize};
use serde_json::{self, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct ReplayVectors {
    replay_attack_detection: ReplayCases,
    replay_window_boundaries: ReplayCases,
    poisoning_injection: PoisoningSection,
    epoch_fork_detection: EpochForkSection,
    malformed_eare: MalformedEareSection,
    anti_poisoning_rules: AntiPoisoningSection,
    replay_storm_simulation: ReplayStormSection,
}

#[derive(Deserialize, Clone)]
struct ReplayCases {
    window_size: i64,
    test_cases: Vec<ReplayTestCase>,
}

#[derive(Deserialize, Clone)]
struct ReplayTestCase {
    case: String,
    sequence_numbers: Vec<i64>,
    expected_detection: bool,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct PoisoningSection {
    attack_vectors: Vec<AttackVector>,
}

#[derive(Deserialize, Clone)]
struct AttackVector {
    attack_name: String,
    malicious_fields: Vec<HashMap<String, Value>>,
    expected_defense: String,
}

#[derive(Deserialize)]
struct EpochForkSection {
    scenarios: Vec<EpochScenario>,
}

#[derive(Deserialize, Clone)]
struct EpochScenario {
    scenario: String,
    expected_fork_detected: bool,
    timeline: Vec<EpochEntry>,
}

#[derive(Deserialize, Clone)]
struct EpochEntry {
    epoch_id: String,
    parent: Option<String>,
}

#[derive(Deserialize)]
struct MalformedEareSection {
    records: Vec<EareRecord>,
}

#[derive(Deserialize, Clone)]
struct EareRecord {
    record_id: String,
    fields: HashMap<String, Value>,
    required_fields: Option<Vec<String>>,
    hash_bytes: Option<i64>,
    min_hash_bytes: Option<i64>,
    expected_valid: bool,
}

#[derive(Deserialize)]
struct AntiPoisoningSection {
    rules: Vec<AntiPoisoningRule>,
}

#[derive(Deserialize, Clone)]
struct AntiPoisoningRule {
    rule_id: String,
    conditions: HashMap<String, Value>,
    sample_message: HashMap<String, Value>,
    expected_enforced: bool,
}

#[derive(Deserialize)]
struct ReplayStormSection {
    window_size: i64,
    capacity_per_ms: f64,
    profiles: Vec<ReplayProfile>,
}

#[derive(Deserialize, Clone)]
struct ReplayProfile {
    profile_id: String,
    burst_rate: f64,
    duration_ms: f64,
    expected_drop_ratio: f64,
}

#[derive(Serialize)]
struct ScenarioResult {
    scenario: String,
    valid: bool,
    details: Vec<String>,
}

struct Validator {
    vectors: ReplayVectors,
    results: Vec<ScenarioResult>,
}

impl Validator {
    fn new(vectors: ReplayVectors) -> Self {
        Self { vectors, results: Vec::new() }
    }

    fn run(mut self) -> Vec<ScenarioResult> {
        self.validate_replay_cases();
        self.validate_replay_boundaries();
        self.validate_poisoning();
        self.validate_epoch_forks();
        self.validate_malformed_eare();
        self.validate_anti_poisoning();
        self.validate_replay_storm();
        self.results
    }

    fn record(&mut self, name: String, valid: bool, details: Vec<String>) {
        self.results.push(ScenarioResult { scenario: name, valid, details });
    }

    fn detect_replay(&self, sequence_numbers: &[i64], window: i64) -> bool {
        let mut seen: Vec<i64> = Vec::new();
        let mut detection = false;
        for &seq in sequence_numbers {
            let cutoff = seq - window;
            seen.retain(|value| *value >= cutoff);
            if seen.contains(&seq) {
                detection = true;
            }
            seen.push(seq);
        }
        detection
    }

    fn validate_replay_cases(&mut self) {
        let window = self.vectors.replay_attack_detection.window_size;
        let test_cases = self.vectors.replay_attack_detection.test_cases.clone();
        for test in test_cases {
            let detected = self.detect_replay(&test.sequence_numbers, window);
            let mut details = vec![
                format!("window={}", window),
                format!("detected={}", detected),
                format!("expected={}", test.expected_detection),
            ];
            if let Some(notes) = &test.notes {
                if !notes.is_empty() {
                    details.push(notes.clone());
                }
            }
            self.record(
                format!("replay_attack::{}", test.case),
                detected == test.expected_detection,
                details,
            );
        }
    }

    fn validate_replay_boundaries(&mut self) {
        let window = self.vectors.replay_window_boundaries.window_size;
        let test_cases = self.vectors.replay_window_boundaries.test_cases.clone();
        for test in test_cases {
            let detected = self.detect_replay(&test.sequence_numbers, window);
            let mut details = vec![
                format!("window={}", window),
                format!("detected={}", detected),
                format!("expected={}", test.expected_detection),
            ];
            if let Some(notes) = &test.notes {
                if !notes.is_empty() {
                    details.push(notes.clone());
                }
            }
            self.record(
                format!("replay_window::{}", test.case),
                detected == test.expected_detection,
                details,
            );
        }
    }

    fn validate_poisoning(&mut self) {
        let attacks = self.vectors.poisoning_injection.attack_vectors.clone();
        for attack in attacks {
            let mut violations = 0;
            for field in &attack.malicious_fields {
                for (key, expected) in field {
                    if key.starts_with("expected_") {
                        let suffix = &key[9..];
                        let actual_key = format!("actual_{}", suffix);
                        if let Some(actual) = field.get(&actual_key) {
                            if actual != expected {
                                violations += 1;
                            }
                        }
                    }
                }
            }
            let details = vec![
                format!("violations={}", violations),
                format!("expected_defense={}", attack.expected_defense),
            ];
            self.record(
                format!("poisoning::{}", attack.attack_name),
                violations > 0,
                details,
            );
        }
    }

    fn validate_epoch_forks(&mut self) {
        let scenarios = self.vectors.epoch_fork_detection.scenarios.clone();
        for scenario in scenarios {
            let mut counts: HashMap<String, usize> = HashMap::new();
            for entry in &scenario.timeline {
                if let Some(parent) = &entry.parent {
                    *counts.entry(parent.clone()).or_insert(0) += 1;
                }
            }
            let fork_detected = counts.values().any(|count| *count > 1);
            let details = vec![
                format!("fork_detected={}", fork_detected),
                format!("expected={}", scenario.expected_fork_detected),
                format!("timeline_length={}", scenario.timeline.len()),
            ];
            self.record(
                format!("epoch_fork::{}", scenario.scenario),
                fork_detected == scenario.expected_fork_detected,
                details,
            );
        }
    }

    fn validate_malformed_eare(&mut self) {
        let records = self.vectors.malformed_eare.records.clone();
        for record in records {
            let required = record.required_fields.unwrap_or_default();
            let mut missing = Vec::new();
            for field in &required {
                if !record.fields.contains_key(field) {
                    missing.push(field.clone());
                }
            }
            let mut hash_bytes = record.hash_bytes.unwrap_or(0);
            if hash_bytes == 0 {
                if let Some(Value::String(hex_str)) = record.fields.get("hash") {
                    hash_bytes = (hex_str.len() / 2) as i64;
                }
            }
            let min_hash = record.min_hash_bytes.unwrap_or(32);
            let valid = missing.is_empty() && hash_bytes >= min_hash;
            let details = vec![
                format!("missing_fields={:?}", missing),
                format!("hash_bytes={}", hash_bytes),
                format!("min_hash_bytes={}", min_hash),
                format!("expected_valid={}", record.expected_valid),
            ];
            self.record(
                format!("eare::{}", record.record_id),
                valid == record.expected_valid,
                details,
            );
        }
    }

    fn validate_anti_poisoning(&mut self) {
        let rules = self.vectors.anti_poisoning_rules.rules.clone();
        for rule in rules {
            let conditions = &rule.conditions;
            let sample = &rule.sample_message;
            let mut enforced = true;

            if let Some(value) = conditions.get("max_drift") {
                let drift = get_int(sample.get("nonce_counter")) - get_int(sample.get("last_nonce_counter"));
                let limit = get_float(Some(value));
                enforced = (drift as f64) <= limit;
            } else if matches!(conditions.get("require_binding"), Some(Value::Bool(true))) {
                enforced = sample.get("sender_id") == sample.get("aad_sender");
            } else if matches!(conditions.get("allow_missing_aad"), Some(Value::Bool(true))) {
                enforced = !sample.contains_key("aad") || sample.get("aad").map(|v| v.is_null()).unwrap_or(true);
            }

            let details = vec![
                format!("enforced={}", enforced),
                format!("expected={}", rule.expected_enforced),
            ];
            self.record(
                format!("anti_poisoning::{}", rule.rule_id),
                enforced == rule.expected_enforced,
                details,
            );
        }
    }

    fn validate_replay_storm(&mut self) {
        let window = self.vectors.replay_storm_simulation.window_size;
        let capacity_rate = self.vectors.replay_storm_simulation.capacity_per_ms;
        let profiles = self.vectors.replay_storm_simulation.profiles.clone();
        let tolerance = 0.1;
        for profile in profiles {
            let total = profile.burst_rate * profile.duration_ms;
            let capacity = capacity_rate * profile.duration_ms + window as f64;
            let drops = (total - capacity).max(0.0);
            let drop_ratio = if total == 0.0 { 0.0 } else { (drops / total).min(1.0) };
            let valid = (drop_ratio - profile.expected_drop_ratio).abs() <= tolerance;
            let details = vec![
                format!("window={}", window),
                format!("drop_ratio={:.2}", drop_ratio),
                format!("expected_ratio={:.2}", profile.expected_drop_ratio),
                format!("burst_rate={:.0}", profile.burst_rate),
                format!("duration_ms={:.0}", profile.duration_ms),
            ];
            self.record(
                format!("replay_storm::{}", profile.profile_id),
                valid,
                details,
            );
        }
    }
}

fn get_int(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(num)) => num.as_i64().unwrap_or(0),
        Some(Value::Bool(flag)) => if *flag { 1 } else { 0 },
        _ => 0,
    }
}

fn get_float(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(num)) => num.as_f64().unwrap_or(0.0),
        Some(Value::Bool(flag)) => if *flag { 1.0 } else { 0.0 },
        _ => 0.0,
    }
}

fn save_results(results: &[ScenarioResult]) -> Result<(), Box<dyn std::error::Error>> {
    let mut output_dir = PathBuf::from(env::current_dir()?);
    output_dir.push("results");
    fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("replay_poisoning_validation_results_rust.json");
    let payload = serde_json::json!({
        "language": "rust",
        "scenario_count": results.len(),
        "success": results.iter().all(|r| r.valid),
        "results": results,
    });
    fs::write(&output_path, serde_json::to_string_pretty(&payload)?)?;
    println!("\n📄 Results saved to {}", output_path.display());
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        println!("Usage: cargo run --bin validate_replay_poisoning_rust <test_vectors_file>");
        std::process::exit(1);
    }

    let data = fs::read_to_string(&args[1])?;
    let vectors: ReplayVectors = serde_json::from_str(&data)?;

    println!("FoxWhisper Replay & Poisoning Validator (Rust)");
    println!("{}", "=".repeat(55));

    let validator = Validator::new(vectors);
    let results = validator.run();

    let mut passed = 0;
    for result in &results {
        if result.valid {
            passed += 1;
            println!("✅ {}", result.scenario);
        } else {
            println!("❌ {}", result.scenario);
            for detail in &result.details {
                println!("   {}", detail);
            }
        }
    }

    println!("Validated {} scenarios: {} passed", results.len(), passed);

    save_results(&results)?;

    if !results.iter().all(|r| r.valid) {
        std::process::exit(1);
    }

    Ok(())
}
