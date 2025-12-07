'use strict';

const fs = require('fs');
const { inputPath, writeJson } = require('../util/reporting');

const DEFAULT_CORPUS = 'tests/common/adversarial/sfu_abuse.json';
const SUMMARY_FILE = 'nodejs_sfu_abuse_summary.json';

const ERROR_CODES = new Set([
  'UNAUTHORIZED_SUBSCRIBE',
  'IMPERSONATION',
  'KEY_LEAK_ATTEMPT',
  'STALE_KEY_REUSE',
  'DUPLICATE_ROUTE',
  'REPLAY_TRACK',
  'HIJACKED_TRACK',
  'SIMULCAST_SPOOF',
  'BITRATE_ABUSE',
]);

function loadCorpus(relPath) {
  const full = inputPath(relPath);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Corpus root must be an array');
  return raw;
}

function simulate(scenario) {
  const errors = [];
  const notes = [];

  const authed = new Set();
  const roomExpected = new Set((scenario.sfu_context?.expected_participants) || []);
  const routes = new Map(); // track_id -> participant
  const trackLayers = new Map();
  const affectedParticipants = new Set();

  let keyLeakAttempts = 0;
  let hijackedTracks = 0;
  let unauthorizedTracks = 0;
  let replayedTracks = 0;
  let duplicateRoutes = 0;
  let simulcastSpoofs = 0;
  let bitrateAbuseEvents = 0;
  let falsePositiveBlocks = 0;
  let falseNegativeLeaks = 0;

  let detectionTime = null;

  const events = [...(scenario.timeline || [])].sort((a, b) => {
    if ((a.t || 0) === (b.t || 0)) return String(a.event).localeCompare(String(b.event));
    return (a.t || 0) - (b.t || 0);
  });

  const participants = new Map();
  for (const p of scenario.participants || []) {
    participants.set(p.id, p);
  }

  for (const ev of events) {
    const e = ev.event;
    const t = ev.t || 0;

    if (e === 'join') {
      const pid = ev.participant;
      const token = ev.token;
      const part = participants.get(pid);
      if (!part || !part.authz_tokens?.includes(token)) {
        pushErr(errors, 'IMPERSONATION');
      } else {
        authed.add(pid);
      }
    } else if (e === 'publish') {
      const pid = ev.participant;
      const trackId = ev.track_id;
      const layers = Array.isArray(ev.layers) ? ev.layers : [];
      if (!authed.has(pid)) {
        pushErr(errors, 'UNAUTHORIZED_SUBSCRIBE');
        unauthorizedTracks += 1;
      } else {
        routes.set(trackId, pid);
        trackLayers.set(trackId, layers);
      }
    } else if (e === 'subscribe') {
      const pid = ev.participant;
      const trackId = ev.track_id;
      if (!authed.has(pid) || !routes.has(trackId)) {
        pushErr(errors, 'UNAUTHORIZED_SUBSCRIBE');
        unauthorizedTracks += 1;
      }
    } else if (e === 'ghost_subscribe') {
      const pid = ev.participant;
      pushErr(errors, 'UNAUTHORIZED_SUBSCRIBE');
      unauthorizedTracks += 1;
      affectedParticipants.add(pid || 'ghost');
    } else if (e === 'impersonate') {
      const pid = ev.participant;
      pushErr(errors, 'IMPERSONATION');
      affectedParticipants.add(pid || 'unknown');
    } else if (e === 'replay_track') {
      const trackId = ev.track_id;
      if (routes.has(trackId)) {
        pushErr(errors, 'REPLAY_TRACK');
        replayedTracks += 1;
      }
    } else if (e === 'dup_track') {
      const trackId = ev.track_id;
      if (routes.has(trackId)) {
        pushErr(errors, 'DUPLICATE_ROUTE');
        duplicateRoutes += 1;
      }
    } else if (e === 'simulcast_spoof') {
      const trackId = ev.track_id;
      const requested = Array.isArray(ev.requested_layers) ? ev.requested_layers : [];
      const allowed = trackLayers.get(trackId) || [];
      if (requested.some((layer) => !allowed.includes(layer))) {
        pushErr(errors, 'SIMULCAST_SPOOF');
        simulcastSpoofs += 1;
      }
    } else if (e === 'bitrate_abuse') {
      pushErr(errors, 'BITRATE_ABUSE');
      bitrateAbuseEvents += 1;
    } else if (e === 'key_rotation_skip' || e === 'stale_key_reuse') {
      pushErr(errors, 'STALE_KEY_REUSE');
      keyLeakAttempts += 1;
    } else if (e === 'steal_key') {
      pushErr(errors, 'KEY_LEAK_ATTEMPT');
      keyLeakAttempts += 1;
    }

    if (errors.length && detectionTime === null) detectionTime = t;
  }

  const detection = errors.length > 0;
  const detectionMs = detectionTime;

  const metrics = {
    unauthorized_tracks: unauthorizedTracks,
    hijacked_tracks: hijackedTracks,
    impersonation_attempts: errors.includes('IMPERSONATION') ? 1 : 0,
    key_leak_attempts: keyLeakAttempts,
    duplicate_routes: duplicateRoutes,
    replayed_tracks: replayedTracks,
    simulcast_spoofs: simulcastSpoofs,
    bitrate_abuse_events: bitrateAbuseEvents,
    accepted_tracks: routes.size,
    rejected_tracks: unauthorizedTracks,
    false_positive_blocks: falsePositiveBlocks,
    false_negative_leaks: falseNegativeLeaks,
    max_extra_latency_ms: detectionMs || 0,
    affected_participant_count: affectedParticipants.size,
  };

  return { detection, detection_ms: detectionMs, errors, metrics, notes };
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

  if (result.metrics.hijacked_tracks > expectations.max_hijacked_tracks) failures.push('hijacked_tracks_exceeded');
  if (result.metrics.unauthorized_tracks > expectations.max_unauthorized_tracks) failures.push('unauthorized_tracks_exceeded');
  if (result.metrics.key_leak_attempts > expectations.max_key_leak_attempts) failures.push('key_leak_exceeded');
  if (result.metrics.max_extra_latency_ms > expectations.max_extra_latency_ms) failures.push('latency_exceeded');
  if (result.metrics.false_positive_blocks > expectations.max_false_positive_blocks) failures.push('false_positive_blocks_exceeded');
  if (result.metrics.false_negative_leaks > expectations.max_false_negative_leaks) failures.push('false_negative_leaks_exceeded');

  if (!expectations.residual_routing_allowed && result.metrics.duplicate_routes > 0) {
    failures.push('residual_routing');
  }

  return { status: failures.length ? 'fail' : 'pass', failures };
}

function main() {
  const corpus = loadCorpus(process.env.SFU_ABUSE_CORPUS || DEFAULT_CORPUS);
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
  console.log(`SFU abuse (Node.js) summary written to ${outPath}`);
  if (summary.failed) {
    console.log(`❌ ${summary.failed} scenario(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All SFU abuse scenarios passed');
    process.exit(0);
  }
}

function pushErr(arr, code) {
  if (!arr.includes(code)) arr.push(code);
}

if (require.main === module) {
  main();
}
