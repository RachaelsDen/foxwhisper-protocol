package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	"foxwhisper-protocol/validation/go/validators/util"
	"golang.org/x/crypto/hkdf"
)

// Simple handshake flow validator: recompute handshake_hash/session_id from the
// HANDSHAKE_RESPONSE in the shared vector and compare to HANDSHAKE_COMPLETE.
func main() {
	root, err := util.RepoRoot()
	if err != nil {
		log.Fatalf("failed to locate repo root: %v", err)
	}

	path := root + "/tests/common/handshake/end_to_end_test_vectors_go.json"
	data, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("failed to read vectors: %v", err)
	}

	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		log.Fatalf("failed to parse vectors: %v", err)
	}

	hf, ok := doc["handshake_flow"].(map[string]any)
	if !ok {
		log.Fatalf("handshake_flow missing or wrong type")
	}
	steps, ok := hf["steps"].([]any)
	if !ok || len(steps) < 3 {
		log.Fatalf("handshake_flow.steps missing or too short")
	}

	respMap := steps[1].(map[string]any)["message"].(map[string]any)
	complete := steps[2].(map[string]any)["message"].(map[string]any)

	type respStruct struct {
		Type            string `json:"type"`
		Version         int    `json:"version"`
		ServerID        string `json:"server_id"`
		X25519PublicKey string `json:"x25519_public_key"`
		KyberCiphertext string `json:"kyber_ciphertext"`
		Timestamp       int64  `json:"timestamp"`
		Nonce           string `json:"nonce"`
	}
	respBytes, _ := json.Marshal(respMap)
	var resp respStruct
	_ = json.Unmarshal(respBytes, &resp)

	encoded, err := util.EncodeCanonical(resp)
	if err != nil {
		log.Fatalf("canonical encode failed: %v", err)
	}
	h := sha256.Sum256(encoded)
	handshakeHash := base64.StdEncoding.EncodeToString(h[:])

	hk := hkdf.New(sha256.New, h[:], nil, []byte("FoxWhisper-SessionId"))
	okm := make([]byte, 32)
	if _, err := io.ReadFull(hk, okm); err != nil {
		log.Fatalf("hkdf failed: %v", err)
	}
	sessionID := base64.StdEncoding.EncodeToString(okm)

	if handshakeHash != complete["handshake_hash"] {
		log.Fatalf("handshake_hash mismatch: expected %v, got %v", complete["handshake_hash"], handshakeHash)
	}
	if sessionID != complete["session_id"] {
		log.Fatalf("session_id mismatch: expected %v, got %v", complete["session_id"], sessionID)
	}

	fmt.Println("✅ handshake_flow derivation matches (Go)")
}
