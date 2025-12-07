mod util;

use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use serde_json::{self, Map, Value};
use std::collections::HashMap;
use std::error::Error;
use std::fs;

#[derive(Debug, Deserialize, Clone)]
struct Mutation {
    op: String,
    field: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    factor: Option<i64>,
    #[serde(default)]
    expected_outcome: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct Seed {
    seed_id: String,
    message_type: String,
    base_vector: String,
    mutations: Vec<Mutation>,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    seeds: Vec<Seed>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let corpus_path = util::root_path("tests/common/adversarial/malformed_packets.json");
    let content = fs::read_to_string(corpus_path)?;
    let corpus: Corpus = serde_json::from_str(&content)?;

    println!("FoxWhisper Rust Malformed Packet Harness");
    println!("{}", "=".repeat(45));

    let mut cache = HashMap::new();
    let mut results_summary = Vec::new();
    let mut passed = 0;

    for seed in corpus.seeds {
        match process_seed(&seed, &mut cache) {
            Ok((observed, logs)) => {
                let expected = expected_success(&seed);
                let pass = observed == expected;
                if pass {
                    passed += 1;
                    println!("✅ {}", seed.seed_id);
                } else {
                    println!(
                        "❌ {} (expected {}, observed {})",
                        seed.seed_id, expected, observed
                    );
                }
                results_summary.push(serde_json::json!({
                    "seed_id": seed.seed_id,
                    "message_type": seed.message_type,
                    "expected_success": expected,
                    "observed_success": observed,
                    "passed": pass,
                    "mutations": logs,
                }));
            }
            Err(err) => {
                println!("❌ {} ({})", seed.seed_id, err);
                results_summary.push(serde_json::json!({
                    "seed_id": seed.seed_id,
                    "message_type": seed.message_type,
                    "error": err.to_string(),
                    "passed": false,
                }));
            }
        }
    }

    println!(
        "\nSummary: {}/{} seeds matched expectations",
        passed,
        results_summary.len()
    );

    let payload = serde_json::json!({
        "language": "rust",
        "test": "malformed_fuzz",
        "total_seeds": results_summary.len(),
        "passed": passed,
        "failed": results_summary.len() - passed,
        "results": results_summary,
    });

    util::write_json("rust_malformed_packet_fuzz_results.json", &payload)?;
    println!("📄 Results saved to results/rust_malformed_packet_fuzz_results.json");

    if passed != results_summary.len() {
        std::process::exit(1);
    }

    Ok(())
}

fn process_seed(
    seed: &Seed,
    cache: &mut HashMap<String, Value>,
) -> Result<(bool, Vec<String>), Box<dyn Error>> {
    let base = load_base_vector(&seed.base_vector, cache)?;
    let (mut mutated, mut logs) = (base, Vec::new());
    for mutation in &seed.mutations {
        apply_mutation(&mut mutated, mutation)?;
        logs.push(format!("{}:{}", mutation.op, mutation.field));
    }
    let observed = evaluate_seed(seed, &mutated)?;
    Ok((observed, logs))
}

fn load_base_vector(
    reference: &str,
    cache: &mut HashMap<String, Value>,
) -> Result<Value, Box<dyn Error>> {
    let parts: Vec<&str> = reference.split('#').collect();
    let path = parts.get(0).ok_or("invalid base_vector path")?;
    let pointer = parts.get(1).copied().unwrap_or("");

    let data = cache.entry(path.to_string()).or_insert_with(|| {
        let file_path = util::root_path(path);
        let content = fs::read_to_string(file_path).expect("Failed to read base vector file");
        serde_json::from_str(&content).expect("Failed to parse base vector")
    });

    if pointer.is_empty() {
        return Ok(data.clone());
    }

    let mut current_ref: &Value = data;
    for key in pointer.split('.') {
        current_ref = current_ref
            .get(key)
            .ok_or_else(|| format!("Missing key {}", key))?;
    }
    Ok(current_ref.clone())
}

fn apply_mutation(target: &mut Value, mutation: &Mutation) -> Result<(), Box<dyn Error>> {
    let path: Vec<&str> = mutation
        .field
        .split('.')
        .filter(|p| !p.is_empty())
        .collect();
    match mutation.op.as_str() {
        "remove_field" => remove_field(target, &path)?,
        "set_value" => set_value(target, &path, mutation.value.clone())?,
        "shuffle_map" => {
            // no-op; serde_json map order is deterministic
            let _ = path;
        }
        "expand_bytes" => {
            let factor = mutation.factor.unwrap_or(2).max(1) as usize;
            expand_bytes(target, &path, factor)?;
        }
        op => return Err(format!("unsupported mutation op: {}", op).into()),
    }
    Ok(())
}

fn remove_field(target: &mut Value, path: &[&str]) -> Result<(), Box<dyn Error>> {
    if path.is_empty() {
        return Ok(());
    }
    if let Some(parent) = resolve_parent_mut(target, path)? {
        if let Some(key) = path.last() {
            parent.remove(*key);
        }
    }
    Ok(())
}

fn set_value(target: &mut Value, path: &[&str], value: Value) -> Result<(), Box<dyn Error>> {
    if path.is_empty() {
        *target = value;
        return Ok(());
    }
    if let Some(parent) = resolve_parent_mut(target, path)? {
        if let Some(key) = path.last() {
            parent.insert((*key).to_string(), value);
        }
    }
    Ok(())
}

fn expand_bytes(target: &mut Value, path: &[&str], factor: usize) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = resolve_parent_mut(target, path)? {
        if let Some(key) = path.last() {
            if let Some(Value::String(current)) = parent.get_mut(*key) {
                let expanded = current.repeat(factor);
                *current = expanded;
            }
        }
    }
    Ok(())
}

