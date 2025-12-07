package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type ScenarioResult struct {
	Scenario string   `json:"scenario"`
	Valid    bool     `json:"valid"`
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Println("Usage: go run ./validation/go/validators/multi_device_sync <test_vectors_file>")
		os.Exit(1)
	}

	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Printf("Failed to read test vectors: %v\n", err)
		os.Exit(1)
	}

	var vectors map[string]interface{}
	if err := json.Unmarshal(data, &vectors); err != nil {
		fmt.Printf("Failed to parse test vectors: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("FoxWhisper Multi-Device Sync Validation (Go)")
	fmt.Println(repeat("=", 50))

	validators := map[string]func(map[string]interface{}) ScenarioResult{
		"device_addition": validateDeviceAddition,
		"device_removal":  validateDeviceRemoval,
		"sync_conflict":   validateSyncConflict,
		"backup_restore":  validateBackupRestore,
	}

	results := make(map[string]ScenarioResult)
	validCount := 0

	for name, validator := range validators {
		raw, ok := vectors[name]
		if !ok {
			continue
		}
		scenarioMap, err := toMap(raw)
		if err != nil {
			results[name] = ScenarioResult{Scenario: name, Valid: false, Errors: []string{err.Error()}}
			reportScenario(results[name])
			continue
		}
		result := validator(scenarioMap)
		results[name] = result
		if result.Valid {
			validCount++
		}
		reportScenario(result)
	}

	fmt.Println("\n" + repeat("=", 40))
	fmt.Println("MULTI-DEVICE SYNC VALIDATION SUMMARY")
	fmt.Println(repeat("=", 40))
	fmt.Printf("Overall: %d/%d scenarios valid\n", validCount, len(results))
	if validCount == len(results) && validCount > 0 {
		fmt.Println("🎉 All multi-device sync scenarios passed validation!")
	} else {
		fmt.Println("⚠️  Some scenarios failed validation")
	}

	if err := saveResults(results); err != nil {
		fmt.Printf("Failed to save results: %v\n", err)
		os.Exit(1)
	}
}

func reportScenario(result ScenarioResult) {
	icon := "❌"
	status := "INVALID"
	if result.Valid {
		icon = "✅"
		status = "VALID"
	}
	fmt.Printf("%s %s - %s\n", icon, result.Scenario, status)
	for _, err := range result.Errors {
		fmt.Printf("   Error: %s\n", err)
	}
	for _, warn := range result.Warnings {
		fmt.Printf("   Warning: %s\n", warn)
	}
}

func validateDeviceAddition(scenario map[string]interface{}) ScenarioResult {
	errors := []string{}
	steps, stepErrors := extractSteps(scenario, 3)
	errors = append(errors, stepErrors...)

	for idx, step := range steps {
		stepMap, err := toMap(step)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		msg, err := extractMessage(stepMap)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		stepType, _ := stepMap["type"].(string)
		errors = append(errors, validateCommonFields(idx, msg, stepType)...)

		switch stepType {
		case "DEVICE_ADD_INIT":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "primary_device_id", "new_device_id", "new_device_public_key"})...)
			errors = append(errors, checkBase64Field(idx, msg, "new_device_public_key", 32)...)
		case "DEVICE_ADD_RESPONSE":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "primary_device_id", "acknowledgment"})...)
			errors = append(errors, checkBooleanField(idx, msg, "acknowledgment")...)
		case "DEVICE_ADD_COMPLETE":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "primary_device_id", "device_status", "handshake_hash"})...)
			errors = append(errors, checkBase64Field(idx, msg, "handshake_hash", 32)...)
		default:
			errors = append(errors, fmt.Sprintf("Step %d: unexpected type %s", idx+1, stepType))
		}
	}

	return buildResult("device_addition", errors)
}

