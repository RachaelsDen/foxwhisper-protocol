mod util;

use serde::Deserialize;
use serde_json;
use std::error::Error;
use std::fs;

#[derive(Debug, Deserialize)]
struct Profile {
    profile_id: String,
    burst_rate: f64,
    duration_ms: f64,
    expected_drop_ratio: f64,
    alert_threshold: f64,
    expected_alert: bool,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProfileSet {
    description: String,
    window_size: f64,
    capacity_per_ms: f64,
    #[serde(default)]
    queue_limit: Option<f64>,
    #[serde(default = "default_tolerance")]
    tolerance: f64,
    profiles: Vec<Profile>,
}

fn default_tolerance() -> f64 {
    0.05
}

fn main() -> Result<(), Box<dyn Error>> {
    let set_path = util::root_path("tests/common/adversarial/replay_storm_profiles.json");
    let payload: ProfileSet = serde_json::from_str(&fs::read_to_string(set_path)?)?;

    println!("FoxWhisper Rust Replay Storm Simulator");
    println!("{}", "=".repeat(45));

    let simulator = Simulator::new(
        payload.window_size,
        payload.capacity_per_ms,
        payload.queue_limit,
    );
    let mut profile_results = Vec::new();
    let mut passed = 0;

    for profile in payload.profiles {
        let metrics = simulator.simulate(&profile);
        let drop_ratio = metrics.drop_ratio;
        let drop_delta = (drop_ratio - profile.expected_drop_ratio).abs();
        let alert_ok = metrics.alert_triggered == profile.expected_alert;
        let status = drop_delta <= payload.tolerance && alert_ok;
        if status {
            passed += 1;
            println!("✅ {}", profile.profile_id);
        } else {
            println!(
                "❌ {} (Δ={:.2}, alert expected={}, observed={})",
                profile.profile_id, drop_delta, profile.expected_alert, metrics.alert_triggered
            );
        }
        profile_results.push(serde_json::json!({
            "profile_id": profile.profile_id,
            "drop_ratio": drop_ratio,
            "expected_drop_ratio": profile.expected_drop_ratio,
            "drop_ratio_delta": drop_delta,
            "max_queue_depth": metrics.max_queue_depth,
            "latency_penalty": metrics.latency_penalty,
            "alert_triggered": metrics.alert_triggered,
            "expected_alert": profile.expected_alert,
            "status": if status { "pass" } else { "fail" },
        }));
    }

    let total = profile_results.len();
    let summary = serde_json::json!({
        "language": "rust",
        "test": "replay_storm",
        "window_size": payload.window_size,
        "capacity_per_ms": payload.capacity_per_ms,
        "queue_limit": simulator.queue_limit,
        "tolerance": payload.tolerance,
        "profiles": profile_results,
        "passed": passed,
        "failed": total - passed,
        "status": if passed == total { "success" } else { "failed" }
    });

    util::write_json("rust_replay_storm_summary.json", &summary)?;
    println!("📄 Results saved to results/rust_replay_storm_summary.json");

    if passed != total {
        std::process::exit(1);
    }

    Ok(())
}

struct Simulator {
    window_size: f64,
    capacity_per_ms: f64,
    queue_limit: f64,
}

impl Simulator {
    fn new(window: f64, capacity: f64, queue_limit: Option<f64>) -> Self {
        let limit = queue_limit.unwrap_or(window * 8.0);
        Self {
            window_size: window.max(1.0),
            capacity_per_ms: capacity.max(0.0),
            queue_limit: limit.max(1.0),
        }
    }

    fn simulate(&self, profile: &Profile) -> Metrics {
        let mut pending = 0.0;
        let mut processed = 0.0;
        let mut dropped = 0.0;
        let mut total = 0.0;
        let mut max_queue = 0.0;
        let mut latency_integral = 0.0;

        let steps = profile.duration_ms.max(0.0) as usize;
        for _ in 0..steps {
            pending += profile.burst_rate;
            total += profile.burst_rate;

            let processed_now = pending.min(self.capacity_per_ms);
            pending -= processed_now;
            processed += processed_now;

            let overflow = (pending - self.queue_limit).max(0.0);
            if overflow > 0.0 {
                pending -= overflow;
                dropped += overflow;
            }

            if pending > max_queue {
                max_queue = pending;
            }
            latency_integral += pending;
        }

        let drop_ratio = if total > 0.0 {
            (dropped / total).min(1.0)
        } else {
            0.0
        };
        let delivery_ratio = if total > 0.0 { processed / total } else { 0.0 };
        let latency_penalty = if profile.duration_ms > 0.0 {
            latency_integral / profile.duration_ms
        } else {
            latency_integral
        };
        let alert = drop_ratio >= profile.alert_threshold;

        Metrics {
            drop_ratio,
            delivery_ratio,
            max_queue_depth: max_queue,
            latency_penalty,
            alert_triggered: alert,
        }
    }
}

struct Metrics {
    drop_ratio: f64,
    delivery_ratio: f64,
    max_queue_depth: f64,
    latency_penalty: f64,
    alert_triggered: bool,
}
