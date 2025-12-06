package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

type ReplayVectors struct {
	ReplayAttackDetection struct {
		WindowSize int `json:"window_size"`
		TestCases  []struct {
			Case              string `json:"case"`
			SequenceNumbers   []int  `json:"sequence_numbers"`
			ExpectedDetection bool   `json:"expected_detection"`
			Notes             string `json:"notes"`
		} `json:"test_cases"`
	} `json:"replay_attack_detection"`
	ReplayWindowBoundaries struct {
		WindowSize int `json:"window_size"`
		TestCases  []struct {
			Case              string `json:"case"`
			SequenceNumbers   []int  `json:"sequence_numbers"`
			ExpectedDetection bool   `json:"expected_detection"`
			Notes             string `json:"notes"`
		} `json:"test_cases"`
	} `json:"replay_window_boundaries"`
	PoisoningInjection struct {
		AttackVectors []struct {
			AttackName      string                   `json:"attack_name"`
			MaliciousFields []map[string]interface{} `json:"malicious_fields"`
			ExpectedDefense string                   `json:"expected_defense"`
		} `json:"attack_vectors"`
	} `json:"poisoning_injection"`
	EpochForkDetection struct {
		Scenarios []struct {
			Scenario string `json:"scenario"`
			Timeline []struct {
				EpochID string  `json:"epoch_id"`
				Parent  *string `json:"parent"`
			} `json:"timeline"`
			ExpectedForkDetected bool `json:"expected_fork_detected"`
		} `json:"scenarios"`
	} `json:"epoch_fork_detection"`
	MalformedEare struct {
		Records []struct {
			RecordID      string                 `json:"record_id"`
			Fields        map[string]interface{} `json:"fields"`
			Required      []string               `json:"required_fields"`
			HashBytes     *int                   `json:"hash_bytes"`
			MinHashBytes  *int                   `json:"min_hash_bytes"`
			ExpectedValid bool                   `json:"expected_valid"`
		} `json:"records"`
	} `json:"malformed_eare"`
	AntiPoisoningRules struct {
		Rules []struct {
			RuleID          string                 `json:"rule_id"`
			Conditions      map[string]interface{} `json:"conditions"`
			SampleMessage   map[string]interface{} `json:"sample_message"`
			ExpectedEnforce bool                   `json:"expected_enforced"`
		} `json:"rules"`
	} `json:"anti_poisoning_rules"`
	ReplayStormSimulation struct {
		WindowSize    int     `json:"window_size"`
		CapacityPerMS float64 `json:"capacity_per_ms"`
		Profiles      []struct {
			ProfileID        string  `json:"profile_id"`
			BurstRate        float64 `json:"burst_rate"`
			DurationMS       float64 `json:"duration_ms"`
			ExpectedDropRate float64 `json:"expected_drop_ratio"`
		} `json:"profiles"`
	} `json:"replay_storm_simulation"`
}

type ScenarioResult struct {
	Scenario string   `json:"scenario"`
	Valid    bool     `json:"valid"`
	Details  []string `json:"details"`
}

type Validator struct {
	vectors ReplayVectors
	results []ScenarioResult
}

func (v *Validator) run() []ScenarioResult {
	v.validateReplayCases()
	v.validateReplayBoundaries()
	v.validatePoisoning()
	v.validateEpochForks()
	v.validateMalformedEARE()
	v.validateAntiPoisoning()
	v.validateReplayStorm()
	return v.results
}

func (v *Validator) record(name string, valid bool, details []string) {
	v.results = append(v.results, ScenarioResult{Scenario: name, Valid: valid, Details: details})
}

func (v *Validator) detectReplay(sequenceNumbers []int, window int) bool {
	seen := make([]int, 0, len(sequenceNumbers))
	detected := false
	for _, seq := range sequenceNumbers {
		cutoff := seq - window
		kept := seen[:0]
		for _, prev := range seen {
			if prev >= cutoff {
				kept = append(kept, prev)
			}
		}
		seen = kept
		for _, prev := range seen {
			if prev == seq {
				detected = true
				break
			}
		}
		seen = append(seen, seq)
	}
	return detected
}

