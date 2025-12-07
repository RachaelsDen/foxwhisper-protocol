'use strict';

const fs = require('fs');
const path = require('path');
const { inputPath, writeJson } = require('../util/reporting');

const DEFAULT_CORPUS = 'tests/common/adversarial/device_desync.json';
const SUMMARY_FILE = 'nodejs_device_desync_summary.json';

function loadCorpus(relPath) {
  const full = inputPath(relPath);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error('Corpus root must be an array');
  }
  return raw;
}

function cloneDevices(devices) {
  const out = new Map();
  for (const d of devices) {
    out.set(d.device_id, {
      device_id: d.device_id,
      dr_version: d.dr_version,
      clock_ms: d.clock_ms || 0,
      state_hash: d.state_hash ?? null,
    });
  }
  return out;
}

function currentDrStats(devices) {
  const versions = Array.from(devices.values()).map((d) => d.dr_version);
  const min = Math.min(...versions);
  const max = Math.max(...versions);
  return { min, max, delta: max - min };
}

function simulate(scenario) {
  const devices = cloneDevices(scenario.devices);
  const messages = new Map();

  let detectionTime = null;
  let divergenceStart = null;
  let recoveryTime = null;

  let delivered = 0;
  let expected = 0;
  let dropped = 0;
  let outOfOrder = 0;
  let drIntegral = 0;
  let drSamples = 0;
  let maxDrDelta = 0;
  let maxDivergedCount = 0;
  let maxClockSkew = 0;
  let skewViolations = 0;
  let recoveryAttempts = 0;
  let successfulRecoveries = 0;
  let failedRecoveries = 0;
  let maxRollback = 0;
  const errors = [];
  const notes = [];

  const addError = (code, at) => {
    if (!errors.includes(code)) {
      errors.push(code);
    }
    if (detectionTime === null && typeof at === 'number') {
      detectionTime = at;
    }
  };

  const sortedEvents = [...scenario.timeline].sort((a, b) => {
    if (a.t === b.t) return a.event.localeCompare(b.event);
    return a.t - b.t;
  });

  for (const ev of sortedEvents) {
    for (const dev of devices.values()) {
      dev.clock_ms = Math.max(dev.clock_ms, ev.t);
    }

    switch (ev.event) {
      case 'send': {
        const { msg_id: msgId, from, to = [], dr_version: drVersion, state_hash: stateHash } = ev;
        if (typeof msgId !== 'string' || typeof from !== 'string' || !Array.isArray(to)) {
          throw new Error(`[${scenario.scenario_id}] invalid send event`);
        }
        if (!devices.has(from)) {
          throw new Error(`[${scenario.scenario_id}] send references unknown device ${from}`);
        }
        if (!messages.has(msgId)) {
          messages.set(msgId, {
            msg_id: msgId,
            sender: from,
            targets: to.map(String),
            dr_version: drVersion != null ? Number(drVersion) : devices.get(from).dr_version,
            state_hash: typeof stateHash === 'string' ? stateHash : null,
            send_time: ev.t,
            delivered: new Set(),
            dropped: new Set(),
            replay_count: 0,
          });
        } else {
          messages.get(msgId).replay_count += 1;
        }
        expected += to.length;
        const senderState = devices.get(from);
        const newVer = drVersion != null ? Number(drVersion) : senderState.dr_version;
        if (newVer < senderState.dr_version) {
          maxRollback = Math.max(maxRollback, senderState.dr_version - newVer);
        }
        senderState.dr_version = newVer;
        if (typeof stateHash === 'string') {
          senderState.state_hash = stateHash;
        }
        break;
      }
      case 'recv': {
        const { msg_id: msgId, device } = ev;
        if (!messages.has(msgId) || !devices.has(device)) {
          addError('UNKNOWN_MESSAGE', ev.t);
        }
        if (messages.has(msgId) && devices.has(device)) {
          const envelope = messages.get(msgId);
          if (envelope.delivered.has(device)) {
            addError('DUPLICATE_DELIVERY');
          }
          if (ev.t < envelope.send_time) {
            outOfOrder += 1;
          }
          envelope.delivered.add(device);
          delivered += 1;
          const devState = devices.get(device);
          if (ev.apply_dr_version != null) {
            const applyVer = Number(ev.apply_dr_version);
            if (applyVer < devState.dr_version) {
              maxRollback = Math.max(maxRollback, devState.dr_version - applyVer);
            }
            devState.dr_version = applyVer;
          }
          if (typeof ev.state_hash === 'string') {
            devState.state_hash = ev.state_hash;
          }
        }
        break;
      }
      case 'drop': {
        const { msg_id: msgId, targets } = ev;
        if (!messages.has(msgId)) {
          addError('UNKNOWN_MESSAGE', ev.t);
        } else {
          const envelope = messages.get(msgId);
          const targetList = Array.isArray(targets) ? targets.map(String) : envelope.targets;
          targetList.forEach((t) => envelope.dropped.add(t));
          dropped += targetList.length;
        }
        break;
      }
      case 'replay': {
        const { msg_id: msgId, from, to = [], dr_version: drVersion } = ev;
        if (typeof msgId !== 'string' || typeof from !== 'string') {
          throw new Error(`[${scenario.scenario_id}] invalid replay event`);
        }
        if (!devices.has(from)) {
          throw new Error(`[${scenario.scenario_id}] replay references unknown device ${from}`);
        }
        if (!messages.has(msgId)) {
          messages.set(msgId, {
            msg_id: msgId,
            sender: from,
            targets: to.map(String),
            dr_version: drVersion != null ? Number(drVersion) : devices.get(from).dr_version,
            state_hash: null,
            send_time: ev.t,
            delivered: new Set(),
            dropped: new Set(),
            replay_count: 1,
          });
        } else {
          messages.get(msgId).replay_count += 1;
        }
        expected += to.length;
        addError('REPLAY_INJECTED', ev.t);
        break;
      }
      case 'backup_restore': {
        const { device, dr_version: drVersion, state_hash: stateHash } = ev;
        if (!devices.has(device) || typeof drVersion !== 'number') {
          throw new Error(`[${scenario.scenario_id}] invalid backup_restore event`);
        }
        const devState = devices.get(device);
        if (drVersion < devState.dr_version) {
          maxRollback = Math.max(maxRollback, devState.dr_version - drVersion);
          addError('ROLLBACK_APPLIED', ev.t);
        }
        devState.dr_version = drVersion;
        if (typeof stateHash === 'string') {
          devState.state_hash = stateHash;
        }
        break;
      }
      case 'clock_skew': {
        const { device, delta_ms: delta } = ev;
        if (!devices.has(device) || typeof delta !== 'number') {
          throw new Error(`[${scenario.scenario_id}] invalid clock_skew event`);
        }
        devices.get(device).clock_ms += delta;
        maxClockSkew = Math.max(maxClockSkew, clockRange(devices));
        if (maxClockSkew > scenario.expectations.max_clock_skew_ms) {
          skewViolations += 1;
          addError('CLOCK_SKEW_VIOLATION', ev.t);
        }
        break;
      }
      case 'resync': {
        const { device, target_dr_version: targetVersion, state_hash: stateHash } = ev;
        if (!devices.has(device) || typeof targetVersion !== 'number') {
          throw new Error(`[${scenario.scenario_id}] invalid resync event`);
        }
        recoveryAttempts += 1;
        const devState = devices.get(device);
        const beforeDelta = currentDrStats(devices).delta;
        if (targetVersion < devState.dr_version) {
          maxRollback = Math.max(maxRollback, devState.dr_version - targetVersion);
        }
        devState.dr_version = targetVersion;
        if (typeof stateHash === 'string') {
          devState.state_hash = stateHash;
        }
        const afterDelta = currentDrStats(devices).delta;
        if (afterDelta === 0) {
          successfulRecoveries += 1;
        } else if (afterDelta < beforeDelta) {
          notes.push(`resync on ${device} reduced divergence`);
        } else {
          failedRecoveries += 1;
        }
        break;
      }
      default:
        throw new Error(`[${scenario.scenario_id}] unsupported event type ${ev.event}`);
    }

    const stats = currentDrStats(devices);
    drIntegral += stats.delta;
    drSamples += 1;
    maxDrDelta = Math.max(maxDrDelta, stats.delta);

    const divergenceActive = stats.delta > 0;
    if (divergenceActive && divergenceStart === null) {
      divergenceStart = ev.t;
      if (detectionTime === null) detectionTime = ev.t;
    }
    if (divergenceActive) {
      if (!errors.includes('DIVERGENCE_DETECTED')) {
        errors.push('DIVERGENCE_DETECTED');
      }
    }
    if (!divergenceActive && divergenceStart !== null && recoveryTime === null) {
      recoveryTime = ev.t;
    }

    const divergentDevices = Array.from(devices.values()).filter((d) => d.dr_version !== stats.min);
    maxDivergedCount = Math.max(maxDivergedCount, divergentDevices.length);
    maxClockSkew = Math.max(maxClockSkew, clockRange(devices));
  }

  if (divergenceStart === null && errors.length) {
    divergenceStart = sortedEvents[0] ? sortedEvents[0].t : 0;
    detectionTime = detectionTime ?? divergenceStart;
  }

  const residualDivergence = currentDrStats(devices).delta > 0;
  const detectionMs = detectionTime !== null && divergenceStart !== null ? Math.max(0, detectionTime - divergenceStart) : null;
  const recoveryMs = recoveryTime !== null && detectionTime !== null ? Math.max(0, recoveryTime - detectionTime) : null;

  const messageLossRate = expected > 0 ? Math.max(0, (expected - delivered) / expected) : 0;
  const outOfOrderRate = delivered > 0 ? outOfOrder / delivered : 0;
  const avgDrDelta = drSamples ? drIntegral / drSamples : 0;

  if (messageLossRate > 0) addError('MESSAGE_LOSS');
  if (outOfOrder > 0) addError('OUT_OF_ORDER');

  const metrics = {
    max_dr_version_delta: maxDrDelta,
    avg_dr_version_delta: avgDrDelta,
    max_clock_skew_ms: maxClockSkew,
    diverged_device_count: Array.from(devices.values()).filter((d) => d.dr_version !== currentDrStats(devices).min).length,
    max_diverged_device_count: maxDivergedCount,
    delivered_messages: delivered,
    expected_messages: expected,
    message_loss_rate: messageLossRate,
    out_of_order_deliveries: outOfOrder,
    out_of_order_rate: outOfOrderRate,
    skew_violations: skewViolations,
    recovery_attempts: recoveryAttempts,
    successful_recoveries: successfulRecoveries,
    failed_recoveries: failedRecoveries,
    max_rollback_events: maxRollback,
    residual_divergence: residualDivergence,
  };

  return {
    detection: divergenceStart !== null || errors.length > 0,
    detection_ms: detectionMs,
    recovery_ms: recoveryMs,
    errors,
    notes,
    metrics,
  };
}

