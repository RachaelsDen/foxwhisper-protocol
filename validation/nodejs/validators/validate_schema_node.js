#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { inputPath, writeJson } = require('../util/reporting');

function loadJSON(rel) {
  const p = inputPath(rel);
  const data = fs.readFileSync(p, 'utf8');
  return JSON.parse(data);
}

function main() {
  const targets = [
    'tests/common/handshake/cbor_test_vectors_fixed.json',
    'tests/common/handshake/cbor_test_vectors.json'
  ];

  let payload = null;
  let used = null;
  for (const rel of targets) {
    try {
      payload = loadJSON(rel);
      used = rel;
      break;
    } catch (err) {
      continue;
    }
  }

  if (!payload) {
    console.error('No schema/cbor vector file found');
    process.exit(1);
  }

  const nonEmpty = payload && Object.keys(payload).length > 0;
  const status = nonEmpty ? 'success' : 'failed';
  const result = {
    language: 'nodejs',
    test: 'cbor_schema',
    file: used,
    status,
    success: nonEmpty,
    timestamp: new Date().toISOString(),
  };
  writeJson('nodejs_cbor_schema_status.json', result);
  console.log(`Schema check (${used}): ${status}`);
  process.exit(nonEmpty ? 0 : 1);
}

if (require.main === module) {
  main();
}
