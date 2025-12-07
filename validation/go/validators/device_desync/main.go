package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"

	validatorsutil "foxwhisper-protocol/validation/go/validators/util"
)

type Device struct {
	ID        string  `json:"device_id"`
	DRVersion int     `json:"dr_version"`
	ClockMS   int     `json:"clock_ms"`
	StateHash *string `json:"state_hash"`
}

type Event struct {
	T         int            `json:"t"`
	Event     string         `json:"event"`
	Raw       map[string]any `json:"-"`
	From      string         `json:"from"`
	To        []string       `json:"to"`
	MsgID     string         `json:"msg_id"`
	Device    string         `json:"device"`
	ApplyDR   *int           `json:"apply_dr_version"`
	StateHash *string        `json:"state_hash"`
	DRVersion *int           `json:"dr_version"`
	Targets   []string       `json:"targets"`
	DeltaMS   *int           `json:"delta_ms"`
	TargetDR  *int           `json:"target_dr_version"`
}

type Expectations struct {
	Detected                  bool     `json:"detected"`
	MaxDetectionMS            int      `json:"max_detection_ms"`
	MaxRecoveryMS             int      `json:"max_recovery_ms"`
	HealingRequired           bool     `json:"healing_required"`
	ResidualDivergenceAllowed bool     `json:"residual_divergence_allowed"`
	MaxDRVersionDelta         int      `json:"max_dr_version_delta"`
	MaxClockSkewMS            int      `json:"max_clock_skew_ms"`
	AllowMessageLossRate      float64  `json:"allow_message_loss_rate"`
	AllowOutOfOrderRate       float64  `json:"allow_out_of_order_rate"`
	ExpectedErrorCategories   []string `json:"expected_error_categories"`
	MaxRollbackEvents         int      `json:"max_rollback_events"`
}

type Scenario struct {
	ScenarioID   string       `json:"scenario_id"`
	Tags         []string     `json:"tags"`
	Devices      []Device     `json:"devices"`
	Timeline     []Event      `json:"timeline"`
	Expectations Expectations `json:"expectations"`
}

type MessageEnvelope struct {
	MsgID       string
	Sender      string
	Targets     []string
	DRVersion   int
	StateHash   *string
	SendTime    int
	Delivered   map[string]struct{}
	Dropped     map[string]struct{}
	ReplayCount int
}

type SimulationResult struct {
	Detection   bool
	DetectionMS *int
	RecoveryMS  *int
	Errors      []string
	Notes       []string
	Metrics     map[string]any
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
	for i := range scenarios {
		// hydrate raw
		for j := range scenarios[i].Timeline {
			raw, _ := json.Marshal(scenarios[i].Timeline[j])
			tmp := map[string]any{}
			_ = json.Unmarshal(raw, &tmp)
			scenarios[i].Timeline[j].Raw = tmp
		}
	}
	return scenarios, nil
}

func cloneDevices(devs []Device) map[string]*Device {
	out := make(map[string]*Device, len(devs))
	for _, d := range devs {
		dcopy := d
		out[d.ID] = &dcopy
	}
	return out
}

func currentDrStats(devs map[string]*Device) (min, max, delta int) {
	first := true
	for _, d := range devs {
		if first {
			min, max = d.DRVersion, d.DRVersion
			first = false
			continue
		}
		if d.DRVersion < min {
			min = d.DRVersion
		}
		if d.DRVersion > max {
			max = d.DRVersion
		}
	}
	delta = max - min
	return
}

func clockRange(devs map[string]*Device) int {
	first := true
	var min, max int
	for _, d := range devs {
		if first {
			min, max = d.ClockMS, d.ClockMS
			first = false
			continue
		}
		if d.ClockMS < min {
			min = d.ClockMS
		}
		if d.ClockMS > max {
			max = d.ClockMS
		}
	}
	if first {
		return 0
	}
	return max - min
}

func contains(slice []string, item string) bool {
	for _, v := range slice {
		if v == item {
			return true
		}
	}
	return false
}

