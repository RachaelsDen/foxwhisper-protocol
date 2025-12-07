package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type profile struct {
	ProfileID      string  `json:"profile_id"`
	BurstRate      float64 `json:"burst_rate"`
	DurationMS     float64 `json:"duration_ms"`
	ExpectedDrop   float64 `json:"expected_drop_ratio"`
	AlertThreshold float64 `json:"alert_threshold"`
	ExpectedAlert  bool    `json:"expected_alert"`
	Notes          string  `json:"notes"`
}

type corpus struct {
	Description   string    `json:"description"`
	WindowSize    float64   `json:"window_size"`
	CapacityPerMS float64   `json:"capacity_per_ms"`
	QueueLimit    float64   `json:"queue_limit"`
	Tolerance     float64   `json:"tolerance"`
	Profiles      []profile `json:"profiles"`
}

func main() {
	root, err := validatorsutil.RepoRoot()
	if err != nil {
		fmt.Printf("Failed to resolve repo root: %v\n", err)
		os.Exit(1)
	}
	corpusPath := filepath.Join(root, "tests/common/adversarial/replay_storm_profiles.json")
	data, err := os.ReadFile(corpusPath)
	if err != nil {
		fmt.Printf("Failed to read profiles: %v\n", err)
		os.Exit(1)
	}

	var payload corpus
	if err := json.Unmarshal(data, &payload); err != nil {
		fmt.Printf("Failed to parse profiles: %v\n", err)
		os.Exit(1)
	}

	simulator := newSimulator(payload.WindowSize, payload.CapacityPerMS, payload.QueueLimit)

	fmt.Println("FoxWhisper Go Replay Storm Simulator")
	fmt.Println("=====================================")

	summary := map[string]interface{}{
		"window_size":     payload.WindowSize,
		"capacity_per_ms": payload.CapacityPerMS,
		"queue_limit":     simulator.queueLimit,
		"tolerance":       payload.Tolerance,
		"profiles":        []map[string]interface{}{},
	}

	passed := 0
	for _, prof := range payload.Profiles {
		metrics := simulator.simulate(prof)
		dropDelta := math.Abs(metrics["drop_ratio"].(float64) - prof.ExpectedDrop)
		ok := dropDelta <= payload.Tolerance && metrics["alert_triggered"].(bool) == prof.ExpectedAlert
		entry := map[string]interface{}{
			"profile_id":          prof.ProfileID,
			"drop_ratio":          metrics["drop_ratio"],
			"expected_drop_ratio": prof.ExpectedDrop,
			"drop_ratio_delta":    dropDelta,
			"alert_triggered":     metrics["alert_triggered"],
			"expected_alert":      prof.ExpectedAlert,
			"max_queue_depth":     metrics["max_queue_depth"],
			"latency_penalty":     metrics["latency_penalty"],
			"notes":               prof.Notes,
			"status":              map[bool]string{true: "pass", false: "fail"}[ok],
		}
		summary["profiles"] = append(summary["profiles"].([]map[string]interface{}), entry)
		if ok {
			passed++
			fmt.Printf("✅ %s\n", prof.ProfileID)
		} else {
			fmt.Printf("❌ %s (Δ=%.2f)\n", prof.ProfileID, dropDelta)
		}
	}

	total := len(payload.Profiles)
	summary["passed"] = passed
	summary["failed"] = total - passed
	summary["status"] = map[bool]string{true: "success", false: "failed"}[passed == total]

	if err := saveReplayResults(summary); err != nil {
		fmt.Printf("Failed to save summary: %v\n", err)
		os.Exit(1)
	}

	if passed != total {
		os.Exit(1)
	}
}

type simulator struct {
	windowSize    float64
	capacityPerMS float64
	queueLimit    float64
}

func newSimulator(window, capacity, queue float64) *simulator {
	if queue <= 0 {
		queue = window * 8
	}
	return &simulator{windowSize: window, capacityPerMS: capacity, queueLimit: queue}
}

func (s *simulator) simulate(profile profile) map[string]interface{} {
	pending := 0.0
	processed := 0.0
	dropped := 0.0
	totalGenerated := 0.0
	maxQueue := 0.0
	latencyIntegral := 0.0

	steps := int(math.Max(profile.DurationMS, 0))
	for i := 0; i < steps; i++ {
		pending += profile.BurstRate
		totalGenerated += profile.BurstRate

		processedNow := math.Min(pending, s.capacityPerMS)
		pending -= processedNow
		processed += processedNow

		overflow := math.Max(0, pending-s.queueLimit)
		if overflow > 0 {
			pending -= overflow
			dropped += overflow
		}

		if pending > maxQueue {
			maxQueue = pending
		}
		latencyIntegral += pending
	}

	dropRatio := 0.0
	deliveryRatio := 0.0
	if totalGenerated > 0 {
		dropRatio = dropped / totalGenerated
		deliveryRatio = processed / totalGenerated
	}
	latencyPenalty := 0.0
	if profile.DurationMS > 0 {
		latencyPenalty = latencyIntegral / profile.DurationMS
	}
	alert := dropRatio >= profile.AlertThreshold
	return map[string]interface{}{
		"drop_ratio":      dropRatio,
		"delivery_ratio":  deliveryRatio,
		"max_queue_depth": maxQueue,
		"latency_penalty": latencyPenalty,
		"alert_triggered": alert,
	}
}

func saveReplayResults(summary map[string]interface{}) error {
	return validatorsutil.SaveJSON("go_replay_storm_summary.json", summary)
}
