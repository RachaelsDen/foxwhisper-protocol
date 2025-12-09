export type SfuErrorCode =
  | 'UNAUTHORIZED_SUBSCRIBE'
  | 'IMPERSONATION'
  | 'KEY_LEAK_ATTEMPT'
  | 'STALE_KEY_REUSE'
  | 'DUPLICATE_ROUTE'
  | 'REPLAY_TRACK'
  | 'HIJACKED_TRACK'
  | 'SIMULCAST_SPOOF'
  | 'BITRATE_ABUSE';

export const SFU_ERROR_CODES: readonly SfuErrorCode[] = [
  'UNAUTHORIZED_SUBSCRIBE',
  'IMPERSONATION',
  'KEY_LEAK_ATTEMPT',
  'STALE_KEY_REUSE',
  'DUPLICATE_ROUTE',
  'REPLAY_TRACK',
  'HIJACKED_TRACK',
  'SIMULCAST_SPOOF',
  'BITRATE_ABUSE',
] as const;

export type SfuLogger = (event: string, meta?: Record<string, unknown>) => void;
export type SfuAuditLogger = (event: string, meta?: Record<string, unknown>) => void;

export type SfuPolicy = {
  maxSubscribersPerTrack?: number;
  maxTracksPerParticipant?: number;
  allowedLayers?: string[];
  tokenMaxSkewMs?: number;
  nonceCacheTtlMs?: number;
  acceptAnyToken?: boolean;
};

export type SfuConfig = {
  roomId?: string;
  callId?: string;
  sfuId?: string;
  logger?: SfuLogger;
  auditLogger?: SfuAuditLogger;
  sfuSecretKey?: Buffer | string;
  sfuKeyProvider?: () => Buffer | string;
  clientAuthKey?: Buffer | string;
  expectedParticipants?: string[];
  policy?: SfuPolicy;
};

export type SfuParticipant = {
  id: string;
  role?: 'publisher' | 'subscriber' | 'both';
  authzTokens?: string[];
  metadata?: Record<string, unknown>;
};

export type SfuTrack = {
  trackId: string;
  publisherId: string;
  kind?: 'audio' | 'video' | 'data';
  layers?: string[];
  bitrateCapKbps?: number;
  mediaEpoch?: number;
};

export type SfuSubscription = {
  subscriberId: string;
  trackId: string;
  layers?: string[];
  createdAt: number;
};

export type SfuFrameMeta = {
  call_id: string;
  participant_id: string;
  stream_id: string;
  frame_sequence: number;
  media_epoch: number;
  layer?: string;
  timestamp_ms?: number;
  auth_tag_b64?: string;
};

export type SfuTranscriptEntry = {
  call_id?: string;
  room_id?: string;
  sfu_id?: string;
  participant_id?: string;
  subscriber_ids?: string[];
  track_id?: string;
  media_epoch?: number;
  frame_sequence?: number;
  routing_action: 'routed' | 'dropped' | 'denied';
  reason?: SfuErrorCode;
  header_digest?: string;
};

export type SfuAuthContext = {
  token: string;
  timestamp_ms?: number;
  nonce?: string;
  skew_ms?: number;
};

export type SfuJoinResult = { ok: true } | { ok: false; error: SfuErrorCode; note?: string };

export type SfuSubscribeResult =
  | { allowed: true; note?: string }
  | { allowed: false; error: SfuErrorCode; note?: string };

export type SfuKeyGrant = {
  callId: string;
  participantId: string;
  mediaEpoch?: number;
  keyId: string;
  encryptedKeyBlob?: string;
};

export type SfuKeyRequestResult =
  | { granted: true; keyId: string; encryptedKeyBlob?: string }
  | { granted: false; error: SfuErrorCode; note?: string };
