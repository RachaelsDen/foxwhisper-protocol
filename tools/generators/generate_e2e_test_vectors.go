package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
)

// EndToEndTestVectorGenerator generates complete protocol flow test vectors
type EndToEndTestVectorGenerator struct {
	testVectors map[string]interface{}
}

// HandshakeFlow represents complete handshake flow
type HandshakeFlow struct {
	Description        string             `json:"description"`
	Participants       []string           `json:"participants"`
	Steps              []HandshakeStep    `json:"steps"`
	ValidationCriteria ValidationCriteria `json:"validation_criteria"`
}

type HandshakeStep struct {
	Step             int              `json:"step"`
	Type             string           `json:"type"`
	From             string           `json:"from"`
	To               string           `json:"to"`
	Message          HandshakeMessage `json:"message"`
	ExpectedResponse string           `json:"expected_response"`
}

type HandshakeMessage struct {
	Type            string `json:"type"`
	Version         int    `json:"version"`
	ClientID        string `json:"client_id,omitempty"`
	ServerID        string `json:"server_id,omitempty"`
	SessionID       string `json:"session_id,omitempty"`
	X25519PublicKey string `json:"x25519_public_key"`
	KyberPublicKey  string `json:"kyber_public_key,omitempty"`
	KyberCiphertext string `json:"kyber_ciphertext,omitempty"`
	HandshakeHash   string `json:"handshake_hash,omitempty"`
	Timestamp       int64  `json:"timestamp"`
	Nonce           string `json:"nonce,omitempty"`
}

type ValidationCriteria struct {
	AllRequiredFieldsPresent bool `json:"all_required_fields_present"`
	CorrectMessageTypes      bool `json:"correct_message_types"`
	ValidBase64Encoding      bool `json:"valid_base64_encoding"`
	CorrectFieldSizes        bool `json:"correct_field_sizes"`
	ChronologicalTimestamps  bool `json:"chronological_timestamps"`
	MatchingSessionIDs       bool `json:"matching_session_ids"`
}

func (g *EndToEndTestVectorGenerator) generateHandshakeFlow() HandshakeFlow {
	// Generate cryptographic material
	clientID := generateRandomBase64(32)
	serverID := generateRandomBase64(32)
	clientX25519Pub := generateRandomBase64(32)
	serverX25519Pub := generateRandomBase64(32)
	clientKyberPub := generateRandomBase64(1568)
	serverKyberCipher := generateRandomBase64(1568)
	clientNonce := generateRandomBase64(16)
	serverNonce := generateRandomBase64(16)
	sessionID := generateRandomBase64(32)
	handshakeHash := generateRandomBase64(32)

	handshakeFlow := HandshakeFlow{
		Description:  "Complete FoxWhisper handshake flow",
		Participants: []string{"client", "server"},
		Steps: []HandshakeStep{
			{
				Step: 1,
				Type: "HANDSHAKE_INIT",
				From: "client",
				To:   "server",
				Message: HandshakeMessage{
					Type:            "HANDSHAKE_INIT",
					Version:         1,
					ClientID:        clientID,
					X25519PublicKey: clientX25519Pub,
					KyberPublicKey:  clientKyberPub,
					Timestamp:       1701763200000,
					Nonce:           clientNonce,
				},
				ExpectedResponse: "HANDSHAKE_RESPONSE",
			},
			{
				Step: 2,
				Type: "HANDSHAKE_RESPONSE",
				From: "server",
				To:   "client",
				Message: HandshakeMessage{
					Type:            "HANDSHAKE_RESPONSE",
					Version:         1,
					ServerID:        serverID,
					X25519PublicKey: serverX25519Pub,
					KyberCiphertext: serverKyberCipher,
					Timestamp:       1701763201000,
					Nonce:           serverNonce,
				},
				ExpectedResponse: "HANDSHAKE_COMPLETE",
			},
			{
				Step: 3,
				Type: "HANDSHAKE_COMPLETE",
				From: "client",
				To:   "server",
				Message: HandshakeMessage{
					Type:          "HANDSHAKE_COMPLETE",
					Version:       1,
					SessionID:     sessionID,
					HandshakeHash: handshakeHash,
					Timestamp:     1701763202000,
				},
				ExpectedResponse: "ENCRYPTED_MESSAGE",
			},
		},
		ValidationCriteria: ValidationCriteria{
			AllRequiredFieldsPresent: true,
			CorrectMessageTypes:      true,
			ValidBase64Encoding:      true,
			CorrectFieldSizes:        true,
			ChronologicalTimestamps:  true,
			MatchingSessionIDs:       true,
		},
	}

	return handshakeFlow
}

func generateRandomBase64(size int) string {
	bytes := make([]byte, size)
	rand.Read(bytes)
	return base64.StdEncoding.EncodeToString(bytes)
}

func (g *EndToEndTestVectorGenerator) saveTestVectors(filename string) error {
	g.testVectors = make(map[string]interface{})
	g.testVectors["handshake_flow"] = g.generateHandshakeFlow()

	// Add metadata
	g.testVectors["_metadata"] = map[string]interface{}{
		"version":         "0.9",
		"generated_by":    "FoxWhisper End-to-End Test Vector Generator (Go)",
		"description":     "Complete protocol flow test vectors for FoxWhisper E2EE",
		"test_categories": []string{"handshake_flow"},
		"validation_features": []string{
			"message_structure_validation",
			"field_size_validation",
			"base64_encoding_validation",
			"chronological_validation",
			"session_consistency_validation",
		},
	}

	// Save to file
	data, err := json.MarshalIndent(g.testVectors, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal test vectors: %v", err)
	}

	err = os.WriteFile(filename, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write test vectors: %v", err)
	}

	fmt.Printf("✅ End-to-end test vectors saved to %s\n", filename)
	fmt.Printf("📊 Generated %d test scenarios\n", len(g.testVectors)-1)

	return nil
}

func main() {
	fmt.Println("FoxWhisper End-to-End Test Vector Generator (Go)")
	fmt.Println(strings.Repeat("=", 50))

	generator := &EndToEndTestVectorGenerator{}

	// Generate test vectors
	outputFile := "../test-vectors/handshake/end_to_end_test_vectors_go.json"
	err := generator.saveTestVectors(outputFile)
	if err != nil {
		log.Fatalf("Failed to generate test vectors: %v", err)
	}

	fmt.Printf("\n🎉 End-to-end test vector generation completed!\n")
	fmt.Printf("📁 Saved to: %s\n", outputFile)
}
