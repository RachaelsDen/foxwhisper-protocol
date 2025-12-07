package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type messageVector struct {
	Tag  int                    `json:"tag"`
	Data map[string]interface{} `json:"data"`
}

func main() {

	root, err := validatorsutil.RepoRoot()
	if err != nil {
		fmt.Printf("Failed to resolve repo root: %v\n", err)
		os.Exit(1)
	}

	vectorCandidates := []string{
		"tests/common/handshake/cbor_test_vectors_fixed.json",
		"tests/common/handshake/cbor_test_vectors.json",
	}

	var data []byte
	var readErr error
	for _, rel := range vectorCandidates {
		vectorsPath := filepath.Join(root, rel)
		data, readErr = os.ReadFile(vectorsPath)
		if readErr == nil {
			fmt.Printf("Loaded vectors from: %s\n", vectorsPath)
			break
		}
	}
	if readErr != nil {
		fmt.Printf("Failed to read CBOR vectors: %v\n", readErr)
		os.Exit(1)
	}

	vectors := map[string]messageVector{}
	if err := json.Unmarshal(data, &vectors); err != nil {
		fmt.Printf("Failed to parse vectors: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("FoxWhisper Go CBOR Schema Validator")
	fmt.Println("===================================")

	passed := 0
	total := 0
	results := make(map[string]bool)
	for name, vector := range vectors {
		total++
		valid := validateVector(name, vector)
		results[name] = valid
		if valid {
			passed++
			fmt.Printf("✅ %s\n", name)
		} else {
			fmt.Printf("❌ %s\n", name)
		}
	}

	fmt.Printf("\nSummary: %d/%d vectors valid\n", passed, total)
	if err := saveSchemaResults(results); err != nil {
		fmt.Printf("Failed to save results: %v\n", err)
		os.Exit(1)
	}
	if passed != total {
		os.Exit(1)
	}
}

func validateVector(name string, vector messageVector) bool {
	if vector.Data == nil {
		return false
	}
	return validatorsutil.ValidateVector(name, vector.Data, vector.Tag)
}

func saveSchemaResults(results map[string]bool) error {
	payload := map[string]interface{}{
		"language": "go",
		"test":     "cbor_schema",
		"results":  results,
	}
	return validatorsutil.SaveJSON("go_cbor_schema_results.json", payload)
}
