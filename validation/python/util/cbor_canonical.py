from __future__ import annotations

import base64
import hashlib
from typing import Any

import cbor2

# Canonical CBOR encoder with explicit map-key sorting by encoded key bytes
# (shortest first, then lexicographic) to mirror RFC 8949 ordering.

def _canonicalize(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, dict):
        items = []
        for k, v in value.items():
            k_c = _canonicalize(k)
            v_c = _canonicalize(v)
            key_bytes = cbor2.dumps(k_c, canonical=True)
            items.append((key_bytes, k_c, v_c))
        items.sort(key=lambda entry: (len(entry[0]), entry[0]))
        return {k: v for (_, k, v) in items}
    return value


def encode_canonical(obj: Any) -> bytes:
    canon = _canonicalize(obj)
    return cbor2.dumps(canon, canonical=True)
