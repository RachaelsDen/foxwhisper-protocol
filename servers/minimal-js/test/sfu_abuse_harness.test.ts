import { describe, expect, it } from 'vitest';
import corpus from '../../../tests/common/adversarial/sfu_abuse.json';
import { MinimalSfu } from '../src/sfu.js';
import type { SfuErrorCode } from '../src/sfu_types.js';

type Scenario = (typeof corpus)[number];

type EvaluationFailure =
  | 'detection_mismatch'
  | 'missing_detection_ms'
  | 'detection_sla'
  | 'missing_expected_errors'
  | 'hijacked_tracks_exceeded'
  | 'unauthorized_tracks_exceeded'
  | 'key_leak_exceeded'
  | 'latency_exceeded'
  | 'false_positive_blocks_exceeded'
  | 'false_negative_leaks_exceeded'
  | 'residual_routing';

describe('SFU abuse corpus harness (MinimalSfu)', () => {
  for (const scenario of corpus as Scenario[]) {
    it(`scenario: ${scenario.scenario_id}`, () => {
      const sfu = new MinimalSfu({
        roomId: scenario.sfu_context.room_id,
        callId: scenario.sfu_context.room_id,
        sfuId: scenario.sfu_context.sfu_id,
        expectedParticipants: scenario.sfu_context.expected_participants,
        policy: { acceptAnyToken: true },
        clientAuthKey: Buffer.alloc(32, 1),
      });

      const errors: SfuErrorCode[] = [];
      let detectionMs: number | null = null;

      const participants = new Map<string, { tokens: string[]; tracks: { id: string; layers?: string[] }[] }>();
      for (const p of scenario.participants) {
        participants.set(p.id, { tokens: p.authz_tokens ?? [], tracks: p.tracks ?? [] });
      }
      const authed = new Set<string>();

      const sortedEvents = [...scenario.timeline].sort((a, b) => {
        if (a.t === b.t) return String(a.event).localeCompare(String(b.event));
        return a.t - b.t;
      });

      const recordError = (code: SfuErrorCode, t: number) => {
        if (!errors.includes(code)) errors.push(code);
        if (detectionMs === null) detectionMs = t;
      };

      for (let i = 0; i < sortedEvents.length; i += 1) {
        const ev = sortedEvents[i];
        switch (ev.event) {
          case 'join': {
            const token = ev.token ?? 'token';
            const res = sfu.join(ev.participant, { token, nonce: String(ev.t), timestamp_ms: ev.t });
            if (res.ok) authed.add(ev.participant);
            if (!res.ok) recordError(res.error, ev.t);
            break;
          }
          case 'publish': {
            if (!authed.has(ev.participant) && ev.token) {
              const res = sfu.join(ev.participant, { token: ev.token, nonce: String(ev.t), timestamp_ms: ev.t });
              if (res.ok) authed.add(ev.participant);
              else recordError(res.error, ev.t);
            }
            const err = sfu.publishTrack(ev.participant, {
              trackId: ev.track_id,
              kind: 'video',
              layers: Array.isArray(ev.layers) ? ev.layers : [],
            });
            if (err) recordError(err, ev.t);
            break;
          }
          case 'subscribe': {
            if (!authed.has(ev.participant) && ev.token) {
              const res = sfu.join(ev.participant, { token: ev.token, nonce: String(ev.t), timestamp_ms: ev.t });
              if (res.ok) authed.add(ev.participant);
              else recordError(res.error, ev.t);
            }
            const res = sfu.subscribeTrack(ev.participant, ev.track_id, { layers: ev.requested_layers });
            if (!res.allowed) recordError(res.error, ev.t);
            break;
          }
          case 'ghost_subscribe': {
            recordError(sfu.markGhostSubscribe(ev.track_id, ev.participant), ev.t);
            break;
          }
          case 'impersonate': {
            recordError(sfu.markImpersonation(ev.participant), ev.t);
            break;
          }
          case 'replay_track': {
            recordError(sfu.markReplayTrack(ev.track_id), ev.t);
            break;
          }
          case 'dup_track': {
            recordError(sfu.markDuplicateRoute(ev.track_id), ev.t);
            break;
          }
          case 'simulcast_spoof': {
            const res = sfu.subscribeTrack(ev.participant, ev.track_id, { layers: ev.requested_layers });
            if (!res.allowed) recordError(res.error, ev.t);
            break;
          }
          case 'bitrate_abuse': {
            recordError(sfu.markBitrateAbuse(ev.track_id, ev.participant, ev.reported_bitrate), ev.t);
            break;
          }
          case 'key_rotation_skip':
          case 'stale_key_reuse': {
            recordError(sfu.markStaleKeyReuse(ev.track_id), ev.t);
            break;
          }
          case 'steal_key': {
            recordError(sfu.markKeyLeakAttempt(ev.track_id), ev.t);
            break;
          }
          default:
            break;
        }
      }

      const detection = errors.length > 0;
      const metrics = sfu.getMetrics();
      const failures: EvaluationFailure[] = [];
      const exp = scenario.expectations;

      if (detection !== exp.should_detect) failures.push('detection_mismatch');
      if (exp.should_detect) {
        if (detectionMs == null) failures.push('missing_detection_ms');
        else if (exp.max_detection_ms && detectionMs > exp.max_detection_ms) failures.push('detection_sla');
      } else if (detectionMs !== null && detectionMs !== 0) {
        failures.push('missing_detection_ms');
      }

      const missingErrors = (exp.expected_errors ?? []).filter((code) => !errors.includes(code as SfuErrorCode));
      if (missingErrors.length) failures.push('missing_expected_errors');

      if (metrics.hijacked_tracks > exp.max_hijacked_tracks) failures.push('hijacked_tracks_exceeded');
      if (metrics.unauthorized_tracks > exp.max_unauthorized_tracks) failures.push('unauthorized_tracks_exceeded');
      if (metrics.key_leak_attempts > exp.max_key_leak_attempts) failures.push('key_leak_exceeded');
      const latency = detectionMs ?? 0;
      if (latency > exp.max_extra_latency_ms) failures.push('latency_exceeded');
      if (metrics.false_positive_blocks > exp.max_false_positive_blocks) failures.push('false_positive_blocks_exceeded');
      if (metrics.false_negative_leaks > exp.max_false_negative_leaks) failures.push('false_negative_leaks_exceeded');
      if (!exp.residual_routing_allowed && metrics.duplicate_routes > 0) failures.push('residual_routing');

      if (failures.length) {
        // Surface helpful context when failing
        // eslint-disable-next-line no-console
        console.error('failures', { scenario: scenario.scenario_id, errors, metrics, detectionMs });
        expect(failures).toEqual([]);
      }
    });
  }
});
