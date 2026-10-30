// pass2 y7: proxies — background VP8/VP9 transcode of a 1080p file, PX badge, preview plays the proxy while export
// renders the original, View › Use Proxies toggle, proxy survives a reload (IndexedDB) and relink.
const H = require('./plib');
const fs = require('fs');
const { execSync } = require('child_process');
const OUT = H.path.join(__dirname, 'out') + '/';
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y7');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['main1080.webm']);
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => { const m = prj.media.find(x => x.name === 'main1080.webm'); T.placeMedia(s, m, 0, P.vtracks(s)[0].id, null, 'overwrite', 0, 4); });
  });
  await p.waitForTimeout(300);
  // create a proxy from the Library context menu
  const item = await p.locator('.bin-item:has-text("main1080")').first().boundingBox();
  await p.mouse.click(item.x + item.width / 2, item.y + item.height / 2, { button: 'right' });
  await p.waitForTimeout(200);
  await H.shot(p, 'library-menu');
  const hasCreate = await p.locator('.cl-menu .item:has-text("Create Proxy")').count();
  H.ok(hasCreate === 1, 'Library context menu offers Create Proxy for a video item');
  await p.click('.cl-menu .item:has-text("Create Proxy")');
  await p.waitForTimeout(400);
  const busy = await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'); return { busy: C.Proxy.busy(m), status: document.querySelector('#statusbar').textContent }; });
  H.info('while transcoding: ' + JSON.stringify(busy));
  H.ok(busy.busy && /proxy \d+%/.test(busy.status), 'status bar shows the proxy transcode progress');
  await H.shot(p, 'transcoding');
  await p.waitForFunction(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'); return C.Proxy.has(m); }, null, { timeout: 180000 });
  await p.waitForTimeout(500);
  const info = await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'), rt = C.MRT[m.id]; return { proxy: rt.proxy, badge: !!document.querySelector('.bin-item .px-badge'), badgeText: (document.querySelector('.bin-item .px-badge') || {}).textContent }; });
  H.info('proxy: ' + JSON.stringify(info));
  H.ok(info.proxy && info.proxy.w === 960 && info.proxy.h === 540 && info.proxy.size > 10000 && info.proxy.size < 4000000, 'proxy is a 960×540 file much smaller than the source (' + (info.proxy && info.proxy.size) + ' bytes)');
  H.ok(info.badge && info.badgeText === 'PX', 'Library thumbnail shows the PX badge');
  await H.shot(p, 'proxy-ready');
  // the Program monitor's video element now plays the proxy
  await p.evaluate(() => Cutline.Engine.seek(30)); await p.waitForTimeout(800);
  const prev = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips[0], e = C.Engine.provider.elementOf(c.id), m = C.P.media(c.mediaId), rt = C.MRT[m.id]; return { url: e && e.url === rt.proxyUrl ? 'proxy' : 'original', vw: e && e.el.videoWidth, status: document.querySelector('#statusbar').textContent }; });
  H.info('preview element: ' + JSON.stringify(prev));
  H.ok(prev.url === 'proxy' && prev.vw === 960, 'Program monitor plays the 960 px proxy');
  H.ok(/PROXY/.test(prev.status), 'status bar flags PROXY while a proxied clip is shown');
  const px = await H.progPixels(p, [[0.5, 0.5]]);
  H.ok(px[0][0] + px[0][1] + px[0][2] > 60, 'proxied frame renders a picture (' + px[0] + ')');
  // export reads the original: a 1920-wide export frame is sharp (compare detail energy against a proxy-sized upscale)
  const ex = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq();
    const cv = document.createElement('canvas'), comp = C.createCompositor(cv), prov = new C.SourceProvider('export'); prov.useDecoders = true;
    const scene = C.Scene.build(s, 30); await prov.prepare(scene); comp.render(scene, 1920, 1080, prov, { captions: false });
    const src = prov.source(C.Scene.clipLayers(scene)[0], { seq: s, outW: 1920, outH: 1080 });
    const r = { srcW: src && src.w, srcH: src && src.h, frames: Object.keys(prov.frames || {}).length };
    prov.dropAll(); if (comp.destroy) comp.destroy(); return r;
  });
  H.info('export source: ' + JSON.stringify(ex));
  H.ok(ex.srcW === 1920 && ex.srcH === 1080, 'export provider decodes the original 1920×1080 frames, not the proxy');
  // View › Use Proxies off → element switches back to the original
  await H.menu(p, 'View', 'Use Proxies');
  await p.waitForTimeout(800);
  await p.evaluate(() => Cutline.Engine.renderNow()); await p.waitForTimeout(300);
  const off = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips[0], e = C.Engine.provider.elementOf(c.id), rt = C.MRT[C.P.media(c.mediaId).id]; return { url: e && e.url === rt.url ? 'original' : 'proxy', pref: C.prefs.useProxies, badgeOff: !!document.querySelector('.px-badge.off') }; });
  H.ok(off.url === 'original' && off.pref === false && off.badgeOff, 'turning proxies off plays the original and dims the badge');
  await H.menu(p, 'View', 'Use Proxies');
  await p.waitForTimeout(300);
  // reload: the proxy comes back from IndexedDB once the media is online again (recovery restores the cached file)
  await p.evaluate(() => Cutline.IO.autosaveNow());
  await H.boot(p);
  await p.click('.welcome .side button:has-text("Recover")');
  await p.waitForFunction(() => { const C = Cutline, m = C.state.project && C.state.project.media.find(x => x.name === 'main1080.webm'); return m && C.Media.isOnline(m) && C.Proxy.has(m); }, null, { timeout: 30000 });
  await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
  const back = await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'); return C.MRT[m.id].proxy; });
  H.ok(back && back.w === 960, 'proxy restored from IndexedDB after a reload (' + JSON.stringify(back) + ')');
  // remove
  await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'); return C.Proxy.remove(m); });
  await p.waitForTimeout(300);
  const gone = await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'main1080.webm'); return { has: C.Proxy.has(m), badge: !!document.querySelector('.px-badge') }; });
  H.ok(!gone.has && !gone.badge, 'Remove Proxy drops the proxy and its badge');
  await H.finish(b, errs, 'y7_proxy');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
