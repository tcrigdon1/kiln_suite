// pass2 y2: exporter / muxer correctness + GPU & decoder resource accounting.
//  - WebM export of a sequence with: solid A -> cross dissolve -> solid B (range starts INSIDE the transition),
//    an adjustment clip (invert) over the dissolve, a cropped+rotated+screen-blended clip, burnt-in captions,
//    audio tone with a fade-out at the very end. Frames are decoded back with ffmpeg and checked pixel-wise;
//    the audio tail is checked for the fade.
//  - MP4 (VP9/Opus) export probed with ffprobe (duration, first pts, stream count).
//  - GL texture/framebuffer counts and VideoFrame / AudioData open counts before/after an export.
const { ROOT } = require('../../env.js');
const H = require('./plib');
const { execSync } = require('child_process');
const fs = require('fs');
const OUT = H.path.join(__dirname, 'out') + '/';
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function pixelAt(png, x, y) { // decode PNG via ffmpeg to raw RGB and read one pixel
  const raw = execSync(`ffmpeg -v error -i ${png} -f rawvideo -pix_fmt rgb24 -`, { maxBuffer: 64 * 1048576 });
  const w = +sh(`ffprobe -v error -show_entries stream=width -of csv=p=0 ${png}`);
  const i = (y * w + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]];
}
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y2');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['clip25.webm', ROOT + '/_tests/cutline/media/tone.wav']);
  // resource counters
  if (!process.env.NOHOOK) await p.evaluate(() => {
    const C = Cutline, gl = C.Engine.comp.gl;
    window.__glc = { tex: 0, fbo: 0 };
    ['createTexture', 'createFramebuffer', 'deleteTexture', 'deleteFramebuffer'].forEach(n => {
      const o = WebGL2RenderingContext.prototype[n];
      WebGL2RenderingContext.prototype[n] = function () { const k = /Texture/.test(n) ? 'tex' : 'fbo'; window.__glc[k] += /^create/.test(n) ? 1 : -1; return o.apply(this, arguments); };
    });
    window.__vf = { made: 0, closed: 0 }; window.__ad = { made: 0, closed: 0 };
    const VD = window.VideoDecoder; window.VideoDecoder = function (init) { const oo = init.output; init.output = function (f) { window.__vf.made++; return oo(f); }; return new VD(init); }; window.VideoDecoder.isConfigSupported = VD.isConfigSupported.bind(VD); window.VideoDecoder.prototype = VD.prototype;
    const VF = window.VideoFrame; window.VideoFrame = function () { window.__vf.made++; return new (Function.prototype.bind.apply(VF, [null].concat(Array.prototype.slice.call(arguments))))(); }; window.VideoFrame.prototype = VF.prototype;
    const vfc = VideoFrame.prototype.close; VideoFrame.prototype.close = function () { if (!this.__closed) { this.__closed = true; window.__vf.closed++; } return vfc.call(this); };
    const AD = window.AudioDecoder; window.AudioDecoder = function (init) { const oo = init.output; init.output = function (f) { window.__ad.made++; return oo(f); }; return new AD(init); }; window.AudioDecoder.isConfigSupported = AD.isConfigSupported.bind(AD); window.AudioDecoder.prototype = AD.prototype;
    const ADc = window.AudioData; window.AudioData = function () { window.__ad.made++; return new (Function.prototype.bind.apply(ADc, [null].concat(Array.prototype.slice.call(arguments))))(); }; window.AudioData.prototype = ADc.prototype;
    const adc = AudioData.prototype.close; AudioData.prototype.close = function () { if (!this.__closed) { this.__closed = true; window.__ad.closed++; } return adc.call(this); };
    void gl;
  });
  // build the sequence (30 fps, 640x360 for speed)
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => {
      s.w = 640; s.h = 360;
      const red = C.Media.newGen('solid'); red.gen.color = '#ff0000'; red.name = 'red';
      const blue = C.Media.newGen('solid'); blue.gen.color = '#0000ff'; blue.name = 'blue';
      const adj = C.Media.newGen('adjust');
      const clip = prj.media.find(m => m.name === 'clip25.webm'), tone = prj.media.find(m => m.name === 'tone.wav');
      const v1 = P.vtracks(s)[0].id, v2 = P.vtracks(s)[1].id, v3 = P.vtracks(s)[2].id, a1 = P.atracks(s)[0].id;
      const r = T.placeMedia(s, red, 0, v1, null, 'overwrite', 0, 2)[0];          // 0..60
      const bl = T.placeMedia(s, blue, 60, v1, null, 'overwrite', 0, 2)[0];       // 60..120
      s.transitions.push({ id: 'trX', type: 'cross', a: r.id, b: bl.id, dur: 30, align: 'center', params: {} }); // 45..75
      const ad = T.placeMedia(s, adj, 50, v3, null, 'overwrite', 0, 0.5)[0];      // 50..65 invert over the dissolve
      ad.fx.push(C.FX.newInstance('invert'));
      const cv = T.placeMedia(s, clip, 90, v2, null, 'overwrite', 0, 1)[0];      // 90..120 crop+rot+blend
      cv.tf.scale = 50; cv.tf.rot = 45; cv.tf.cl = 25; cv.tf.cr = 25; cv.blend = 'screen'; cv.fit = true;
      const au = T.placeMedia(s, tone, 0, null, a1, 'overwrite', 0, 4)[0];       // 0..120 fade out 30 frames
      au.fadeOut = 30; au.au.vol = -6;
      s.captions.push({ id: 'cap1', start: 30, end: 100, text: 'HELLO' });
      s.inF = 55; s.outF = 120;                                                   // range starts inside the dissolve
    });
  });
  H.info('media after setup: ' + JSON.stringify(await p.evaluate(() => Cutline.state.project.media.map(m => [m.id, m.name, m.type]))) + ' clips ' + JSON.stringify(await p.evaluate(() => Cutline.P.seq().clips.map(c => [c.kind, c.mediaId, c.name]))));
  await p.waitForTimeout(500);
  await H.shot(p, 'export-setup');
  const before = await p.evaluate(() => ({ gl: Object.assign({}, window.__glc || {}), vf: Object.assign({}, window.__vf || {}), ad: Object.assign({}, window.__ad || {}) }));
  // export WebM In->Out
  const res = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq();
    const st = { format: 'webm-vp9', res: 'seq', w: s.w, h: s.h, fps: s.fps, quality: 'high', range: 'inout', audio: true, abitrate: 128000, captions: true, name: 'y2', seqId: s.id };
    const br0 = C.Mixer.blockRenderer(s, 55 / 30, 4, 48000); const bl0 = await br0.next(); let q0 = 0; for (let i = 0; i < bl0.L.length; i++) q0 += bl0.L[i] * bl0.L[i];
    const ro = await C.Mixer.renderOffline(s, 55 / 30, 4, 48000); const dro = ro.getChannelData(0); let q1 = 0; for (let i = 0; i < dro.length; i++) q1 += dro[i] * dro[i];
    const r = await C.Export.run(st, () => { }, { v: false }, null);
    const ab = await r.blob.arrayBuffer();
    let inRms = -1; try { const actx = new OfflineAudioContext(2, 48000, 48000); const dec = await actx.decodeAudioData(ab.slice(0)); const d = dec.getChannelData(0); let q = 0; for (let i = 0; i < d.length; i++) q += d[i] * d[i]; inRms = Math.sqrt(q / d.length); } catch (e) { inRms = String(e); }
    const buf = new Uint8Array(ab); let s64 = ''; for (let i = 0; i < buf.length; i += 0x8000) s64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s64), size: r.blob.size, stats: C.Export.lastStats, inRms: inRms, diag: (function () { const ac = s.clips.find(c => c.kind === 'audio'), m = C.P.media(ac.mediaId), rt = C.MRT[m.id]; return { m: m && m.name, type: m.type, hasAudio: m.hasAudio, buf: !!(rt && rt.buffer), status: rt && rt.status, streamed: C.Media.isStreamed(m), tracks: s.tracks.filter(t => t.kind === 'audio').map(t => [t.mute, t.solo, t.vol]), gain: C.Mixer.clipGainAt(s, ac, 60, C.Mixer.clipWindow(s, ac)), masterVol: s.masterVol }; })(), blockRms: Math.sqrt(q0 / bl0.L.length), offRms: Math.sqrt(q1 / dro.length), nAudioClips: s.clips.filter(c => c.kind === 'audio').length, aud: s.clips.filter(c => c.kind === 'audio').map(c => [c.start, c.dur, c.au.vol, c.au.mute, c.enabled]) };
  });
  fs.writeFileSync(OUT + 'y2.webm', Buffer.from(res.b64, 'base64'));
  H.info('webm size ' + res.size + ' stats ' + JSON.stringify(res.stats) + ' in-page rms ' + res.inRms + ' block ' + res.blockRms + ' diag ' + JSON.stringify(res.diag) + ' offline ' + res.offRms + ' audio clips ' + JSON.stringify(res.aud));
  const after = await p.evaluate(() => ({ gl: Object.assign({}, window.__glc || {}), vf: Object.assign({}, window.__vf || {}), ad: Object.assign({}, window.__ad || {}), tex: Object.keys(Cutline.Engine.comp.texCache).length, free: Cutline.Engine.comp.free.length }));
  H.info('resources before ' + JSON.stringify(before) + ' after ' + JSON.stringify(after));
  H.ok(after.vf.made === after.vf.closed, 'every decoded VideoFrame was closed (' + after.vf.made + '/' + after.vf.closed + ')');
  H.ok(after.ad.made === after.ad.closed, 'every AudioData was closed (' + after.ad.made + '/' + after.ad.closed + ')');
  H.ok(after.gl.tex - before.gl.tex < 40 && after.gl.fbo - before.gl.fbo < 40, 'GL textures/framebuffers do not accumulate across an export (+' + (after.gl.tex - before.gl.tex) + ' tex, +' + (after.gl.fbo - before.gl.fbo) + ' fbo)');
  // probe the container
  const probe = sh(`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate -of json ${OUT}y2.webm`);
  const pj = JSON.parse(probe);
  H.info('ffprobe: ' + JSON.stringify(pj));
  const dur = +pj.format.duration;
  H.ok(Math.abs(dur - 65 / 30) < 0.08, 'WebM duration matches the In->Out range (65 frames): ' + dur.toFixed(3));
  H.ok(pj.streams.length === 2 && pj.streams.some(x => x.codec_name === 'vp9') && pj.streams.some(x => x.codec_name === 'opus'), 'VP9 + Opus streams');
  const nframes = +sh(`ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 ${OUT}y2.webm`);
  H.ok(nframes === 65, 'exactly 65 video frames decoded (' + nframes + ')');
  // frame 0 of the export = sequence frame 55: inside the dissolve (p=(55-45+0.5)/30=0.35) AND under the inverted adjustment (50..65)
  sh(`ffmpeg -v error -y -i ${OUT}y2.webm -vf "select=eq(n\\,0)" -vframes 1 ${OUT}y2_f0.png`);
  sh(`ffmpeg -v error -y -i ${OUT}y2.webm -vf "select=eq(n\\,15)" -vframes 1 ${OUT}y2_f15.png`);   // seq 70: dissolve p=0.85, no adjustment
  sh(`ffmpeg -v error -y -i ${OUT}y2.webm -vf "select=eq(n\\,44)" -vframes 1 ${OUT}y2_f44.png`);   // seq 99: blue + clip (screen blend) + caption
  sh(`ffmpeg -v error -y -i ${OUT}y2.webm -vf "select=eq(n\\,50)" -vframes 1 ${OUT}y2_f50.png`);   // seq 105: caption gone
  const f0 = pixelAt(OUT + 'y2_f0.png', 100, 60), f15 = pixelAt(OUT + 'y2_f15.png', 100, 60), f44 = pixelAt(OUT + 'y2_f44.png', 320, 180), f44c = pixelAt(OUT + 'y2_f44.png', 100, 60), f50 = pixelAt(OUT + 'y2_f50.png', 100, 60);
  H.info('pixels f0 ' + f0 + ' f15 ' + f15 + ' f44 centre ' + f44 + ' f44 corner ' + f44c + ' f50 ' + f50);
  // expected f0 before inversion: mix(red, blue, .35) = (166, 0, 89) -> inverted (89, 255, 166)
  H.ok(Math.abs(f0[0] - 89) < 24 && f0[1] > 200 && Math.abs(f0[2] - 166) < 24, 'first exported frame = mid-dissolve colour inverted by the adjustment clip');
  H.ok(f15[0] < 70 && f15[2] > 180, 'frame 15 (p=0.85) is mostly blue, adjustment ended');
  H.ok(f44[2] > 150 && (f44[0] > 20 || f44[1] > 20), 'frame 44 centre shows the screen-blended clip over blue');
  H.ok(f44c[0] < 40 && f44c[1] < 40 && f44c[2] > 200, 'frame 44 corner (outside the rotated/cropped clip) is pure blue');
  // caption: bright pixels low in the frame at f44 (caption visible) vs f50 (caption gone)
  const capRow = (png) => { const raw = execSync(`ffmpeg -v error -i ${png} -f rawvideo -pix_fmt rgb24 -`); let bright = 0; for (let x = 0; x < 640; x++) { const i = (324 * 640 + x) * 3; if (raw[i] > 200 && raw[i + 1] > 200 && raw[i + 2] > 200) bright++; } return bright; };
  const c44 = capRow(OUT + 'y2_f44.png'), c50 = capRow(OUT + 'y2_f50.png');
  H.info('caption bright pixels on row 324: f44=' + c44 + ' f50=' + c50);
  H.ok(c44 > 10 && c50 === 0, 'burnt-in caption appears exactly within its timing');
  // audio tail fade: RMS of the last 0.3 s vs 1 s earlier
  sh(`ffmpeg -v error -y -i ${OUT}y2.webm -vn -f f32le -ac 1 -ar 48000 ${OUT}y2.pcm`);
  const pcm = new Float32Array(fs.readFileSync(OUT + 'y2.pcm').buffer.slice(0));
  const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.max(0, a); i < Math.min(pcm.length, b); i++) { s += pcm[i] * pcm[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
  const n = pcm.length, tail = rms(n - 0.1 * 48000, n), mid = rms(n - 1.3 * 48000, n - 1.1 * 48000), head = rms(0.2 * 48000, 0.4 * 48000);
  H.info('audio samples ' + n + ' (' + (n / 48000).toFixed(3) + ' s) rms head ' + head.toFixed(4) + ' mid ' + mid.toFixed(4) + ' tail ' + tail.toFixed(4));
  H.ok(Math.abs(n / 48000 - 65 / 30) < 0.1, 'audio length matches the range');
  H.ok(head > 0.01 && tail < mid * 0.35, 'audio fades out at the sequence end');
  // MP4 (VP9/Opus) full export
  const res2 = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq();
    const st = { format: 'mp4-vp9', res: 'seq', w: s.w, h: s.h, fps: s.fps, quality: 'medium', range: 'all', audio: true, abitrate: 96000, captions: false, name: 'y2b', seqId: s.id };
    const r = await C.Export.run(st, () => { }, { v: false }, null);
    const buf = new Uint8Array(await r.blob.arrayBuffer()); let s64 = ''; for (let i = 0; i < buf.length; i += 0x8000) s64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s64), size: r.blob.size };
  });
  fs.writeFileSync(OUT + 'y2b.mp4', Buffer.from(res2.b64, 'base64'));
  const pj2 = JSON.parse(sh(`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,start_time,duration -of json ${OUT}y2b.mp4`));
  H.info('mp4 ffprobe: ' + JSON.stringify(pj2));
  const v = pj2.streams.find(x => x.codec_type === 'video'), a = pj2.streams.find(x => x.codec_type === 'audio');
  H.ok(Math.abs(+pj2.format.duration - 4) < 0.08, 'MP4 duration 4.0 s (' + pj2.format.duration + ')');
  H.ok(Math.abs(+v.start_time) < 0.001 && Math.abs(+a.start_time) < 0.02, 'MP4 video/audio start at 0 (' + v.start_time + '/' + a.start_time + ')');
  const nf2 = +sh(`ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 ${OUT}y2b.mp4`);
  H.ok(nf2 === 120, 'MP4 has 120 frames (' + nf2 + ')');
  const ok2 = sh(`ffmpeg -v error -i ${OUT}y2b.mp4 -f null - 2>&1 || true`);
  H.ok(!ok2, 'ffmpeg decodes the MP4 without errors' + (ok2 ? ': ' + ok2.slice(0, 200) : ''));
  await H.finish(b, errs, 'y2_export');
})();
