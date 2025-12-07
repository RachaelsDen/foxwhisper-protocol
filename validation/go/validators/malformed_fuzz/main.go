package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type mutation struct {
	Op              string      `json:"op"`
	Field           string      `json:"field"`
	Value           interface{} `json:"value"`
	Factor          int         `json:"factor"`
	ExpectedOutcome string      `json:"expected_outcome"`
}

type seed struct {
	SeedID      string     `json:"seed_id"`
	MessageType string     `json:"message_type"`
	BaseVector  string     `json:"base_vector"`
	Mutations   []mutation `json:"mutations"`
}

type schemaVector struct {
	Tag  int                    `json:"tag"`
	Data map[string]interface{} `json:"data"`
}

func main() {
	corpusPath, err := validatorsutil.InputPath("tests/common/adversarial/malformed_packets.json")
	if err != nil {
		fmt.Printf("Failed to resolve corpus path: %v\n", err)
		os.Exit(1)
	}
	data, err := os.ReadFile(corpusPath)
	if err != nil {
		fmt.Printf("Failed to read corpus: %v\n", err)
		os.Exit(1)
	}

	var payload struct {
		Seeds []seed `json:"seeds"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		fmt.Printf("Failed to parse corpus: %v\n", err)
		os.Exit(1)
	}

	root, err := validatorsutil.RepoRoot()
	if err != nil {
		fmt.Printf("Failed to locate repo root: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("FoxWhisper Go Malformed Packet Harness")
	fmt.Println("======================================")

	results := make([]map[string]interface{}, 0, len(payload.Seeds))
	passed := 0

	for _, s := range payload.Seeds {
		baseVector, err := loadBaseVector(root, s.BaseVector)
		if err != nil {
			recordFailure(&results, s, false, fmt.Sprintf("load error: %v", err), nil)
			continue
		}
		mutated, logs, err := applyMutations(baseVector, s.Mutations)
		if err != nil {
			recordFailure(&results, s, false, fmt.Sprintf("mutation error: %v", err), logs)
			continue
		}
		vector := messageVectorFrom(mutated)
		expected := expectedOutcome(s.Mutations)
		observed := validatorsutil.ValidateVector(s.MessageType, vector.Data, vector.Tag)
		pass := observed == expected
		if pass {
			passed++
			fmt.Printf("✅ %s\n", s.SeedID)
		} else {
			fmt.Printf("❌ %s (expected %t, observed %t)\n", s.SeedID, expected, observed)
		}
		results = append(results, map[string]interface{}{
			"seed_id":          s.SeedID,
			"message_type":     s.MessageType,
			"expected_success": expected,
			"observed_success": observed,
			"passed":           pass,
			"mutations":        logs,
		})
	}

	fmt.Printf("\nSummary: %d/%d seeds passed\n", passed, len(results))
	if err := saveFuzzResults(results); err != nil {
		fmt.Printf("Failed to save results: %v\n", err)
		os.Exit(1)
	}
	if passed != len(results) {
		os.Exit(1)
	}
}

func messageVectorFrom(raw interface{}) schemaVector {
	rootMap, _ := raw.(map[string]interface{})
	mv := schemaVector{}
	if tag, ok := rootMap["tag"].(float64); ok {
		mv.Tag = int(tag)
	}
	if data, ok := rootMap["data"].(map[string]interface{}); ok {
		mv.Data = data
	}
	return mv
}

func expectedOutcome(mutations []mutation) bool {
	if len(mutations) == 0 {
		return false
	}
	return strings.EqualFold(mutations[0].ExpectedOutcome, "recover")
}

func loadBaseVector(root, ref string) (interface{}, error) {
	parts := strings.SplitN(ref, "#", 2)
	path := filepath.Join(root, parts[0])
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var payload interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	if len(parts) == 1 || parts[1] == "" {
		return payload, nil
	}
	return traverse(payload, parts[1])
}

func traverse(value interface{}, pointer string) (interface{}, error) {
	if pointer == "" {
		return value, nil
	}
	current := value
	for _, key := range strings.Split(pointer, ".") {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("pointer %s not found", pointer)
		}
		next, ok := m[key]
		if !ok {
			return nil, fmt.Errorf("field %s missing", key)
		}
		current = next
	}
	return current, nil
}

func applyMutations(base interface{}, mutations []mutation) (interface{}, []string, error) {
	cloneData, err := json.Marshal(base)
	if err != nil {
		return nil, nil, err
	}
	var mutated interface{}
	if err := json.Unmarshal(cloneData, &mutated); err != nil {
		return nil, nil, err
	}
	logs := []string{}
	for _, mut := range mutations {
		path := parsePath(mut.Field)
		switch mut.Op {
		case "remove_field":
			if err := mutateRemove(mutated, path); err != nil {
				return nil, logs, err
			}
			logs = append(logs, fmt.Sprintf("remove_field:%s", mut.Field))
		case "set_value":
			if err := mutateSet(mutated, path, mut.Value); err != nil {
				return nil, logs, err
			}
			logs = append(logs, fmt.Sprintf("set_value:%s", mut.Field))
		case "shuffle_map":
			if err := mutateShuffle(mutated, path); err != nil {
				return nil, logs, err
			}
			logs = append(logs, fmt.Sprintf("shuffle_map:%s", mut.Field))
		case "expand_bytes":
			factor := mut.Factor
			if factor <= 0 {
				factor = 2
			}
			if err := mutateExpand(mutated, path, factor); err != nil {
				return nil, logs, err
			}
			logs = append(logs, fmt.Sprintf("expand_bytes:%s", mut.Field))
		default:
			return nil, logs, fmt.Errorf("unsupported op %s", mut.Op)
		}
	}
	return mutated, logs, nil
}

func parsePath(field string) []string {
	if field == "" {
		return nil
	}
	return strings.Split(field, ".")
}

func resolveMap(target interface{}, path []string) (map[string]interface{}, string, error) {
	if len(path) == 0 {
		m, ok := target.(map[string]interface{})
		if !ok {
			return nil, "", fmt.Errorf("target is not map")
		}
		return m, "", nil
	}
	current := target
	for i := 0; i < len(path)-1; i++ {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil, "", fmt.Errorf("path segment %s is not map", path[i])
		}
		next, ok := m[path[i]]
		if !ok {
			return nil, "", fmt.Errorf("path segment %s missing", path[i])
		}
		current = next
	}
	parent, ok := current.(map[string]interface{})
	if !ok {
		return nil, "", fmt.Errorf("parent is not map")
	}
	return parent, path[len(path)-1], nil
}

func mutateRemove(target interface{}, path []string) error {
	parent, key, err := resolveMap(target, path)
	if err != nil {
		return err
	}
	delete(parent, key)
	return nil
}

func mutateSet(target interface{}, path []string, value interface{}) error {
	parent, key, err := resolveMap(target, path)
	if err != nil {
		return err
	}
	parent[key] = value
	return nil
}

func mutateShuffle(target interface{}, path []string) error {
	if len(path) == 0 {
		return fmt.Errorf("shuffle path is empty")
	}
	resolved, err := traverse(target, strings.Join(path, "."))
	if err != nil {
		return err
	}
	m, ok := resolved.(map[string]interface{})
	if !ok {
		return fmt.Errorf("shuffle target is not map")
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	for i, j := 0, len(keys)-1; i < j; i, j = i+1, j-1 {
		keys[i], keys[j] = keys[j], keys[i]
	}
	reordered := make(map[string]interface{}, len(m))
	for _, k := range keys {
		reordered[k] = m[k]
	}
	if len(path) == 1 {
		root, ok := target.(map[string]interface{})
		if !ok {
			return fmt.Errorf("root is not map")
		}
		root[path[0]] = reordered
		return nil
	}
	parent, key, err := resolveMap(target, path[:len(path)-1])
	if err != nil {
		return err
	}
	parent[key] = reordered
	return nil
}

func mutateExpand(target interface{}, path []string, factor int) error {
	parent, key, err := resolveMap(target, path)
	if err != nil {
		return err
	}
	value, ok := parent[key].(string)
	if !ok {
		return fmt.Errorf("expand target is not string")
	}
	parent[key] = strings.Repeat(value, factor)
	return nil
}

func recordFailure(results *[]map[string]interface{}, s seed, passed bool, message string, logs []string) {
	fmt.Printf("❌ %s (%s)\n", s.SeedID, message)
	entry := map[string]interface{}{
		"seed_id":      s.SeedID,
		"message_type": s.MessageType,
		"passed":       passed,
		"error":        message,
	}
	if logs != nil {
		entry["mutations"] = logs
	}
	*results = append(*results, entry)
}

func saveFuzzResults(results []map[string]interface{}) error {
	payload := map[string]interface{}{
		"language": "go",
		"test":     "malformed_fuzz",
		"results":  results,
	}
	return validatorsutil.SaveJSON("go_malformed_packet_fuzz_results.json", payload)
}
