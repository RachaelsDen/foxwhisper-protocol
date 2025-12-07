package main

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type GroupContext struct {
	GroupID           string `json:"group_id"`
	MembershipVersion int    `json:"membership_version"`
	EpochSizeLimit    int    `json:"epoch_size_limit"`
}

type Node struct {
	NodeID            string         `json:"node_id"`
	EpochID           int            `json:"epoch_id"`
	EAREHash          string         `json:"eare_hash"`
	IssuedBy          string         `json:"issued_by"`
	PreviousEpochHash string         `json:"previous_epoch_hash"`
	MembershipDigest  string         `json:"membership_digest"`
	Payload           map[string]any `json:"payload"`
}

type Corruption struct {
	Type         string         `json:"type"`
	TargetNode   string         `json:"target_node"`
	Fields       map[string]any `json:"fields"`
	PayloadPatch map[string]any `json:"payload_patch"`
	Reason       string         `json:"reason"`
}

type Expectations struct {
	ShouldDetect            bool     `json:"should_detect"`
	ExpectedErrors          []string `json:"expected_errors"`
	MaxDetectionMS          int      `json:"max_detection_ms"`
	AllowPartialAccept      bool     `json:"allow_partial_accept"`
	ResidualDivergenceAllow bool     `json:"residual_divergence_allowed"`
}

type Scenario struct {
	ScenarioID   string       `json:"scenario_id"`
	Tags         []string     `json:"tags"`
	GroupContext GroupContext `json:"group_context"`
	Nodes        []Node       `json:"nodes"`
	Corruptions  []Corruption `json:"corruptions"`
	Expectations Expectations `json:"expectations"`
}

type SimulationResult struct {
	Detection   bool
	DetectionMS *int
	Errors      []string
	Metrics     map[string]any
	Notes       []string
}

type ScenarioSummary struct {
	ScenarioID string         `json:"scenario_id"`
	Status     string         `json:"status"`
	Failures   []string       `json:"failures"`
	Errors     []string       `json:"errors"`
	Metrics    map[string]any `json:"metrics"`
	Notes      []string       `json:"notes"`
}

type Summary struct {
	Corpus    string            `json:"corpus"`
	Total     int               `json:"total"`
	Failed    int               `json:"failed"`
	Passed    int               `json:"passed"`
	Scenarios []ScenarioSummary `json:"scenarios"`
}

func loadCorpus(path string) ([]Scenario, error) {
	var scenarios []Scenario
	if err := validatorsutil.LoadJSON(path, &scenarios); err != nil {
		return nil, err
	}
	if len(scenarios) == 0 {
		return nil, errors.New("corpus empty")
	}
	return scenarios, nil
}

func pushErr(list *[]string, code string) {
	for _, v := range *list {
		if v == code {
			return
		}
	}
	*list = append(*list, code)
}

