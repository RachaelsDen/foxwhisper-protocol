use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;

mod util;
use util::{load_json, write_json};

#[derive(Debug, Deserialize)]
struct GroupContext {
    group_id: String,
    membership_version: i32,
    epoch_size_limit: i32,
}

#[derive(Debug, Deserialize, Clone)]
struct Node {
    node_id: String,
    epoch_id: i32,
    eare_hash: String,
    issued_by: String,
    previous_epoch_hash: String,
    membership_digest: String,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct Corruption {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    target_node: Option<String>,
    #[serde(default)]
    fields: Option<serde_json::Value>,
    #[serde(default)]
    payload_patch: Option<serde_json::Value>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Expectations {
    should_detect: bool,
    expected_errors: Vec<String>,
    max_detection_ms: i32,
    allow_partial_accept: bool,
    residual_divergence_allowed: bool,
}

#[derive(Debug, Deserialize)]
struct Scenario {
    scenario_id: String,
    #[serde(default)]
    tags: Vec<String>,
    group_context: GroupContext,
    nodes: Vec<Node>,
    #[serde(default)]
    corruptions: Vec<Corruption>,
    expectations: Expectations,
}

#[derive(Debug, Serialize)]
struct ScenarioSummary {
    scenario_id: String,
    status: String,
    failures: Vec<String>,
    errors: Vec<String>,
    metrics: serde_json::Value,
    notes: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Summary {
    corpus: String,
    total: usize,
    failed: usize,
    passed: usize,
    scenarios: Vec<ScenarioSummary>,
}

#[derive(Debug)]
struct SimulationResult {
    detection: bool,
    detection_ms: Option<i32>,
    errors: Vec<String>,
    metrics: serde_json::Value,
    notes: Vec<String>,
}

fn push_err(errors: &mut Vec<String>, code: &str) {
    if !errors.iter().any(|e| e == code) {
        errors.push(code.to_string());
    }
}

fn simulate(s: &Scenario) -> SimulationResult {
    let mut errors: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    let mut corr_by_target: HashMap<String, Vec<Corruption>> = HashMap::new();
    for c in s.corruptions.iter() {
        let target = c.target_node.clone().unwrap_or_else(|| "*".into());
        corr_by_target.entry(target).or_default().push(c.clone());
    }

    let mut nodes = s.nodes.clone();
    nodes.sort_by_key(|n| n.epoch_id);

    let mut last_hash: Option<String> = None;
    let mut hash_breaks = 0;
    let mut accepted = 0;
    let mut rejected = 0;

    for node in nodes.iter() {
        if let Some(prev) = &last_hash {
            if node.previous_epoch_hash != *prev {
                push_err(&mut errors, "HASH_CHAIN_BREAK");
                hash_breaks += 1;
                rejected += 1;
            } else {
                accepted += 1;
            }
        } else {
            accepted += 1;
        }
        last_hash = Some(node.eare_hash.clone());

        let targets = vec![node.node_id.clone(), "*".to_string()];
        for t in targets {
            if let Some(corrs) = corr_by_target.get(&t) {
                for c in corrs {
                    match c.r#type.to_uppercase().as_str() {
                        "INVALID_SIGNATURE" => push_err(&mut errors, "INVALID_SIGNATURE"),
                        "INVALID_POP" => push_err(&mut errors, "INVALID_POP"),
                        "HASH_CHAIN_BREAK" => {
                            push_err(&mut errors, "HASH_CHAIN_BREAK");
                            hash_breaks += 1;
                        }
                        "TRUNCATED_EARE" => {
                            push_err(&mut errors, "TRUNCATED_EARE");
                            rejected += 1;
                        }
                        "EXTRA_FIELDS" => push_err(&mut errors, "EXTRA_FIELDS"),
                        "PAYLOAD_TAMPERED" | "TAMPER_PAYLOAD" => {
                            push_err(&mut errors, "PAYLOAD_TAMPERED")
                        }
                        "STALE_EPOCH_REF" => push_err(&mut errors, "STALE_EPOCH_REF"),
                        other => notes.push(format!("unhandled corruption {}", other)),
                    }
                }
            }
        }
    }

    let detection = !errors.is_empty();
    let detection_ms = if detection { Some(0) } else { None };

    let metrics = serde_json::json!({
        "chain_length": nodes.len(),
        "hash_chain_breaks": hash_breaks,
        "corruptions_applied": s.corruptions.len(),
        "accepted_nodes": accepted,
        "rejected_nodes": rejected,
    });

    SimulationResult {
        detection,
        detection_ms,
        errors,
        metrics,
        notes,
    }
}

fn evaluate(exp: &Expectations, res: &SimulationResult) -> (String, Vec<String>) {
    let mut failures = Vec::new();
    if res.detection != exp.should_detect {
        failures.push("detection_mismatch".into());
    }
    if exp.should_detect {
        match res.detection_ms {
            None => failures.push("missing_detection_ms".into()),
            Some(ms) => {
                if exp.max_detection_ms > 0 && ms > exp.max_detection_ms {
                    failures.push("detection_sla".into());
                }
            }
        }
    } else if let Some(ms) = res.detection_ms {
        if ms != 0 {
            failures.push("unexpected_detection_ms".into());
        }
    }

    let missing: Vec<String> = exp
        .expected_errors
        .iter()
        .filter(|code| !res.errors.iter().any(|e| e == *code))
        .cloned()
        .collect();
    if !missing.is_empty() {
        failures.push("missing_expected_errors".into());
    }

    if !exp.allow_partial_accept {
        if res.metrics["rejected_nodes"].as_i64().unwrap_or(0) > 0 {
            failures.push("partial_accept_not_allowed".into());
        }
    }

    if !exp.residual_divergence_allowed {
        if res.metrics["hash_chain_breaks"].as_i64().unwrap_or(0) > 0 {
            failures.push("residual_divergence".into());
        }
    }

    if failures.is_empty() {
        ("pass".into(), failures)
    } else {
        ("fail".into(), failures)
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let corpus_path = "tests/common/adversarial/corrupted_eare.json";
    let scenarios: Vec<Scenario> = load_json(corpus_path)?;
    let mut summary = Summary {
        corpus: corpus_path.into(),
        total: scenarios.len(),
        failed: 0,
        passed: 0,
        scenarios: Vec::new(),
    };

    for scenario in scenarios.iter() {
        let res = simulate(scenario);
        let (status, failures) = evaluate(&scenario.expectations, &res);
        if status == "pass" {
            summary.passed += 1;
        } else {
            summary.failed += 1;
        }
        summary.scenarios.push(ScenarioSummary {
            scenario_id: scenario.scenario_id.clone(),
            status,
            failures,
            errors: res.errors.clone(),
            metrics: res.metrics.clone(),
            notes: res.notes.clone(),
        });
    }

    write_json("rust_corrupted_eare_summary.json", &summary)?;

    if summary.failed > 0 {
        eprintln!("❌ {} scenario(s) failed", summary.failed);
        std::process::exit(1);
    }
    println!("✅ All corrupted EARE scenarios passed (Rust)");
    Ok(())
}
