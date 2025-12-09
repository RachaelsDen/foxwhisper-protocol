import { describe, expect, it } from 'vitest';
import corpus from '../../../tests/common/adversarial/sfu_abuse.json';
import { MinimalSfu } from '../src/sfu.js';

const sampleScenario = (corpus as any[]).find((s) => s.scenario_id === 'ghost_subscribe_and_impersonate');

describe('SFU transcript reflects abuse detection', () => {
  it('records denied entries for ghost subscribe', () => {
    const sfu = new MinimalSfu({
      roomId: sampleScenario.sfu_context.room_id,
      callId: sampleScenario.sfu_context.room_id,
      sfuId: sampleScenario.sfu_context.sfu_id,
      expectedParticipants: sampleScenario.sfu_context.expected_participants,
      policy: { acceptAnyToken: true },
      clientAuthKey: Buffer.alloc(32, 1),
    });

    const events = [...sampleScenario.timeline].sort((a, b) => (a.t === b.t ? String(a.event).localeCompare(String(b.event)) : a.t - b.t));

    for (const ev of events) {
      if (ev.event === 'join') {
        sfu.join(ev.participant, { token: ev.token ?? 't', nonce: String(ev.t), timestamp_ms: ev.t });
      } else if (ev.event === 'publish') {
        sfu.publishTrack(ev.participant, { trackId: ev.track_id, kind: 'video', layers: ev.layers });
      } else if (ev.event === 'subscribe') {
        sfu.subscribeTrack(ev.participant, ev.track_id, { layers: ev.requested_layers });
      } else if (ev.event === 'ghost_subscribe') {
        sfu.markGhostSubscribe(ev.track_id, ev.participant);
      }
    }

    const denied = sfu.getTranscript().filter((e) => e.routing_action === 'denied');
    expect(denied.length).toBeGreaterThan(0);
    const hasGhost = denied.some((e) => e.reason === 'UNAUTHORIZED_SUBSCRIBE');
    expect(hasGhost).toBe(true);
  });
});