func simulate(s Scenario) SimulationResult {
	errorsSeen := []string{}
	notes := []string{}

	corruptionsByTarget := map[string][]Corruption{}
	for _, c := range s.Corruptions {
		target := c.TargetNode
		if target == "" {
			target = "*"
		}
		corruptionsByTarget[target] = append(corruptionsByTarget[target], c)
	}

	nodes := append([]Node{}, s.Nodes...)
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].EpochID < nodes[j].EpochID })

	lastHash := ""
	haveLast := false
	hashBreaks := 0
	accepted := 0
	rejected := 0

	for _, node := range nodes {
		if haveLast {
			if node.PreviousEpochHash != lastHash {
				pushErr(&errorsSeen, "HASH_CHAIN_BREAK")
				hashBreaks++
				rejected++
			} else {
				accepted++
			}
		} else {
			accepted++
		}
		lastHash = node.EAREHash
		haveLast = true

		targets := []string{node.NodeID, "*"}
		for _, t := range targets {
			for _, c := range corruptionsByTarget[t] {
				switch ct := normalize(c.Type); ct {
				case "INVALID_SIGNATURE":
					pushErr(&errorsSeen, "INVALID_SIGNATURE")
				case "INVALID_POP":
					pushErr(&errorsSeen, "INVALID_POP")
				case "HASH_CHAIN_BREAK":
					pushErr(&errorsSeen, "HASH_CHAIN_BREAK")
					hashBreaks++
				case "TRUNCATED_EARE":
					pushErr(&errorsSeen, "TRUNCATED_EARE")
					rejected++
				case "EXTRA_FIELDS":
					pushErr(&errorsSeen, "EXTRA_FIELDS")
				case "PAYLOAD_TAMPERED", "TAMPER_PAYLOAD":
					pushErr(&errorsSeen, "PAYLOAD_TAMPERED")
				case "STALE_EPOCH_REF":
					pushErr(&errorsSeen, "STALE_EPOCH_REF")
				default:
					notes = append(notes, fmt.Sprintf("unhandled corruption %s", ct))
				}
			}
		}
	}

	detection := len(errorsSeen) > 0
	var detectionMS *int
	if detection {
		v := 0
		detectionMS = &v
	}

	metrics := map[string]any{
		"chain_length":        len(nodes),
		"hash_chain_breaks":   hashBreaks,
		"corruptions_applied": len(s.Corruptions),
		"accepted_nodes":      accepted,
		"rejected_nodes":      rejected,
	}

	return SimulationResult{
		Detection:   detection,
		DetectionMS: detectionMS,
		Errors:      errorsSeen,
		Metrics:     metrics,
		Notes:       notes,
	}
}

func normalize(s string) string { return strings.ToUpper(s) }

func evaluate(exp Expectations, res SimulationResult) (string, []string) {
	failures := []string{}
	if res.Detection != exp.ShouldDetect {
		failures = append(failures, "detection_mismatch")
	}
	if exp.ShouldDetect {
		if res.DetectionMS == nil {
			failures = append(failures, "missing_detection_ms")
		} else if exp.MaxDetectionMS > 0 && *res.DetectionMS > exp.MaxDetectionMS {
			failures = append(failures, "detection_sla")
		}
	} else {
		if res.DetectionMS != nil && *res.DetectionMS != 0 {
			failures = append(failures, "unexpected_detection_ms")
		}
	}

	missing := []string{}
	for _, code := range exp.ExpectedErrors {
		found := false
		for _, e := range res.Errors {
			if e == code {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, code)
		}
	}
	if len(missing) > 0 {
		failures = append(failures, "missing_expected_errors")
	}

	if !exp.AllowPartialAccept {
		if v, ok := res.Metrics["rejected_nodes"].(int); ok && v > 0 {
			failures = append(failures, "partial_accept_not_allowed")
		}
	}

	if !exp.ResidualDivergenceAllow {
		if v, ok := res.Metrics["hash_chain_breaks"].(int); ok && v > 0 {
			failures = append(failures, "residual_divergence")
		}
	}

	if len(failures) == 0 {
		return "pass", failures
	}
	return "fail", failures
}

func main() {
	corpusPath := "tests/common/adversarial/corrupted_eare.json"
	scenarios, err := loadCorpus(corpusPath)
	if err != nil {
		fmt.Println("error loading corpus:", err)
		os.Exit(1)
	}

	summary := Summary{Corpus: corpusPath, Total: len(scenarios)}

	for _, scenario := range scenarios {
		res := simulate(scenario)
		status, failures := evaluate(scenario.Expectations, res)
		if status == "pass" {
			summary.Passed++
		} else {
			summary.Failed++
		}
		summary.Scenarios = append(summary.Scenarios, ScenarioSummary{
			ScenarioID: scenario.ScenarioID,
			Status:     status,
			Failures:   failures,
			Errors:     res.Errors,
			Metrics:    res.Metrics,
			Notes:      res.Notes,
		})
	}

	if err := validatorsutil.SaveJSON("go_corrupted_eare_summary.json", summary); err != nil {
		fmt.Println("error writing summary:", err)
		os.Exit(1)
	}

	if summary.Failed > 0 {
		fmt.Printf("❌ %d corrupted EARE scenario(s) failed\n", summary.Failed)
		os.Exit(1)
	}
	fmt.Println("✅ All corrupted EARE scenarios passed (Go)")
	os.Exit(0)
}
