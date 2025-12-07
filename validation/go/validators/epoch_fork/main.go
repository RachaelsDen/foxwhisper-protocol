package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type EpochNode struct {
	NodeID            string  `json:"node_id"`
	EpochID           int     `json:"epoch_id"`
	EAREHash          string  `json:"eare_hash"`
	PreviousEpochHash *string `json:"previous_epoch_hash"`
	MembershipDigest  *string `json:"membership_digest"`
	ParentID          *string `json:"parent_id"`
	IssuedBy          string  `json:"issued_by"`
	TimestampMs       int     `json:"timestamp_ms"`
}

type EpochEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"`
}

type Event struct {
	T                 int      `json:"t"`
	Event             string   `json:"event"`
	Controller        string   `json:"controller"`
	EpochID           int      `json:"epoch_id"`
	NodeID            string   `json:"node_id"`
	Participants      []string `json:"participants"`
	ReconcileStrategy string   `json:"reconcile_strategy"`
	Count             int      `json:"count"`
	Faults            []string `json:"faults"`
}

type AllowReplayGap struct {
	MaxMessages int `json:"max_messages"`
	MaxMs       int `json:"max_ms"`
}

type Expectations struct {
	Detected              bool           `json:"detected"`
	DetectionReference    string         `json:"detection_reference"`
	MaxDetectionMs        int            `json:"max_detection_ms"`
	MaxReconciliationMs   int            `json:"max_reconciliation_ms"`
	ReconciledEpoch       Reconciled     `json:"reconciled_epoch"`
	AllowReplayGap        AllowReplayGap `json:"allow_replay_gap"`
	ExpectedErrorCategory []string       `json:"expected_error_categories"`
	HealingRequired       bool           `json:"healing_required"`
}

type Reconciled struct {
	EpochID int    `json:"epoch_id"`
	NodeID  string `json:"node_id"`
	Hash    string `json:"eare_hash"`
}

type Scenario struct {
	ScenarioID   string                 `json:"scenario_id"`
	GroupContext map[string]interface{} `json:"group_context"`
	Graph        Graph                  `json:"graph"`
	EventStream  []Event                `json:"event_stream"`
	Expectations Expectations           `json:"expectations"`
}

type Graph struct {
	Nodes []EpochNode `json:"nodes"`
	Edges []EpochEdge `json:"edges"`
}

type Envelope struct {
	ScenarioID       string         `json:"scenario_id"`
	Language         string         `json:"language"`
	Status           string         `json:"status"`
	Detection        bool           `json:"detection"`
	DetectionMs      *int           `json:"detection_ms"`
	ReconciliationMs *int           `json:"reconciliation_ms"`
	WinningEpochID   *int           `json:"winning_epoch_id"`
	WinningHash      *string        `json:"winning_hash"`
	MessagesDropped  int            `json:"messages_dropped"`
	HealingActions   []string       `json:"healing_actions"`
	Errors           []string       `json:"errors"`
	FalsePositives   map[string]int `json:"false_positives"`
	Notes            []string       `json:"notes"`
	Failures         []string       `json:"failures"`
}

func loadCorpus(path string) ([]Scenario, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		// Retry with repo-relative resolution when a relative path was provided
		if !filepath.IsAbs(path) {
			if p2, e2 := validatorsutil.InputPath(path); e2 == nil {
				data, err = os.ReadFile(p2)
			}
		}
	}
	if err != nil {
		return nil, err
	}
	var scenarios []Scenario
	if err := json.Unmarshal(data, &scenarios); err != nil {
		return nil, err
	}
	return scenarios, nil
}

func depth(nodeID string, nodes map[string]EpochNode) int {
	depth := 0
	seen := map[string]bool{}
	cur, ok := nodes[nodeID]
	for ok && cur.ParentID != nil {
		if seen[cur.NodeID] {
			break
		}
		seen[cur.NodeID] = true
		depth++
		next, exists := nodes[*cur.ParentID]
		if !exists {
			break
		}
		cur = next
		ok = true
	}
	return depth
}

func faultDelay(faults []string) int {
	for _, f := range faults {
		if strings.HasPrefix(f, "delay_validation:") {
			parts := strings.SplitN(f, ":", 2)
			if len(parts) == 2 {
				var v int
				fmt.Sscanf(parts[1], "%d", &v)
				return v
			}
		}
	}
	return 0
}

