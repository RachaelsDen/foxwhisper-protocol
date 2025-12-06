package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strings"
)

// CrossLanguageValidator runs validators in multiple languages
type CrossLanguageValidator struct {
	Results map[string]LanguageResult
}

type LanguageResult struct {
	Language string   `json:"language"`
	Success  bool     `json:"success"`
	Output   string   `json:"output"`
	Errors   []string `json:"errors,omitempty"`
}

func main() {
	log.Println("FoxWhisper CBOR Cross-Language Validation")
	log.Println(strings.Repeat("=", 50))

	validator := &CrossLanguageValidator{
		Results: make(map[string]LanguageResult),
	}

	// Run validators in different languages
	languages := []string{
		"python",
		"node",
		"go",
		"rust",
	}

	for _, lang := range languages {
		log.Printf("\nRunning %s validator...\n", strings.Title(lang))
		log.Println(strings.Repeat("-", 30))

		result := validator.runLanguageValidator(lang)
		validator.Results[lang] = result

		if result.Success {
			fmt.Printf("✅ %s validation successful\n", strings.Title(lang))
		} else {
			fmt.Printf("❌ %s validation failed\n", strings.Title(lang))
			for _, err := range result.Errors {
				fmt.Printf("   Error: %s\n", err)
			}
		}
	}

	// Summary
	fmt.Println("\n" + strings.Repeat("=", 40))
	fmt.Println("CROSS-LANGUAGE SUMMARY")
	fmt.Println(strings.Repeat("=", 40))

	successCount := 0
	for lang, result := range validator.Results {
		if result.Success {
			successCount++
		}
		status := "✅ SUCCESS"
		if !result.Success {
			status = "❌ FAILED"
		}
		fmt.Printf("%s %s\n", status, strings.Title(lang))
	}

	fmt.Printf("\nOverall: %d/%d languages successful\n", successCount, len(languages))

	if successCount == len(languages) {
		fmt.Println("🎉 All validators passed!")
	} else {
		fmt.Println("⚠️  Some validators failed")
	}

	// Save results
	validator.saveResults()
}

func (cv *CrossLanguageValidator) runLanguageValidator(language string) LanguageResult {
	var cmd *exec.Cmd
	var workingDir string

	switch language {
	case "python":
		cmd = exec.Command("python3", "validate_cbor_python.py")
		workingDir = "../../python/validators/"
	case "node":
		cmd = exec.Command("node", "validate_cbor_node.js")
		workingDir = "../../nodejs/validators/"
	case "go":
		cmd = exec.Command("go", "run", "validate_cbor_go.go")
		workingDir = "../../go/validators/"
	case "rust":
		cmd = exec.Command("cargo", "run", "--bin", "validate_cbor_rust")
		workingDir = "../../../"
	default:
		return LanguageResult{
			Language: language,
			Success:  false,
			Errors:   []string{fmt.Sprintf("Unsupported language: %s", language)},
		}
	}

	cmd.Dir = workingDir
	output, err := cmd.CombinedOutput()

	result := LanguageResult{
		Language: language,
		Success:  err == nil,
		Output:   string(output),
	}

	if err != nil {
		result.Errors = append(result.Errors, err.Error())
	}

	// Parse output for validation results
	if strings.Contains(result.Output, "All messages passed") ||
		strings.Contains(result.Output, "All messages passed CBOR validation") ||
		strings.Contains(result.Output, "All Rust CBOR validation tests passed") {
		result.Success = true
	}

	if !result.Success {
		trimmedOutput := strings.TrimSpace(result.Output)
		if trimmedOutput != "" {
			result.Errors = append(result.Errors, trimmedOutput)
		}
		if len(result.Errors) == 0 {
			result.Errors = append(result.Errors, "Validation output did not indicate success")
		}
	}

	return result
}

func (cv *CrossLanguageValidator) saveResults() {
	resultsJSON, err := json.MarshalIndent(cv.Results, "", "  ")
	if err != nil {
		log.Printf("Failed to marshal results: %v", err)
		return
	}

	err = os.WriteFile("../../../results/cross_language_validation_results.json", resultsJSON, 0644)
	if err != nil {
		log.Printf("Failed to save results: %v", err)
		return
	}

	fmt.Println("\n📄 Results saved to results/cross_language_validation_results.json")
}
