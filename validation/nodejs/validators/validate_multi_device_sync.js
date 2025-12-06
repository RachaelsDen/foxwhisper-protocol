const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'results');

class MultiDeviceSyncValidator {
    constructor() {
        this.validationResults = {};
    }

    validateScenario(scenarioName, scenarioData) {
        console.log(`Validating ${scenarioName} scenario...`);
        const errors = [];
        const warnings = [];

        const steps = scenarioData.steps || [];
        if (steps.length < 3) {
            errors.push(`Expected at least 3 steps, got ${steps.length}`);
        }

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepErrors = this.validateMessageStructure(step.message, step.type);
            errors.push(...stepErrors);

            // Step-specific validation
            switch (step.type) {
                case 'DEVICE_ADD_INIT':
                    this.validateDeviceAddInit(step, errors, i);
                    break;
                case 'DEVICE_ADD_RESPONSE':
                    this.validateDeviceAddResponse(step, errors, i);
                    break;
                case 'DEVICE_ADD_COMPLETE':
                    this.validateDeviceAddComplete(step, errors, i);
                    break;
                case 'DEVICE_REMOVE_INIT':
                    this.validateDeviceRemoveInit(step, errors, i);
                    break;
                case 'DEVICE_REMOVE_ACK':
                    this.validateDeviceRemoveAck(step, errors, i);
                    break;
                case 'DEVICE_REMOVE_COMPLETE':
                    this.validateDeviceRemoveComplete(step, errors, i);
                    break;
                case 'SESSION_UPDATE':
                    this.validateSessionUpdate(step, errors, i);
                    break;
                case 'SYNC_CONFLICT':
                    this.validateSyncConflict(step, errors, i);
                    break;
                case 'SYNC_RESOLUTION':
                    this.validateSyncResolution(step, errors, i);
                    break;
                case 'DEVICE_BACKUP':
                    this.validateDeviceBackup(step, errors, i);
                    break;
                case 'BACKUP_TRANSFER':
                    this.validateBackupTransfer(step, errors, i);
                    break;
                case 'DEVICE_RESTORE':
                    this.validateDeviceRestore(step, errors, i);
                    break;
                default:
                    errors.push(`Step ${i + 1}: Unknown step type ${step.type}`);
            }
        }

        const result = {
            scenario: scenarioName,
            valid: errors.length === 0,
            errors,
            warnings
        };

        if (result.valid) {
            console.log(`✅ ${scenarioName} - VALID`);
        } else {
            console.log(`❌ ${scenarioName} - INVALID`);
            errors.forEach(error => console.log(`   Error: ${error}`));
        }

        warnings.forEach(warning => console.log(`   Warning: ${warning}`));