func faultDrop(faults []string) bool {
	for _, f := range faults {
		if f == "drop_next_eare" {
			return true
		}
	}
	return false
}

func simulate(s Scenario) (Envelope, error) {
	nodes := map[string]EpochNode{}
	for _, n := range s.Graph.Nodes {
		if _, exists := nodes[n.NodeID]; exists {
			return Envelope{}, fmt.Errorf("duplicate node_id %s", n.NodeID)
		}
		nodes[n.NodeID] = n
	}

	// deterministic ordering
	type evwrap struct {
		idx int
		ev  Event
	}
	wraps := make([]evwrap, 0, len(s.EventStream))
	for i, ev := range s.EventStream {
		wraps = append(wraps, evwrap{idx: i, ev: ev})
	}
	sort.SliceStable(wraps, func(i, j int) bool {
		if wraps[i].ev.T == wraps[j].ev.T {
			return wraps[i].idx < wraps[j].idx
		}
		return wraps[i].ev.T < wraps[j].ev.T
	})

	observed := map[int][][2]string{}
	childrenByParent := map[string][]struct {
		epochID int
		nodeID  string
		hash    string
	}{}
	detection := false
	var detectionTime *int
	var forkCreated *int
	errorsList := []string{}
	messagesDropped := 0

	for _, wrap := range wraps {
		ev := wrap.ev
		switch ev.Event {
		case "epoch_issue":
			if faultDrop(ev.Faults) {
				continue
			}
			node, ok := nodes[ev.NodeID]
			if !ok {
				return Envelope{}, fmt.Errorf("unknown node_id %s", ev.NodeID)
			}

			entries := observed[node.EpochID]
			hashSet := map[string]bool{}
			for _, entry := range entries {
				hashSet[entry[1]] = true
			}

			parentKey := ""
			if node.ParentID != nil {
				parentKey = *node.ParentID
			}
			parentChildren := childrenByParent[parentKey]

			forkDetected := false
			if !hashSet[node.EAREHash] && len(entries) >= 1 {
				forkDetected = true
			}
			if len(parentChildren) >= 1 {
				diff := true
				for _, c := range parentChildren {
					if c.hash == node.EAREHash && c.epochID == node.EpochID {
						diff = false
						break
					}
				}
				if diff {
					forkDetected = true
				}
			}

			entries = append(entries, [2]string{node.NodeID, node.EAREHash})
			observed[node.EpochID] = entries
			childrenByParent[parentKey] = append(parentChildren, struct {
				epochID int
				nodeID  string
				hash    string
			}{epochID: node.EpochID, nodeID: node.NodeID, hash: node.EAREHash})

			if forkDetected {
				if forkCreated == nil {
					t := ev.T
					forkCreated = &t
				}
				if detectionTime == nil {
					t := ev.T + faultDelay(ev.Faults)
					detectionTime = &t
					detection = true
					if !contains(errorsList, "EPOCH_FORK_DETECTED") {
						errorsList = append(errorsList, "EPOCH_FORK_DETECTED")
					}
				}
			}

			if node.ParentID != nil && node.PreviousEpochHash != nil {
				parent, ok := nodes[*node.ParentID]
				if ok && parent.EAREHash != *node.PreviousEpochHash {
					if !contains(errorsList, "HASH_CHAIN_BREAK") {
						errorsList = append(errorsList, "HASH_CHAIN_BREAK")
					}
				}
			}
		case "replay_attempt":
			messagesDropped += ev.Count
		default:
		}
	}

	var winningNode *EpochNode
	allEntries := [][2]string{}
	for _, entries := range observed {
		allEntries = append(allEntries, entries...)
	}
	sort.SliceStable(allEntries, func(i, j int) bool {
		ni := nodes[allEntries[i][0]]
		nj := nodes[allEntries[j][0]]
		di := depth(ni.NodeID, nodes)
		dj := depth(nj.NodeID, nodes)
		if di == dj {
			if ni.EpochID == nj.EpochID {
				if ni.TimestampMs == nj.TimestampMs {
					return ni.EAREHash > nj.EAREHash
				}
				return ni.TimestampMs < nj.TimestampMs
			}
			return ni.EpochID > nj.EpochID
		}
		return di > dj
	})
	if len(allEntries) > 0 {
		n := nodes[allEntries[0][0]]
		winningNode = &n
	}

	var detectionMs *int
	var reconciliationMs *int
	var detectionReference *int
	if s.Expectations.DetectionReference == "fork_observable" {
		detectionReference = detectionTime
	} else {
		detectionReference = forkCreated
		if detectionReference == nil {
			detectionReference = detectionTime
		}
	}
	if detectionTime != nil && detectionReference != nil {
		delta := *detectionTime - *detectionReference
		if delta < 0 {
			delta = 0
		}
		detectionMs = &delta
	}

	var mergeTime *int
	for _, wrap := range wraps {
		if wrap.ev.Event == "merge" {
			t := wrap.ev.T
			mergeTime = &t
			break
		}
	}
	if detectionTime != nil && mergeTime != nil {
		delta := *mergeTime - *detectionTime
		if delta < 0 {
			delta = 0
		}
		reconciliationMs = &delta
	}

	env := Envelope{
		ScenarioID:       s.ScenarioID,
		Language:         "go",
		Status:           "pass",
		Detection:        detection,
		DetectionMs:      detectionMs,
		ReconciliationMs: reconciliationMs,
		MessagesDropped:  messagesDropped,
		HealingActions:   []string{},
		Errors:           errorsList,
		FalsePositives:   map[string]int{"warnings": 0, "hard_errors": 0},
		Notes:            []string{},
		Failures:         []string{},
	}
	if winningNode != nil {
		env.WinningEpochID = &winningNode.EpochID
		env.WinningHash = &winningNode.EAREHash
	}

	failures := evaluate(s, env)
	if len(failures) > 0 {
		env.Status = "fail"
		env.Failures = failures
	}
	return env, nil
}

