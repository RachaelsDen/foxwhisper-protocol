package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"foxwhisper-protocol/validation/go/validators/util"
)

// Simple handshake flow validator: recompute handshake_hash/session_id from the
// HANDSHAKE_RESPONSE in the shared vector and compare to HANDSHAKE_COMPLETE.
func main() {
	root, err := util.RepoRoot()
	if err != nil {
		log.Fatalf("failed to locate repo root: %v", err)
	}

	path := root + "/tests/common/handshake/v0.9/handshake_flow_test_vectors.json"
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
	transcript, ok := hf["transcript"].(map[string]any)
	if !ok {
		log.Fatalf("handshake_flow.transcript missing or wrong type")
	}
	rawB64, _ := transcript["handshake_transcript_raw_cbor_b64"].(string)
	expectedSession, _ := transcript["session_id_b64"].(string)
	if rawB64 == "" || expectedSession == "" {
		log.Fatalf("missing transcript.handshake_transcript_raw_cbor_b64 or transcript.session_id_b64")
	}
	raw, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil {
		log.Fatalf("failed to decode transcript CBOR: %v", err)
	}
	h := sha256.Sum256(raw)
	derivedSession := base64.StdEncoding.EncodeToString(h[:])
	if derivedSession != expectedSession {
		log.Fatalf("session_id_b64 mismatch: expected %v, got %v", expectedSession, derivedSession)
	}
	steps, ok := hf["steps"].([]any)
	if !ok || len(steps) < 3 {
		log.Fatalf("handshake_flow.steps missing or too short")
	}
	resp := steps[1].(map[string]any)["message"].(map[string]any)
	complete := steps[2].(map[string]any)["message"].(map[string]any)
	if resp["session_id"] != expectedSession {
		log.Fatalf("HANDSHAKE_RESPONSE.session_id mismatch: expected %v, got %v", expectedSession, resp["session_id"])
	}
	if complete["session_id"] != expectedSession {
		log.Fatalf("HANDSHAKE_COMPLETE.session_id mismatch: expected %v, got %v", expectedSession, complete["session_id"])
	}
	if resp["timestamp_ms"] == nil || complete["timestamp_ms"] == nil {
		log.Fatalf("missing timestamp_ms in handshake messages")
	}
	fmt.Println("✅ handshake_flow v0.9 transcript binding matches (Go)")
}