func validateDeviceRemoval(scenario map[string]interface{}) ScenarioResult {
	errors := []string{}
	steps, stepErrors := extractSteps(scenario, 3)
	errors = append(errors, stepErrors...)

	for idx, step := range steps {
		stepMap, err := toMap(step)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		msg, err := extractMessage(stepMap)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		stepType, _ := stepMap["type"].(string)
		errors = append(errors, validateCommonFields(idx, msg, stepType)...)

		switch stepType {
		case "DEVICE_REMOVE_INIT":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "primary_device_id", "target_device_id", "removal_reason"})...)
		case "DEVICE_REMOVE_ACK":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "primary_device_id", "acknowledgment"})...)
			errors = append(errors, checkBooleanField(idx, msg, "acknowledgment")...)
		case "DEVICE_REMOVE_COMPLETE":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "removed_device_id", "primary_device_id", "remaining_devices", "handshake_hash"})...)
			errors = append(errors, checkArrayField(idx, msg, "remaining_devices")...)
			errors = append(errors, checkBase64Field(idx, msg, "handshake_hash", 32)...)
		default:
			errors = append(errors, fmt.Sprintf("Step %d: unexpected type %s", idx+1, stepType))
		}
	}

	return buildResult("device_removal", errors)
}

func validateSyncConflict(scenario map[string]interface{}) ScenarioResult {
	errors := []string{}
	steps, stepErrors := extractSteps(scenario, 4)
	errors = append(errors, stepErrors...)

	for idx, step := range steps {
		stepMap, err := toMap(step)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		msg, err := extractMessage(stepMap)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		stepType, _ := stepMap["type"].(string)
		errors = append(errors, validateCommonFields(idx, msg, stepType)...)

		switch stepType {
		case "SESSION_UPDATE":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "update_type", "update_data", "sequence_number"})...)
			errors = append(errors, checkIntegerField(idx, msg, "sequence_number")...)
		case "SYNC_CONFLICT":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "conflicting_devices", "conflict_type", "conflicting_updates", "resolution_strategy"})...)
			errors = append(errors, checkArrayField(idx, msg, "conflicting_devices")...)
			errors = append(errors, checkArrayField(idx, msg, "conflicting_updates")...)
		case "SYNC_RESOLUTION":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "arbitrator_device_id", "resolution", "handshake_hash"})...)
			errors = append(errors, checkObjectField(idx, msg, "resolution")...)
			errors = append(errors, checkBase64Field(idx, msg, "handshake_hash", 32)...)
		default:
			errors = append(errors, fmt.Sprintf("Step %d: unexpected type %s", idx+1, stepType))
		}
	}

	return buildResult("sync_conflict", errors)
}

func validateBackupRestore(scenario map[string]interface{}) ScenarioResult {
	errors := []string{}
	steps, stepErrors := extractSteps(scenario, 3)
	errors = append(errors, stepErrors...)

	for idx, step := range steps {
		stepMap, err := toMap(step)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		msg, err := extractMessage(stepMap)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Step %d: %v", idx+1, err))
			continue
		}
		stepType, _ := stepMap["type"].(string)
		errors = append(errors, validateCommonFields(idx, msg, stepType)...)

		switch stepType {
		case "DEVICE_BACKUP":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "backup_data", "backup_format"})...)
			errors = append(errors, checkObjectField(idx, msg, "backup_data")...)
		case "BACKUP_TRANSFER":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "source_device_id", "target_device_id", "backup_data", "transfer_method"})...)
		case "DEVICE_RESTORE":
			errors = append(errors, requireFields(idx, msg, []string{"session_id", "device_id", "restore_data", "restore_verification"})...)
			errors = append(errors, checkObjectField(idx, msg, "restore_verification")...)
		default:
			errors = append(errors, fmt.Sprintf("Step %d: unexpected type %s", idx+1, stepType))
		}
	}

	return buildResult("backup_restore", errors)
}

func extractSteps(scenario map[string]interface{}, expected int) ([]interface{}, []string) {
	stepsRaw, ok := scenario["steps"].([]interface{})
	if !ok {
		return nil, []string{"Steps array missing or invalid"}
	}
	errors := []string{}
	if len(stepsRaw) != expected {
		errors = append(errors, fmt.Sprintf("Expected %d steps, got %d", expected, len(stepsRaw)))
	}
	return stepsRaw, errors
}

func extractMessage(step map[string]interface{}) (map[string]interface{}, error) {
	msg, ok := step["message"]
	if !ok {
		return nil, errors.New("missing message field")
	}
	return toMap(msg)
}

