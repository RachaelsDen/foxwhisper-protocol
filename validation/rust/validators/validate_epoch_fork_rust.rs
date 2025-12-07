use serde::{Deserialize, Serialize};
use serde_json;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::env;
use std::fs;

mod util;

#[derive(Debug, Deserialize, Clone, Default)]
struct GroupContext {
    #[serde(default)]
    group_id: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct EpochNode {
    node_id: String,
    epoch_id: i32,
    eare_hash: String,
    #[serde(default)]
    previous_epoch_hash: Option<String>,
    #[serde(default)]
    membership_digest: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    issued_by: String,
    timestamp_ms: i64,
}

#[derive(Debug, Deserialize)]
struct EpochEdge {
    from: String,
    to: String,
    #[serde(default = "default_edge_type")]
    edge_type: String,
}

fn default_edge_type() -> String {
    "linear".to_string()
}

#[derive(Debug, Deserialize, Clone)]
struct Event {
    t: i64,
    event: String,
    #[serde(default)]
    controller: Option<String>,
    #[serde(default)]
    epoch_id: Option<i32>,
    #[serde(default)]
    node_id: Option<String>,
    #[serde(default)]
    participants: Option<Vec<String>>,
    #[serde(default)]
    reconcile_strategy: Option<String>,
    #[serde(default)]
    count: Option<i32>,
    #[serde(default)]
    faults: Vec<String>,
    #[serde(skip)]
    idx: usize,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct AllowReplayGap {
    #[serde(default)]
    max_messages: i32,
    #[serde(default)]
    max_ms: i32,
}

#[derive(Debug, Deserialize, Clone, Default)]
struct ReconciledEpoch {
    #[serde(default)]
    epoch_id: Option<i32>,
    #[serde(default)]
    node_id: Option<String>,
    #[serde(default)]
    eare_hash: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct Expectations {
    #[serde(default)]
    detected: bool,
    #[serde(default = "default_detection_reference")]
    detection_reference: String,
    #[serde(default)]
    max_detection_ms: i64,
    #[serde(default)]
    max_reconciliation_ms: i64,
    #[serde(default)]
    reconciled_epoch: ReconciledEpoch,
    #[serde(default)]
    allow_replay_gap: AllowReplayGap,
    #[serde(default)]
    expected_error_categories: Vec<String>,
    #[serde(default)]
    healing_required: bool,
}

fn default_detection_reference() -> String {
    "fork_created".to_string()
}

#[derive(Debug, Deserialize)]
struct Graph {
    nodes: Vec<EpochNode>,
    #[serde(default)]
    edges: Vec<EpochEdge>,
}

#[derive(Debug, Deserialize)]
struct Scenario {
    scenario_id: String,
    #[serde(default)]
    group_context: Option<GroupContext>,
    graph: Graph,
    event_stream: Vec<Event>,
    expectations: Expectations,
}

#[derive(Debug, Serialize)]
struct Envelope {
    scenario_id: String,
    language: String,
    status: String,
    detection: bool,
    detection_ms: Option<i64>,
    reconciliation_ms: Option<i64>,
    winning_epoch_id: Option<i32>,
    winning_hash: Option<String>,
    winning_node_id: Option<String>,
    messages_dropped: i32,
    healing_actions: Vec<String>,
    errors: Vec<String>,
    false_positives: HashMap<String, i32>,
    notes: Vec<String>,
    failures: Vec<String>,
}

fn depth(node_id: &str, nodes: &HashMap<String, EpochNode>) -> i32 {
    let mut d = 0;
    let mut current = nodes.get(node_id);
    let mut seen = std::collections::HashSet::new();
    while let Some(node) = current {
        if let Some(parent_id) = &node.parent_id {
            if seen.contains(&node.node_id) {
                break;
            }
            seen.insert(node.node_id.clone());
            d += 1;
            current = nodes.get(parent_id);
        } else {
            break;
        }
    }
    d
}

fn fault_delay_ms(faults: &[String]) -> i64 {
    for f in faults {
        if let Some(rest) = f.strip_prefix("delay_validation:") {
            if let Ok(ms) = rest.parse::<i64>() {
                return ms;
            }
        }
    }
    0
}

fn simulate(s: &Scenario) -> Envelope {
    let mut nodes = HashMap::new();
    for n in &s.graph.nodes {
        nodes.insert(n.node_id.clone(), n.clone());
    }

    let mut events: Vec<Event> = s
        .event_stream
        .iter()
        .cloned()
        .enumerate()
        .map(|(idx, mut e)| {
            e.idx = idx;
            e
        })
        .collect();
    events.sort_by(|a, b| match a.t.cmp(&b.t) {
        Ordering::Equal => a.idx.cmp(&b.idx),
        other => other,
    });

    let mut observed: HashMap<i32, Vec<(String, String)>> = HashMap::new();
    let mut children: HashMap<String, Vec<(i32, String, String)>> = HashMap::new();
    let mut detection = false;
    let mut detection_time: Option<i64> = None;
    let mut fork_created: Option<i64> = None;
    let mut errors = Vec::new();
    let mut messages_dropped: i32 = 0;

    for ev in &events {
        if ev.event == "epoch_issue" {
            let node_id = ev.node_id.as_ref().expect("node_id required");
            let node = nodes
                .get(node_id)
                .unwrap_or_else(|| panic!("Unknown node_id {}", node_id));

            let epoch_entries = observed.entry(node.epoch_id).or_default();
            let hash_set: std::collections::HashSet<_> =
                epoch_entries.iter().map(|(_, h)| h.clone()).collect();

            let parent_key = node.parent_id.clone().unwrap_or_else(|| "".to_string());
            let parent_children = children.entry(parent_key.clone()).or_default();

            let mut fork_detected = false;
            if !hash_set.contains(&node.eare_hash) && epoch_entries.len() >= 1 {
                fork_detected = true;
            }
            if parent_children.len() >= 1 {
                let diff = !parent_children
                    .iter()
                    .any(|(e, _, h)| *e == node.epoch_id && h == &node.eare_hash);
                if diff {
                    fork_detected = true;
                }
            }

            epoch_entries.push((node.node_id.clone(), node.eare_hash.clone()));
            parent_children.push((node.epoch_id, node.node_id.clone(), node.eare_hash.clone()));

            if fork_detected {
                if fork_created.is_none() {
                    fork_created = Some(ev.t);
                }
                if detection_time.is_none() {
                    detection_time = Some(ev.t + fault_delay_ms(&ev.faults));
                    detection = true;
                    if !errors.contains(&"EPOCH_FORK_DETECTED".to_string()) {
                        errors.push("EPOCH_FORK_DETECTED".to_string());
                    }
                }
            }

            if let (Some(prev), Some(parent_id)) = (&node.previous_epoch_hash, &node.parent_id) {
                if let Some(parent) = nodes.get(parent_id) {
                    if parent.eare_hash != *prev {
                        if !errors.contains(&"HASH_CHAIN_BREAK".to_string()) {
                            errors.push("HASH_CHAIN_BREAK".to_string());
                        }
                    }
                }
            }
        } else if ev.event == "replay_attempt" {
            if let Some(c) = ev.count {
                messages_dropped += c;
            }
        }
    }

    let mut all_entries: Vec<(String, String)> = observed.values().flatten().cloned().collect();
    all_entries.sort_by(|a, b| {
        let na = nodes.get(&a.0).unwrap();
        let nb = nodes.get(&b.0).unwrap();
        let da = depth(&na.node_id, &nodes);
        let db = depth(&nb.node_id, &nodes);
        if da != db {
            return db.cmp(&da);
        }
        if na.epoch_id != nb.epoch_id {
            return nb.epoch_id.cmp(&na.epoch_id);
        }
        if na.timestamp_ms != nb.timestamp_ms {
            return na.timestamp_ms.cmp(&nb.timestamp_ms);
        }
        nb.eare_hash.cmp(&na.eare_hash)
    });

    let mut winning_node_id: Option<String> = None;
    let mut winning_hash: Option<String> = None;
    let mut winning_epoch_id: Option<i32> = None;
    if let Some((nid, h)) = all_entries.first() {
        winning_node_id = Some(nid.clone());
        winning_hash = Some(h.clone());
        if let Some(n) = nodes.get(nid) {
            winning_epoch_id = Some(n.epoch_id);
        }
    }

    let detection_reference = if s.expectations.detection_reference == "fork_observable" {
        detection_time
    } else {
        fork_created.or(detection_time)
    };

    let detection_ms = match (detection_time, detection_reference) {
        (Some(dt), Some(dr)) => Some(std::cmp::max(0, dt - dr)),
        _ => None,
    };

    let mut reconciliation_ms: Option<i64> = None;
    if let Some(dt) = detection_time {
        if let Some(merge) = events.iter().find(|e| e.event == "merge") {
            reconciliation_ms = Some(std::cmp::max(0, merge.t - dt));
        }
    }

    let mut false_pos = HashMap::new();
    false_pos.insert("warnings".to_string(), 0);
    false_pos.insert("hard_errors".to_string(), 0);

    Envelope {
        scenario_id: s.scenario_id.clone(),
        language: "rust".to_string(),
        status: "pass".to_string(),
        detection,
        detection_ms,
        reconciliation_ms,
        winning_epoch_id,
        winning_hash,
        winning_node_id,
        messages_dropped,
        healing_actions: Vec::new(),
        errors,
        false_positives: false_pos,
        notes: Vec::new(),
        failures: Vec::new(),
    }
}

fn evaluate(s: &Scenario, env: &mut Envelope) {
    let mut failures = Vec::new();
    let exp = &s.expectations;
    if env.detection != exp.detected {
        failures.push("detection_mismatch".to_string());
    }
    if exp.detected {
        if env.detection_ms.is_none() {
            failures.push("missing_detection_ms".to_string());
        } else if exp.max_detection_ms > 0 {
            if let Some(dm) = env.detection_ms {
                if dm > exp.max_detection_ms {
                    failures.push("detection_sla".to_string());
                }
            }
        }
    }

    if let (Some(exp_hash), Some(win_hash)) = (&exp.reconciled_epoch.eare_hash, &env.winning_hash) {
        if exp_hash != win_hash {
            failures.push("winning_hash_mismatch".to_string());
        }
    }
    if let (Some(exp_epoch), Some(win_epoch)) =
        (exp.reconciled_epoch.epoch_id, env.winning_epoch_id)
    {
        if exp_epoch != win_epoch {
            failures.push("winning_epoch_mismatch".to_string());
        }
    }

    if exp.healing_required {
        if env.reconciliation_ms.is_none() {
            failures.push("missing_reconciliation".to_string());
        } else if exp.max_reconciliation_ms > 0 {
            if let Some(rm) = env.reconciliation_ms {
                if rm > exp.max_reconciliation_ms {
                    failures.push("reconciliation_sla".to_string());
                }
            }
        }
    }

    if exp.allow_replay_gap.max_messages > 0
        && env.messages_dropped > exp.allow_replay_gap.max_messages
    {
        failures.push("replay_gap_messages".to_string());
    }

    let missing_errors: Vec<&String> = exp
        .expected_error_categories
        .iter()
        .filter(|e| !env.errors.contains(e))
        .collect();
    if !missing_errors.is_empty() {
        failures.push("missing_error_categories".to_string());
    }

    if !failures.is_empty() {
        env.status = "fail".to_string();
        env.failures = failures;
    }
}

fn parse_args() -> (String, Option<String>) {
    let mut corpus = "tests/common/adversarial/epoch_forks.json".to_string();
    let mut scenario: Option<String> = None;
    let args: Vec<String> = env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--corpus" => {
                if i + 1 < args.len() {
                    corpus = args[i + 1].clone();
                    i += 1;
                }
            }
            "--scenario" => {
                if i + 1 < args.len() {
                    scenario = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    (corpus, scenario)
}

fn load_corpus(path: &str) -> Vec<Scenario> {
    let resolved = if std::path::Path::new(path).is_absolute() {
        path.to_string()
    } else {
        util::root_path(path).to_string_lossy().to_string()
    };
    let data = fs::read_to_string(resolved).expect("Failed to read corpus");
    serde_json::from_str(&data).expect("Failed to parse corpus")
}

fn main() {
    let (corpus_path, scenario_id) = parse_args();
    let scenarios = load_corpus(&corpus_path);
    let selected: Vec<Scenario> = if let Some(id) = scenario_id {
        scenarios
            .into_iter()
            .filter(|s| s.scenario_id == id)
            .collect()
    } else {
        scenarios
    };

    if selected.is_empty() {
        eprintln!("No matching scenarios");
        std::process::exit(1);
    }

    for mut scenario in selected {
        for (idx, ev) in scenario.event_stream.iter_mut().enumerate() {
            ev.idx = idx;
        }
        let mut env = simulate(&scenario);
        evaluate(&scenario, &mut env);
        println!("{}", serde_json::to_string(&env).unwrap());
    }
}
