// Shared locations for the Kiln Suite test scripts. Everything is resolved relative to this file, so the
// suite runs from any checkout: `npm install` at the repo root (pulls Playwright), then `npm test`.
const path = require('path'), os = require('os'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const TMP = process.env.KILN_TEST_TMP || path.join(os.tmpdir(), 'kiln-tests');
fs.mkdirSync(TMP, { recursive: true });
module.exports = {
  ROOT, TMP,
  url: (app, q) => 'file://' + path.join(ROOT, app, 'index.html') + (q || ''),
  media: (...p) => path.join(ROOT, '_tests', ...p),
};