function clockRange(devices) {
  const clocks = Array.from(devices.values()).map((d) => d.clock_ms);
  if (!clocks.length) return 0;
  return Math.max(...clocks) - Math.min(...clocks);
}

function evaluate(expectations, result) {
  const failures = [];
  if (!!result.detection !== expectations.detected) failures.push('detection_mismatch');
  if (expectations.detected) {
    if (result.detection_ms == null) failures.push('missing_detection_ms');
    else if (expectations.max_detection_ms && result.detection_ms > expectations.max_detection_ms) failures.push('detection_sla');
  } else if (result.detection_ms !== null && result.detection_ms !== 0) {
    failures.push('unexpected_detection_ms');
  }

  if (expectations.healing_required) {
    if (result.recovery_ms == null) failures.push('missing_recovery_ms');
    else if (expectations.max_recovery_ms && result.recovery_ms > expectations.max_recovery_ms) failures.push('recovery_sla');
    if (!expectations.residual_divergence_allowed && result.metrics.residual_divergence) failures.push('residual_divergence');
  }

  if (result.metrics.max_dr_version_delta > expectations.max_dr_version_delta) failures.push('dr_delta_exceeded');
  if (result.metrics.max_clock_skew_ms > expectations.max_clock_skew_ms) failures.push('clock_skew_exceeded');
  if (result.metrics.message_loss_rate > expectations.allow_message_loss_rate) failures.push('message_loss_rate');
  if (result.metrics.out_of_order_rate > expectations.allow_out_of_order_rate) failures.push('out_of_order_rate');
  if (result.metrics.max_rollback_events > expectations.max_rollback_events) failures.push('rollback_exceeded');

  const missing = (expectations.expected_error_categories || []).filter((code) => !result.errors.includes(code));
  if (missing.length) failures.push('missing_error_categories');

  return { status: failures.length ? 'fail' : 'pass', failures };
}

function main() {
  const corpus = loadCorpus(process.env.DEVICE_DESYNC_CORPUS || DEFAULT_CORPUS);
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
  console.log(`Device desync (Node.js) summary written to ${outPath}`);
  if (summary.failed) {
    console.log(`❌ ${summary.failed} scenario(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All device desync scenarios passed');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}
