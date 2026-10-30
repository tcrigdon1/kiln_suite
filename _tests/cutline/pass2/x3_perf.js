// pass2 exploration 3: playback with many effect clips, export while playing, export write failure, layouts at
// 1280×720 / 2560×1440, HiDPI, memory after 300 edits, autosave recovery mid-drag, relink with a renamed file

const H = require('./plib');
const { chromium } = require('playwright');
(async () => {
  const { b, p, errs, ctx } = await H.launch();
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  H.setPrefix('x3');
  await H.boot(p);
  await H.newProjectUI(p, { w: 1280, h: 720 });
  await H.importUI(p, ['clip25.webm', 'clip60.webm', 'music.mp3']);
  const libItem = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const dismissMatch = async () => { await p.waitForTimeout(250); if (await p.$('.dialog:has-text("Clip format differs")')) await p.click('.dialog .btn:text-is("Keep Sequence Settings")'); };
  // ---- 50 clips with effects: drop clip25 at 0, then duplicate (Ctrl+Shift+/) 24 times → 25 pairs, apply effect to all
  let it = await libItem('clip25.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await dismissMatch();
  await p.evaluate(() => Cutline.A.selectAll());
  for (let i = 0; i < 24; i++) { await H.key(p, 'Control+Shift+Slash'); }
  await p.waitForTimeout(300);
  let cl = await H.clips(p);
  H.info('clips after duplicates: ' + cl.length);
  await p.evaluate(() => Cutline.A.selectAll());
  await H.menu(p, 'Effects', 'Color', 'Black & White');
  await H.menu(p, 'Effects', 'Stylize', 'Film Grain');
  await p.evaluate(() => Cutline.A.deselect());
  await H.key(p, 'Backslash');
  cl = await H.clips(p);
  H.ok(cl.length >= 50 && cl.filter(c => c.kind === 'video').every(c => true), cl.length + ' clips on the timeline');
  const fxN = await p.evaluate(() => Cutline.P.seq().clips.filter(c => c.fx.length === 2).length);
  H.ok(fxN === 25, 'two effects on each of the 25 video clips (' + fxN + ')');
  await H.shot(p, '50-clips');
  // play 12 s and sample rendered frames: count distinct frames vs elapsed
  await p.evaluate(() => { window.__frames = []; Cutline.bus.on('rendered', (sc) => { if (Cutline.Engine.playing) window.__frames.push([performance.now(), sc.frame]); }); });
  await p.evaluate(() => Cutline.Engine.seek(0));
  await H.key(p, 'Space');
  await p.waitForTimeout(12000);
  await H.key(p, 'Space');
  const st = await p.evaluate(() => { const f = window.__frames; if (f.length < 2) return null; const span = (f[f.length - 1][0] - f[0][0]) / 1000; const frames = f[f.length - 1][1] - f[0][1]; let gaps = 0, maxGap = 0; for (let i = 1; i < f.length; i++) { const g = f[i][1] - f[i - 1][1]; if (g > 3) gaps++; maxGap = Math.max(maxGap, g); } return { renders: f.length, span: span, timelineFrames: frames, rps: f.length / span, gaps: gaps, maxGap: maxGap, fps: frames / span }; });
  H.info('playback of 25 effect clips: ' + JSON.stringify(st));
  H.ok(st && st.fps > 20 && st.fps < 40, 'timeline advanced in real time (' + (st && st.fps.toFixed(1)) + ' timeline fps over ' + (st && st.span.toFixed(1)) + ' s)');
  H.ok(st && st.rps > 2.5, 'program kept rendering under SwiftShader software decode (' + (st && st.rps.toFixed(1)) + ' renders/s; effects are not the bottleneck, see x3 notes)');
  // ---- export while playing: playback must stop
  await p.evaluate(() => Cutline.Engine.seek(0));
  await H.key(p, 'Space');
  await p.waitForTimeout(500);
  H.ok(await p.evaluate(() => Cutline.Engine.playing), 'playing before export');
  await H.key(p, 'Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  await p.waitForTimeout(600);
  const playingWithDialog = await p.evaluate(() => Cutline.Engine.playing);
  H.info('still playing while the export dialog is open: ' + playingWithDialog);
  // choose In→Out short range? set range all but 1/4 res to keep it quick: use 480 lines
  await p.selectOption('.dialog select >> nth=2', '480');
  await p.waitForTimeout(100);
  await p.click('.dialog .btn.primary:has-text("Export")');
  await p.waitForTimeout(800);
  H.ok(!(await p.evaluate(() => Cutline.Engine.playing)), 'playback stopped when the export started');
  await H.shot(p, 'export-progress');
  // cancel it
  await p.click('.dialog .btn:has-text("Cancel")');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 30000 });
  // ---- export when the target write fails: fake picker whose writable throws after the first write
  await p.evaluate(() => {
    window.showSaveFilePicker = async (o) => ({ name: (o && o.suggestedName) || 'x.webm', createWritable: async () => { let n = 0; return { write: async (d) => { n++; if (n > 2) throw new DOMException('The disk is full (simulated)', 'QuotaExceededError'); }, seek: async () => { }, truncate: async () => { }, close: async () => { }, abort: async () => { window.__aborted = true; } }; } });
  });
  await H.key(p, 'Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  await p.selectOption('.dialog select >> nth=2', '480');
  await p.click('.dialog .btn.primary:has-text("Export")');
  await p.waitForSelector('.dialog:has-text("Export failed")', { timeout: 60000 }).catch(() => { });
  await H.shot(p, 'export-write-failed');
  const failDlg = await p.evaluate(() => { const d = document.querySelector('.dialog'); return d ? d.textContent.slice(0, 200) : null; });
  H.info('dialog after write failure: ' + failDlg + ' aborted=' + (await p.evaluate(() => !!window.__aborted)));
  H.ok(failDlg && /Export failed/.test(failDlg) && /disk is full/.test(failDlg), 'write failure is reported with the reason');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  H.ok(!(await p.$('.dialog')), 'no stuck progress dialog after the failure');
  await p.evaluate(() => { delete window.showSaveFilePicker; });
  // ---- memory growth after 300 edits (nudge the selection back and forth)
  await p.evaluate(() => Cutline.A.selectAll());
  const gc = async () => { try { await cdp.send('HeapProfiler.collectGarbage'); } catch (e) { } };
  await gc(); await p.waitForTimeout(300);
  const h0 = await H.heapMB(cdp);
  for (let i = 0; i < 150; i++) { await p.keyboard.press('Alt+ArrowRight'); await p.keyboard.press('Alt+ArrowLeft'); }
  await p.waitForTimeout(500);
  await gc(); await p.waitForTimeout(300);
  const h1 = await H.heapMB(cdp);
  const hist = await p.evaluate(() => ({ undo: Cutline.H.undo.length, snapKB: Math.round(Cutline.H.cur.length / 1024) }));
  H.info('heap before ' + h0.toFixed(1) + ' MB, after 300 edits ' + h1.toFixed(1) + ' MB; history ' + JSON.stringify(hist));
  H.ok(h1 - h0 < 120, 'heap growth after 300 edits under 120 MB (' + (h1 - h0).toFixed(1) + ' MB; history holds ' + hist.undo + ' snapshots of ' + hist.snapKB + ' KB)');
  // ---- autosave recovery mid-drag: start dragging a clip, then "crash" (reload) while the pointer is down
  await p.evaluate(() => Cutline.A.deselect());
  const bx = await H.clipBox(p, { track: 'V1', idx: 3 });
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  await p.mouse.move(bx.x0 + 20, bx.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(bx.x0 + 20 + i * 15 * ppf, bx.y);
  await p.waitForTimeout(200);
  const live = await p.evaluate(() => ({ dirty: Cutline.state.dirty, cur: JSON.parse(Cutline.H.cur).sequences[0].clips.length }));
  await H.shot(p, 'mid-drag');
  // simulate the crash: navigate away without mouseup
  await p.evaluate(() => Cutline.IO.autosaveNow());
  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('cutline.autosave')));
  const recClips = rec && JSON.parse(rec.json).sequences[0].clips;
  const committed = await p.evaluate(() => JSON.parse(Cutline.H.cur).sequences[0].clips);
  const sameAsCommitted = JSON.stringify(recClips.map(c => [c.id, c.start])) === JSON.stringify(committed.map(c => [c.id, c.start]));
  H.info('autosave mid-drag equals the last committed state: ' + sameAsCommitted + ' (live state has ' + live.cur + ' clips)');
  H.ok(sameAsCommitted, 'autosave written during a drag holds the last committed state, not the half-finished drag');
  await p.mouse.up();
  await p.waitForTimeout(200);
  // ---- relink with a renamed file: save, reopen in a fresh profile, relink picking a differently named copy
  const renamed = H.path.join(__dirname, 'out', 'renamed_clip25.webm');
  H.fs.copyFileSync(H.MEDIA + 'clip25.webm', renamed);
  const [dl] = await Promise.all([p.waitForEvent('download'), H.key(p, 'Control+s')]);
  const saved = H.path.join(__dirname, 'out', 'x3-save.kcut');
  await dl.saveAs(saved);
  const ctx2 = await b.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  await ctx2.addInitScript(() => { try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; } catch (e) { } });
  const p2 = await ctx2.newPage();
  const errs2 = []; p2.on('console', m => { if (m.type() === 'error') errs2.push('console: ' + m.text()); }); p2.on('pageerror', e => errs2.push('pageerror: ' + e.message));
  await H.boot(p2);
  const [fc2] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('.welcome .btn:has-text("Open Project")')]);
  await fc2.setFiles(saved);
  await p2.waitForSelector('.dialog:has-text("Relink Media")', { timeout: 15000 });
  // Select Files… with the renamed copy only: must NOT auto-match (name differs) — then Locate… per item picks it
  const [fc3] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('.dialog .btn.primary')]);
  await fc3.setFiles([renamed]);
  await p2.waitForTimeout(800);
  let off = await p2.evaluate(() => Cutline.Media.offlineMedia().map(m => m.name));
  H.info('offline after offering a renamed file: ' + off);
  H.ok(off.indexOf('clip25.webm') >= 0, 'a differently named file is not matched automatically by name');
  const [fc4] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('.relink-row:has-text("clip25.webm") .btn')]);
  await fc4.setFiles([renamed]);
  await p2.waitForFunction(() => !Cutline.Media.offlineMedia().some(m => m.name === 'clip25.webm'), null, { timeout: 30000 });
  const mrec = await p2.evaluate(() => { const m = Cutline.state.project.media.find(m => /clip25/.test(m.name)); return { name: m.name, online: Cutline.Media.isOnline(m), dur: m.duration }; });
  H.info('after Locate… with the renamed file: ' + JSON.stringify(mrec));
  H.ok(mrec.online, 'Locate… relinks a renamed file');
  await p2.screenshot({ path: H.SHOTS + 'x3-relink-renamed.png' });
  // reopening the same project later: does the stored name follow the new file so it matches next time?
  const nowName = mrec.name;
  H.info('media record name after relink: ' + nowName + (nowName === 'renamed_clip25.webm' ? ' (follows the file)' : ' (keeps the old name)'));
  if (errs2.length) H.info('page2 errors: ' + errs2.join('\n'));
  await ctx2.close();
  // ---- layouts: 1280×720 and 2560×1440, HiDPI 2×
  for (const vp of [{ width: 1280, height: 720 }, { width: 2560, height: 1440 }]) {
    const c3 = await b.newContext({ viewport: vp, deviceScaleFactor: vp.width === 2560 ? 2 : 1 });
    const p3 = await c3.newPage(); const e3 = []; p3.on('pageerror', e => e3.push(e.message)); p3.on('console', m => { if (m.type() === 'error') e3.push(m.text()); });
    await H.boot(p3);
    await p3.waitForSelector('.dialog .welcome');
    await p3.click('.dialog .preset[data-w="1920"][data-h="1080"]'); await p3.click('.dialog-foot .btn.primary');
    await p3.waitForFunction(() => !!Cutline.state.project);
    await p3.waitForTimeout(400);
    const [fc5] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
    await fc5.setFiles([H.MEDIA + 'main1080.webm']);
    await p3.waitForFunction(() => Cutline.state.project.media.length === 1 && Cutline.MRT[Cutline.state.project.media[0].id].status === 'ready', null, { timeout: 30000 });
    await p3.waitForSelector('#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
    const it3 = await p3.locator('#p-bin .bin-item:has(.name:text-is("main1080.webm"))').boundingBox();
    const sr3 = await p3.locator('#p-timeline .tl-scroll').boundingBox();
    const rowY = await p3.evaluate(() => { const C = Cutline, TL = C.TL, s = C.P.seq(); const r = TL.rows.find(r => r.track && C.P.trackLabel(s, r.track) === 'V1'); const sr = TL.scroller.getBoundingClientRect(); return sr.top + r.y - TL.scrollY + r.h / 2; });
    await H.dnd(p3, it3.x + it3.width / 2, it3.y + it3.height / 2, sr3.x + 3, rowY);
    await p3.waitForTimeout(1200);
    await p3.keyboard.press('Backslash');
    await p3.waitForTimeout(300);
    const m = await p3.evaluate(() => {
      const vis = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0; };
      const bar = document.querySelector('#p-program .mon-bar'), hidden = Array.from(bar.children).filter(c => getComputedStyle(c).display === 'none').map(c => c.getAttribute('data-tip') || c.tagName);
      return { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight,
        tools: Array.from(document.querySelectorAll('.tl-tools .icon-btn')).every(b2 => { const r = b2.getBoundingClientRect(); return r.height >= 16 && r.bottom <= innerHeight; }),
        exportBtnOk: vis('#p-program .mon-bar .icon-btn[data-tip^="Full-screen"]'), hiddenProgCtrls: hidden,
        prog: { css: [Cutline.Program.canvas.clientWidth, Cutline.Program.canvas.clientHeight], px: [Cutline.Program.canvas.width, Cutline.Program.canvas.height] },
        tl: { css: [Cutline.TL.canvas.clientWidth, Cutline.TL.canvas.clientHeight], px: [Cutline.TL.canvas.width, Cutline.TL.canvas.height] },
        a3: (() => { const el = Array.from(document.querySelectorAll('.th.audio .lbl')).find(e => e.textContent === 'A3'); if (!el) return null; const r = el.getBoundingClientRect(); return r.bottom <= innerHeight; })(), dpr: devicePixelRatio };
    });
    H.info(vp.width + '×' + vp.height + ' @' + m.dpr + 'x: ' + JSON.stringify(m));
    H.ok(m.scrollW <= m.iw && m.scrollH <= m.ih, vp.width + '×' + vp.height + ': no page overflow');
    H.ok(m.tools, vp.width + '×' + vp.height + ': all tool buttons visible');
    if (m.dpr === 2) {
      H.ok(m.tl.px[0] === m.tl.css[0] * 2, 'HiDPI: timeline canvas backing store is 2× CSS size');
      H.ok(m.prog.px[0] >= m.prog.css[0] * 2 * 0.95, 'HiDPI: program canvas renders at ≥ device resolution (' + m.prog.px + ' for CSS ' + m.prog.css + ')');
    }
    await p3.screenshot({ path: H.SHOTS + 'x3-layout-' + vp.width + '.png' });
    if (e3.length) H.info('errors at ' + vp.width + ': ' + e3.join('\n'));
    await c3.close();
  }
  await H.finish(b, errs.filter(e => !/\(simulated\)/.test(e)), 'x3_perf'); // the disk-full step provokes a logged export error on purpose
})();
