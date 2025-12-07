#!/usr/bin/env node
/**
 * FoxWhisper replay & poisoning validator (Node.js)
 */

const fs = require('fs');
const path = require('path');

const { writeJson, inputPath } = require('../util/reporting');

class ReplayPoisoningValidator {
  constructor(vectors) {
    this.vectors = vectors;
    this.results = [];
  }

  run() {
    this.validateReplayCases();
    this.validateReplayBoundaries();
    this.validatePoisoningVectors();
    this.validateEpochForks();
    this.validateMalformedEare();
    this.validateAntiPoisoningRules();
    this.validateReplayStormProfiles();
    return this.results;
  }

  record(scenario, valid, details) {
    this.results.push({ scenario, valid, details });
  }

  detectReplay(sequenceNumbers, windowSize) {
    const seen = [];
    let detection = false;
    for (const seq of sequenceNumbers) {
      const cutoff = seq - windowSize;
      for (let i = seen.length - 1; i >= 0; i--) {
        if (seen[i] < cutoff) {
          seen.splice(i, 1);
        }
      }
      if (seen.includes(seq)) {
        detection = true;
      }
      seen.push(seq);
    }
    return detection;
  }

  validateReplayCases() {
    const section = this.vectors.replay_attack_detection;
    const windowSize = section.window_size;
    for (const test of section.test_cases) {
      const detected = this.detectReplay(test.sequence_numbers, windowSize);
      const expected = test.expected_detection;
      this.record(
        `replay_attack::${test.case}`,
        detected === expected,
        [
          `window=${windowSize}`,
          `detected=${detected}`,
          `expected=${expected}`,
          test.notes || '',
        ].filter(Boolean)
      );
    }
  }

  validateReplayBoundaries() {
    const section = this.vectors.replay_window_boundaries;
    const windowSize = section.window_size;
    for (const test of section.test_cases) {
      const detected = this.detectReplay(test.sequence_numbers, windowSize);
      const expected = test.expected_detection;
      this.record(
        `replay_window::${test.case}`,
        detected === expected,
        [
          `window=${windowSize}`,
          `detected=${detected}`,
          `expected=${expected}`,
          test.notes || '',
        ].filter(Boolean)
      );
    }
  }

  validatePoisoningVectors() {
    const section = this.vectors.poisoning_injection;
    for (const attack of section.attack_vectors) {
      let violations = 0;
      for (const field of attack.malicious_fields) {
        for (const [key, value] of Object.entries(field)) {
          if (!key.startsWith('expected_')) continue;
          const suffix = key.replace('expected_', '');
          const actualKey = `actual_${suffix}`;
          if (Object.prototype.hasOwnProperty.call(field, actualKey) && field[actualKey] !== value) {
            violations += 1;
          }
        }
      }
      this.record(
        `poisoning::${attack.attack_name}`,
        violations > 0,
        [
          `violations=${violations}`,
          `expected_defense=${attack.expected_defense}`,
        ]
      );
    }
  }

  validateEpochForks() {
    const section = this.vectors.epoch_fork_detection;
    for (const scenario of section.scenarios) {
      const children = {};
      for (const entry of scenario.timeline) {
        if (!entry.parent) continue;
        if (!children[entry.parent]) {
          children[entry.parent] = [];
        }
        children[entry.parent].push(entry.epoch_id);
      }
      const forkDetected = Object.values(children).some(nodes => nodes.length > 1);
      const expected = scenario.expected_fork_detected;
      this.record(
        `epoch_fork::${scenario.scenario}`,
        forkDetected === expected,
        [
          `fork_detected=${forkDetected}`,
          `expected=${expected}`,
          `timeline_length=${scenario.timeline.length}`,
        ]
      );
    }
  }

