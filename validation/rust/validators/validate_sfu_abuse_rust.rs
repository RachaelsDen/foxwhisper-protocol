use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::error::Error;

mod util;
use util::{load_json, write_json};

#[derive(Debug, Deserialize)]
struct SFUContext {
    sfu_id: String,
    room_id: String,
    expected_participants: Vec<String>,
    auth_mode: String,
}

#[derive(Debug, Deserialize, Clone)]
struct Track {
    id: String,
    kind: String,
    #[serde(default)]
    layers: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct Participant {
    id: String,
    role: String,
    #[serde(default)]
    authz_tokens: Vec<String>,
    #[serde(default)]
    tracks: Vec<Track>,
}

#[derive(Debug, Deserialize, Clone)]
struct Event {
    t: i32,
    event: String,
    #[serde(default)]
    participant: Option<String>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    track_id: Option<String>,
    #[serde(default)]
    layers: Option<Vec<String>>,
    #[serde(default)]
    requested_layers: Option<Vec<String>>,
    #[serde(default)]
    reported_bitrate: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct Expectations {
    should_detect: bool,
    expected_errors: Vec<String>,
    max_detection_ms: i32,
    allow_partial_accept: bool,
    residual_routing_allowed: bool,
    max_hijacked_tracks: i32,
    max_unauthorized_tracks: i32,
    max_key_leak_attempts: i32,
    max_extra_latency_ms: i32,
    max_false_positive_blocks: i32,
    max_false_negative_leaks: i32,
}

#[derive(Debug, Deserialize)]
struct Scenario {
    scenario_id: String,
    #[serde(default)]
    tags: Vec<String>,
    sfu_context: SFUContext,
    participants: Vec<Participant>,
    timeline: Vec<Event>,
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

    let mut authed: HashSet<String> = HashSet::new();
    let mut routes: HashMap<String, String> = HashMap::new();
    let mut track_layers: HashMap<String, Vec<String>> = HashMap::new();
    let mut affected: HashSet<String> = HashSet::new();

    let mut key_leak_attempts = 0;
    let mut hijacked_tracks = 0;
    let mut unauthorized_tracks = 0;
    let mut replayed_tracks = 0;
    let mut duplicate_routes = 0;
    let mut simulcast_spoofs = 0;
    let mut bitrate_abuse_events = 0;
    let false_positive_blocks = 0;
    let false_negative_leaks = 0;

    let mut detection_time: Option<i32> = None;

    let mut events = s.timeline.clone();
    events.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.event.cmp(&b.event)));

    for ev in events.iter() {
        match ev.event.as_str() {
            "join" => {
                if let Some(pid) = &ev.participant {
                    if let Some(part) = s.participants.iter().find(|p| &p.id == pid) {
                        if let Some(tok) = &ev.token {
                            if part.authz_tokens.contains(tok) {
                                authed.insert(pid.clone());
                            } else {
                                push_err(&mut errors, "IMPERSONATION");
                            }
                        } else {
                            push_err(&mut errors, "IMPERSONATION");
                        }
                    } else {
                        push_err(&mut errors, "IMPERSONATION");
                    }
                }
            }
            "publish" => {
                if let (Some(pid), Some(track_id)) = (&ev.participant, &ev.track_id) {
                    if !authed.contains(pid) {
                        push_err(&mut errors, "UNAUTHORIZED_SUBSCRIBE");
                        unauthorized_tracks += 1;
                    } else {
                        routes.insert(track_id.clone(), pid.clone());
                        track_layers.insert(track_id.clone(), ev.layers.clone().unwrap_or_default());
                    }
                } else {
                    push_err(&mut errors, "UNAUTHORIZED_SUBSCRIBE");
                    unauthorized_tracks += 1;
                }
            }
            "subscribe" => {
                if let (Some(pid), Some(track_id)) = (&ev.participant, &ev.track_id) {
                    if !authed.contains(pid) || !routes.contains_key(track_id) {
                        push_err(&mut errors, "UNAUTHORIZED_SUBSCRIBE");
                        unauthorized_tracks += 1;
                    }
                } else {
                    push_err(&mut errors, "UNAUTHORIZED_SUBSCRIBE");
                    unauthorized_tracks += 1;
                }
            }
            "ghost_subscribe" => {
                if let Some(pid) = &ev.participant {
                    push_err(&mut errors, "UNAUTHORIZED_SUBSCRIBE");
                    unauthorized_tracks += 1;
                    affected.insert(pid.clone());
                }
            }
            "impersonate" => {
                if let Some(pid) = &ev.participant {
                    push_err(&mut errors, "IMPERSONATION");
                    affected.insert(pid.clone());
                }
            }
            "replay_track" => {
                if let Some(track_id) = &ev.track_id {
                    if routes.contains_key(track_id) {
                        push_err(&mut errors, "REPLAY_TRACK");
                        replayed_tracks += 1;
                    }
                }
            }
            "dup_track" => {
                if let Some(track_id) = &ev.track_id {
                    if routes.contains_key(track_id) {
                        push_err(&mut errors, "DUPLICATE_ROUTE");
                        duplicate_routes += 1;
                    }
                }
            }
            "simulcast_spoof" => {
                if let Some(track_id) = &ev.track_id {
                    let requested = ev.requested_layers.clone().unwrap_or_default();
                    let allowed = track_layers.get(track_id).cloned().unwrap_or_default();
                    if requested.iter().any(|r| !allowed.contains(r)) {
                        push_err(&mut errors, "SIMULCAST_SPOOF");
                        simulcast_spoofs += 1;
                    }
                }
            }
            "bitrate_abuse" => {
                push_err(&mut errors, "BITRATE_ABUSE");
                bitrate_abuse_events += 1;
            }
            "key_rotation_skip" | "stale_key_reuse" => {
                push_err(&mut errors, "STALE_KEY_REUSE");
                key_leak_attempts += 1;
            }
            "steal_key" => {
                push_err(&mut errors, "KEY_LEAK_ATTEMPT");
                key_leak_attempts += 1;
            }
            _ => {}
        }

        if !errors.is_empty() && detection_time.is_none() {
            detection_time = Some(ev.t);
        }
    }

