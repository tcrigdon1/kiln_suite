#!/usr/bin/env node
// Kiln Suite test runner. Runs the Playwright suites one script at a time (they are CPU-heavy; running them in
// parallel causes timing flakes) and prints a pass/fail table.
//
//   npm test                  every group below (≈ 2–3 h on a laptop)
//   npm run test:quick        a 10-minute smoke pass over both apps
//   node _tests/run.js gesso | cutline | <group> [<group> ...]
//   node _tests/run.js --list
//
// Each script prints its own "ok -" / "ASSERT FAIL" / "PASS" / "FAIL" lines; a script fails when it exits non-zero or
// prints a failure marker. Screenshots and files land next to the scripts in shots/, out/ and downloads/ (git-ignored).
const { spawnSync } = require('child_process');
const path = require('path'), fs = require('fs');
const T = __dirname;
const group = (dir, names) => names.map((n) => path.join(T, dir, n.endsWith('.js') ? n : n + '.js'));
const GROUPS = {
  'gesso-core': group('gesso', ['smoke', 'full', 'more', 'third', 'fourth', 'fifth', 'sixth', 'monkey', 'toolmonkey']),
  'gesso-pass2': group('gesso/pass2', ['a1-edge-cases', 'a2-extremes', 'a3-ui-env', 'a4-tools-offset', 'a5-sparse-masks', 'a6-sessions', 'b1-content-layers', 'c1-warp', 'c2-meshwarp', 'c3-export', 'c4-patchfill', 'c5-subject', 'c6-embed', 'c7-comps', 'c8-gallery', 'c9-palette-tour', 'c10-actions', 'c11-brush-type', 'c12-vector', 'repro-flip2']),
  'gesso-pass3': group('gesso/pass3', ['lut-histogram', 'anim', 'measure-cascale', 'photomerge', 'brushes-extra', 'automate', 'blendif', 'sweep', 'chain']),
  'gesso-handson': group('gesso/handson', ['s1-start', 's2-select', 's3-layers', 's4-transform', 's5-text-shapes', 's6-adjust-view', 's7-files-ui', 's8-misc', 's9-more', 'p2-shapes', 'p2-text']),
  'cutline-core': group('cutline', ['t2', 't4', 't5', 't6', 't8', 't_shaders', 't_mp4', 't_dec2', 't_nest', 't_match', 't_gate', 't_2d', 't_menus', 't_ctx']),
  'cutline-pass2': group('cutline/pass2', ['x1_edges', 'x2_media', 'x3_perf', 'x4_av', 'y1_model', 'y2_export', 'y3_edges', 'y4_playback', 'y5_workspace', 'y6_motion', 'y7_proxy', 'y8_audio', 'y9_color', 'y10_titles_mc', 'y11_export_cache']),
  'cutline-pass3': group('cutline/pass3', ['y1_autocut', 'y2_keyframes_matte', 'y3_interchange', 'y4_audio_popout', 'y5_presets_qc', 'y6_spectrum', 'y7_sweep', 'y8_chain', 'y9_menu_checks']),
  'cutline-handson': group('cutline/handson', ['h1_library', 'h2_source', 'h3_timeline', 'h4_playback', 'h5_program', 'h6_effects', 'h7_transitions', 'h8_titles', 'h9_color_audio', 'h10_captions_history', 'h11_save_open', 'h12_export', 'h13_mixed', 'h14_prefs_layout', 'h15_context_menus', 'h16_misc']),
};
GROUPS.quick = [...group('gesso', ['smoke']), ...group('gesso/pass3', ['sweep']), ...group('cutline', ['t2', 't_menus']), ...group('cutline/pass3', ['y7_sweep', 'y9_menu_checks'])];
const ALIAS = { gesso: ['gesso-core', 'gesso-pass2', 'gesso-pass3', 'gesso-handson'], cutline: ['cutline-core', 'cutline-pass2', 'cutline-pass3', 'cutline-handson'] };
const DEFAULT = [...ALIAS.gesso, ...ALIAS.cutline];

const args = process.argv.slice(2);
if (args.includes('--list')) { Object.keys(GROUPS).forEach((g) => console.log(g.padEnd(16), GROUPS[g].length, 'scripts')); process.exit(0); }
let groups = args.length ? args.flatMap((a) => ALIAS[a] || [a]) : DEFAULT;
const bad = groups.filter((g) => !GROUPS[g]);
if (bad.length) { console.error('unknown group(s):', bad.join(', '), '\nknown:', Object.keys(GROUPS).join(', ')); process.exit(2); }
try { require.resolve('playwright'); } catch (e) { console.error('Playwright is not installed. Run `npm install` in the repository root first (it also downloads a Chromium build).'); process.exit(2); }
const missingMedia = path.join(T, 'cutline/pass2/media/sync5m.webm');
if (groups.includes('cutline-pass2') && !fs.existsSync(missingMedia)) console.log('note: pass2/media/sync5m.webm is missing — run `npm run test:media` first or x4_av will be skipped\n');

const FAILRX = /ASSERT FAIL|TEST ERROR|^FAILURES|^FAIL\b|pageerror|^ERRORS:\n\S/m;
const results = [];
const t0 = Date.now();
for (const g of groups) {
  console.log('\n=== ' + g);
  for (const script of GROUPS[g]) {
    const name = path.relative(T, script);
    if (!fs.existsSync(script)) { results.push({ g, name, status: 'missing' }); console.log('  ?  ' + name + ' (missing)'); continue; }
    if (/x4_av/.test(script) && !fs.existsSync(missingMedia)) { results.push({ g, name, status: 'skipped' }); console.log('  -  ' + name + ' (skipped: no sync5m.webm)'); continue; }
    const ts = Date.now();
    const r = spawnSync(process.execPath, [script], { cwd: path.dirname(script), encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const ok = r.status === 0 && !FAILRX.test(out);
    const oks = (out.match(/^ok -/gm) || []).length, fails = (out.match(/ASSERT FAIL/g) || []).length;
    const secs = ((Date.now() - ts) / 1000).toFixed(0);
    results.push({ g, name, status: ok ? 'pass' : 'FAIL', oks, fails, secs });
    console.log(`  ${ok ? '✓' : '✗'}  ${name}  ${oks ? oks + ' ok' : ''}${fails ? ' ' + fails + ' failed' : ''}  (${secs}s)`);
    if (!ok) {
      const lines = out.split('\n').filter((l) => FAILRX.test(l) || /Error|error:/.test(l)).slice(0, 12);
      lines.forEach((l) => console.log('       ' + l.slice(0, 220)));
      const logDir = path.join(T, 'out'); fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, name.replace(/[\\/]/g, '_') + '.log'); fs.writeFileSync(logFile, out);
      console.log('       full log: ' + path.relative(process.cwd(), logFile));
    }
  }
}
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length} scripts, ${results.filter((r) => r.status === 'pass').length} passed, ${failed.length} failed, ${results.filter((r) => r.status === 'skipped' || r.status === 'missing').length} skipped — ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (failed.length) { console.log('failed: ' + failed.map((r) => r.name).join(', ')); process.exit(1); }
