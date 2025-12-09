#!/usr/bin/env bash
set -euo pipefail

echo "[minimal-node] installing client deps..."
npm ci --prefix "$(dirname "$0")/../clients/minimal-js"

echo "[minimal-node] running client lint/typecheck..."
export FOXW_CRYPTO_BACKEND=real
npm run lint --prefix "$(dirname "$0")/../clients/minimal-js"
npm run typecheck --prefix "$(dirname "$0")/../clients/minimal-js"

echo "[minimal-node] running client tests..."
npm test --prefix "$(dirname "$0")/../clients/minimal-js"

# Verify digest artifacts from minimal-js harness for downstream cross-lang diffing
ART_ROOT="$(dirname "$0")/../clients/minimal-js/test-output"
REQUIRED=(
  handshake_cbor_status.json
  dr_vectors_status.json
  handshake_dr_crypto_status.json
  dr_vectors_crypto_status.json
  group_vectors_status.json
  media_key_status.json
  media_vectors_status.json
  key_schedule_status.json
  minimal_e2e_status.json
)
for f in "${REQUIRED[@]}"; do
  if [ ! -s "$ART_ROOT/$f" ]; then
    echo "[minimal-node] missing digest artifact: $ART_ROOT/$f" >&2
    exit 1
  fi
done

echo "[minimal-node] running client conformance..."
npm run conformance --prefix "$(dirname "$0")/../clients/minimal-js"

echo "[minimal-node] installing server deps..."
npm ci --prefix "$(dirname "$0")/../servers/minimal-js"

echo "[minimal-node] running server lint/typecheck..."
npm run lint --prefix "$(dirname "$0")/../servers/minimal-js"
npm run typecheck --prefix "$(dirname "$0")/../servers/minimal-js"

echo "[minimal-node] running server tests..."
npm test --prefix "$(dirname "$0")/../servers/minimal-js"

echo "[minimal-node] running demo smoke..."
npm run demo --prefix "$(dirname "$0")/../servers/minimal-js"
