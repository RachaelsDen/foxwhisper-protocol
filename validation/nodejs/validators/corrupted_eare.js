'use strict';

const fs = require('fs');
const path = require('path');
const { inputPath, writeJson } = require('../util/reporting');

const DEFAULT_CORPUS = 'tests/common/adversarial/corrupted_eare.json';
const SUMMARY_FILE = 'nodejs_corrupted_eare_summary.json';

const ERROR_CODES = new Set([
  'INVALID_SIGNATURE',
  'INVALID_POP',
  'HASH_CHAIN_BREAK',
  'TRUNCATED_EARE',
  'EXTRA_FIELDS',
  'PAYLOAD_TAMPERED',
  'STALE_EPOCH_REF',
]);

function loadCorpus(relPath) {
  const full = inputPath(relPath);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Corpus root must be array');
  return raw;
}

function simulate(scenario) {
  const errors = [];
  const notes = [];

  const corruptionsByTarget = new Map();
  (scenario.corruptions || []).forEach((c) => {
    const target = c.target_node || '*';
    if (!corruptionsByTarget.has(target)) corruptionsByTarget.set(target, []);
    corruptionsByTarget.get(target).push(c);
    if (!ERROR_CODES.has(String(c.type).toUpperCase())) {
      notes.push(`unknown corruption type ${c.type}`);
    }
  });

  let lastHash = null;
  let hashBreaks = 0;
  let accepted = 0;
  let rejected = 0;

  const nodes = [...(scenario.nodes || [])].sort((a, b) => (a.epoch_id || 0) - (b.epoch_id || 0));

  for (const node of nodes) {
    if (lastHash !== null && node.previous_epoch_hash !== lastHash) {
      if (!errors.includes('HASH_CHAIN_BREAK')) errors.push('HASH_CHAIN_BREAK');
      hashBreaks += 1;
      rejected += 1;
    } else {
      accepted += 1;
    }
    lastHash = node.eare_hash;

    const targets = [node.node_id, '*'];
    for (const t of targets) {
      const corrs = corruptionsByTarget.get(t) || [];
      for (const c of corrs) {
        const ctype = String(c.type).toUpperCase();
        switch (ctype) {
          case 'INVALID_SIGNATURE':
            pushErr(errors, 'INVALID_SIGNATURE');
            break;
          case 'INVALID_POP':
            pushErr(errors, 'INVALID_POP');
            break;
          case 'HASH_CHAIN_BREAK':
            pushErr(errors, 'HASH_CHAIN_BREAK');
            hashBreaks += 1;
            break;
          case 'TRUNCATED_EARE':
            pushErr(errors, 'TRUNCATED_EARE');
            rejected += 1;
            break;
          case 'EXTRA_FIELDS':
            pushErr(errors, 'EXTRA_FIELDS');
            break;
          case 'PAYLOAD_TAMPERED':
          case 'TAMPER_PAYLOAD':
            pushErr(errors, 'PAYLOAD_TAMPERED');
            break;
          case 'STALE_EPOCH_REF':
            pushErr(errors, 'STALE_EPOCH_REF');
            break;
          default:
            notes.push(`unhandled corruption ${ctype}`);
        }
      }
    }
  }

  const detection = errors.length > 0;
  const detectionMs = detection ? 0 : null;

  const metrics = {
    chain_length: nodes.length,
    hash_chain_breaks: hashBreaks,
    corruptions_applied: (scenario.corruptions || []).length,
    accepted_nodes: accepted,
    rejected_nodes: rejected,
  };

  return { detection, detection_ms: detectionMs, errors, metrics, notes };
}

function pushErr(arr, code) {
  if (!arr.includes(code)) arr.push(code);
}

function evaluate(expectations, result) {
  const failures = [];
  if (!!result.detection !== expectations.should_detect) failures.push('detection_mismatch');
  if (expectations.should_detect) {
    if (result.detection_ms == null) failures.push('missing_detection_ms');
    else if (expectations.max_detection_ms && result.detection_ms > expectations.max_detection_ms) failures.push('detection_sla');
  } else if (result.detection_ms !== null && result.detection_ms !== 0) {
    failures.push('unexpected_detection_ms');
  }

  const missing = (expectations.expected_errors || []).filter((e) => !result.errors.includes(e));
  if (missing.length) failures.push('missing_expected_errors');

  if (!expectations.allow_partial_accept && (result.metrics.rejected_nodes || 0) > 0) {
    failures.push('partial_accept_not_allowed');
  }

  if (!expectations.residual_divergence_allowed && (result.metrics.hash_chain_breaks || 0) > 0) {
    failures.push('residual_divergence');
  }

  return { status: failures.length ? 'fail' : 'pass', failures };
}

function main() {
  const corpus = loadCorpus(process.env.CORRUPTED_EARE_CORPUS || DEFAULT_CORPUS);
  const scenarios = corpus.map((raw) => raw);
  const summary = { corpus: DEFAULT_CORPUS, total: scenarios.length, failed: 0, passed: 0, scenarios: [] };

  for (const scenario of scenarios) {
    const result = simulate(scenario);
    const { status, failures } = evaluate(scenario.expectations, result);
    if (status !== 'pass') summary.failed += 1; else summary.passed += 1;
    summary.scenarios.push({
      scenario_id: scenario.scenario_id,
      status,
      failures,
      errors: result.errors,
      metrics: result.metrics,
      notes: result.notes,
    });
  }

  const outPath = writeJson(SUMMARY_FILE, summary);
  console.log(`Corrupted EARE (Node.js) summary written to ${outPath}`);
  if (summary.failed) {
    console.log(`❌ ${summary.failed} scenario(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All corrupted EARE scenarios passed');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}
