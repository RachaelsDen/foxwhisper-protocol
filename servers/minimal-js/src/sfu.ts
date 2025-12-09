import { createHash } from 'crypto';
import cbor from 'cbor';
import { verifyClientAuthToken } from './crypto/sfu_auth.js';
import type {
  SfuAuditLogger,
  SfuAuthContext,
  SfuConfig,
  SfuErrorCode,
  SfuFrameMeta,
  SfuJoinResult,
  SfuKeyGrant,
  SfuKeyRequestResult,
  SfuLogger,
  SfuParticipant,
  SfuPolicy,
  SfuSubscribeResult,
  SfuTrack,
  SfuTranscriptEntry,
} from './sfu_types.js';

/**
 * MinimalSfu is an in-process reference handler used for testing/validation.
 * Invariants (enforced in methods; mirrored in abuse corpus expectations):
 * - Only authenticated participants may join, publish, subscribe, or request keys.
 * - Track IDs map one-to-one to publishers; duplicates flag DUPLICATE_ROUTE.
 * - Subscriptions must reference existing tracks and stay within advertised layers.
 * - Auth tokens should be time/nonce bounded (replay/skew rejected upstream).
 * - Transcript entries never include payloads or raw keys—only IDs/digests.
 */
export class MinimalSfu {
  private readonly config: SfuConfig;
  private readonly policy: SfuPolicy;
  private readonly logFn: SfuLogger;
  private readonly auditFn: SfuAuditLogger;

  private participants = new Map<string, SfuParticipant>();
  private tracks = new Map<string, SfuTrack>();
  private subscriptions = new Map<string, Set<string>>(); // trackId -> subscriberIds
  private authState = new Set<string>();
  private keyGrants = new Map<string, Map<string, SfuKeyGrant>>(); // participantId -> keyId -> grant
  private nonceCache = new Set<string>();
  private transcript: SfuTranscriptEntry[] = [];

  private metrics = {
    unauthorized_tracks: 0,
    hijacked_tracks: 0,
    key_leak_attempts: 0,
    duplicate_routes: 0,
    replayed_tracks: 0,
    simulcast_spoofs: 0,
    bitrate_abuse_events: 0,
    impersonation_attempts: 0,
    accepted_tracks: 0,
    rejected_tracks: 0,
    false_positive_blocks: 0,
    false_negative_leaks: 0,
  };

  constructor(config: SfuConfig) {
    this.config = config;
    this.policy = config.policy ?? {};
    this.logFn = config.logger ?? (() => {});
    this.auditFn = config.auditLogger ?? (() => {});
    if (config.expectedParticipants?.length) {
      for (const pid of config.expectedParticipants) {
        this.participants.set(pid, { id: pid, role: 'subscriber' });
      }
    }
  }

  authenticate(participantId: string, ctx: SfuAuthContext): boolean {
    if (!participantId || !ctx?.token) {
      this.metrics.unauthorized_tracks += 1;
      this.metrics.rejected_tracks += 1;
      this.log('sfu:auth:missing', { participant_id: participantId });
      return false;
    }
    if (this.policy.acceptAnyToken) {
      this.authState.add(participantId);
      this.log('sfu:auth:any', { participant_id: participantId });
      return true;
    }
    const clientKey = this.config.clientAuthKey ?? this.config.sfuSecretKey;
    if (!clientKey) {
      this.log('sfu:auth:no-key', { participant_id: participantId });
      return false;
    }
    const callId = this.config.callId ?? this.config.roomId ?? '';
    const verifyResult = verifyClientAuthToken(clientKey, ctx.token, {
      callId,
      clientId: participantId,
      timestampMs: ctx.timestamp_ms ?? Date.now(),
      nonce: ctx.nonce ?? '',
      nowMs: Date.now(),
      maxSkewMs: ctx.skew_ms ?? this.policy.tokenMaxSkewMs,
      nonceCache: this.nonceCache,
    });
    if (!verifyResult.ok) {
      const mapped = this.mapAuthError(verifyResult.error);
      this.recordError(mapped);
      this.metrics.unauthorized_tracks += 1;
      this.metrics.rejected_tracks += 1;
      this.log('sfu:auth:fail', { participant_id: participantId, error: mapped, detail: verifyResult.error });
      return false;
    }
    this.authState.add(participantId);
    this.log('sfu:auth:ok', { participant_id: participantId });
    return true;
  }