  validateMalformedEare() {
    const section = this.vectors.malformed_eare;
    for (const record of section.records) {
      const fields = record.fields || {};
      const required = record.required_fields || [];
      const missing = required.filter(field => !(field in fields));
      const hashBytes = record.hash_bytes ?? this.hexLength(fields.hash);
      const minHashBytes = record.min_hash_bytes ?? 32;
      const lengthOk = hashBytes >= minHashBytes;
      const valid = missing.length === 0 && lengthOk;
      const expected = record.expected_valid;
      this.record(
        `eare::${record.record_id}`,
        valid === expected,
        [
          `missing_fields=${missing.join(',')}`,
          `hash_bytes=${hashBytes}`,
          `min_hash_bytes=${minHashBytes}`,
          `expected_valid=${expected}`,
        ]
      );
    }
  }

  validateAntiPoisoningRules() {
    const section = this.vectors.anti_poisoning_rules;
    for (const rule of section.rules) {
      const sample = rule.sample_message || {};
      const conditions = rule.conditions || {};
      let enforced = true;

      if (typeof conditions.max_drift === 'number') {
        const drift = sample.nonce_counter - sample.last_nonce_counter;
        enforced = drift <= conditions.max_drift;
      } else if (conditions.require_binding) {
        enforced = sample.sender_id === sample.aad_sender;
      } else if (conditions.allow_missing_aad) {
        enforced = sample.aad === null || sample.aad === undefined;
      }

      this.record(
        `anti_poisoning::${rule.rule_id}`,
        enforced === rule.expected_enforced,
        [
          `enforced=${enforced}`,
          `expected=${rule.expected_enforced}`,
        ]
      );
    }
  }

  validateReplayStormProfiles() {
    const section = this.vectors.replay_storm_simulation;
    const windowSize = section.window_size;
    const capacityRate = section.capacity_per_ms;
    const tolerance = 0.1;

    for (const profile of section.profiles) {
      const total = profile.burst_rate * profile.duration_ms;
      const capacity = capacityRate * profile.duration_ms + windowSize;
      const drops = Math.max(0, total - capacity);
      const dropRatio = total === 0 ? 0 : Math.min(1, drops / total);
      const expectedRatio = profile.expected_drop_ratio;
      const valid = Math.abs(dropRatio - expectedRatio) <= tolerance;
      this.record(
        `replay_storm::${profile.profile_id}`,
        valid,
        [
          `window=${windowSize}`,
          `drop_ratio=${dropRatio.toFixed(2)}`,
          `expected_ratio=${expectedRatio}`,
          `burst_rate=${profile.burst_rate}`,
          `duration_ms=${profile.duration_ms}`,
        ]
      );
    }
  }

  hexLength(value) {
    if (!value || typeof value !== 'string') {
      return 0;
    }
    try {
      return Buffer.from(value, 'hex').length;
    } catch (err) {
      return 0;
    }
  }
}

function saveResults(results) {
  const payload = {
    language: 'nodejs',
    scenario_count: results.length,
    success: results.every(result => result.valid),
    results,
  };
  const outputPath = writeJson('replay_poisoning_validation_results_nodejs.json', payload);
  console.log(`\n📄 Results saved to ${outputPath}`);
}

function main() {
  const [, , vectorsPath] = process.argv;
  if (!vectorsPath) {
    console.log('Usage: node validate_replay_poisoning.js <test_vectors_file>');
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(vectorsPath) ? vectorsPath : inputPath(vectorsPath);
  const data = fs.readFileSync(resolvedPath, 'utf8');
  const vectors = JSON.parse(data);

  console.log('FoxWhisper Replay & Poisoning Validator (Node.js)');
  console.log('='.repeat(55));

  const validator = new ReplayPoisoningValidator(vectors);
  const results = validator.run();

  const successes = results.filter(result => result.valid).length;
  console.log(`Validated ${results.length} scenarios: ${successes} passed`);
  results.forEach(result => {
    const status = result.valid ? '✅' : '❌';
    console.log(`${status} ${result.scenario}`);
  });

  saveResults(results);

  if (results.some(result => !result.valid)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
