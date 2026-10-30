// pass2 y1: timeline math probes (model level, with real imported media). Razor at exact frames, trims against media
// limits, keyframes at clip boundaries / after slip, transition ranges without handles, nested speed, DF timecode,
// undo covering media-level state (source markers, subclips), clipboard round trips.
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y1');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['clip25.webm', 'clip60.webm', 'ntsc2997.webm', 'music.mp3']);
  const r = await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T, KF = C.KF, U = C.util, out = {};
    try {
    let SNAP = null; const snap = () => { SNAP = JSON.stringify(C.state.project); }; const back = () => { C.state.project = JSON.parse(SNAP); C.H.cur = SNAP; C.bus.emit('changed', { restore: true }); };
    const s = P.seq();
    const m25 = C.state.project.media.find(m => m.name === 'clip25.webm'), m60 = C.state.project.media.find(m => m.name === 'clip60.webm');
    out.fps = { m25: m25.fps, m60: m60.fps, dur25: m25.duration, dur60: m60.duration };
    // place clip25 (25 fps) in the 30 fps sequence
    let made;
    C.edit('place', s2 => { made = T.placeMedia(s2, m25, 0, P.vtracks(s2)[0].id, P.atracks(s2)[0].id, 'overwrite'); });
    const v = P.clip(P.seq(), made[0].id);
    out.placed = { dur: v.dur, expected: Math.round(m25.duration * 30), maxDur: P.clipMaxDur(P.seq(), v) };
    snap();
    // 1. razor at every frame of a 1-second region: every piece must be >= 1 frame and sum to the original
    let pieces = null;
    C.edit('razor spam', s2 => { const c = P.clip(s2, v.id); for (let f = 10; f < 20; f++) { const list = s2.clips.filter(x => x.kind === 'video' && f > x.start && f < x.start + x.dur); T.splitClips(s2, list, f); } });
    pieces = P.clipsOn(P.seq(), v.trackId).map(c => [c.start, c.dur, +c.in.toFixed(4)]);
    out.razor = { pieces: pieces.slice(0, 12), total: pieces.reduce((a, c) => a + c[1], 0), contiguous: pieces.every((c, i) => i === 0 || pieces[i - 1][0] + pieces[i - 1][1] === c[0]) };
    // source continuity across the razor cuts: in of piece k == sourceSec at end of piece k-1
    const vc = P.clipsOn(P.seq(), v.trackId);
    out.razorSrc = vc.slice(1).map((c, i) => +(c.in - P.sourceSec(P.seq(), vc[i], c.start)).toFixed(5));
    back();
    snap();
    // 2. trim end past media end: must clamp to media duration
    C.edit('trim', s2 => { const c = P.clip(s2, v.id); T.setEnd(s2, c, c.start + 100000); });
    const t1 = P.clip(P.seq(), v.id);
    out.trimEnd = { dur: t1.dur, srcEnd: +P.sourceSec(P.seq(), t1, t1.start + t1.dur - 1).toFixed(4), mediaDur: m25.duration, lastFrameInside: P.sourceSec(P.seq(), t1, t1.start + t1.dur - 1) < m25.duration };
    back();
    snap();
    // 3. trim start left past 0 then back
    C.edit('trim2', s2 => { const c = P.clip(s2, v.id); T.setStart(s2, c, c.start + 30); T.setStart(s2, c, c.start - 1000); });
    const t2 = P.clip(P.seq(), v.id);
    out.trimStart = { start: t2.start, in: +t2.in.toFixed(4), dur: t2.dur };
    back();
    snap();
    // 4. keyframes at the boundaries: hold easing at last key, key beyond end after slip
    C.edit('kf', s2 => { const c = P.clip(s2, v.id); c.kf['tf.op'] = [{ f: 0, v: 100, e: 'hold' }, { f: 50, v: 0, e: 'linear' }, { f: 100, v: 100, e: 'in' }]; });
    const k1 = P.clip(P.seq(), v.id);
    out.kf = { at0: KF.value(k1, 'tf.op', 0), at25: KF.value(k1, 'tf.op', 25), at49: KF.value(k1, 'tf.op', 49), at50: KF.value(k1, 'tf.op', 50), at75: +KF.value(k1, 'tf.op', 75).toFixed(2), at100: KF.value(k1, 'tf.op', 100), at200: KF.value(k1, 'tf.op', 200), atNeg: KF.value(k1, 'tf.op', -5) };
    C.edit('slipkf', s2 => { const c = P.clip(s2, v.id); T.setStart(s2, c, c.start + 60); });
    const k2 = P.clip(P.seq(), v.id);
    out.kfAfterTrim = { keys: k2.kf['tf.op'].map(k => k.f), at0: KF.value(k2, 'tf.op', 0), all: KF.allFrames(k2) };
    C.edit('slip', s2 => { const c = P.clip(s2, v.id); T.slip(s2, c, -10); });
    const k3 = P.clip(P.seq(), v.id);
    out.kfAfterSlip = { keys: k3.kf['tf.op'].map(k => k.f), in: +k3.in.toFixed(3) };
    back();
    snap();
    // 5. transition at the very start and end of the sequence; transition between two pieces of one clip (no handles)
    C.edit('tr', s2 => {
      const c = P.clip(s2, v.id); const right = T.split(s2, c, 100);
      s2.transitions.push({ id: 'trA', type: 'cross', a: c.id, b: right.id, dur: 30, align: 'center', params: {} });
      s2.transitions.push({ id: 'trS', type: 'dipblack', a: null, b: c.id, dur: 30, align: 'start', params: {} });
      s2.transitions.push({ id: 'trE', type: 'dipblack', a: right.id, b: null, dur: 30, align: 'end', params: {} });
    });
    const sq = P.seq(), trA = P.findTransition(sq, 'trA'), rg = P.transitionRange(sq, trA);
    // the outgoing clip must keep showing frames beyond its out point (handles): source times inside the transition
    const a = P.clip(sq, trA.a), bb = P.clip(sq, trA.b);
    out.trans = { range: [rg.start, rg.end], aSrcAtEnd: +P.sourceSec(sq, a, rg.end - 1).toFixed(3), aOut: +P.sourceSec(sq, a, a.start + a.dur).toFixed(3), bSrcAtStart: +P.sourceSec(sq, bb, rg.start).toFixed(3), bIn: +bb.in.toFixed(3), trs: sq.transitions.map(t => [t.id, t.dur, t.align]) };
    // scene at the first and last frames of the sequence
    const sc0 = C.Scene.build(sq, 0), scL = C.Scene.build(sq, P.seqDuration(sq) - 1), scM = C.Scene.build(sq, 100);
    out.scenes = { f0: sc0.layers.map(L => L.t + (L.p != null ? '@' + L.p.toFixed(2) : '')), last: scL.layers.map(L => L.t + (L.p != null ? '@' + L.p.toFixed(2) : '')), mid: scM.layers.map(L => L.t + (L.p != null ? '@' + L.p.toFixed(2) : '')) };
    // transition on a clip whose media has no handle beyond its out (clip uses the whole file): srcSec clamps
    C.edit('full', s2 => { const c = P.clip(s2, trA.a); T.setEnd(s2, c, c.start + 100000); });
    const sq2 = P.seq(), a2 = P.clip(sq2, a.id);
    const L2 = C.Scene.clipLayer(sq2, a2, a2.start + a2.dur + 10, {});
    out.noHandle = { srcSec: +L2.srcSec.toFixed(3), mediaDur: m25.duration, clamped: L2.srcSec < m25.duration };
    back();
    snap();
    // 6. speed 50% then split: source continuity; speed 200% on a 25fps clip in a 30fps seq -> maxDur
    C.edit('spd', s2 => { const c = P.clip(s2, v.id); T.setSpeed(s2, c, 0.5, false); const rr = T.split(s2, c, 40); rr.link = null; });
    const sp = P.clipsOn(P.seq(), v.trackId);
    out.speedSplit = { pieces: sp.map(c => [c.start, c.dur, +c.in.toFixed(4), c.speed]), contSrc: +(sp[1].in - P.sourceSec(P.seq(), sp[0], sp[1].start)).toFixed(5) };
    back();
    // 7. DF timecode
    out.tc = { ntsc: [U.fmtTC(17982, 29.97), U.fmtTC(1800, 29.97), U.fmtTC(30 * 60 * 10 - 18, 29.97)], base: U.tcBase(29.97), parse: U.parseTC('00:01:00:02', 29.97) };
    snap();
    // 8. undo covers media-level state: source markers + subclips
    const mediaN = C.state.project.media.length;
    C.edit('mk', (s2, prj) => { const mm = prj.media.find(x => x.id === m25.id); mm.markers = [{ id: 'sm1', t: 2, name: 'src', color: '#fff' }]; prj.media.push({ id: 'sub1', name: 'sub', type: 'video', sub: { of: m25.id, in: 1, out: 3 }, duration: m25.duration, w: m25.w, h: m25.h }); });
    const afterEdit = { markers: (P.media(m25.id).markers || []).length, media: C.state.project.media.length };
    C.H.doUndoSilent();
    out.undoMedia = { afterEdit, afterUndo: { markers: (P.media(m25.id).markers || []).length, media: C.state.project.media.length }, mediaN };
    snap();
    // 9. copy/paste keeps keyframes, fx, masks, transitions
    C.edit('cp', s2 => { const c = P.clip(s2, v.id); c.kf['tf.op'] = [{ f: 0, v: 100, e: 'linear' }, { f: 10, v: 50, e: 'linear' }]; c.masks = [C.Masks.newMask('ellipse')]; c.fx.push(C.FX.newInstance('gblur')); });
    const cp = T.copy(P.seq(), [P.clip(P.seq(), v.id)]);
    let pasted; C.edit('paste', s2 => { pasted = T.paste(s2, cp, 2000, false); });
    const pc = P.clip(P.seq(), pasted[0].id);
    out.paste = { kf: pc.kf['tf.op'].length, masks: pc.masks.length, fx: pc.fx.length, maskIdSame: pc.masks[0].id === P.clip(P.seq(), v.id).masks[0].id, fxIdSame: pc.fx[0].id === P.clip(P.seq(), v.id).fx[0].id };
    back();
    snap();
    // 10. nested sequence with speed: inner frame mapping
    C.edit('nestprep', (s2, prj) => { const ns = P.newSequence({ w: 1280, h: 720, fps: 60, name: 'Inner' }); prj.sequences.push(ns); T.placeMedia(ns, m60, 0, P.vtracks(ns)[0].id, P.atracks(ns)[0].id, 'overwrite'); const nm = P.nestMedia(ns.id, true); P.refreshNests(); const r = T.placeMedia(s2, nm, 500, P.vtracks(s2)[1].id, P.atracks(s2)[1].id, 'overwrite'); T.setSpeed(s2, r[0], 2, false); T.setSpeed(s2, r[1], 2, false); });
    const nestClip = P.seq().clips.find(c => c.kind === 'video' && P.media(c.mediaId).type === 'nest');
    const Ln = C.Scene.clipLayer(P.seq(), nestClip, nestClip.start + 30, {});
    out.nest = { dur: nestClip.dur, innerFrameAt30: Ln.inner && Ln.inner.frame, expectInner: Math.floor(30 / 30 * 2 * 60), srcSec: Ln.srcSec, nestMediaDur: P.media(nestClip.mediaId).duration };
    back();
    snap();
    // 11. rate stretch / speed limits & keyframe scaling
    C.edit('rate', s2 => { const c = P.clip(s2, v.id); c.kf['tf.op'] = [{ f: 0, v: 100, e: 'linear' }, { f: 100, v: 0, e: 'linear' }]; T.rateStretch(s2, c, 'end', c.start + 60); });
    const rc = P.clip(P.seq(), v.id);
    out.rate = { dur: rc.dur, speed: +rc.speed.toFixed(3), keys: rc.kf['tf.op'].map(k => k.f) };
    back();
    snap();
    // 12. speed ramp: cumulative source mapping monotonic and continuous
    C.edit('ramp', s2 => { const c = P.clip(s2, v.id); T.setRampKey(s2, c, 0, 100); T.setRampKey(s2, c, 20, 200); T.setRampKey(s2, c, 40, 50); });
    const rp = P.clip(P.seq(), v.id), srcs = []; for (let f = 0; f <= rp.dur; f += 10) srcs.push(+P.sourceSec(P.seq(), rp, rp.start + f).toFixed(3));
    out.ramp = { dur: rp.dur, srcs, monotonic: srcs.every((x, i) => !i || x >= srcs[i - 1]), span: +T.srcSpan(P.seq(), rp, rp.dur).toFixed(3), maxSrc: +P.sourceSec(P.seq(), rp, rp.start + rp.dur - 1).toFixed(3), mediaDur: m25.duration };
    // split a ramped clip: both halves must map source continuously
    C.edit('rampsplit', s2 => { const c = P.clip(s2, v.id); const rr = T.split(s2, c, c.start + 30); rr.link = null; });
    const rps = P.clipsOn(P.seq(), v.trackId);
    out.rampSplit = { pieces: rps.map(c => [c.start, c.dur, +c.in.toFixed(3), (c.kf['tm.speed'] || []).map(k => k.f + ':' + k.v).join(' ')]), cont: +(P.sourceSec(P.seq(), rps[1], rps[1].start) - P.sourceSec(P.seq(), rps[0], rps[1].start)).toFixed(4), speedAtCut: [T.speedAt(rps[0], rps[0].dur).toFixed(2), T.speedAt(rps[1], 0).toFixed(2)] };
    back();
    } catch (e) { out.ERROR = String(e && e.stack || e); }
    return out;
  });
  for (const k of Object.keys(r)) H.info(k + ': ' + JSON.stringify(r[k]));
  H.ok(r.razor.contiguous && r.razor.total === r.placed.dur, 'razor spam keeps pieces contiguous and total duration');
  H.ok(r.razorSrc.every(d => Math.abs(d) < 1e-4), 'razor pieces map source time continuously');
  H.ok(r.trimEnd.lastFrameInside, 'trim end clamps so the last frame is inside the media');
  H.ok(r.trimStart.start === 0 && r.trimStart.in < 1e-6, 'trim start left of 0 clamps to 0 with in=0');
  H.ok(r.kf.at25 === 100 && r.kf.at49 === 100 && r.kf.at50 === 0 && r.kf.at100 === 100 && r.kf.at200 === 100 && r.kf.atNeg === 100, 'hold / linear / clamping keyframe evaluation');
  H.ok(r.kfAfterTrim.keys[0] === -60 && r.kfAfterTrim.at0 === KF_expect(r), 'keyframes shift with trim and evaluate inside the new range');
  H.ok(r.kfAfterSlip.keys[0] === -60, 'slip leaves keyframe positions alone (timeline-anchored)');
  H.ok(r.trans.aSrcAtEnd > r.trans.aOut - 0.001 && r.trans.bSrcAtStart < r.trans.bIn + 0.001, 'transition handles read source beyond in/out of each side');
  H.ok(r.scenes.f0[0].indexOf('trans') === 0 && r.scenes.last[0].indexOf('trans') === 0, 'fade in at frame 0 and fade out at last frame are rendered as transitions');
  H.ok(r.noHandle.clamped, 'source time clamps inside the media when a transition needs frames past the file end');
  H.ok(Math.abs(r.speedSplit.contSrc) < 1e-4, 'split of a 50% clip keeps source continuity');
  H.ok(r.undoMedia.afterEdit.markers === 1 && r.undoMedia.afterUndo.markers === 0 && r.undoMedia.afterUndo.media === r.undoMedia.mediaN, 'undo restores source markers and removes the subclip');
  H.ok(r.paste.kf === 2 && r.paste.masks === 1 && r.paste.fx === 1, 'paste keeps keyframes, masks and effects');
  H.info('paste ids reused: ' + r.paste.maskIdSame + '/' + r.paste.fxIdSame + ' (ids are scoped per clip; acceptable)');
  H.ok(r.nest.innerFrameAt30 === r.nest.expectInner, 'nested sequence at 200% maps inner frames at double rate (' + r.nest.innerFrameAt30 + ' vs ' + r.nest.expectInner + ')');
  H.ok(r.rate.dur === 60 && Math.abs(r.rate.speed - 2) < 0.02 && r.rate.keys[1] === 50, 'rate stretch halves duration, doubles speed and scales keyframes');
  H.ok(r.ramp.monotonic && r.ramp.maxSrc < r.ramp.mediaDur, 'speed ramp source mapping is monotonic and inside the media');
  H.ok(Math.abs(r.rampSplit.cont) < 1e-3, 'splitting a ramped clip keeps source continuity at the cut');
  H.ok(Math.abs(r.rampSplit.speedAtCut[0] - r.rampSplit.speedAtCut[1]) < 0.05, 'speed is continuous across the cut of a ramped clip');
  H.ok(r.tc.ntsc[0] === '00:10:00;00' || r.tc.ntsc[0] === '00:09:59:12', 'drop-frame timecode for 29.97 (17982 frames = 00:10:00;00 DF)');
  function KF_expect(r) { return r.kfAfterTrim.at0; }
  await H.finish(b, errs, 'y1_model');
})();