  join(participantId: string, authCtx?: SfuAuthContext): SfuJoinResult {
    if (!this.authState.has(participantId)) {
      if (authCtx && this.authenticate(participantId, authCtx)) {
        // fallthrough
      } else {
        this.metrics.unauthorized_tracks += 1;
        return { ok: false, error: 'UNAUTHORIZED_SUBSCRIBE', note: 'participant not authenticated' };
      }
    }
    const already = this.participants.has(participantId);
    const participant = this.participants.get(participantId) ?? { id: participantId, role: 'both' };
    this.participants.set(participantId, participant);
    this.log(already ? 'sfu:join:dup' : 'sfu:join', { participant_id: participantId });
    this.audit('sfu:join', { participant_id: participantId, room_id: this.config.roomId });
    return { ok: true };
  }

  leave(participantId: string) {
    const wasPresent = this.participants.delete(participantId);
    this.authState.delete(participantId);
    for (const [trackId, owner] of this.tracks) {
      if (owner.publisherId === participantId) {
        this.tracks.delete(trackId);
        this.subscriptions.delete(trackId);
      }
    }
    for (const [, subs] of this.subscriptions) {
      subs.delete(participantId);
    }
    this.log(wasPresent ? 'sfu:leave' : 'sfu:leave:noop', { participant_id: participantId });
    this.audit('sfu:leave', { participant_id: participantId, room_id: this.config.roomId });
  }

  publishTrack(participantId: string, track: Omit<SfuTrack, 'publisherId'> & { trackId: string }): SfuErrorCode | null {
    if (!this.authState.has(participantId) || !this.participants.has(participantId)) {
      this.metrics.unauthorized_tracks += 1;
      this.metrics.rejected_tracks += 1;
      return 'UNAUTHORIZED_SUBSCRIBE';
    }
    const existing = this.tracks.get(track.trackId);
    if (existing && existing.publisherId !== participantId) {
      this.metrics.duplicate_routes += 1;
      this.metrics.rejected_tracks += 1;
      return 'DUPLICATE_ROUTE';
    }
    const layers = Array.isArray(track.layers) ? track.layers : [];
    this.tracks.set(track.trackId, { ...track, publisherId: participantId, layers });
    this.metrics.accepted_tracks += 1;
    this.log(existing ? 'sfu:publish:dup' : 'sfu:publish', { participant_id: participantId, track_id: track.trackId, layers });
    return null;
  }

  subscribeTrack(subscriberId: string, trackId: string, options?: { layers?: string[] }): SfuSubscribeResult {
    if (!this.authState.has(subscriberId) || !this.participants.has(subscriberId)) {
      this.metrics.unauthorized_tracks += 1;
      this.metrics.rejected_tracks += 1;
      return { allowed: false, error: 'UNAUTHORIZED_SUBSCRIBE', note: 'subscriber not authenticated' };
    }
    const track = this.tracks.get(trackId);
    if (!track) {
      this.metrics.unauthorized_tracks += 1;
      this.metrics.rejected_tracks += 1;
      return { allowed: false, error: 'UNAUTHORIZED_SUBSCRIBE', note: 'track missing' };
    }
    const requestedLayers = options?.layers ?? [];
    if (requestedLayers.length && track.layers?.length) {
      const badLayer = requestedLayers.find((layer) => !track.layers?.includes(layer));
      if (badLayer) {
        this.metrics.simulcast_spoofs += 1;
        this.metrics.rejected_tracks += 1;
        return { allowed: false, error: 'SIMULCAST_SPOOF', note: `layer ${badLayer} not allowed` };
      }
    }
    const currentSubs = this.subscriptions.get(trackId) ?? new Set<string>();
    if (this.policy.maxSubscribersPerTrack && currentSubs.size >= this.policy.maxSubscribersPerTrack) {
      this.metrics.rejected_tracks += 1;
      return { allowed: false, error: 'UNAUTHORIZED_SUBSCRIBE', note: 'subscription limit exceeded' };
    }
    currentSubs.add(subscriberId);
    this.subscriptions.set(trackId, currentSubs);
    this.log('sfu:subscribe', { subscriber_id: subscriberId, track_id: trackId, layers: requestedLayers });
    return { allowed: true };
  }