func validateCommonFields(idx int, msg map[string]interface{}, expected string) []string {
	errors := []string{}
	if t, ok := msg["type"].(string); !ok || t != expected {
		errors = append(errors, fmt.Sprintf("Step %d: type mismatch (expected %s)", idx+1, expected))
	}
	errors = append(errors, requireFields(idx, msg, []string{"version", "timestamp"})...)
	errors = append(errors, checkIntegerField(idx, msg, "version")...)
	errors = append(errors, checkIntegerField(idx, msg, "timestamp")...)
	if _, ok := msg["nonce"]; ok {
		errors = append(errors, checkBase64Field(idx, msg, "nonce", 16)...)
	}
	return errors
}

func requireFields(idx int, msg map[string]interface{}, fields []string) []string {
	errors := []string{}
	for _, field := range fields {
		if _, ok := msg[field]; !ok {
			errors = append(errors, fmt.Sprintf("Step %d: Missing field %s", idx+1, field))
		}
	}
	return errors
}

func checkBooleanField(idx int, msg map[string]interface{}, field string) []string {
	if value, ok := msg[field]; ok {
		if _, ok := value.(bool); !ok {
			return []string{fmt.Sprintf("Step %d: Field %s must be boolean", idx+1, field)}
		}
	}
	return nil
}

func checkIntegerField(idx int, msg map[string]interface{}, field string) []string {
	value, ok := msg[field]
	if !ok {
		return nil
	}
	if _, ok := toInt(value); !ok {
		return []string{fmt.Sprintf("Step %d: Field %s must be integer", idx+1, field)}
	}
	return nil
}

func checkArrayField(idx int, msg map[string]interface{}, field string) []string {
	if value, ok := msg[field]; ok {
		if _, ok := value.([]interface{}); !ok {
			return []string{fmt.Sprintf("Step %d: Field %s must be array", idx+1, field)}
		}
	}
	return nil
}

func checkObjectField(idx int, msg map[string]interface{}, field string) []string {
	if value, ok := msg[field]; ok {
		if _, err := toMap(value); err != nil {
			return []string{fmt.Sprintf("Step %d: Field %s must be object", idx+1, field)}
		}
	}
	return nil
}

func checkBase64Field(idx int, msg map[string]interface{}, field string, expected int) []string {
	value, ok := msg[field]
	if !ok {
		return nil
	}
	str, ok := value.(string)
	if !ok {
		return []string{fmt.Sprintf("Step %d: Field %s must be string", idx+1, field)}
	}
	decoded, err := decodeBase64(str)
	if err != nil {
		return []string{fmt.Sprintf("Step %d: Field %s invalid base64 (%v)", idx+1, field, err)}
	}
	if expected > 0 && len(decoded) != expected {
		return []string{fmt.Sprintf("Step %d: Field %s wrong size (%d != %d)", idx+1, field, len(decoded), expected)}
	}
	return nil
}

func decodeBase64(value string) ([]byte, error) {
	if bytes, err := base64.StdEncoding.DecodeString(value); err == nil {
		return bytes, nil
	}
	return base64.URLEncoding.DecodeString(value)
}

func toMap(value interface{}) (map[string]interface{}, error) {
	if value == nil {
		return nil, errors.New("value is nil")
	}
	if m, ok := value.(map[string]interface{}); ok {
		return m, nil
	}
	return nil, errors.New("value must be object")
}

func toInt(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case float64:
		return int64(v), v == float64(int64(v))
	case json.Number:
		i, err := v.Int64()
		return i, err == nil
	case int:
		return int64(v), true
	case int64:
		return v, true
	default:
		return 0, false
	}
}

func buildResult(name string, errors []string) ScenarioResult {
	return ScenarioResult{Scenario: name, Valid: len(errors) == 0, Errors: errors}
}

func saveResults(results map[string]ScenarioResult) error {
	payload := map[string]interface{}{
		"language": "go",
		"results":  results,
	}
	if err := validatorsutil.SaveJSON("multi_device_sync_validation_results_go.json", payload); err != nil {
		return err
	}
	fmt.Println("\n📄 Results saved to results/multi_device_sync_validation_results_go.json")
	return nil
}

func repeat(ch string, count int) string {
	if count <= 0 {
		return ""
	}
	bytes := make([]byte, count)
	for i := 0; i < count; i++ {
		bytes[i] = ch[0]
	}
	return string(bytes)
}
