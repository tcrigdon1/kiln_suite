// 17. Keyboard shortcuts dialog (rebind), Preferences, layout dividers, workspaces, 1366×768
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h14');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'still.jpg']);
  // --- shortcuts dialog: no browser-reserved defaults; alternatives are listed
  await H.key(p, 'F1');
  await p.waitForTimeout(200);
  H.ok(await p.locator('.dialog-head span:text-is("Keyboard Shortcuts")').count() === 1, 'F1 opens Keyboard Shortcuts');
  const chips = await p.$$eval('.kb-table .kbd-chip', els => els.map(e => e.textContent));
  const reserved = chips.filter(k => /^Ctrl\+(N|T|W|Tab|Shift\+N|Shift\+T|Shift\+W)$/.test(k));
  H.ok(reserved.length === 0, 'no default bound to Ctrl+N/T/W (found: ' + reserved.join(',') + ')');
  const rowKeys = async (name) => p.$$eval('.kb-table tr', (trs, name) => { const tr = trs.find(t => t.children[1] && t.children[1].textContent === name); return tr ? Array.from(tr.querySelectorAll('.kbd-chip')).map(c => c.textContent).filter(t => t !== '+' && t !== 'Set…') : null; }, name);
  H.ok((await rowKeys('New Project…')).includes('Ctrl+Alt+N'), 'New Project… = Ctrl+Alt+N');
  H.ok((await rowKeys('New Title')).includes('Ctrl+Alt+T'), 'New Title = Ctrl+Alt+T');
  H.ok((await rowKeys('New Sequence…')).includes('Ctrl+Alt+Shift+N'), 'New Sequence… = Ctrl+Alt+Shift+N');
  // rebind Razor Tool from C to E
  await p.fill('.dialog input[placeholder="Filter commands…"]', 'razor');
  await p.waitForTimeout(150);
  await H.shot(p, 'shortcuts-filter');
  await p.locator('.kb-table tr:has(td:text-is("Razor Tool")) .kbd-chip').first().click();
  await p.keyboard.press('e');
  await p.waitForTimeout(150);
  H.ok(JSON.stringify(await rowKeys('Razor Tool')) === '["E"]', 'Razor rebound to E: ' + JSON.stringify(await rowKeys('Razor Tool')));
  // conflict: bind Slip Tool (Y) to V (Selection) → V removed from Selection with a toast
  await p.fill('.dialog input[placeholder="Filter commands…"]', 'tool');
  await p.locator('.kb-table tr:has(td:text-is("Slip Tool")) .kbd-chip').first().click();
  await p.keyboard.press('v');
  await p.waitForTimeout(150);
  const toast = await p.locator('.toast').allInnerTexts();
  H.ok(toast.some(t => /Removed V from "Selection Tool"/.test(t)), 'conflict resolved with a toast: ' + toast.join(' | '));
  await H.shot(p, 'shortcuts-conflict');
  await p.click('.dialog-foot .btn:text-is("Done")');
  // the new key works; the menubar/tool tips update
  await p.mouse.click(800, 650);
  await H.key(p, 'e');
  H.ok(await p.evaluate(() => Cutline.state.tool) === 'razor', 'pressing E selects the Razor tool');
  H.ok(await p.getAttribute('.tl-tools [data-tool="razor"]', 'data-tip') === 'Razor (E)', 'tool button tooltip follows the new key (' + await p.getAttribute('.tl-tools [data-tool="razor"]', 'data-tip') + ')');
  await H.key(p, 'c');
  H.ok(await p.evaluate(() => Cutline.state.tool) === 'razor', 'C no longer switches tools');
  await H.key(p, 'v');
  H.ok(await p.evaluate(() => Cutline.state.tool) === 'slip', 'V now selects Slip (rebound)');
  // persists across reload
  await p.reload(); await p.waitForFunction(() => window.Cutline && window.Cutline.ready);
  const persisted = await p.evaluate(() => Cutline.CMD.keys('tool_razor'));
  H.ok(JSON.stringify(persisted) === '["E"]', 'custom shortcut persists after reload');
  // recover the session that was autosaved, then reset shortcuts to defaults
  await p.click('.dialog .welcome button:has-text("Recover Last Session")');
  await p.waitForFunction(() => !!Cutline.state.project); await p.waitForTimeout(800);
  await p.keyboard.press('Escape').catch(() => { });
  if (await p.locator('.dialog-head span:text-is("Relink Media")').count()) await p.click('.dialog-foot .btn:text-is("Close")');
  await H.key(p, 'F1');
  await p.click('.dialog-foot .btn:text-is("Reset All to Defaults")');
  await p.click('.dialog-foot .btn:text-is("Done")');
  H.ok(await p.evaluate(() => Cutline.CMD.keys('tool_razor')[0] === 'C' && Cutline.CMD.keys('tool_select')[0] === 'V'), 'Reset All restores defaults');
  // --- Preferences: still duration 2 s, snapping off by default
  await H.menu(p, 'Edit', 'Preferences');
  await p.waitForTimeout(200);
  await H.shot(p, 'prefs');
  const still = p.locator('.prefs-grid label:text-is("Default still duration") + .row input');
  await still.fill('2');
  await p.locator('.prefs-grid label:text-is("Snapping on by default") + div input').uncheck();
  await p.click('.dialog-foot .btn:text-is("Save")');
  await p.waitForTimeout(200);
  H.ok(/Snap off/.test(await p.locator('#statusbar').innerText()), 'status bar shows Snap off after Preferences change');
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V2'));
  const sd = await p.evaluate(() => { const c = Cutline.P.seq().clips.find(c => c.name === 'still.jpg'); return c && c.dur; });
  H.ok(sd === 60, 'new still uses the 2 s default (dur ' + sd + ')');
  // --- layout: drag the Library/Source divider and the top/bottom divider
  const L0 = await p.evaluate(() => Object.assign({}, Cutline.ui.layout));
  const sv = await H.center(p, '.split-v[data-split="bin"]');
  await H.drag(p, sv.x, sv.y, sv.x + 120, sv.y);
  const sh = await H.center(p, '.split-h[data-split="top"]');
  await H.drag(p, sh.x, sh.y, sh.x, sh.y - 80);
  const rv = await H.center(p, '.split-v[data-split="right"]');
  await H.drag(p, rv.x, rv.y, rv.x - 60, rv.y);
  const L1 = await p.evaluate(() => Object.assign({}, Cutline.ui.layout));
  H.ok(L1.binW === L0.binW + 120 && L1.topH < L0.topH && L1.rightW === L0.rightW + 60, 'dividers resize panels: ' + JSON.stringify(L1));
  await H.shot(p, 'layout-dragged');
  await p.dblclick('.split-v[data-split="bin"]');
  const L2 = await p.evaluate(() => Object.assign({}, Cutline.ui.layout));
  H.ok(L2.binW === 300 && L2.topH === 0.5, 'double-click divider resets layout');
  // workspaces
  for (const ws of ['color', 'audio', 'titles', 'edit']) {
    await p.click(`.ws-btns .ws[data-ws="${ws}"]`);
    await p.waitForTimeout(150);
    const tab = await p.evaluate(() => document.querySelector('#p-right .tab.active').getAttribute('data-id'));
    H.ok(tab === { color: 'color', audio: 'audio', titles: 'inspector', edit: 'inspector' }[ws], 'workspace ' + ws + ' → right tab ' + tab);
  }
  // Window › Source Monitor toggle hides/shows the source panel
  await H.menu(p, 'Window', 'Source Monitor');
  H.ok(await p.evaluate(() => getComputedStyle(document.getElementById('p-source')).display === 'none'), 'Window › Source Monitor hides the source monitor');
  await H.shot(p, 'no-source');
  await H.menu(p, 'Window', 'Source Monitor');
  // --- 1366×768: nothing clipped/overlapping
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.waitForTimeout(600);
  await H.shot(p, 'at-1366');
  const lay = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, sw: e.scrollWidth, cw: e.clientWidth }; };
    const out = { body: { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }, menubar: r('#menubar'), status: r('#statusbar'), tlhead: r('#p-timeline .panel-head'), right: r('#p-right'), ws: r('.ws-btns'), proj: r('#menubar .proj-name') };
    out.bars = Array.from(document.querySelectorAll('.mon-bar')).map(b => ({ sw: b.scrollWidth, cw: b.clientWidth }));
    out.tabs = Array.from(document.querySelectorAll('.tabs')).map(t => ({ sw: t.scrollWidth, cw: t.clientWidth }));
    out.headItems = Array.from(document.querySelectorAll('#p-timeline .panel-head > *')).map(e => Math.round(e.getBoundingClientRect().right));
    out.lastMenu = Math.round(Array.from(document.querySelectorAll('.menu-title')).pop().getBoundingClientRect().right);
    return out;
  });
  H.info(JSON.stringify(lay));
  H.ok(lay.body.sw <= 1366 && lay.body.sh <= 768, 'no page scrollbars at 1366×768 (' + lay.body.sw + '×' + lay.body.sh + ')');
  H.ok(lay.bars.every(b => b.sw <= b.cw + 1), 'monitor bars fit: ' + JSON.stringify(lay.bars));
  H.ok(lay.tabs.every(t => t.sw <= t.cw + 1), 'panel tab strips fit: ' + JSON.stringify(lay.tabs));
  H.ok(Math.max(...lay.headItems) <= lay.tlhead.r + 1, 'timeline header controls fit');
  H.ok(lay.lastMenu < lay.proj.x || lay.proj.w === 0, 'menus do not overlap the project name');
  const tools = await p.evaluate(() => { const c = document.querySelector('.tl-tools'), r0 = c.getBoundingClientRect(), pr = document.getElementById('p-timeline').getBoundingClientRect(), r = { bottom: Math.min(r0.bottom, pr.bottom) }; return { all: Array.from(c.children).every(b => { const q = b.getBoundingClientRect(); return q.bottom <= r.bottom + 0.5 && q.height >= 20; }), sh: c.scrollHeight, ch: c.clientHeight }; });
  H.ok(tools.all && tools.sh <= tools.ch + 1, 'all timeline tool buttons visible at 1366×768 ' + JSON.stringify(tools));
  // tracks below the fold are reachable by scrolling the timeline
  const tl = await H.center(p, '#p-timeline .tl-scroll');
  await p.mouse.move(tl.x, tl.y); await p.mouse.wheel(0, 400); await p.waitForTimeout(200);
  const a3 = await p.evaluate(() => { const C = Cutline, TL = C.TL, s = C.P.seq(), r = TL.rows.find(r => r.track && C.P.trackLabel(s, r.track) === 'A3'), sr = TL.scroller.getBoundingClientRect(); return { top: sr.top + r.y - TL.scrollY, bottom: sr.top + r.y - TL.scrollY + r.h, sbot: sr.top + TL.scroller.clientHeight, st: TL.scrollY }; });
  H.ok(a3.st > 0 && a3.bottom <= a3.sbot + 1, 'wheel scrolls the timeline so A3 is fully visible ' + JSON.stringify(a3));
  await H.shot(p, 'at-1366-scrolled');
  await p.mouse.wheel(0, -400);
  // 1366 with a clip selected: inspector usable
  await p.mouse.click((await H.clipBox(p, { track: 'V2' })).x0 + 5, (await H.clipBox(p, { track: 'V2' })).y);
  await p.waitForTimeout(200);
  await H.shot(p, 'at-1366-selected');
  await p.click('.ws-btns .ws[data-ws="color"]'); await p.waitForTimeout(400);
  await H.shot(p, 'at-1366-color');
  const rp = await p.evaluate(() => { const e = document.querySelector('#p-right .pane.active'); return { sw: e.scrollWidth, cw: e.clientWidth }; });
  H.ok(rp.sw <= rp.cw + 1, 'Color panel has no horizontal overflow at 1366 (' + rp.sw + '/' + rp.cw + ')');
  await p.click('.ws-btns .ws[data-ws="edit"]');
  await H.key(p, 'Control+m'); await p.waitForTimeout(500);
  const dl = await p.evaluate(() => { const r = document.querySelector('.dialog').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
  H.ok(dl.x >= 0 && dl.y >= 0 && dl.r <= 1366 && dl.b <= 768, 'Export dialog fits in 1366×768: ' + JSON.stringify(dl));
  await H.shot(p, 'at-1366-export');
  await p.keyboard.press('Escape');
  await H.finish(b, errs, 'h14_prefs_layout');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
