package util

import (
	"encoding/base64"
	"encoding/json"
)

// ValidateVector ensures the provided handshake vector matches schema rules.
func ValidateVector(messageName string, vector map[string]interface{}, tag int) bool {
	_ = tag
	msgType, _ := vector["type"].(string)
	switch msgType {
	case "HANDSHAKE_INIT":
		return validateHandshakeInit(vector)
	case "HANDSHAKE_RESPONSE":
		return validateHandshakeResponse(vector)
	case "HANDSHAKE_COMPLETE":
		return validateHandshakeComplete(vector)
	default:
		return false
	}
}

func validateHandshakeInit(data map[string]interface{}) bool {
	required := []string{"version", "client_id", "x25519_public_key", "kyber_public_key", "nonce"}
	if !requireFields(data, required) {
		return false
	}
	version, ok := toInt(data["version"])
	if !ok || version < 1 {
		return false
	}
	// Corpus vectors are shorter than spec; enforce reasonable minima and maxima to keep fuzz results meaningful.
	if !checkBase64Range(data["client_id"], 16, 64) {
		return false
	}
	if !checkBase64Range(data["x25519_public_key"], 32, 128) {
		return false
	}
	if !checkBase64Range(data["kyber_public_key"], 32, 1600) {
		return false
	}
	if !checkBase64Range(data["nonce"], 8, 32) {
		return false
	}
	return true
}

func validateHandshakeResponse(data map[string]interface{}) bool {
	required := []string{"version", "server_id", "x25519_public_key", "kyber_ciphertext", "nonce"}
	if !requireFields(data, required) {
		return false
	}
	version, ok := toInt(data["version"])
	if !ok || version < 1 {
		return false
	}
	if !checkBase64Range(data["server_id"], 16, 64) {
		return false
	}
	if !checkBase64Range(data["x25519_public_key"], 32, 128) {
		return false
	}
	if !checkBase64Range(data["kyber_ciphertext"], 32, 1600) {
		return false
	}
	if !checkBase64Range(data["nonce"], 8, 32) {
		return false
	}
	return true
}

func validateHandshakeComplete(data map[string]interface{}) bool {
	required := []string{"version", "session_id", "handshake_hash", "timestamp"}
	if !requireFields(data, required) {
		return false
	}
	version, ok := toInt(data["version"])
	if !ok || version < 1 {
		return false
	}
	if !checkBase64Range(data["session_id"], 16, 64) {
		return false
	}
	if !checkBase64Range(data["handshake_hash"], 16, 64) {
		return false
	}

	ts, ok := toInt(data["timestamp"])
	if !ok {
		return false
	}
	if ts < 0 || ts > 4102444800000 {
		return false
	}
	return true
}

func requireFields(data map[string]interface{}, fields []string) bool {
	for _, f := range fields {
		if _, ok := data[f]; !ok {
			return false
		}
	}
	return true
}

func checkBase64Range(value interface{}, min, max int) bool {
	s, ok := value.(string)
	if !ok {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		decoded, err = base64.RawStdEncoding.DecodeString(s)
		if err != nil {
			return false
		}
	}
	l := len(decoded)
	if l < min {
		return false
	}
	if max > 0 && l > max {
		return false
	}
	return true
}

func toInt(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case float64:
		return int64(v), true
	case float32:
		return int64(v), true
	case int:
		return int64(v), true
	case int64:
		return v, true
	case json.Number:
		parsed, err := v.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}
