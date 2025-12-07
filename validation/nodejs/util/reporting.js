const fs = require('fs');
const path = require('path');


const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');

function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  return RESULTS_DIR;
}

function writeJson(filename, payload) {
  const dir = ensureResultsDir();
  const outputPath = path.join(dir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  return outputPath;
}

module.exports = {
  ROOT_DIR,
  RESULTS_DIR,
  ensureResultsDir,
  writeJson,
};