func (v *Validator) validateReplayCases() {
	section := v.vectors.ReplayAttackDetection
	for _, test := range section.TestCases {
		detected := v.detectReplay(test.SequenceNumbers, section.WindowSize)
		details := []string{
			fmt.Sprintf("window=%d", section.WindowSize),
			fmt.Sprintf("detected=%t", detected),
			fmt.Sprintf("expected=%t", test.ExpectedDetection),
		}
		if test.Notes != "" {
			details = append(details, test.Notes)
		}
		v.record("replay_attack::"+test.Case, detected == test.ExpectedDetection, details)
	}
}

func (v *Validator) validateReplayBoundaries() {
	section := v.vectors.ReplayWindowBoundaries
	for _, test := range section.TestCases {
		detected := v.detectReplay(test.SequenceNumbers, section.WindowSize)
		details := []string{
			fmt.Sprintf("window=%d", section.WindowSize),
			fmt.Sprintf("detected=%t", detected),
			fmt.Sprintf("expected=%t", test.ExpectedDetection),
		}
		if test.Notes != "" {
			details = append(details, test.Notes)
		}
		v.record("replay_window::"+test.Case, detected == test.ExpectedDetection, details)
	}
}

func (v *Validator) validatePoisoning() {
	for _, attack := range v.vectors.PoisoningInjection.AttackVectors {
		violations := 0
		for _, field := range attack.MaliciousFields {
			for key, expected := range field {
				if len(key) > len("expected_") && key[:len("expected_")] == "expected_" {
					suffix := key[len("expected_"):]
					actualKey := "actual_" + suffix
					if actual, ok := field[actualKey]; ok && actual != expected {
						violations++
					}
				}
			}
		}
		details := []string{
			fmt.Sprintf("violations=%d", violations),
			fmt.Sprintf("expected_defense=%s", attack.ExpectedDefense),
		}
		v.record("poisoning::"+attack.AttackName, violations > 0, details)
	}
}

func (v *Validator) validateEpochForks() {
	for _, scenario := range v.vectors.EpochForkDetection.Scenarios {
		childMap := make(map[string]int)
		for _, entry := range scenario.Timeline {
			if entry.Parent == nil {
				continue
			}
			childMap[*entry.Parent]++
		}
		forkDetected := false
		for _, count := range childMap {
			if count > 1 {
				forkDetected = true
				break
			}
		}
		details := []string{
			fmt.Sprintf("fork_detected=%t", forkDetected),
			fmt.Sprintf("expected=%t", scenario.ExpectedForkDetected),
			fmt.Sprintf("timeline_length=%d", len(scenario.Timeline)),
		}
		v.record("epoch_fork::"+scenario.Scenario, forkDetected == scenario.ExpectedForkDetected, details)
	}
}

func (v *Validator) validateMalformedEARE() {
	for _, record := range v.vectors.MalformedEare.Records {
		missing := []string{}
		for _, field := range record.Required {
			if _, ok := record.Fields[field]; !ok {
				missing = append(missing, field)
			}
		}
		hashBytes := 0
		if record.HashBytes != nil {
			hashBytes = *record.HashBytes
		} else if value, ok := record.Fields["hash"].(string); ok {
			hashBytes = len(decodeHex(value))
		}
		minHash := 32
		if record.MinHashBytes != nil {
			minHash = *record.MinHashBytes
		}
		valid := len(missing) == 0 && hashBytes >= minHash
		details := []string{
			fmt.Sprintf("missing_fields=%v", missing),
			fmt.Sprintf("hash_bytes=%d", hashBytes),
			fmt.Sprintf("min_hash_bytes=%d", minHash),
			fmt.Sprintf("expected_valid=%t", record.ExpectedValid),
		}
		v.record("eare::"+record.RecordID, valid == record.ExpectedValid, details)
	}
}

