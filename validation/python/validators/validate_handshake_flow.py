from __future__ import annotations

import base64
import hashlib
import hmac
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT_DIR / "validation" / "python"))

from util.cbor_canonical import encode_canonical  # type: ignore


def hkdf_sha256(ikm: bytes, info: bytes, length: int = 32) -> bytes:
    salt = b"\x00" * hashlib.sha256().digest_size
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    t1 = hmac.new(prk, info + b"\x01", hashlib.sha256).digest()
    return t1[:length]


def main() -> None:
    path = ROOT_DIR / "tests/common/handshake/end_to_end_test_vectors.json"
    doc = path.read_text(encoding="utf-8")
    vectors = __import__("json").loads(doc)

    flow = vectors.get("handshake_flow") or {}
    steps = flow.get("steps") or []
    if len(steps) < 3:
        raise SystemExit("handshake_flow missing steps")

    resp = steps[1]["message"]
    complete = steps[2]["message"]

    encoded = encode_canonical(resp)
    h = hashlib.sha256(encoded).digest()
    handshake_hash = base64.b64encode(h).decode()
    session_id = base64.b64encode(hkdf_sha256(h, b"FoxWhisper-SessionId", 32)).decode()

    if handshake_hash != complete.get("handshake_hash"):
        raise SystemExit(f"handshake_hash mismatch: {complete.get('handshake_hash')} != {handshake_hash}")
    if session_id != complete.get("session_id"):
        raise SystemExit(f"session_id mismatch: {complete.get('session_id')} != {session_id}")

    print("✅ handshake_flow derivation matches (Python)")


if __name__ == "__main__":
    main()
