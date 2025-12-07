package main

import (
	"errors"
	"fmt"
	"os"
	"sort"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type SFUContext struct {
	SFUID                string   `json:"sfu_id"`
	RoomID               string   `json:"room_id"`
	ExpectedParticipants []string `json:"expected_participants"`
	AuthMode             string   `json:"auth_mode"`
}

type Participant struct {
	ID     string   `json:"id"`
	Role   string   `json:"role"`
	Tokens []string `json:"authz_tokens"`
	Tracks []Track  `json:"tracks"`
}

type Track struct {
	ID     string   `json:"id"`
	Kind   string   `json:"kind"`
	Layers []string `json:"layers"`
}

type Event struct {
	T               int      `json:"t"`
	Event           string   `json:"event"`
	Participant     string   `json:"participant"`
	Token           string   `json:"token"`
	TrackID         string   `json:"track_id"`
	Layers          []string `json:"layers"`
	RequestedLayers []string `json:"requested_layers"`
	ReportedBitrate int      `json:"reported_bitrate"`
}

type Expectations struct {
	ShouldDetect           bool     `json:"should_detect"`
	ExpectedErrors         []string `json:"expected_errors"`
	MaxDetectionMS         int      `json:"max_detection_ms"`
	AllowPartialAccept     bool     `json:"allow_partial_accept"`
	ResidualRoutingAllowed bool     `json:"residual_routing_allowed"`
	MaxHijackedTracks      int      `json:"max_hijacked_tracks"`
	MaxUnauthorizedTracks  int      `json:"max_unauthorized_tracks"`
	MaxKeyLeakAttempts     int      `json:"max_key_leak_attempts"`
	MaxExtraLatencyMS      int      `json:"max_extra_latency_ms"`
	MaxFalsePositiveBlocks int      `json:"max_false_positive_blocks"`
	MaxFalseNegativeLeaks  int      `json:"max_false_negative_leaks"`
}

type Scenario struct {
	ScenarioID   string        `json:"scenario_id"`
	Tags         []string      `json:"tags"`
	SFUContext   SFUContext    `json:"sfu_context"`
	Participants []Participant `json:"participants"`
	Timeline     []Event       `json:"timeline"`
	Expectations Expectations  `json:"expectations"`
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

	authed := map[string]bool{}
	routes := map[string]string{} // track -> publisher
	trackLayers := map[string][]string{}
	affected := map[string]bool{}

	keyLeakAttempts := 0
	hijackedTracks := 0
	unauthorizedTracks := 0
	replayedTracks := 0
	duplicateRoutes := 0
	simulcastSpoofs := 0
	bitrateAbuseEvents := 0
	falsePositiveBlocks := 0
	falseNegativeLeaks := 0

	detectionTime := -1

	participants := map[string]Participant{}
	for _, p := range s.Participants {
		participants[p.ID] = p
	}

	events := append([]Event{}, s.Timeline...)
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].T == events[j].T {
			return events[i].Event < events[j].Event
		}
		return events[i].T < events[j].T
	})

	for _, ev := range events {
		switch ev.Event {
		case "join":
			part, ok := participants[ev.Participant]
			if !ok {
				pushErr(&errorsSeen, "IMPERSONATION")
				break
			}
			if !contains(part.Tokens, ev.Token) {
				pushErr(&errorsSeen, "IMPERSONATION")
			} else {
				authed[ev.Participant] = true
			}
		case "publish":
			if !authed[ev.Participant] {
				pushErr(&errorsSeen, "UNAUTHORIZED_SUBSCRIBE")
				unauthorizedTracks++
			} else {
				routes[ev.TrackID] = ev.Participant
				trackLayers[ev.TrackID] = ev.Layers
			}
		case "subscribe":
			if !authed[ev.Participant] || routes[ev.TrackID] == "" {
				pushErr(&errorsSeen, "UNAUTHORIZED_SUBSCRIBE")
				unauthorizedTracks++
			}
		case "ghost_subscribe":
			pushErr(&errorsSeen, "UNAUTHORIZED_SUBSCRIBE")
			unauthorizedTracks++
			affected[ev.Participant] = true
		case "impersonate":
			pushErr(&errorsSeen, "IMPERSONATION")
			affected[ev.Participant] = true
		case "replay_track":
			if routes[ev.TrackID] != "" {
				pushErr(&errorsSeen, "REPLAY_TRACK")
				replayedTracks++
			}
		case "dup_track":
			if routes[ev.TrackID] != "" {
				pushErr(&errorsSeen, "DUPLICATE_ROUTE")
				duplicateRoutes++
			}
		case "simulcast_spoof":
			allowed := trackLayers[ev.TrackID]
			requested := ev.RequestedLayers
			if len(allowed) > 0 {
				for _, layer := range requested {
					if !contains(allowed, layer) {
						pushErr(&errorsSeen, "SIMULCAST_SPOOF")
						simulcastSpoofs++
						break
					}
				}
			}
		case "bitrate_abuse":
			pushErr(&errorsSeen, "BITRATE_ABUSE")
			bitrateAbuseEvents++
		case "key_rotation_skip", "stale_key_reuse":
			pushErr(&errorsSeen, "STALE_KEY_REUSE")
			keyLeakAttempts++
		case "steal_key":
			pushErr(&errorsSeen, "KEY_LEAK_ATTEMPT")
			keyLeakAttempts++
		}

		if len(errorsSeen) > 0 && detectionTime == -1 {
			detectionTime = ev.T
		}
	}

	detection := len(errorsSeen) > 0
	var detectionMS *int
	if detection {
		dt := detectionTime
		if dt < 0 {
			dt = 0
		}
		detectionMS = &dt
	}

	metrics := map[string]any{
		"unauthorized_tracks":        unauthorizedTracks,
		"hijacked_tracks":            hijackedTracks,
		"impersonation_attempts":     boolToInt(contains(errorsSeen, "IMPERSONATION")),
		"key_leak_attempts":          keyLeakAttempts,
		"duplicate_routes":           duplicateRoutes,
		"replayed_tracks":            replayedTracks,
		"simulcast_spoofs":           simulcastSpoofs,
		"bitrate_abuse_events":       bitrateAbuseEvents,
		"accepted_tracks":            len(routes),
		"rejected_tracks":            unauthorizedTracks,
		"false_positive_blocks":      falsePositiveBlocks,
		"false_negative_leaks":       falseNegativeLeaks,
		"max_extra_latency_ms":       maxInt(detectionTime, 0),
		"affected_participant_count": len(affected),
	}

	return SimulationResult{
		Detection:   detection,
		DetectionMS: detectionMS,
		Errors:      errorsSeen,
		Metrics:     metrics,
		Notes:       notes,
	}
}

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
		if !contains(res.Errors, code) {
			missing = append(missing, code)
		}
	}
	if len(missing) > 0 {
		failures = append(failures, "missing_expected_errors")
	}

	if res.Metrics["hijacked_tracks"].(int) > exp.MaxHijackedTracks {
		failures = append(failures, "hijacked_tracks_exceeded")
	}
	if res.Metrics["unauthorized_tracks"].(int) > exp.MaxUnauthorizedTracks {
		failures = append(failures, "unauthorized_tracks_exceeded")
	}
	if res.Metrics["key_leak_attempts"].(int) > exp.MaxKeyLeakAttempts {
		failures = append(failures, "key_leak_exceeded")
	}
	if res.Metrics["max_extra_latency_ms"].(int) > exp.MaxExtraLatencyMS {
		failures = append(failures, "latency_exceeded")
	}
	if res.Metrics["false_positive_blocks"].(int) > exp.MaxFalsePositiveBlocks {
		failures = append(failures, "false_positive_blocks_exceeded")
	}
	if res.Metrics["false_negative_leaks"].(int) > exp.MaxFalseNegativeLeaks {
		failures = append(failures, "false_negative_leaks_exceeded")
	}

	if !exp.ResidualRoutingAllowed {
		if res.Metrics["duplicate_routes"].(int) > 0 {
			failures = append(failures, "residual_routing")
		}
	}

	if len(failures) == 0 {
		return "pass", failures
	}
	return "fail", failures
}

func contains(slice []string, item string) bool {
	for _, v := range slice {
		if v == item {
			return true
		}
	}
	return false
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	corpusPath := "tests/common/adversarial/sfu_abuse.json"
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

	if err := validatorsutil.SaveJSON("go_sfu_abuse_summary.json", summary); err != nil {
		fmt.Println("error writing summary:", err)
		os.Exit(1)
	}

	if summary.Failed > 0 {
		fmt.Printf("❌ %d SFU abuse scenario(s) failed\n", summary.Failed)
		os.Exit(1)
	}
	fmt.Println("✅ All SFU abuse scenarios passed (Go)")
	os.Exit(0)
}