func simulate(s Scenario) (SimulationResult, error) {
	devices := cloneDevices(s.Devices)
	messages := map[string]*MessageEnvelope{}

	var detectionTime *int
	var divergenceStart *int
	var recoveryTime *int

	delivered := 0
	expected := 0
	outOfOrder := 0
	drIntegral := 0
	drSamples := 0
	maxDrDelta := 0
	maxDivergedCount := 0
	maxClockSkew := 0
	skewViolations := 0
	recoveryAttempts := 0
	successfulRecoveries := 0
	failedRecoveries := 0
	maxRollback := 0
	dropped := 0
	errorsSeen := []string{}
	notes := []string{}

	addError := func(code string, at *int) {
		if !contains(errorsSeen, code) {
			errorsSeen = append(errorsSeen, code)
		}
		if detectionTime == nil && at != nil {
			detectionTime = at
		}
	}

	sort.SliceStable(s.Timeline, func(i, j int) bool {
		if s.Timeline[i].T == s.Timeline[j].T {
			return s.Timeline[i].Event < s.Timeline[j].Event
		}
		return s.Timeline[i].T < s.Timeline[j].T
	})

	for _, ev := range s.Timeline {
		for _, dev := range devices {
			if ev.T > dev.ClockMS {
				dev.ClockMS = ev.T
			}
		}

		switch ev.Event {
		case "send":
			msgId, sender := ev.MsgID, ev.From
			targets := ev.To
			drVersion := ev.DRVersion
			stateHash := ev.StateHash
			if msgId == "" || sender == "" {
				return SimulationResult{}, fmt.Errorf("[%s] invalid send event", s.ScenarioID)
			}
			senderState, ok := devices[sender]
			if !ok {
				return SimulationResult{}, fmt.Errorf("[%s] send unknown device %s", s.ScenarioID, sender)
			}
			if _, exists := messages[msgId]; !exists {
				ver := senderState.DRVersion
				if drVersion != nil {
					ver = *drVersion
				}
				messages[msgId] = &MessageEnvelope{
					MsgID:     msgId,
					Sender:    sender,
					Targets:   append([]string{}, targets...),
					DRVersion: ver,
					StateHash: stateHash,
					SendTime:  ev.T,
					Delivered: map[string]struct{}{},
					Dropped:   map[string]struct{}{},
				}
			} else {
				messages[msgId].ReplayCount++
			}
			expected += len(targets)
			newVer := senderState.DRVersion
			if drVersion != nil {
				newVer = *drVersion
			}
			if newVer < senderState.DRVersion {
				rollback := senderState.DRVersion - newVer
				if rollback > maxRollback {
					maxRollback = rollback
				}
			}
			senderState.DRVersion = newVer
			if stateHash != nil {
				senderState.StateHash = stateHash
			}

		case "recv":
			msgId, device := ev.MsgID, ev.Device
			if _, ok := messages[msgId]; !ok {
				addError("UNKNOWN_MESSAGE", &ev.T)
			}
			dev, devOK := devices[device]
			if !devOK {
				addError("UNKNOWN_MESSAGE", &ev.T)
			}
			if envelope, ok := messages[msgId]; ok && devOK {
				if _, already := envelope.Delivered[device]; already {
					addError("DUPLICATE_DELIVERY", nil)
				}
				if ev.T < envelope.SendTime {
					outOfOrder++
				}
				envelope.Delivered[device] = struct{}{}
				delivered++
				if ev.ApplyDR != nil {
					if *ev.ApplyDR < dev.DRVersion {
						rollback := dev.DRVersion - *ev.ApplyDR
						if rollback > maxRollback {
							maxRollback = rollback
						}
					}
					dev.DRVersion = *ev.ApplyDR
				}
				if ev.StateHash != nil {
					dev.StateHash = ev.StateHash
				}
			}

			if envelope, ok := messages[msgId]; ok && devOK {
				if _, already := envelope.Delivered[device]; already {

					addError("DUPLICATE_DELIVERY", nil)
				}
				if ev.T < envelope.SendTime {
					outOfOrder++
				}
				envelope.Delivered[device] = struct{}{}
				delivered++
				dev := devices[device]
				if ev.ApplyDR != nil {
					if *ev.ApplyDR < dev.DRVersion {
						rollback := dev.DRVersion - *ev.ApplyDR
						if rollback > maxRollback {
							maxRollback = rollback
						}
					}
					dev.DRVersion = *ev.ApplyDR
				}
				if ev.StateHash != nil {
					dev.StateHash = ev.StateHash
				}
			}

		case "drop":
			msgId := ev.MsgID
			targets := ev.Targets
			if _, ok := messages[msgId]; !ok {
				addError("UNKNOWN_MESSAGE", &ev.T)
			} else {
				envelope := messages[msgId]
				list := targets
				if len(list) == 0 {
					list = envelope.Targets
				}
				for _, t := range list {
					envelope.Dropped[t] = struct{}{}
				}
				dropped += len(list)
			}

		case "replay":
			msgId, sender := ev.MsgID, ev.From
			targets := ev.To
			drVersion := ev.DRVersion
			if msgId == "" || sender == "" {
				return SimulationResult{}, fmt.Errorf("[%s] invalid replay event", s.ScenarioID)
			}
			if _, ok := devices[sender]; !ok {
				return SimulationResult{}, fmt.Errorf("[%s] replay unknown device %s", s.ScenarioID, sender)
			}
			if _, exists := messages[msgId]; !exists {
				ver := devices[sender].DRVersion
				if drVersion != nil {
					ver = *drVersion
				}
				messages[msgId] = &MessageEnvelope{
					MsgID:       msgId,
					Sender:      sender,
					Targets:     append([]string{}, targets...),
					DRVersion:   ver,
					StateHash:   nil,
					SendTime:    ev.T,
					Delivered:   map[string]struct{}{},
					Dropped:     map[string]struct{}{},
					ReplayCount: 1,
				}
			} else {
				messages[msgId].ReplayCount++
			}
			expected += len(targets)
			addError("REPLAY_INJECTED", &ev.T)

		case "backup_restore":
			device := ev.Device
			if ev.DRVersion == nil {
				return SimulationResult{}, fmt.Errorf("[%s] invalid backup_restore event", s.ScenarioID)
			}
			dev, ok := devices[device]
			if !ok {
				return SimulationResult{}, fmt.Errorf("[%s] backup_restore unknown device %s", s.ScenarioID, device)
			}
			newVer := *ev.DRVersion
			if newVer < dev.DRVersion {
				rollback := dev.DRVersion - newVer
				if rollback > maxRollback {
					maxRollback = rollback
				}
				addError("ROLLBACK_APPLIED", &ev.T)
			}
			dev.DRVersion = newVer
			if ev.StateHash != nil {
				dev.StateHash = ev.StateHash
			}

		case "clock_skew":
			device := ev.Device
			if ev.DeltaMS == nil {
				return SimulationResult{}, fmt.Errorf("[%s] invalid clock_skew event", s.ScenarioID)
			}
			dev, ok := devices[device]
			if !ok {
				return SimulationResult{}, fmt.Errorf("[%s] clock_skew unknown device %s", s.ScenarioID, device)
			}
			dev.ClockMS += *ev.DeltaMS
			if cr := clockRange(devices); cr > maxClockSkew {
				maxClockSkew = cr
			}
			if maxClockSkew > s.Expectations.MaxClockSkewMS {
				skewViolations++
				addError("CLOCK_SKEW_VIOLATION", &ev.T)
			}

		case "resync":
			device := ev.Device
			if ev.TargetDR == nil {
				return SimulationResult{}, fmt.Errorf("[%s] invalid resync event", s.ScenarioID)
			}
			dev, ok := devices[device]
			if !ok {
				return SimulationResult{}, fmt.Errorf("[%s] resync unknown device %s", s.ScenarioID, device)
			}
			recoveryAttempts++
			_, _, beforeDelta := currentDrStats(devices)
			if *ev.TargetDR < dev.DRVersion {
				rollback := dev.DRVersion - *ev.TargetDR
				if rollback > maxRollback {
					maxRollback = rollback
				}
			}
			dev.DRVersion = *ev.TargetDR
			if ev.StateHash != nil {
				dev.StateHash = ev.StateHash
			}
			_, _, afterDelta := currentDrStats(devices)
			if afterDelta == 0 {
				successfulRecoveries++
			} else if afterDelta < beforeDelta {
				notes = append(notes, fmt.Sprintf("resync on %s reduced divergence", device))
			} else {
				failedRecoveries++
			}

		default:
			return SimulationResult{}, fmt.Errorf("[%s] unsupported event %s", s.ScenarioID, ev.Event)
		}

		minVer, _, drDelta := currentDrStats(devices)
		drIntegral += drDelta
		drSamples++
		if drDelta > maxDrDelta {
			maxDrDelta = drDelta
		}

		divergenceActive := drDelta > 0
		if divergenceActive && divergenceStart == nil {
			t := ev.T
			divergenceStart = &t
			if detectionTime == nil {
				detectionTime = &t
			}
		}
		if divergenceActive {
			if !contains(errorsSeen, "DIVERGENCE_DETECTED") {
				errorsSeen = append(errorsSeen, "DIVERGENCE_DETECTED")
			}
		}
		if !divergenceActive && divergenceStart != nil && recoveryTime == nil {
			t := ev.T
			recoveryTime = &t
		}

		diverged := 0
		for _, dev := range devices {
			if dev.DRVersion != minVer {
				diverged++
			}
		}
		if diverged > maxDivergedCount {
			maxDivergedCount = diverged
		}
		if cr := clockRange(devices); cr > maxClockSkew {
			maxClockSkew = cr
		}
	}

	if divergenceStart == nil && len(errorsSeen) > 0 {
		t := 0
		if len(s.Timeline) > 0 {
			t = s.Timeline[0].T
		}
		divergenceStart = &t
		if detectionTime == nil {
			detectionTime = &t
		}
	}

	_, _, endDelta := currentDrStats(devices)
	residualDivergence := endDelta > 0

	var detectionMS *int
	if detectionTime != nil && divergenceStart != nil {
		val := *detectionTime - *divergenceStart
		if val < 0 {
			val = 0
		}
		detectionMS = &val
	}

	var recoveryMS *int
	if recoveryTime != nil && detectionTime != nil {
		val := *recoveryTime - *detectionTime
		if val < 0 {
			val = 0
		}
		recoveryMS = &val
	}

	deliveredCount := 0
	for _, env := range messages {
		deliveredCount += len(env.Delivered)
	}
	delivered = deliveredCount

	messageLossRate := 0.0
	if expected > 0 {
		messageLossRate = float64(expected-delivered) / float64(expected)
		if messageLossRate < 0 {
			messageLossRate = 0
		}
	}
	outOfOrderRate := 0.0
	if delivered > 0 {
		outOfOrderRate = float64(outOfOrder) / float64(delivered)
	}
	avgDr := 0.0
	if drSamples > 0 {
		avgDr = float64(drIntegral) / float64(drSamples)
	}

	if messageLossRate > 0 {
		addError("MESSAGE_LOSS", nil)
	}
	if outOfOrder > 0 {
		addError("OUT_OF_ORDER", nil)
	}

	minForMetrics, _, _ := currentDrStats(devices)
	divergedCount := 0
	for _, dev := range devices {
		if dev.DRVersion != minForMetrics {
			divergedCount++
		}
	}

	metrics := map[string]any{
		"max_dr_version_delta":      maxDrDelta,
		"avg_dr_version_delta":      avgDr,
		"max_clock_skew_ms":         maxClockSkew,
		"diverged_device_count":     divergedCount,
		"max_diverged_device_count": maxDivergedCount,
		"delivered_messages":        delivered,
		"expected_messages":         expected,
		"message_loss_rate":         messageLossRate,
		"out_of_order_deliveries":   outOfOrder,
		"out_of_order_rate":         outOfOrderRate,
		"skew_violations":           skewViolations,
		"recovery_attempts":         recoveryAttempts,
		"successful_recoveries":     successfulRecoveries,
		"failed_recoveries":         failedRecoveries,
		"max_rollback_events":       maxRollback,
		"residual_divergence":       residualDivergence,
		"dropped_messages":          dropped,
	}

	return SimulationResult{
		Detection:   divergenceStart != nil || len(errorsSeen) > 0,
		DetectionMS: detectionMS,
		RecoveryMS:  recoveryMS,
		Errors:      errorsSeen,
		Notes:       notes,
		Metrics:     metrics,
	}, nil
}