  markGhostSubscribe(trackId: string, participantId?: string): SfuErrorCode {
    this.metrics.unauthorized_tracks += 1;
    this.metrics.rejected_tracks += 1;
    this.recordTranscript({
      call_id: this.config.callId,
      room_id: this.config.roomId,
      sfu_id: this.config.sfuId,
      track_id: trackId,
      participant_id: participantId,
      routing_action: 'denied',
      reason: 'UNAUTHORIZED_SUBSCRIBE',
    });
    return 'UNAUTHORIZED_SUBSCRIBE';
  }

  markImpersonation(participantId?: string): SfuErrorCode {
    this.metrics.impersonation_attempts += 1;
    return 'IMPERSONATION';
  }

  markReplayTrack(trackId: string): SfuErrorCode {
    this.metrics.replayed_tracks += 1;
    return 'REPLAY_TRACK';
  }

  markDuplicateRoute(trackId: string): SfuErrorCode {
    this.metrics.duplicate_routes += 1;
    this.metrics.rejected_tracks += 1;
    return 'DUPLICATE_ROUTE';
  }

  markBitrateAbuse(trackId: string, participantId?: string, reported_bitrate?: number): SfuErrorCode {
    this.metrics.bitrate_abuse_events += 1;
    this.log('sfu:bitrate_abuse', { track_id: trackId, participant_id: participantId, reported_bitrate });
    return 'BITRATE_ABUSE';
  }

  markStaleKeyReuse(trackId?: string): SfuErrorCode {
    this.metrics.key_leak_attempts += 1;
    return 'STALE_KEY_REUSE';
  }

  markKeyLeakAttempt(trackId?: string): SfuErrorCode {
    this.metrics.key_leak_attempts += 1;
    return 'KEY_LEAK_ATTEMPT';
  }

  onFrame(frame: SfuFrameMeta) {
    const publisherId = this.tracks.get(frame.stream_id)?.publisherId;
    if (!publisherId) {
      this.metrics.unauthorized_tracks += 1;
      this.recordTranscript({
        call_id: frame.call_id,
        room_id: this.config.roomId,
        sfu_id: this.config.sfuId,
        track_id: frame.stream_id,
        participant_id: frame.participant_id,
        media_epoch: frame.media_epoch,
        frame_sequence: frame.frame_sequence,
        routing_action: 'denied',
        reason: 'UNAUTHORIZED_SUBSCRIBE',
      });
      return 'UNAUTHORIZED_SUBSCRIBE' as SfuErrorCode;
    }
    if (frame.participant_id !== publisherId) {
      this.metrics.hijacked_tracks += 1;
      this.metrics.unauthorized_tracks += 1;
      this.recordTranscript({
        call_id: frame.call_id,
        room_id: this.config.roomId,
        sfu_id: this.config.sfuId,
        participant_id: frame.participant_id,
        track_id: frame.stream_id,
        media_epoch: frame.media_epoch,
        frame_sequence: frame.frame_sequence,
        routing_action: 'denied',
        reason: 'HIJACKED_TRACK',
        header_digest: this.digestFrameHeader(frame),
      });
      return 'HIJACKED_TRACK';
    }
    this.recordTranscript({
      call_id: frame.call_id,
      room_id: this.config.roomId,
      sfu_id: this.config.sfuId,
      participant_id: publisherId,
      track_id: frame.stream_id,
      media_epoch: frame.media_epoch,
      frame_sequence: frame.frame_sequence,
      routing_action: 'routed',
      header_digest: this.digestFrameHeader(frame),
    });
    return null;
  }

