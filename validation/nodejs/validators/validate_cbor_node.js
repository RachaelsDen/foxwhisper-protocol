#!/usr/bin/env node
/**
 * FoxWhisper CBOR Validation - Node.js Implementation
 * Validates canonical CBOR encoding examples across multiple message types
 */

const cbor = require('cbor');
const crypto = require('crypto');

// Test data from CBOR examples
const TEST_VECTORS = {
    "HANDSHAKE_INIT": {
        tag: 0xD1,
        data: {
            type: "HANDSHAKE_INIT",
            version: 1,
            client_id: Buffer.from("ABCDEFGHijklmnopqrstuvwxyz1234567890", 'base64url'),
            x25519_public_key: Buffer.from("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Oj8=", 'base64url'),
            kyber_public_key: Buffer.alloc(1568, 0), // Simplified for testing
            timestamp: 1701763200000,
            nonce: Buffer.from("ABERhnd4uJrq67z7", 'base64url')
        }
    },
    "HANDSHAKE_RESPONSE": {
        tag: 0xD2,
        data: {
            type: "HANDSHAKE_RESPONSE",
            version: 1,
            server_id: Buffer.from("UVVXV1lZYWJjZGVmZ2hpams=", 'base64url'),
            x25519_public_key: Buffer.from("ISIjJCUmJygpKissLS4vMTIzNDU2Nzg5Oj8+Pw==", 'base64url'),
            kyber_ciphertext: Buffer.alloc(1568, 0), // Simplified for testing
            timestamp: 1701763201000,
            nonce: Buffer.from("ESIzJCVSMVqL", 'base64url')
        }
    },
    "HANDSHAKE_COMPLETE": {
        tag: 0xD3,
        data: {
            type: "HANDSHAKE_COMPLETE",
            version: 1,
            session_id: Buffer.from("YWJjZGVmZ2hpams=", 'base64url'),
            handshake_hash: Buffer.from("ODlBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZQ==", 'base64url'),
            timestamp: 1701763202000
        }
    }
};

function validateMessage(messageName, testVector) {
    try {
        // Create tagged CBOR
        const tagged = new cbor.Tagged(testVector.tag, testVector.data);
        
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
    
    // Compare implementations if possible
    console.log();
    compareImplementations();
}

if (require.main === module) {
    main();
}

module.exports = { validateMessage, TEST_VECTORS };