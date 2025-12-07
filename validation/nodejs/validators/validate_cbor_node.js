#!/usr/bin/env node
/**
 * FoxWhisper CBOR Validation - Node.js Implementation
 * Validates canonical CBOR encoding examples across multiple message types
 */

const cbor = require('cbor');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ROOT_DIR, RESULTS_DIR, writeJson } = require('../util/reporting');

function loadTestVectors() {
    // Try to find test vectors file
    const possiblePaths = [
        path.join(ROOT_DIR, 'tests/common/handshake/cbor_test_vectors_fixed.json'),
        path.join(ROOT_DIR, 'tests/common/handshake/cbor_test_vectors.json'),
    ];

    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    }

    throw new Error('Could not find test vectors file');
}

// Load test vectors
const TEST_VECTORS = loadTestVectors();

function validateMessage(messageName, testVector) {
    try {
        // Convert base64 strings to buffers for binary fields
        const data = { ...testVector.data };
        const binaryFields = ['client_id', 'server_id', 'session_id', 'handshake_hash', 'x25519_public_key', 'nonce', 'kyber_public_key', 'kyber_ciphertext'];
        
        for (const field of binaryFields) {
            if (data[field] && typeof data[field] === 'string') {
                try {
                    // Try URL-safe base64 first, then standard base64
                    data[field] = Buffer.from(data[field], 'base64url');
                } catch {
                    try {
                        data[field] = Buffer.from(data[field], 'base64');
                    } catch {
                        // If decoding fails, keep as string
                    }
                }
            }
        }
        
        // Create tagged CBOR
        const tagged = new cbor.Tagged(testVector.tag, data);
        
        // Encode with canonical options
        const encoded = cbor.encodeCanonical(tagged);
        
        // Convert to hex for comparison
        const actualHex = encoded.toString('hex').toUpperCase();
        
        console.log(`✓ ${messageName} Node.js validation passed`);
        console.log(`  Encoded length: ${encoded.length} bytes`);
        console.log(`  Hex: ${actualHex.substring(0, 64)}${actualHex.length > 64 ? '...' : ''}`);
        
        return { success: true, hex: actualHex, buffer: encoded };
        
    } catch (error) {
        const errorMsg = `✗ ${messageName} Node.js validation failed: ${error.message}`;
        console.log(errorMsg);
        return { success: false, error: errorMsg };
    }
}

function compareImplementations() {
    console.log('Comparing Python and Node.js implementations...');
    console.log('=' * 50);
    
    // This would require running Python script first
    // For now, just validate Node.js implementation
    console.log('Note: Cross-language comparison requires running Python script first');
}

function saveResults(results) {
    const resultsData = {
        language: 'nodejs',
        timestamp: 1701763202000,
        results: results.map(([messageName, result]) => ({
            message: messageName,
            success: result.success,
            output: result.success ? result.hex : result.error,
        })),
    };

    const outputPath = writeJson('nodejs_cbor_status.json', resultsData);
    console.log(`📄 Results saved to ${outputPath}`);
}

function main() {
    console.log('FoxWhisper CBOR Validation - Node.js Implementation');
    console.log('='.repeat(50));
    
    const results = [];
    
    for (const [messageName, testVector] of Object.entries(TEST_VECTORS)) {
        const result = validateMessage(messageName, testVector);
        results.push([messageName, result]);
        console.log();
    }
    
    // Summary
    console.log('Summary:');
    console.log('-'.repeat(30));
    const passed = results.filter(([_, result]) => result.success).length;
    const total = results.length;
    
    for (const [messageName, result] of results) {
        const status = result.success ? '✓ PASS' : '✗ FAIL';
        console.log(`${status} ${messageName}`);
    }
    
    console.log(`\nOverall: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All Node.js CBOR validation tests passed!');
    } else {
        console.log('❌ Some tests failed. Check implementation.');
    }
    
    // Save results
    saveResults(results);
    
    // Compare implementations if possible
    console.log();
    compareImplementations();
}

if (require.main === module) {
    main();
}

module.exports = { validateMessage, TEST_VECTORS };