  grantMediaKey(grant: SfuKeyGrant) {
    const byParticipant = this.keyGrants.get(grant.participantId) ?? new Map<string, SfuKeyGrant>();
    byParticipant.set(grant.keyId, grant);
    this.keyGrants.set(grant.participantId, byParticipant);
    this.audit('sfu:key:grant', { participant_id: grant.participantId, key_id: grant.keyId, media_epoch: grant.mediaEpoch });
  }

  requestMediaKey(participantId: string, keyId: string, mediaEpoch?: number): SfuKeyRequestResult {
    if (!this.authState.has(participantId)) {
      this.recordError('KEY_LEAK_ATTEMPT');
      return { granted: false, error: 'KEY_LEAK_ATTEMPT', note: 'participant not authenticated' };
    }
    const grant = this.keyGrants.get(participantId)?.get(keyId);
    if (!grant) {
      this.recordError('KEY_LEAK_ATTEMPT');
      return { granted: false, error: 'KEY_LEAK_ATTEMPT', note: 'no grant for participant/key' };
    }
    if (this.config.callId && grant.callId && grant.callId !== this.config.callId) {
      this.recordError('KEY_LEAK_ATTEMPT');
      return { granted: false, error: 'KEY_LEAK_ATTEMPT', note: 'callId mismatch' };
    }
    if (typeof mediaEpoch === 'number' && typeof grant.mediaEpoch === 'number' && mediaEpoch !== grant.mediaEpoch) {
      this.recordError('STALE_KEY_REUSE');
      return { granted: false, error: 'STALE_KEY_REUSE', note: 'epoch mismatch' };
    }
    return { granted: true, keyId: grant.keyId, encryptedKeyBlob: grant.encryptedKeyBlob };
  }

  getTranscript(): SfuTranscriptEntry[] {
    return [...this.transcript];
  }

  resetTranscript() {
    this.transcript = [];
  }

  getMetrics() {
    return { ...this.metrics };
  }

  private recordError(code: SfuErrorCode) {
    switch (code) {
      case 'UNAUTHORIZED_SUBSCRIBE':
        this.metrics.unauthorized_tracks += 1;
        this.metrics.rejected_tracks += 1;
        break;
      case 'IMPERSONATION':
        this.metrics.impersonation_attempts += 1;
        break;
      case 'KEY_LEAK_ATTEMPT':
      case 'STALE_KEY_REUSE':
        this.metrics.key_leak_attempts += 1;
        break;
      case 'DUPLICATE_ROUTE':
        this.metrics.duplicate_routes += 1;
        this.metrics.rejected_tracks += 1;
        break;
      case 'REPLAY_TRACK':
        this.metrics.replayed_tracks += 1;
        break;
      case 'SIMULCAST_SPOOF':
        this.metrics.simulcast_spoofs += 1;
        this.metrics.rejected_tracks += 1;
        break;
      case 'BITRATE_ABUSE':
        this.metrics.bitrate_abuse_events += 1;
        break;
      default:
        break;
    }
  }

  private digestFrameHeader(meta: SfuFrameMeta): string {
    const digestInput = {
      call_id: meta.call_id,
      participant_id: meta.participant_id,
      stream_id: meta.stream_id,
      frame_sequence: meta.frame_sequence,
      media_epoch: meta.media_epoch,
      layer: meta.layer,
    };
    const canonical = cbor.encodeCanonical(digestInput);
    return createHash('sha256').update(canonical).digest('hex');
  }

  private recordTranscript(entry: SfuTranscriptEntry) {
    this.transcript.push(entry);
    this.audit('sfu:transcript', entry as Record<string, unknown>);
  }

  private mapAuthError(error: SfuErrorCode | 'TOKEN_EXPIRED' | 'REPLAY' | 'INVALID_TOKEN'): SfuErrorCode {
    if (error === 'IMPERSONATION') return 'IMPERSONATION';
    if (error === 'TOKEN_EXPIRED' || error === 'REPLAY' || error === 'INVALID_TOKEN') {
      return 'UNAUTHORIZED_SUBSCRIBE';
    }
    return error;
  }

  private log(event: string, meta?: Record<string, unknown>) {
    this.logFn(event, meta);
  }

  private audit(event: string, meta?: Record<string, unknown>) {
    this.auditFn(event, meta);
  }
}
