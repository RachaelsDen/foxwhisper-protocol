package main

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestValidateMessageNilNumericField(t *testing.T) {
	base32 := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x01}, 32))
	base16 := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x02}, 16))
	kyber := base64.StdEncoding.EncodeToString(make([]byte, 1568))

	message := map[string]interface{}{
		"type":              "HANDSHAKE_INIT",
		"version":           nil,
		"client_id":         base32,
		"x25519_public_key": base32,
		"kyber_public_key":  kyber,
		"timestamp":         1234567890,
		"nonce":             base16,
	}

	result := validateMessage(message)

	if result.Valid {
		t.Fatalf("expected validation to fail when numeric fields are nil")
	}

	found := false
	for _, err := range result.Errors {
		if err == "Field version must be integer" {
			found = true
			break
		}
	}

	if !found {
		t.Fatalf("expected integer type error for version field, got errors: %v", result.Errors)
	}
}
