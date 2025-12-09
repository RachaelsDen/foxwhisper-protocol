import cbor from 'cbor';

// encodeCanonical produces RFC 8949-style canonical CBOR. The cbor library's
// canonical option covers sorting and minimal encoding; this helper is a single
// choke point to swap implementations later.
export function encodeCanonical(value: unknown): Buffer {
  return cbor.encodeOne(value, { canonical: true });
}
