#!/usr/bin/env node
const fs = require('fs');
const { inputPath, writeJson } = require('../util/reporting');

function main() {
  const rel = 'tests/common/adversarial/replay_storm_profiles.json';
  const p = inputPath(rel);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const ok = data && typeof data === 'object' && Object.keys(data).length > 0;
  const result = {
    language: 'nodejs',
    test: 'replay_storm',
    file: rel,
    success: ok,
    status: ok ? 'success' : 'failed',
    timestamp: new Date().toISOString(),
  };
  writeJson('nodejs_replay_storm_status.json', result);
  console.log(`Replay storm profiles: ${ok ? 'ok' : 'missing/empty'}`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main();
}