fn resolve_parent_mut<'a>(
    target: &'a mut Value,
    path: &[&str],
) -> Result<Option<&'a mut Map<String, Value>>, Box<dyn Error>> {
    if path.is_empty() {
        return Ok(None);
    }
    let mut current = target;
    for key in &path[..path.len() - 1] {
        current = current
            .as_object_mut()
            .ok_or("expected object in path")?
            .entry((*key).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    Ok(current.as_object_mut())
}

fn evaluate_seed(seed: &Seed, vector: &Value) -> Result<bool, Box<dyn Error>> {
    let obj = vector.as_object().ok_or("mutated vector must be object")?;
    let data = obj
        .get("data")
        .and_then(|v| v.as_object())
        .ok_or("missing data object")?;
    Ok(validate_handshake(&seed.message_type, data))
}

fn validate_handshake(message_type: &str, data: &Map<String, Value>) -> bool {
    match message_type {
        "HANDSHAKE_INIT" => {
            required_fields(
                data,
                &[
                    "version",
                    "client_id",
                    "x25519_public_key",
                    "kyber_public_key",
                    "nonce",
                ],
            ) && base64_len(data, "client_id", 32)
                && base64_len(data, "x25519_public_key", 32)
                && base64_len(data, "kyber_public_key", 32)
                && base64_len(data, "nonce", 12)
        }
        "HANDSHAKE_RESPONSE" => {
            required_fields(
                data,
                &[
                    "version",
                    "server_id",
                    "x25519_public_key",
                    "kyber_ciphertext",
                    "nonce",
                ],
            ) && base64_len(data, "server_id", 32)
                && base64_len(data, "x25519_public_key", 32)
                && base64_len(data, "kyber_ciphertext", 32)
                && base64_len(data, "nonce", 12)
        }
        "HANDSHAKE_COMPLETE" => {
            required_fields(data, &["timestamp"])
                && data
                    .get("timestamp")
                    .and_then(|v| v.as_i64())
                    .map_or(false, |ts| ts >= 0 && ts <= 4_102_444_800_000)
        }

        _ => false,
    }
}

fn required_fields(data: &Map<String, Value>, fields: &[&str]) -> bool {
    fields.iter().all(|field| data.contains_key(*field))
}

fn base64_len(data: &Map<String, Value>, field: &str, min: usize) -> bool {
    if let Some(Value::String(val)) = data.get(field) {
        if let Ok(decoded) = general_purpose::STANDARD.decode(val) {
            return decoded.len() >= min;
        }
    }
    false
}

fn expected_success(seed: &Seed) -> bool {
    seed.mutations
        .first()
        .and_then(|m| m.expected_outcome.as_deref())
        .map(|outcome| outcome.eq_ignore_ascii_case("recover"))
        .unwrap_or(false)
}