    let detection = !errors.is_empty();
    let metrics = serde_json::json!({
        "unauthorized_tracks": unauthorized_tracks,
        "hijacked_tracks": hijacked_tracks,
        "impersonation_attempts": if errors.contains(&"IMPERSONATION".to_string()) {1} else {0},
        "key_leak_attempts": key_leak_attempts,
        "duplicate_routes": duplicate_routes,
        "replayed_tracks": replayed_tracks,
        "simulcast_spoofs": simulcast_spoofs,
        "bitrate_abuse_events": bitrate_abuse_events,
        "accepted_tracks": routes.len(),
        "rejected_tracks": unauthorized_tracks,
        "false_positive_blocks": false_positive_blocks,
        "false_negative_leaks": false_negative_leaks,
        "max_extra_latency_ms": detection_time.unwrap_or(0),
        "affected_participant_count": affected.len(),
    });

    SimulationResult {
        detection,
        detection_ms: detection_time,
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

    if res.metrics["hijacked_tracks"].as_i64().unwrap_or(0) as i32 > exp.max_hijacked_tracks {
        failures.push("hijacked_tracks_exceeded".into());
    }
    if res.metrics["unauthorized_tracks"].as_i64().unwrap_or(0) as i32 > exp.max_unauthorized_tracks {
        failures.push("unauthorized_tracks_exceeded".into());
    }
    if res.metrics["key_leak_attempts"].as_i64().unwrap_or(0) as i32 > exp.max_key_leak_attempts {
        failures.push("key_leak_exceeded".into());
    }
    if res.metrics["max_extra_latency_ms"].as_i64().unwrap_or(0) as i32 > exp.max_extra_latency_ms {
        failures.push("latency_exceeded".into());
    }
    if res.metrics["false_positive_blocks"].as_i64().unwrap_or(0) as i32 > exp.max_false_positive_blocks {
        failures.push("false_positive_blocks_exceeded".into());
    }
    if res.metrics["false_negative_leaks"].as_i64().unwrap_or(0) as i32 > exp.max_false_negative_leaks {
        failures.push("false_negative_leaks_exceeded".into());
    }

    if !exp.residual_routing_allowed {
        if res.metrics["duplicate_routes"].as_i64().unwrap_or(0) > 0 {
            failures.push("residual_routing".into());
        }
    }

    if failures.is_empty() {
        ("pass".into(), failures)
    } else {
        ("fail".into(), failures)
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let corpus_path = "tests/common/adversarial/sfu_abuse.json";
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

    write_json("rust_sfu_abuse_summary.json", &summary)?;

    if summary.failed > 0 {
        eprintln!("❌ {} scenario(s) failed", summary.failed);
        std::process::exit(1);
    }
    println!("✅ All SFU abuse scenarios passed (Rust)");
    Ok(())
}
