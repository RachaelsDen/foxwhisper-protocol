from __future__ import annotations

import base64
import hashlib
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT_DIR / "validation" / "python"))

from util.cbor_canonical import encode_canonical  # type: ignore


def main() -> None:
    path = ROOT_DIR / "tests/common/handshake/v0.9/handshake_flow_test_vectors.json"
    doc = path.read_text(encoding="utf-8")
    vectors = __import__("json").loads(doc)

    flow = vectors.get("handshake_flow") or {}
    steps = flow.get("steps") or []
    if len(steps) < 3:
        raise SystemExit("handshake_flow missing steps")

    init = steps[0]["message"]
    resp = steps[1]["message"]
    complete = steps[2]["message"]

    transcript = (flow.get("transcript") or {})
    raw_cbor_b64 = transcript.get("handshake_transcript_raw_cbor_b64")
    expected_session_id_b64 = transcript.get("session_id_b64")
    if not raw_cbor_b64 or not expected_session_id_b64:
        raise SystemExit("handshake_flow missing transcript.handshake_transcript_raw_cbor_b64 or transcript.session_id_b64")

    raw_cbor = base64.b64decode(raw_cbor_b64)
    derived_session_id_b64 = base64.b64encode(hashlib.sha256(raw_cbor).digest()).decode()

    if derived_session_id_b64 != expected_session_id_b64:
        raise SystemExit(f"session_id_b64 mismatch: {expected_session_id_b64} != {derived_session_id_b64}")

    # Ensure on-wire messages bind to the same session_id
    if resp.get("session_id") != expected_session_id_b64:
        raise SystemExit(f"HANDSHAKE_RESPONSE.session_id mismatch: {resp.get('session_id')} != {expected_session_id_b64}")
    if complete.get("session_id") != expected_session_id_b64:
        raise SystemExit(f"HANDSHAKE_COMPLETE.session_id mismatch: {complete.get('session_id')} != {expected_session_id_b64}")

    # Sanity checks for v0.9 field names
    for msg, name in [(init, "HANDSHAKE_INIT"), (resp, "HANDSHAKE_RESPONSE"), (complete, "HANDSHAKE_COMPLETE")]:
        if "timestamp_ms" not in msg:
            raise SystemExit(f"{name} missing timestamp_ms")
    if "nonce" not in init or "nonce" not in resp:
        raise SystemExit("HANDSHAKE_INIT/HANDSHAKE_RESPONSE missing nonce")

    # Canonical CBOR check: transcript bytes must match canonical encoding of its decoded object.
    # This is a structural smoke test to catch non-canonical fixtures.
    try:
        decoded = __import__("cbor2").loads(raw_cbor)
        reencoded = encode_canonical(decoded)
        if reencoded != raw_cbor:
            raise SystemExit("handshake_transcript_raw_cbor is not canonical")
    except Exception as e:
        raise SystemExit(f"failed to decode transcript CBOR: {e}")

    print("✅ handshake_flow v0.9 transcript binding matches (Python)")


if __name__ == "__main__":
    main()
