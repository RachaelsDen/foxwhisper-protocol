use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::error::Error;

mod util;
use util::{load_json, write_json};

#[derive(Debug, Deserialize)]
struct Device {
    device_id: String,
    dr_version: i32,
    #[serde(default)]
    clock_ms: i32,
    state_hash: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct Event {
    t: i32,
    event: String,
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<Vec<String>>,
    #[serde(default)]
    msg_id: Option<String>,
    #[serde(default)]
    device: Option<String>,
    #[serde(default)]
    apply_dr_version: Option<i32>,
    #[serde(default)]
    state_hash: Option<String>,
    #[serde(default)]
    dr_version: Option<i32>,
    #[serde(default)]
    targets: Option<Vec<String>>,
    #[serde(default)]
    delta_ms: Option<i32>,
    #[serde(default)]
    target_dr_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct Expectations {
    detected: bool,
    max_detection_ms: i32,
    max_recovery_ms: i32,
    healing_required: bool,
    residual_divergence_allowed: bool,
    max_dr_version_delta: i32,
    max_clock_skew_ms: i32,
    allow_message_loss_rate: f64,
    allow_out_of_order_rate: f64,
    expected_error_categories: Vec<String>,
    max_rollback_events: i32,
}

#[derive(Debug, Deserialize)]
struct Scenario {
    scenario_id: String,
    #[serde(default)]
    tags: Vec<String>,
    devices: Vec<Device>,
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

#[derive(Clone)]
struct DeviceState {
    dr_version: i32,
    clock_ms: i32,
    state_hash: Option<String>,
}

struct Message {
    sender: String,
    targets: Vec<String>,
    dr_version: i32,
    state_hash: Option<String>,
    send_time: i32,
    delivered: HashSet<String>,
    dropped: HashSet<String>,
    replay_count: i32,
}

struct SimulationResult {
    detection: bool,
    detection_ms: Option<i32>,
    recovery_ms: Option<i32>,
    errors: Vec<String>,
    notes: Vec<String>,
    metrics: serde_json::Value,
}

fn contains(list: &[String], item: &str) -> bool {
    list.iter().any(|v| v == item)
}

fn current_dr_stats(devices: &HashMap<String, DeviceState>) -> (i32, i32, i32) {
    let mut iter = devices.values();
    let first = iter.next();
    if first.is_none() {
        return (0, 0, 0);
    }
    let mut min = first.unwrap().dr_version;
    let mut max = min;
    for d in iter {
        if d.dr_version < min {
            min = d.dr_version;
        }
        if d.dr_version > max {
            max = d.dr_version;
        }
    }
    (min, max, max - min)
}

fn clock_range(devices: &HashMap<String, DeviceState>) -> i32 {
    let mut iter = devices.values();
    let first = iter.next();
    if first.is_none() {
        return 0;
    }
    let mut min = first.unwrap().clock_ms;
    let mut max = min;
    for d in iter {
        if d.clock_ms < min {
            min = d.clock_ms;
        }
        if d.clock_ms > max {
            max = d.clock_ms;
        }
    }
    max - min
}

fn simulate(s: &Scenario) -> Result<SimulationResult, Box<dyn Error>> {
    let mut devices: HashMap<String, DeviceState> = s
        .devices
        .iter()
        .map(|d| {
            (
                d.device_id.clone(),
                DeviceState {
                    dr_version: d.dr_version,
                    clock_ms: d.clock_ms,
                    state_hash: d.state_hash.clone(),
                },
            )
        })
        .collect();

    let mut messages: HashMap<String, Message> = HashMap::new();

    let mut detection_time: Option<i32> = None;
    let mut divergence_start: Option<i32> = None;
    let mut recovery_time: Option<i32> = None;

    let mut delivered: i32 = 0;
    let mut expected: i32 = 0;
    let mut out_of_order: i32 = 0;
    let mut dr_integral = 0;
    let mut dr_samples = 0;
    let mut max_dr_delta = 0;
    let mut max_diverged_count = 0;
    let mut max_clock_skew = 0;
    let mut skew_violations = 0;
    let mut recovery_attempts = 0;
    let mut successful_recoveries = 0;
    let mut failed_recoveries = 0;
    let mut max_rollback = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    let mut events = s.timeline.clone();
    events.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.event.cmp(&b.event)));

    let mut add_error = |errors: &mut Vec<String>,
                         detection_time: &mut Option<i32>,
                         code: &str,
                         at: Option<i32>| {
        if !contains(errors, code) {
            errors.push(code.to_string());
        }
        if detection_time.is_none() {
            if let Some(t) = at {
                *detection_time = Some(t);
            }
        }
    };

    for ev in events.iter() {
        for dev in devices.values_mut() {
            if ev.t > dev.clock_ms {
                dev.clock_ms = ev.t;
            }
        }

        match ev.event.as_str() {
            "send" => {
                let msg_id = ev.msg_id.as_ref().ok_or("send missing msg_id")?;
                let sender = ev.from.as_ref().ok_or("send missing from")?;
                let targets = ev.to.clone().unwrap_or_default();
                let dr_version = ev.dr_version.unwrap_or_else(|| devices[sender].dr_version);
                let state_hash = ev.state_hash.clone();
                if !messages.contains_key(msg_id) {
                    messages.insert(
                        msg_id.clone(),
                        Message {
                            sender: sender.clone(),
                            targets: targets.clone(),
                            dr_version,
                            state_hash: state_hash.clone(),
                            send_time: ev.t,
                            delivered: HashSet::new(),
                            dropped: HashSet::new(),
                            replay_count: 0,
                        },
                    );
                } else if let Some(msg) = messages.get_mut(msg_id) {
                    msg.replay_count += 1;
                }
                expected += targets.len() as i32;
                if let Some(sender_state) = devices.get_mut(sender) {
                    if dr_version < sender_state.dr_version {
                        let rollback = sender_state.dr_version - dr_version;
                        if rollback > max_rollback {
                            max_rollback = rollback;
                        }
                    }
                    sender_state.dr_version = dr_version;
                    if let Some(hash) = state_hash {
                        sender_state.state_hash = Some(hash);
                    }
                }
            }
            "recv" => {
                let msg_id = ev.msg_id.as_ref().ok_or("recv missing msg_id")?;
                let device = ev.device.as_ref().ok_or("recv missing device")?;
                if !messages.contains_key(msg_id) || !devices.contains_key(device) {
                    add_error(
                        &mut errors,
                        &mut detection_time,
                        "UNKNOWN_MESSAGE",
                        Some(ev.t),
                    );
                }
                if let (Some(envelope), Some(dev)) =
                    (messages.get_mut(msg_id), devices.get_mut(device))
                {
                    if envelope.delivered.contains(device) {
                        add_error(&mut errors, &mut detection_time, "DUPLICATE_DELIVERY", None);
                    }
                    if ev.t < envelope.send_time {
                        out_of_order += 1;
                    }
                    envelope.delivered.insert(device.clone());
                    delivered += 1;
                    if let Some(apply_ver) = ev.apply_dr_version {
                        if apply_ver < dev.dr_version {
                            let rollback = dev.dr_version - apply_ver;
                            if rollback > max_rollback {
                                max_rollback = rollback;
                            }
                        }
                        dev.dr_version = apply_ver;
                    }
                    if let Some(hash) = ev.state_hash.clone() {
                        dev.state_hash = Some(hash);
                    }
                }
            }
            "drop" => {
                let msg_id = ev.msg_id.as_ref().ok_or("drop missing msg_id")?;
                if !messages.contains_key(msg_id) {
                    add_error(
                        &mut errors,
                        &mut detection_time,
                        "UNKNOWN_MESSAGE",
                        Some(ev.t),
                    );
                } else if let Some(env) = messages.get_mut(msg_id) {
                    let target_list = ev.targets.clone().unwrap_or_else(|| env.targets.clone());
                    for t in target_list.iter() {
                        env.dropped.insert(t.clone());
                    }
                }
            }
            "replay" => {
                let msg_id = ev.msg_id.as_ref().ok_or("replay missing msg_id")?;
                let sender = ev.from.as_ref().ok_or("replay missing from")?;
                let targets = ev.to.clone().unwrap_or_default();
                if !devices.contains_key(sender) {
                    return Err(
                        format!("[{}] replay unknown device {}", s.scenario_id, sender).into(),
                    );
                }
                let dr_version = ev.dr_version.unwrap_or_else(|| devices[sender].dr_version);
                if !messages.contains_key(msg_id) {
                    messages.insert(
                        msg_id.clone(),
                        Message {
                            sender: sender.clone(),
                            targets: targets.clone(),
                            dr_version,
                            state_hash: None,
                            send_time: ev.t,
                            delivered: HashSet::new(),
                            dropped: HashSet::new(),
                            replay_count: 1,
                        },
                    );
                } else if let Some(msg) = messages.get_mut(msg_id) {
                    msg.replay_count += 1;
                }
                expected += targets.len() as i32;
                add_error(
                    &mut errors,
                    &mut detection_time,
                    "REPLAY_INJECTED",
                    Some(ev.t),
                );
            }
            "backup_restore" => {
                let device = ev.device.as_ref().ok_or("backup_restore missing device")?;
                let dr_version = ev.dr_version.ok_or("backup_restore missing dr_version")?;
                let dev = devices
                    .get_mut(device)
                    .ok_or_else(|| format!("unknown device {device}"))?;
                if dr_version < dev.dr_version {
                    let rollback = dev.dr_version - dr_version;
                    if rollback > max_rollback {
                        max_rollback = rollback;
                    }
                    add_error(
                        &mut errors,
                        &mut detection_time,
                        "ROLLBACK_APPLIED",
                        Some(ev.t),
                    );
                }
                dev.dr_version = dr_version;
                if let Some(hash) = ev.state_hash.clone() {
                    dev.state_hash = Some(hash);
                }
            }
            "clock_skew" => {
                let device = ev.device.as_ref().ok_or("clock_skew missing device")?;
                let delta = ev.delta_ms.ok_or("clock_skew missing delta")?;
                let dev = devices
                    .get_mut(device)
                    .ok_or_else(|| format!("unknown device {device}"))?;
                dev.clock_ms += delta;
                let cr = clock_range(&devices);
                if cr > max_clock_skew {
                    max_clock_skew = cr;
                }
                if max_clock_skew > s.expectations.max_clock_skew_ms {
                    skew_violations += 1;
                    add_error(
                        &mut errors,
                        &mut detection_time,
                        "CLOCK_SKEW_VIOLATION",
                        Some(ev.t),
                    );
                }
            }
            "resync" => {
                let device = ev.device.as_ref().ok_or("resync missing device")?;
                let target_version = ev.target_dr_version.ok_or("resync missing target")?;
                let before_delta = {
                    let (_, _, d) = current_dr_stats(&devices);
                    d
                };
                {
                    let dev = devices
                        .get_mut(device)
                        .ok_or_else(|| format!("unknown device {device}"))?;
                    recovery_attempts += 1;
                    if target_version < dev.dr_version {
                        let rollback = dev.dr_version - target_version;
                        if rollback > max_rollback {
                            max_rollback = rollback;
                        }
                    }
                    dev.dr_version = target_version;
                    if let Some(hash) = ev.state_hash.clone() {
                        dev.state_hash = Some(hash);
                    }
                }
                let after_delta = {
                    let (_, _, d) = current_dr_stats(&devices);
                    d
                };
                if after_delta == 0 {
                    successful_recoveries += 1;
                } else if after_delta < before_delta {
                    notes.push(format!("resync on {} reduced divergence", device));
                } else {
                    failed_recoveries += 1;
                }
            }
            _ => return Err(format!("unsupported event {}", ev.event).into()),
        }

        let (min_ver, _, dr_delta) = current_dr_stats(&devices);
        dr_integral += dr_delta;
        dr_samples += 1;
        if dr_delta > max_dr_delta {
            max_dr_delta = dr_delta;
        }

        let divergence_active = dr_delta > 0;
        if divergence_active && divergence_start.is_none() {
            divergence_start = Some(ev.t);
            if detection_time.is_none() {
                detection_time = Some(ev.t);
            }
        }
        if divergence_active && !contains(&errors, "DIVERGENCE_DETECTED") {
            errors.push("DIVERGENCE_DETECTED".into());
        }
        if !divergence_active && divergence_start.is_some() && recovery_time.is_none() {
            recovery_time = Some(ev.t);
        }

        let diverged = devices.values().filter(|d| d.dr_version != min_ver).count();
        if diverged as i32 > max_diverged_count {
            max_diverged_count = diverged as i32;
        }
        let cr = clock_range(&devices);
        if cr > max_clock_skew {
            max_clock_skew = cr;
        }
    }

    if divergence_start.is_none() && !errors.is_empty() {
        let t = events.first().map(|e| e.t).unwrap_or(0);
        divergence_start = Some(t);
        if detection_time.is_none() {
            detection_time = Some(t);
        }
    }

    let (_, _, end_delta) = current_dr_stats(&devices);
    let residual_divergence = end_delta > 0;

    let detection_ms = detection_time.and_then(|dt| divergence_start.map(|ds| (dt - ds).max(0)));
    let recovery_ms = recovery_time.and_then(|rt| detection_time.map(|dt| (rt - dt).max(0)));

    let delivered_count: i32 = messages.values().map(|m| m.delivered.len() as i32).sum();
    delivered = delivered_count;

    let message_loss_rate = if expected > 0 {
        ((expected - delivered) as f64 / expected as f64).max(0.0)
    } else {
        0.0
    };
    let out_of_order_rate = if delivered > 0 {
        out_of_order as f64 / delivered as f64
    } else {
        0.0
    };
    let avg_dr = if dr_samples > 0 {
        dr_integral as f64 / dr_samples as f64
    } else {
        0.0
    };

    if message_loss_rate > 0.0 {
        add_error(&mut errors, &mut detection_time, "MESSAGE_LOSS", None);
    }
    if out_of_order > 0 {
        add_error(&mut errors, &mut detection_time, "OUT_OF_ORDER", None);
    }

    let (min_for_metrics, _, _) = current_dr_stats(&devices);
    let diverged_count = devices
        .values()
        .filter(|d| d.dr_version != min_for_metrics)
        .count() as i32;

    let metrics = serde_json::json!({
        "max_dr_version_delta": max_dr_delta,
        "avg_dr_version_delta": avg_dr,
        "max_clock_skew_ms": max_clock_skew,
        "diverged_device_count": diverged_count,
        "max_diverged_device_count": max_diverged_count,
        "delivered_messages": delivered,
        "expected_messages": expected,
        "message_loss_rate": message_loss_rate,
        "out_of_order_deliveries": out_of_order,
        "out_of_order_rate": out_of_order_rate,
        "skew_violations": skew_violations,
        "recovery_attempts": recovery_attempts,
        "successful_recoveries": successful_recoveries,
        "failed_recoveries": failed_recoveries,
        "max_rollback_events": max_rollback,
        "residual_divergence": residual_divergence,
    });

    Ok(SimulationResult {
        detection: divergence_start.is_some() || !errors.is_empty(),
        detection_ms,
        recovery_ms,
        errors,
        notes,
        metrics,
    })
}

fn eval_expectations(exp: &Expectations, res: &SimulationResult) -> (String, Vec<String>) {
    let mut failures = Vec::new();
    if res.detection != exp.detected {
        failures.push("detection_mismatch".into());
    }
    if exp.detected {
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

    if exp.healing_required {
        match res.recovery_ms {
            None => failures.push("missing_recovery_ms".into()),
            Some(ms) => {
                if exp.max_recovery_ms > 0 && ms > exp.max_recovery_ms {
                    failures.push("recovery_sla".into());
                }
            }
        }
        if !exp.residual_divergence_allowed {
            if res.metrics["residual_divergence"]
                .as_bool()
                .unwrap_or(false)
            {
                failures.push("residual_divergence".into());
            }
        }
    }

    if res.metrics["max_dr_version_delta"].as_i64().unwrap_or(0) as i32 > exp.max_dr_version_delta {
        failures.push("dr_delta_exceeded".into());
    }
    if res.metrics["max_clock_skew_ms"].as_i64().unwrap_or(0) as i32 > exp.max_clock_skew_ms {
        failures.push("clock_skew_exceeded".into());
    }
    if res.metrics["message_loss_rate"].as_f64().unwrap_or(0.0) > exp.allow_message_loss_rate {
        failures.push("message_loss_rate".into());
    }
    if res.metrics["out_of_order_rate"].as_f64().unwrap_or(0.0) > exp.allow_out_of_order_rate {
        failures.push("out_of_order_rate".into());
    }
    if res.metrics["max_rollback_events"].as_i64().unwrap_or(0) as i32 > exp.max_rollback_events {
        failures.push("rollback_exceeded".into());
    }

    let missing: Vec<String> = exp
        .expected_error_categories
        .iter()
        .filter(|code| !res.errors.iter().any(|e| e == *code))
        .cloned()
        .collect();
    if !missing.is_empty() {
        failures.push("missing_error_categories".into());
    }

    if failures.is_empty() {
        ("pass".into(), failures)
    } else {
        ("fail".into(), failures)
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let corpus_path = "tests/common/adversarial/device_desync.json";
    let scenarios: Vec<Scenario> = load_json(corpus_path)?;
    let mut summary = Summary {
        corpus: corpus_path.into(),
        total: scenarios.len(),
        failed: 0,
        passed: 0,
        scenarios: Vec::new(),
    };

    for scenario in scenarios.iter() {
        match simulate(scenario) {
            Ok(res) => {
                let (status, failures) = eval_expectations(&scenario.expectations, &res);
                if status == "pass" {
                    summary.passed += 1;
                } else {
                    summary.failed += 1;
                }
                summary.scenarios.push(ScenarioSummary {
                    scenario_id: scenario.scenario_id.clone(),
                    status,
                    failures,
                    errors: res.errors,
                    metrics: res.metrics,
                    notes: res.notes,
                });
            }
            Err(e) => {
                summary.failed += 1;
                summary.scenarios.push(ScenarioSummary {
                    scenario_id: scenario.scenario_id.clone(),
                    status: "fail".into(),
                    failures: vec![e.to_string()],
                    errors: vec![e.to_string()],
                    metrics: serde_json::json!({}),
                    notes: vec![],
                });
            }
        }
    }

    write_json("rust_device_desync_summary.json", &summary)?;

    if summary.failed > 0 {
        eprintln!("❌ {} scenario(s) failed", summary.failed);
        std::process::exit(1);
    }
    println!("✅ All device desync scenarios passed (Rust)");
    Ok(())
}