func evaluate(exp Expectations, res SimulationResult) (string, []string) {
	failures := []string{}
	if res.Detection != exp.Detected {
		failures = append(failures, "detection_mismatch")
	}
	if exp.Detected {
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

	if exp.HealingRequired {
		if res.RecoveryMS == nil {
			failures = append(failures, "missing_recovery_ms")
		} else if exp.MaxRecoveryMS > 0 && *res.RecoveryMS > exp.MaxRecoveryMS {
			failures = append(failures, "recovery_sla")
		}
		if !exp.ResidualDivergenceAllowed {
			if resMetricsBool(res.Metrics, "residual_divergence") {
				failures = append(failures, "residual_divergence")
			}
		}
	}

	if resMetricsInt(res.Metrics, "max_dr_version_delta") > exp.MaxDRVersionDelta {
		failures = append(failures, "dr_delta_exceeded")
	}
	if resMetricsInt(res.Metrics, "max_clock_skew_ms") > exp.MaxClockSkewMS {
		failures = append(failures, "clock_skew_exceeded")
	}
	if resMetricsFloat(res.Metrics, "message_loss_rate") > exp.AllowMessageLossRate {
		failures = append(failures, "message_loss_rate")
	}
	if resMetricsFloat(res.Metrics, "out_of_order_rate") > exp.AllowOutOfOrderRate {
		failures = append(failures, "out_of_order_rate")
	}
	if resMetricsInt(res.Metrics, "max_rollback_events") > exp.MaxRollbackEvents {
		failures = append(failures, "rollback_exceeded")
	}

	missing := []string{}
	for _, code := range exp.ExpectedErrorCategories {
		if !contains(res.Errors, code) {
			missing = append(missing, code)
		}
	}
	if len(missing) > 0 {
		failures = append(failures, "missing_error_categories")
	}

	if len(failures) == 0 {
		return "pass", failures
	}
	return "fail", failures
}

func resMetricsInt(m map[string]any, key string) int {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case int:
			return val
		case float64:
			return int(val)
		}
	}
	return 0
}

