import { expect, test } from 'vitest';
import cbor from 'cbor';
import transcript from './fixtures/golden_transcript.json';

// If this fixture changes, review protocol-level changes carefully.
const taggedLabels = new Set(['handshake_init', 'handshake_response', 'handshake_complete']);

function roundTripTagged(tag: number, body: any) {
  const encoded = cbor.encodeOne(new cbor.Tagged(tag, body));
  const decoded = cbor.decodeFirstSync(encoded) as cbor.Tagged;
  expect(decoded.tag).toBe(tag);
  expect(decoded.value).toMatchObject(body);
}

function roundTripPlain(body: any) {
  const encoded = cbor.encodeOne(body);
  const decoded = cbor.decodeFirstSync(encoded) as any;
  expect(decoded).toMatchObject(body);
}

test('golden transcript frames round-trip through CBOR', () => {
  for (const frame of transcript as any[]) {
    if (taggedLabels.has(frame.label)) {
      roundTripTagged(frame.tag, frame.body);
    } else {
      roundTripPlain(frame.body);
    }
  }
});
