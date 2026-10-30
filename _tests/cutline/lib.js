const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const MEDIA = ROOT + '/_tests/cutline/media/';
async function launch(opts = {}) {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1600, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); else if (m.type() === 'warning' && /Cutline/.test(m.text()) && process.env.SHOW_WARN) console.log('WARN', m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  return { b, ctx, p, errs };
}
async function newProject(p, q = '') {
  await p.goto('file://' + ROOT + '/Cutline/index.html' + q);
  await p.waitForFunction(() => window.Cutline && window.Cutline.ready);
  await p.click('.preset[data-w="1280"][data-h="720"]');
  await p.evaluate(() => { try { localStorage.setItem('cutline.tourDone', 'true'); } catch (e) { } }); // returning user: no welcome tour over the UI
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !!Cutline.state.project);
}
async function importFiles(p, names) {
  await p.setInputFiles('#cl-import-input', names.map(n => MEDIA + n));
  await p.waitForFunction((n) => Cutline.state.project.media.filter(m => Cutline.MRT[m.id] && Cutline.MRT[m.id].status === 'ready').length >= n, names.length, { timeout: 30000 });
}
module.exports = { launch, newProject, importFiles, MEDIA };
