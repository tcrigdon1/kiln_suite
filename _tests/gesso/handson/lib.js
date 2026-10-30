// Hands-on QA helpers: drive Gesso only through real mouse / keyboard input.
// page.evaluate is used ONLY to read state (never to perform actions).

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots');
const ASSETS = path.join(ROOT, 'assets');
fs.mkdirSync(SHOTS, { recursive: true });
const URL = require('../../env.js').url('Gesso');

async function launch(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 900 }, acceptDownloads: true });
  // The File System Access pickers are native OS dialogs that automation cannot drive; remove them so
  // Gesso falls back to <input type=file> (→ filechooser) and download links (→ download event).
  await context.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto(URL);
  await page.waitForTimeout(600);
  // the recovery dialog may appear in a fresh profile — never, since profile is fresh, but be safe
  const results = [];
  const H = {
    browser, context, page, errors, results,
    async shot(name) { const p = path.join(SHOTS, name + '.png'); await page.screenshot({ path: p }); return p; },
    async wait(ms = 120) { await page.waitForTimeout(ms); },
    /** read-only state */
    ev: (fn, arg) => page.evaluate(fn, arg),
    /** doc coords → page coords */
    async pt(x, y) {
      return page.evaluate(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const s = Gesso.View.toScreen(x, y); return [r.left + s[0], r.top + s[1]]; }, [x, y]);
    },
    /** smooth drag through doc-space points */
    async dragDoc(pts, o = {}) {
      const sp = [];
      for (const p of pts) sp.push(await H.pt(p[0], p[1]));
      await H.dragScreen(sp, o);
    },
    async dragScreen(sp, o = {}) {
      const steps = o.steps || 12;
      if (o.mods) for (const m of o.mods) await page.keyboard.down(m);
      await page.mouse.move(sp[0][0], sp[0][1]);
      if (o.modsAfterMove) for (const m of o.modsAfterMove) await page.keyboard.down(m);
      await page.mouse.down({ button: o.button || 'left' });
      for (let i = 1; i < sp.length; i++) {
        const [ax, ay] = sp[i - 1], [bx, by] = sp[i];
        for (let k = 1; k <= steps; k++) await page.mouse.move(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
      }
      if (o.holdMs) await page.waitForTimeout(o.holdMs);
      await page.mouse.up({ button: o.button || 'left' });
      if (o.modsAfterMove) for (const m of o.modsAfterMove) await page.keyboard.up(m);
      if (o.mods) for (const m of o.mods) await page.keyboard.up(m);
      await page.waitForTimeout(o.after ?? 120);
    },
    async clickDoc(x, y, o = {}) {
      const [px, py] = await H.pt(x, y);
      if (o.mods) for (const m of o.mods) await page.keyboard.down(m);
      await page.mouse.click(px, py, { button: o.button || 'left', clickCount: o.count || 1 });
      if (o.mods) for (const m of o.mods) await page.keyboard.up(m);
      await page.waitForTimeout(o.after ?? 120);
    },
    /** open a menubar menu and click an item path, e.g. menu('Image', 'Image Size…') or menu('Edit','Transform','Flip Horizontal') */
    async menu(title, ...items) {
      await page.click(`.menu-title[data-menu="${title}"]`);
      await page.waitForTimeout(80);
      for (let i = 0; i < items.length; i++) {
        const lvl = page.locator('.gesso-menu').nth(i);
        const it = lvl.locator('.item', { hasText: items[i] }).filter({ has: page.locator('.item-label', { hasText: new RegExp('^\\s*✓?\\s*' + esc(items[i]) + '$') }) }).first();
        const cnt = await it.count();
        const target = cnt ? it : lvl.locator('.item', { hasText: items[i] }).first();
        if (i < items.length - 1) { await target.hover(); await page.waitForTimeout(80); }
        else { await target.click(); }
      }
      await page.waitForTimeout(150);
    },
    async ctxMenuClick(label) {
      const it = page.locator('.gesso-menu .item', { hasText: label }).first();
      await it.click();
      await page.waitForTimeout(150);
    },
    async key(k, n = 1) { for (let i = 0; i < n; i++) await page.keyboard.press(k); await page.waitForTimeout(80); },
    async dialogBtn(label) { await page.locator('.gesso-dialog .dialog-foot button', { hasText: label }).last().click(); await page.waitForTimeout(200); },
    dialogOpen: () => page.locator('.gesso-dialog').count(),
    async tool(id) { // click the tool button in the strip (opening a flyout if the tool is hidden in a group)
      const b = page.locator(`.tool-btn[data-tool="${id}"]`);
      if (await b.count()) { await b.click(); await page.waitForTimeout(80); return; }
      const grp = await page.evaluate((id) => { const t = Gesso.Tools.byId[id]; const cur = Gesso.Tools.groupActive[t.group]; return { cur, name: t.name }; }, id);
      const gb = page.locator(`.tool-btn[data-tool="${grp.cur}"]`);
      await gb.click({ button: 'right' });
      await page.waitForTimeout(80);
      await page.locator('.gesso-menu .item', { hasText: grp.name }).first().click();
      await page.waitForTimeout(100);
    },
    state: () => page.evaluate(() => {
      const d = Gesso.app.doc; if (!d) return null;
      const L = d.flatTopDown().map((f) => ({ name: f.layer.name, type: f.layer.type, depth: f.depth, visible: f.layer.visible, opacity: f.layer.opacity, blend: f.layer.blend, clip: f.layer.clip, mask: !!f.layer.mask, id: f.layer.id }));
      return { name: d.name, w: d.width, h: d.height, layers: L, active: d.activeLayer() && d.activeLayer().name, activeType: d.activeLayer() && d.activeLayer().type, sel: d.selection ? d.selection.bounds : null, hist: d.history.index, histName: d.history.entries[d.history.index].name, tool: Gesso.app.tool.id, zoom: d.view.zoom };
    }),
    /** composite pixel at doc coords */
    px: (x, y) => page.evaluate(([x, y]) => { const d = Gesso.app.doc; Gesso.Compositor.update(d); return Array.from(Gesso.util.samplePixels(d.composite, x | 0, y | 0)); }, [x, y]),
    /** active layer pixel */
    lpx: (x, y) => page.evaluate(([x, y]) => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); return Array.from(Gesso.Layers.readRect(l.canvas, { x: x | 0, y: y | 0, w: 1, h: 1 }).data); }, [x, y]),
    async step(name, fn) {
      try { await fn(); results.push(['PASS', name]); console.log('PASS ', name); }
      catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL ', name, '—', e.message.split('\n').slice(0,3).join(' / ')); await H.shot('FAIL-' + name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)); }
    },
    async finish() {
      const fails = results.filter((r) => r[0] === 'FAIL').length;
      console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
      console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
      await browser.close();
      if (fails || errors.length) process.exitCode = 1;
    },
  };
  return H;
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function assert(c, m) { if (!c) throw new Error('assert: ' + (m || '')); }
const near = (a, b, t = 8) => a.every((v, i) => Math.abs(v - b[i]) <= t);
module.exports = { launch, assert, near, SHOTS, ASSETS, ROOT };
