#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { inputPath } = require('../util/reporting');

function loadCorpus(p) {
  const resolved = path.isAbsolute(p) ? p : inputPath(p);
  const raw = fs.readFileSync(resolved, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Corpus root must be an array');
  return data;
}

function depth(nodeId, nodes) {
  let d = 0;
  const seen = new Set();
  let cur = nodes[nodeId];
  while (cur && cur.parent_id) {
    if (seen.has(cur.node_id)) break;
    seen.add(cur.node_id);
    d += 1;
    cur = nodes[cur.parent_id];
  }
  return d;
}

function simulate(scenario) {
  const nodes = {};
  for (const n of scenario.graph.nodes) {
    nodes[n.node_id] = n;
  }
  const events = scenario.event_stream
    .map((ev, idx) => ({ ...ev, _idx: idx }))
    .sort((a, b) => (a.t === b.t ? a._idx - b._idx : a.t - b.t));

  const observed = new Map(); // epoch_id -> [ [node_id, hash] ]
  const childrenByParent = new Map(); // parent_id -> [ {epoch_id,node_id,hash} ]
  let detection = false;
  let detectionTime = null;
  let forkCreated = null;
  const errors = [];
  let messagesDropped = 0;

  for (const ev of events) {
    if (ev.event === 'epoch_issue') {
      const node = nodes[ev.node_id];
      if (!node) throw new Error(`Unknown node_id ${ev.node_id}`);
      const epochEntries = observed.get(node.epoch_id) || [];
      const hashSet = new Set(epochEntries.map((e) => e[1]));

      const parentKey = node.parent_id || '';
      const parentChildren = childrenByParent.get(parentKey) || [];

      let forkDetected = false;
      if (!hashSet.has(node.eare_hash) && epochEntries.length >= 1) {
        forkDetected = true;
      }
      if (parentChildren.length >= 1) {
        const diff = !parentChildren.some(
          (c) => c.hash === node.eare_hash && c.epoch_id === node.epoch_id,
        );
        if (diff) forkDetected = true;
      }

      epochEntries.push([node.node_id, node.eare_hash]);
      observed.set(node.epoch_id, epochEntries);
      parentChildren.push({ epoch_id: node.epoch_id, node_id: node.node_id, hash: node.eare_hash });
      childrenByParent.set(parentKey, parentChildren);

      if (forkDetected) {
        if (forkCreated === null) forkCreated = ev.t;
        if (detectionTime === null) {
          detectionTime = ev.t;
          detection = true;
          if (!errors.includes('EPOCH_FORK_DETECTED')) errors.push('EPOCH_FORK_DETECTED');
        }
      }

      if (node.previous_epoch_hash && node.parent_id) {
        const parent = nodes[node.parent_id];
        if (parent && parent.eare_hash !== node.previous_epoch_hash) {
          if (!errors.includes('HASH_CHAIN_BREAK')) errors.push('HASH_CHAIN_BREAK');
        }
      }
    } else if (ev.event === 'replay_attempt' && ev.count) {
      messagesDropped += ev.count;
    }
  }

  const allEntries = [];
  for (const entries of observed.values()) {
    allEntries.push(...entries);
  }
  allEntries.sort((a, b) => {
    const na = nodes[a[0]];
    const nb = nodes[b[0]];
    const da = depth(na.node_id, nodes);
    const db = depth(nb.node_id, nodes);
    if (da !== db) return db - da;
    if (na.epoch_id !== nb.epoch_id) return nb.epoch_id - na.epoch_id;
    if (na.timestamp_ms !== nb.timestamp_ms) return na.timestamp_ms - nb.timestamp_ms;
    return na.eare_hash < nb.eare_hash ? 1 : -1;
  });
  let winningNode = null;
  if (allEntries.length > 0) {
    winningNode = nodes[allEntries[0][0]];
  }

  let detectionMs = null;
  const detectionRef = scenario.expectations.detection_reference === 'fork_observable'
    ? detectionTime
    : forkCreated ?? detectionTime;
  if (detectionTime !== null && detectionRef !== null) {
    detectionMs = Math.max(0, detectionTime - detectionRef);
  }

  let reconciliationMs = null;
  const mergeEvent = events.find((e) => e.event === 'merge');
  if (detectionTime !== null && mergeEvent) {
    reconciliationMs = Math.max(0, mergeEvent.t - detectionTime);
  }

  return {
    detection,
    detection_ms: detectionMs,
    reconciliation_ms: reconciliationMs,
    winning_epoch_id: winningNode ? winningNode.epoch_id : null,
    winning_hash: winningNode ? winningNode.eare_hash : null,
    winning_node_id: winningNode ? winningNode.node_id : null,
    messages_dropped: messagesDropped,
    errors,
    false_positives: { warnings: 0, hard_errors: 0 },
    healing_actions: [],
    notes: [],
  };
}

function evaluate(scenario, result) {
  const exp = scenario.expectations;
  const failures = [];
  if (result.detection !== exp.detected) failures.push('detection_mismatch');
  if (exp.detected) {
    if (result.detection_ms == null) failures.push('missing_detection_ms');
    else if (exp.max_detection_ms && result.detection_ms > exp.max_detection_ms) failures.push('detection_sla');
  }
  if (exp.reconciled_epoch.eare_hash && result.winning_hash && exp.reconciled_epoch.eare_hash !== result.winning_hash) {
    failures.push('winning_hash_mismatch');
  }
  if (exp.reconciled_epoch.epoch_id && result.winning_epoch_id && exp.reconciled_epoch.epoch_id !== result.winning_epoch_id) {
    failures.push('winning_epoch_mismatch');
  }
  if (exp.healing_required) {
    if (result.reconciliation_ms == null) failures.push('missing_reconciliation');
    else if (exp.max_reconciliation_ms && result.reconciliation_ms > exp.max_reconciliation_ms) failures.push('reconciliation_sla');
  }
  if (exp.allow_replay_gap.max_messages && result.messages_dropped > exp.allow_replay_gap.max_messages) {
    failures.push('replay_gap_messages');
  }
  const missingErrors = (exp.expected_error_categories || []).filter((e) => !result.errors.includes(e));
  if (missingErrors.length) failures.push('missing_error_categories');
  return failures;
}

function runScenario(scenario) {
  const res = simulate(scenario);
  const failures = evaluate(scenario, res);
  const status = failures.length === 0 ? 'pass' : 'fail';
  return {
    scenario_id: scenario.scenario_id,
    language: 'nodejs',
    status,
    ...res,
    failures,
  };
}

function main() {
  const argv = process.argv.slice(2);
  let corpusPath = 'tests/common/adversarial/epoch_forks.json';
  let scenarioId = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--corpus' && i + 1 < argv.length) {
      corpusPath = argv[i + 1];
      i += 1;
    } else if (arg === '--scenario' && i + 1 < argv.length) {
      scenarioId = argv[i + 1];
      i += 1;
    }
  }
  const corpus = loadCorpus(corpusPath);
  const selected = scenarioId ? corpus.filter((s) => s.scenario_id === scenarioId) : corpus;
  if (selected.length === 0) {
    console.error('No matching scenarios');
    process.exit(1);
  }
  for (const scenario of selected) {
    const env = runScenario(scenario);
    process.stdout.write(`${JSON.stringify(env)}\n`);
  }
}

if (require.main === module) {
  main();
}