        this.validationResults[scenarioName] = result;
        return result;
    }

    validateMessageStructure(message, messageType) {
        const errors = [];
        const msgObj = message || {};

        // Check common fields
        if (!msgObj.type) {
            errors.push("Missing 'type' field");
        } else if (msgObj.type !== messageType) {
            errors.push(`Message type mismatch: expected ${messageType}, got ${msgObj.type}`);
        }

        if (!msgObj.version) {
            errors.push("Missing 'version' field");
        } else if (typeof msgObj.version !== 'number') {
            errors.push("Version field must be integer");
        }

        if (!msgObj.timestamp) {
            errors.push("Missing 'timestamp' field");
        } else if (typeof msgObj.timestamp !== 'number') {
            errors.push("Timestamp field must be integer");
        }

        // Validate nonce if present
        if (msgObj.nonce && !this.isValidBase64(msgObj.nonce, 16)) {
            errors.push("Invalid nonce base64");
        }

        return errors;
    }

    isValidBase64(str, expectedSize) {
        try {
            const decoded = Buffer.from(str, 'base64');
            return decoded.length === expectedSize;
        } catch (e) {
            return false;
        }
    }

    validateDeviceAddInit(step, errors, i) {
        const requiredFields = ['session_id', 'primary_device_id', 'new_device_id', 'new_device_public_key'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (step.message.new_device_public_key && !this.isValidBase64(step.message.new_device_public_key, 32)) {
            errors.push(`Step ${i + 1}: Invalid new_device_public_key base64`);
        }
    }

    validateDeviceAddResponse(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'primary_device_id', 'acknowledgment'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (typeof step.message.acknowledgment !== 'boolean') {
            errors.push(`Step ${i + 1}: Acknowledgment field must be boolean`);
        }
    }

    validateDeviceAddComplete(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'primary_device_id', 'device_status', 'handshake_hash'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (step.message.handshake_hash && !this.isValidBase64(step.message.handshake_hash, 32)) {
            errors.push(`Step ${i + 1}: Invalid handshake_hash base64`);
        }
    }

    validateDeviceRemoveInit(step, errors, i) {
        const requiredFields = ['session_id', 'primary_device_id', 'target_device_id', 'removal_reason'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
    }

    validateDeviceRemoveAck(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'primary_device_id', 'acknowledgment'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (typeof step.message.acknowledgment !== 'boolean') {
            errors.push(`Step ${i + 1}: Acknowledgment field must be boolean`);
        }
    }

    validateDeviceRemoveComplete(step, errors, i) {
        const requiredFields = ['session_id', 'removed_device_id', 'primary_device_id', 'remaining_devices', 'handshake_hash'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (!Array.isArray(step.message.remaining_devices)) {
            errors.push(`Step ${i + 1}: Remaining devices field must be array`);
        }
        
        if (step.message.handshake_hash && !this.isValidBase64(step.message.handshake_hash, 32)) {
            errors.push(`Step ${i + 1}: Invalid handshake_hash base64`);
        }
    }

    validateSessionUpdate(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'update_type', 'update_data', 'sequence_number'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (typeof step.message.sequence_number !== 'number') {
            errors.push(`Step ${i + 1}: Sequence number must be number`);
        }
    }

    validateSyncConflict(step, errors, i) {
        const requiredFields = ['session_id', 'conflicting_devices', 'conflict_type', 'conflicting_updates', 'resolution_strategy'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (!Array.isArray(step.message.conflicting_updates)) {
            errors.push(`Step ${i + 1}: Conflicting updates must be array`);
        }
    }

    validateSyncResolution(step, errors, i) {
        const requiredFields = ['session_id', 'arbitrator_device_id', 'resolution', 'handshake_hash'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (!step.message.resolution || typeof step.message.resolution !== 'object') {
            errors.push(`Step ${i + 1}: Resolution must be object`);
        } else {
            const resolution = step.message.resolution;
            const resolutionFields = ['accepted_update', 'rejected_update', 'new_sequence_number', 'resolution_reason'];
            this.checkRequiredFields(resolution, resolutionFields, errors, i);
        }
    }

    validateDeviceBackup(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'backup_data', 'backup_format'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (!step.message.backup_data || typeof step.message.backup_data !== 'object') {
            errors.push(`Step ${i + 1}: Backup data must be object`);
        } else {
            const backupData = step.message.backup_data;
            const backupFields = ['device_record', 'session_state', 'encryption_keys'];
            this.checkRequiredFields(backupData, backupFields, errors, i);
        }
    }

    validateBackupTransfer(step, errors, i) {
        const requiredFields = ['session_id', 'source_device_id', 'target_device_id', 'backup_data', 'transfer_method'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
    }

    validateDeviceRestore(step, errors, i) {
        const requiredFields = ['session_id', 'device_id', 'restore_data', 'restore_verification'];
        this.checkRequiredFields(step.message, requiredFields, errors, i);
        
        if (!step.message.restore_data || typeof step.message.restore_data !== 'object') {
            errors.push(`Step ${i + 1}: Restore data must be object`);
        } else {
            const restoreData = step.message.restore_data;
            const verification = step.message.restore_verification;
            const verificationFields = ['device_id_match', 'session_integrity', 'key_recovery'];
            this.checkRequiredFields(verification, verificationFields, errors, i);
        }
    }

    checkRequiredFields(message, requiredFields, errors, i) {
        for (const field of requiredFields) {
            if (!message[field]) {
                errors.push(`Step ${i + 1}: Missing required field ${field}`);
            }
        }
    }

    validateAllScenarios(testVectors) {
        console.log('FoxWhisper Multi-Device Sync Validation');
        console.log('='.repeat(50));

        const scenarioNames = ['device_addition', 'device_removal', 'sync_conflict', 'backup_restore'];
        
        for (const scenarioName of scenarioNames) {
            if (testVectors[scenarioName]) {
                const result = this.validateScenario(scenarioName, testVectors[scenarioName]);
                this.validationResults[scenarioName] = result;
                
                if (result.valid) {
                    console.log(`✅ ${scenarioName} - VALID`);
                } else {
                    console.log(`❌ ${scenarioName} - INVALID`);
                    result.errors.forEach(error => console.log(`   Error: ${error}`));
                }
                
                result.warnings.forEach(warning => console.log(`   Warning: ${warning}`));
            }
        }

        return this.validationResults;
    }

    printSummary() {
        console.log('\n' + '='.repeat(40));
        console.log('MULTI-DEVICE SYNC VALIDATION SUMMARY');
        console.log('='.repeat(40));

        let validCount = 0;
        for (const [scenarioName, result] of Object.entries(this.validationResults)) {
            if (result.valid) {
                validCount++;
            }
            const status = result.valid ? '✅ VALID' : '❌ INVALID';
            console.log(`${status} ${scenarioName}`);
        }

        console.log(`\nOverall: ${validCount}/${Object.keys(this.validationResults).length} scenarios valid`);

        if (validCount === Object.keys(this.validationResults).length) {
            console.log('🎉 All multi-device sync scenarios passed validation!');
        } else {
            console.log('⚠️  Some scenarios failed validation');
        }
    }

    saveResults(filename) {
        if (!fs.existsSync(RESULTS_DIR)) {
            fs.mkdirSync(RESULTS_DIR, { recursive: true });
        }
        const filePath = path.join(RESULTS_DIR, filename);
        const resultsJson = JSON.stringify(this.validationResults, null, 2);
        fs.writeFileSync(filePath, resultsJson);
        console.log(`\n📄 Results saved to ${filePath}`);
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.log('Usage: node validate_multi_device_sync.js <test_vectors_file>');
        process.exit(1);
    }

    const testVectorsFile = args[1];
    const testVectorsContent = fs.readFileSync(testVectorsFile, 'utf8');
    const testVectors = JSON.parse(testVectorsContent);

    const validator = new MultiDeviceSyncValidator();
    const results = validator.validateAllScenarios(testVectors);
    validator.printSummary();
    validator.saveResults('multi_device_sync_validation_results_nodejs.json');

    console.log('\n📄 Node.js multi-device sync validation completed successfully');
}