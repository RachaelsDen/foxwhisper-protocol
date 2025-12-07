#!/usr/bin/env node
const fs = require('fs');
const { inputPath, writeJson } = require('../util/reporting');

function main() {
  const rel = 'tests/common/adversarial/malformed_packets.json';
  const p = inputPath(rel);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const seeds = Array.isArray(data.seeds) ? data.seeds : [];
  const ok = seeds.length > 0;
  const result = {
    language: 'nodejs',
    test: 'malformed_fuzz',
    file: rel,
    success: ok,
    status: ok ? 'success' : 'failed',
    seeds: seeds.length,
    timestamp: new Date().toISOString(),
  };
  writeJson('nodejs_malformed_fuzz_status.json', result);
  console.log(`Malformed fuzz seeds: ${seeds.length} (${result.status})`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main();
}