func (v *Validator) validateAntiPoisoning() {
	for _, rule := range v.vectors.AntiPoisoningRules.Rules {
		conditions := rule.Conditions
		sample := rule.SampleMessage
		enforced := true

		if value, ok := conditions["max_drift"]; ok {
			drift := intFrom(sample["nonce_counter"]) - intFrom(sample["last_nonce_counter"])
			enforced = float64(drift) <= float64(num(value))
		} else if bind, ok := conditions["require_binding"].(bool); ok && bind {
			enforced = sample["sender_id"] == sample["aad_sender"]
		} else if allow, ok := conditions["allow_missing_aad"].(bool); ok && allow {
			_, has := sample["aad"]
			enforced = !has || sample["aad"] == nil
		}

		details := []string{
			fmt.Sprintf("enforced=%t", enforced),
			fmt.Sprintf("expected=%t", rule.ExpectedEnforce),
		}
		v.record("anti_poisoning::"+rule.RuleID, enforced == rule.ExpectedEnforce, details)
	}
}

func (v *Validator) validateReplayStorm() {
	section := v.vectors.ReplayStormSimulation
	const tolerance = 0.1
	for _, profile := range section.Profiles {
		total := profile.BurstRate * profile.DurationMS
		capacity := section.CapacityPerMS*profile.DurationMS + float64(section.WindowSize)
		drops := math.Max(0, total-capacity)
		dropRatio := 0.0
		if total > 0 {
			dropRatio = math.Min(1, drops/total)
		}
		valid := math.Abs(dropRatio-profile.ExpectedDropRate) <= tolerance
		details := []string{
			fmt.Sprintf("window=%d", section.WindowSize),
			fmt.Sprintf("drop_ratio=%.2f", dropRatio),
			fmt.Sprintf("expected_ratio=%.2f", profile.ExpectedDropRate),
			fmt.Sprintf("burst_rate=%.0f", profile.BurstRate),
			fmt.Sprintf("duration_ms=%.0f", profile.DurationMS),
		}
		v.record("replay_storm::"+profile.ProfileID, valid, details)
	}
}

func decodeHex(value string) []byte {
	data := []byte{}
	for i := 0; i+2 <= len(value); i += 2 {
		var b byte
		fmt.Sscanf(value[i:i+2], "%02X", &b)
		data = append(data, b)
	}
	return data
}

func num(value interface{}) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	default:
		return 0
	}
}

func intFrom(value interface{}) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	default:
		return 0
	}
}

func saveResults(results []ScenarioResult) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	outputDir := filepath.Join(cwd, "results")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}
	payload := map[string]interface{}{
		"language":       "go",
		"scenario_count": len(results),
		"success":        allValid(results),
		"results":        results,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	outputPath := filepath.Join(outputDir, "replay_poisoning_validation_results_go.json")
	if err := os.WriteFile(outputPath, data, 0o644); err != nil {
		return err
	}
	fmt.Printf("\n📄 Results saved to %s\n", outputPath)
	return nil
}

func allValid(results []ScenarioResult) bool {
	for _, result := range results {
		if !result.Valid {
			return false
		}
	}
	return true
}

func main() {
	if len(os.Args) != 2 {
		fmt.Println("Usage: go run ./validation/go/validators/replay_poisoning <test_vectors_file>")
		os.Exit(1)
	}

	fileData, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Printf("Failed to read test vectors: %v\n", err)
		os.Exit(1)
	}

	var vectors ReplayVectors
	if err := json.Unmarshal(fileData, &vectors); err != nil {
		fmt.Printf("Failed to parse test vectors: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("FoxWhisper Replay & Poisoning Validator (Go)")
	fmt.Println("=" + "=" + "=" + "=" + "=" + "=" + "=" + "=")

	validator := Validator{vectors: vectors}
	results := validator.run()

	passed := 0
	for _, result := range results {
		if result.Valid {
			passed++
			fmt.Printf("✅ %s\n", result.Scenario)
		} else {
			fmt.Printf("❌ %s\n", result.Scenario)
			for _, detail := range result.Details {
				fmt.Printf("   %s\n", detail)
			}
		}
	}

	fmt.Printf("Validated %d scenarios: %d passed\n", len(results), passed)

	if err := saveResults(results); err != nil {
		fmt.Printf("Failed to save results: %v\n", err)
		os.Exit(1)
	}

	if !allValid(results) {
		os.Exit(1)
	}
}
