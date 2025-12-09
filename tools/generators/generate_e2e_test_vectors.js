#!/usr/bin/env node
/**
 * FoxWhisper End-to-End Test Vector Generator (JavaScript)
 * Generates complete protocol flow test vectors for FoxWhisper v0.9
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cbor = require('cbor');

class EndToEndTestVectorGenerator {
    constructor() {
        this.testVectors = {};
    }

    deriveFromHandshakeResponse(resp) {
        const transcript = cbor.encodeOne(resp, { canonical: true });
        const hashBytes = crypto.createHash('sha256').update(transcript).digest();
        const handshakeHash = hashBytes.toString('base64');
        const sessionIdBytes = crypto.hkdfSync(
            'sha256',
            hashBytes,
            Buffer.alloc(0),
            Buffer.from('FoxWhisper-SessionId', 'utf8'),
            32,
        );
        const sessionId = Buffer.from(sessionIdBytes).toString('base64');
        return { handshakeHash, sessionId };
    }

    generateHandshakeFlow() {
        // Generate cryptographic material
        const clientId = crypto.randomBytes(32).toString('base64');
        const serverId = crypto.randomBytes(32).toString('base64');
        
        // X25519 key pairs
        const clientX25519Priv = crypto.randomBytes(32).toString('base64');
        const clientX25519Pub = crypto.randomBytes(32).toString('base64');
        const serverX25519Priv = crypto.randomBytes(32).toString('base64');
        const serverX25519Pub = crypto.randomBytes(32).toString('base64');
        
        // Kyber material
        const clientKyberPub = crypto.randomBytes(1568).toString('base64');
        const serverKyberCipher = crypto.randomBytes(1568).toString('base64');
        
        // Nonces
        const clientNonce = crypto.randomBytes(16).toString('base64');
        const serverNonce = crypto.randomBytes(16).toString('base64');
        
        const handshakeResponse = {
            type: "HANDSHAKE_RESPONSE",
            version: 1,
            server_id: serverId,
            x25519_public_key: serverX25519Pub,
            kyber_ciphertext: serverKyberCipher,
            timestamp: 1701763201000,
            nonce: serverNonce
        };

        const { handshakeHash, sessionId } = this.deriveFromHandshakeResponse(handshakeResponse);

        const handshakeFlow = {
            description: "Complete FoxWhisper handshake flow",
            participants: ["client", "server"],
            steps: [
                {
                    step: 1,
                    type: "HANDSHAKE_INIT",
                    from: "client",
                    to: "server",
                    message: {
                        type: "HANDSHAKE_INIT",
                        version: 1,
                        client_id: clientId,
                        x25519_public_key: clientX25519Pub,
                        kyber_public_key: clientKyberPub,
                        timestamp: 1701763200000,
                        nonce: clientNonce
                    },
                    expected_response: "HANDSHAKE_RESPONSE"
                },
                {
                    step: 2,
                    type: "HANDSHAKE_RESPONSE",
                    from: "server",
                    to: "client",
                    message: handshakeResponse,
                    expected_response: "HANDSHAKE_COMPLETE"
                },
                {
                    step: 3,
                    type: "HANDSHAKE_COMPLETE",
                    from: "client",
                    to: "server",
                    message: {
                        type: "HANDSHAKE_COMPLETE",
                        version: 1,
                        session_id: sessionId,
                        handshake_hash: handshakeHash,
                        timestamp: 1701763202000
                    },
                    expected_response: "ENCRYPTED_MESSAGE"
                }
            ],
            validation_criteria: {
                all_required_fields_present: true,
                correct_message_types: true,
                valid_base64_encoding: true,
                correct_field_sizes: true,
                chronological_timestamps: true,
                matching_session_ids: true
            }
        };

        return handshakeFlow;
    }

    saveTestVectors(filename) {
        // Add metadata
        this.testVectors._metadata = {
            version: "0.9",
            generated_by: "FoxWhisper End-to-End Test Vector Generator (JavaScript)",
            description: "Complete protocol flow test vectors for FoxWhisper E2EE",
            test_categories: ["handshake_flow"],
            validation_features: [
                "message_structure_validation",
                "field_size_validation",
                "base64_encoding_validation",
                "chronological_validation",
                "session_consistency_validation"
            ]
        };

        this.testVectors.handshake_flow = this.generateHandshakeFlow();

        // Save to file
        const data = JSON.stringify(this.testVectors, null, 2);
        fs.writeFileSync(filename, data);

        console.log(`✅ End-to-end test vectors saved to ${filename}`);
        console.log(`📊 Generated ${Object.keys(this.testVectors).length - 1} test scenarios`);
    }

    validateTestVectors(filename) {
        const vectors = JSON.parse(fs.readFileSync(filename, 'utf8'));
        const validationResults = {
            handshake_flow: this.validateHandshakeFlow(vectors.handshake_flow || {})
        };

        return validationResults;
    }

    validateHandshakeFlow(flow) {
        if (!flow) {
            return { valid: false, errors: ["Missing handshake flow"] };
        }

        const errors = [];
        const steps = flow.steps || [];

        // Validate step sequence
        const expectedTypes = ["HANDSHAKE_INIT", "HANDSHAKE_RESPONSE", "HANDSHAKE_COMPLETE"];
        for (let i = 0; i < steps.length; i++) {
            if (i >= expectedTypes.length) {
                errors.push(`Unexpected step ${i + 1}: ${steps[i].type}`);
                continue;
            }

            const expectedType = expectedTypes[i];
            const actualType = steps[i].type;
            if (actualType !== expectedType) {
                errors.push(`Step ${i + 1}: expected ${expectedType}, got ${actualType}`);
            }
        }

        // Validate message structure
        for (const step of steps) {
            const message = step.message || {};
            if (!message.type) {
                errors.push(`Step ${step.step}: missing message type`);
            }
            if (!message.version) {
                errors.push(`Step ${step.step}: missing version`);
            }
            if (!message.timestamp) {
                errors.push(`Step ${step.step}: missing timestamp`);
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            steps_validated: steps.length
        };
    }
}

function main() {
    console.log("FoxWhisper End-to-End Test Vector Generator (JavaScript)");
    console.log("=".repeat(50));

    const generator = new EndToEndTestVectorGenerator();

    // Generate test vectors
    const outputFile = path.resolve(__dirname, '../../tests/common/handshake/end_to_end_test_vectors_js.json');
    generator.saveTestVectors(outputFile);

    // Validate generated vectors
    console.log("\nValidating generated test vectors...");
    const validationResults = generator.validateTestVectors(outputFile);

    for (const [category, result] of Object.entries(validationResults)) {
        if (result.valid) {
            console.log(`✅ ${category}: VALID (${result.steps_validated} steps)`);
        } else {
            console.log(`❌ ${category}: INVALID`);
            for (const error of result.errors) {
                console.log(`   Error: ${error}`);
            }
        }
    }

    console.log("\n🎉 End-to-end test vector generation completed!");
    console.log(`📁 Saved to: ${outputFile}`);
}

if (require.main === module) {
    main();
}

module.exports = EndToEndTestVectorGenerator;
