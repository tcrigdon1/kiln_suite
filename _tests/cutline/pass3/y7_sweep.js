// Pass 3 polish — fire every registered command with no project, an empty project, and a populated timeline
// (video + linked audio + music + spectrum + title + track matte + censor + presets + markers). Console errors fail.
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p);
  const SKIP = /^(newProject|openProject|saveProject|saveAs|import|relink|export|batchExport|exportFrame|exportWav|exportSRT|projectManager|versions|fullscreen|tour|demoProject|importProject|saveTemplate|prefs|shortcuts|keyLayout|exportEDL|exportXML|importMarkers|exportGrade|popOutProgram|gpuReport|palette|play|shuttleJ|shuttleK|shuttleL|loop)$/;
  async function sweep(label) {
    const r = await p.evaluate(async (skipSrc) => {
      const C = Cutline, skip = new RegExp(skipSrc), out = { ran: 0, fails: [] }, orig = console.error, caught = [];
      console.error = function () { caught.push(Array.from(arguments).map(String).join(' ').slice(0, 200)); orig.apply(console, arguments); };
      for (const c of C.CMD.list) {
        if (skip.test(c.id)) continue;
        try { C.CMD.run(c.id); } catch (e) { out.fails.push(c.id + ': ' + e.message); }
        await new Promise(r => setTimeout(r, 20));
        // close dialogs/menus the command opened
        document.querySelectorAll('.dialog-backdrop, .modal-backdrop').forEach(el => { const x = el.querySelector('.dialog-head .icon-btn, .dialog .close'); if (x) x.click(); else el.remove(); });
        document.querySelectorAll('.dialog').forEach(el => { const x = el.querySelector('.dialog-head .icon-btn'); if (x) x.click(); else el.remove(); });
        document.querySelectorAll('.cl-menu').forEach(el => el.remove());
        out.ran++;
      }
      console.error = orig;
      out.fails = out.fails.concat(caught.filter(t => /command failed|TypeError|ReferenceError/.test(t)));
      return out;
    }, SKIP.source);
    info(label + ': ran ' + r.ran + (r.fails.length ? ' FAILS ' + r.fails.join(' | ') : ''));
    return r;
  }
  await L.newProjectUI(p, { name: 'SW' });
  const r1 = await sweep('empty project'); ok(!r1.fails.length, 'empty project: no command throws');
  // populate
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  await p.evaluate(() => {
    const C = Cutline, m = C.state.project.media[0];
    const spec = C.Media.newGen('spectrum', { name: 'viz' }), title = C.Media.newGen('title', { name: 't' }), white = C.Media.newGen('solid', { name: 'w' });
    C.edit('pop', (s2) => {
      const vt = s2.tracks.filter(t => t.kind === 'video'), at = s2.tracks.filter(t => t.kind === 'audio');
      C.T.placeMedia(s2, m, 0, vt[0].id, at[0].id, 'overwrite');
      const mus = C.P.newClip(s2, m, 'audio', at[1].id, 0, 360, 0); mus.name = 'music'; s2.clips.push(mus);
      const sc = C.P.newClip(s2, spec, 'video', vt[1].id, 0, 360, 0); s2.clips.push(sc);
      const tt = C.P.newClip(s2, title, 'video', vt[2] ? vt[2].id : vt[1].id, 60, 120, 0); s2.clips.push(tt);
      const v = s2.clips[0]; v.fx.push(C.FX.newInstance('trackmatte')); v.fx.push(C.FX.newInstance('pixelate')); v.masks = [C.Masks.newMask('ellipse', { fx: v.fx[1].id })];
      s2.markers.push({ id: 'mk1', f: 30, name: 'a', color: '#fff' }, { id: 'mk2', f: 200, name: 'b', color: '#fff', dur: 20 });
    });
    const s = C.P.seq(); C.state.selection = [s.clips[0].id]; C.bus.emit('selection');
    C.PresetsQC.savePresets([{ id: 'pz', name: 'Z', kind: 'video', fx: [{ type: 'vhs', p: C.FX.defaults('vhs'), on: true }], col: null }]);
  });
  await p.waitForTimeout(300);
  const r2 = await sweep('populated'); ok(!r2.fails.length, 'populated timeline: no command throws');
  // undo everything / redo everything
  const ur = await p.evaluate(() => { const C = Cutline; let u = 0, r = 0; while (C.H.undo.length && u < 300) { C.H.doUndoSilent(); u++; } while (C.H.redo.length && r < 300) { C.H.doRedoSilent(); r++; } return { u, r, clips: C.P.seq().clips.length }; });
  info(JSON.stringify(ur));
  ok(ur.u > 5 && ur.r === ur.u && ur.clips >= 4, 'undo/redo all the way through the sweep keeps the timeline');
  // render a few frames through the populated stack (matte + censor + spectrum + title)
  const rend = await p.evaluate(async () => { const C = Cutline; let okN = 0; for (const f of [10, 70, 150, 250]) { C.Engine.setFrame(f, true); await new Promise(r => setTimeout(r, 400)); C.Engine.renderNow && C.Engine.renderNow(); const px = C.Engine.comp.readSmall(4, 2); if (px && px.length) okN++; } return okN; });
  ok(rend === 4, 'frames render with the whole stack');
  const bad = errs.filter(e => !/favicon|Autoplay|AudioContext was not allowed|The user aborted|native dialog/i.test(e));
  ok(!bad.length, 'no console/page errors (' + bad.length + ')' + (bad.length ? ': ' + bad.join(' | ').slice(0, 600) : ''));
  errs.length = 0;
  await L.finish(b, errs, 'y7_sweep');
})();
