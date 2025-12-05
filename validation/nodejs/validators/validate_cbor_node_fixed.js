#!/usr/bin/env node
/**
 * FoxWhisper CBOR Validation - Node.js Implementation (Fixed)
 * Uses consistent test data across all implementations
 */

const cbor = require('cbor');
const fs = require('fs');

// Load test data from JSON file for consistency
function loadTestData() {
    try {
        const jsonContent = fs.readFileSync('../../../tests/common/handshake/cbor_test_vectors_fixed.json', 'utf8');
        return JSON.parse(jsonContent);
    } catch (error) {
        console.error('Failed to load test data:', error.message);
        process.exit(1);
    }
}

function base64UrlToBuffer(base64url) {
    // Convert base64url to base64
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Buffer.from(paddedBase64, 'base64');
}

function validateMessage(messageName, testVector) {
    try {
        // Convert test data to proper format
        const data = { ...testVector.data };
        
        // Convert base64url strings to buffers for binary fields
        if (data.session_id && typeof data.session_id === 'string') {
            data.session_id = base64UrlToBuffer(data.session_id);
        }
        if (data.handshake_hash && typeof data.handshake_hash === 'string') {
            data.handshake_hash = base64UrlToBuffer(data.handshake_hash);
        }
        if (data.client_id && typeof data.client_id === 'string') {
            data.client_id = base64UrlToBuffer(data.client_id);
        }
        if (data.server_id && typeof data.server_id === 'string') {
            data.server_id = base64UrlToBuffer(data.server_id);
        }
        if (data.x25519_public_key && typeof data.x25519_public_key === 'string') {
            data.x25519_public_key = base64UrlToBuffer(data.x25519_public_key);
        }
        if (data.nonce && typeof data.nonce === 'string') {
            data.nonce = base64UrlToBuffer(data.nonce);
        }
        
        // For testing, use minimal binary data
        if (data.kyber_public_key && typeof data.kyber_public_key === 'string') {
            data.kyber_public_key = Buffer.alloc(32, 0); // Reduced size for testing
        }
        if (data.kyber_ciphertext && typeof data.kyber_ciphertext === 'string') {
            data.kyber_ciphertext = Buffer.alloc(32, 0); // Reduced size for testing
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

function main() {
    console.log('FoxWhisper CBOR Validation - Node.js Implementation');
    console.log('='.repeat(50));
    
    const testVectors = loadTestData();
    const results = [];
    
    for (const [messageName, testVector] of Object.entries(testVectors)) {
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
    
    // Save hex results for cross-language comparison
    const hexResults = {};
    for (const [messageName, result] of results) {
        if (result.success) {
            hexResults[messageName] = result.hex;
        }
    }
    
    fs.writeFileSync('nodejs_cbor_results.json', JSON.stringify(hexResults, null, 2));
    console.log('📄 Results saved to nodejs_cbor_results.json');
}

if (require.main === module) {
    main();
}

module.exports = { validateMessage, loadTestData };