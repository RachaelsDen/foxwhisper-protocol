package main

import (
	"encoding/base64"
	"testing"
)

func TestValidateMessageHandlesNilNumericFields(t *testing.T) {
	message := map[string]interface{}{
		"type":           "HANDSHAKE_COMPLETE",
		"version":        nil,
		"session_id":     base64.StdEncoding.EncodeToString(make([]byte, 32)),
		"handshake_hash": base64.StdEncoding.EncodeToString(make([]byte, 32)),
		"timestamp":      nil,
	}

	result := validateMessage(message)

	if result.Valid {
		t.Fatalf("expected validation to fail for nil numeric fields")
	}

	expectedErrors := []string{"Field version must be integer", "Field timestamp must be integer"}
	for _, expected := range expectedErrors {
		if !containsError(result.Errors, expected) {
			t.Errorf("expected error %q in results %v", expected, result.Errors)
		}
	}
}

func containsError(errors []string, target string) bool {
	for _, err := range errors {
		if err == target {
			return true
		}
	}
	return false
}