func resMetricsFloat(m map[string]any, key string) float64 {
	if v, ok := m[key]; ok {
		switch val := v.(type) {
		case float64:
			return val
		case int:
			return float64(val)
		}
	}
	return 0
}

func resMetricsBool(m map[string]any, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func main() {
	corpusPath := "tests/common/adversarial/device_desync.json"

	scenarios, err := loadCorpus(corpusPath)

	if err != nil {
		fmt.Println("error loading corpus:", err)
		os.Exit(1)
	}

	summary := Summary{Corpus: corpusPath, Total: len(scenarios)}

	for _, scenario := range scenarios {
		res, err := simulate(scenario)
		if err != nil {
			summary.Failed++
			summary.Scenarios = append(summary.Scenarios, ScenarioSummary{
				ScenarioID: scenario.ScenarioID,
				Status:     "fail",
				Failures:   []string{err.Error()},
				Errors:     []string{err.Error()},
				Metrics:    map[string]any{},
				Notes:      []string{},
			})
			continue
		}
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

	if err := validatorsutil.SaveJSON("go_device_desync_summary.json", summary); err != nil {
		fmt.Println("error writing summary:", err)
		os.Exit(1)
	}

	if summary.Failed > 0 {
		fmt.Printf("❌ %d device desync scenario(s) failed\n", summary.Failed)
		os.Exit(1)
	}
	fmt.Println("✅ All device desync scenarios passed (Go)")
	os.Exit(0)
}