func evaluate(s Scenario, env Envelope) []string {
	failures := []string{}
	exp := s.Expectations
	if env.Detection != exp.Detected {
		failures = append(failures, "detection_mismatch")
	}
	if exp.Detected {
		if env.DetectionMs == nil {
			failures = append(failures, "missing_detection_ms")
		} else if exp.MaxDetectionMs > 0 && *env.DetectionMs > exp.MaxDetectionMs {
			failures = append(failures, "detection_sla")
		}
	}
	if exp.ReconciledEpoch.Hash != "" && env.WinningHash != nil && *env.WinningHash != exp.ReconciledEpoch.Hash {
		failures = append(failures, "winning_hash_mismatch")
	}
	if exp.ReconciledEpoch.EpochID != 0 && env.WinningEpochID != nil && *env.WinningEpochID != exp.ReconciledEpoch.EpochID {
		failures = append(failures, "winning_epoch_mismatch")
	}
	if exp.HealingRequired {
		if env.ReconciliationMs == nil {
			failures = append(failures, "missing_reconciliation")
		} else if exp.MaxReconciliationMs > 0 && *env.ReconciliationMs > exp.MaxReconciliationMs {
			failures = append(failures, "reconciliation_sla")
		}
	}
	if exp.AllowReplayGap.MaxMessages > 0 && env.MessagesDropped > exp.AllowReplayGap.MaxMessages {
		failures = append(failures, "replay_gap_messages")
	}
	for _, expected := range exp.ExpectedErrorCategory {
		if !contains(env.Errors, expected) {
			failures = append(failures, "missing_error_categories")
			break
		}
	}
	return failures
}

func contains(arr []string, target string) bool {
	for _, v := range arr {
		if v == target {
			return true
		}
	}
	return false
}

func main() {
	corpusPath := flag.String("corpus", "tests/common/adversarial/epoch_forks.json", "path to corpus")
	scenarioID := flag.String("scenario", "", "scenario id to run (optional)")
	flag.Parse()

	scenarios, err := loadCorpus(*corpusPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load corpus: %v\n", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "")
	encoded := false
	for _, s := range scenarios {
		if *scenarioID != "" && s.ScenarioID != *scenarioID {
			continue
		}
		env, simErr := simulate(s)
		if simErr != nil {
			fmt.Fprintf(os.Stderr, "simulate failed: %v\n", simErr)
			os.Exit(1)
		}
		if err := enc.Encode(env); err != nil {
			fmt.Fprintf(os.Stderr, "encode failed: %v\n", err)
			os.Exit(1)
		}
		encoded = true
	}
	if !encoded {
		fmt.Fprintln(os.Stderr, "no matching scenario")
		os.Exit(1)
	}
	os.Exit(0)
}
