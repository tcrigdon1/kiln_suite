/* Cutline — application bootstrap: builds panels, wires modules, status bar, startup flow. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;

  function tabPanel(panelEl, tabs, key, onShow) {
    var bar = h('div.tabs'), panes = {};
    panelEl.appendChild(bar);
    tabs.forEach(function (t) { panes[t.id] = h('div.pane', { 'data-pane': t.id }); panelEl.appendChild(panes[t.id]); });
    var api = C.ui.tabs(bar, tabs, function (id) {
      Object.keys(panes).forEach(function (k) { panes[k].classList.toggle('active', k === id); });
      U.lsSet(key, id);
      if (onShow) onShow(id);
    });
    api.panes = panes; api.bar = bar;
    return api;
  }

  function buildStatus() {
    var sb = U.$('#statusbar');
    var left = h('span'), mid = h('span.grow'), tool = h('span'), snap = h('span'), auto = h('span');
    U.append(sb, [left, mid, tool, snap, auto]);
    function upd() {
      var s = P.seq();
      left.innerHTML = s ? '<span class="st-accent">' + U.esc(s.name) + '</span>  ' + s.w + '×' + s.h + ' · ' + s.fps + ' fps · ' + U.fmtTC(P.seqDuration(s), s.fps) : 'No project';
      var sel = P.selectedClips();
      mid.textContent = sel.length ? sel.length + ' clip' + (sel.length > 1 ? 's' : '') + ' selected' : (C.state.selTransition ? 'Transition selected' : '');
      var t = C.A.TOOLS.filter(function (x) { return x.id === C.state.tool; })[0];
      tool.textContent = 'Tool: ' + (t ? t.name : '');
      snap.textContent = 'Snap ' + (C.state.snapping ? 'on' : 'off') + ' · Link ' + (C.state.linked ? 'on' : 'off');
      var pxJobs = C.Proxy ? Object.keys(C.Proxy.jobs) : [], pxTxt = '';
      if (pxJobs.length) { var pj = C.Proxy.jobs[pxJobs[0]]; pxTxt = ' · proxy ' + Math.round((pj.progress || 0) * 100) + '%' + (pxJobs.length + C.Proxy.queue.length > 1 ? ' (+' + (pxJobs.length + C.Proxy.queue.length - 1) + ')' : ''); }
      else if (C.Proxy && C.Engine.lastScene && C.Proxy.activeInScene(C.Engine.lastScene)) pxTxt = ' · PROXY';
      auto.textContent = (C.Engine.comp ? (C.Engine.comp.kind === 'webgl2' ? 'GPU' : '2D') : '') + pxTxt + (C.Engine.dynDrop && C.Engine.playing ? ' · preview 1/' + Math.round(1 / C.Engine.dynDrop) : '') + (C.state.dirty ? ' · unsaved' : ' · saved');
    }
    ['changed', 'selection', 'tool', 'state', 'saved', 'sequence', 'history', 'proxy:progress', 'playhead'].forEach(function (e) { C.bus.on(e, U.debounce(upd, 30)); });
    upd();
  }

  function init() {
    C.Menus.build();
    // Left panel: library etc.
    var left = tabPanel(U.$('#p-bin'), [{ id: 'library', label: 'Library' }, { id: 'markers', label: 'Markers' }, { id: 'captions', label: 'Captions' }, { id: 'history', label: 'History' }], 'tab.left', function (id) {
      if (id === 'markers') C.Side.renderMarkers(); if (id === 'captions') C.Side.renderCaptions(); if (id === 'history') C.Side.renderHistory();
    });
    C.Bin.init(left.panes.library);
    C.Side.initMarkers(left.panes.markers);
    C.Side.initCaptions(left.panes.captions);
    C.Side.initHistory(left.panes.history);
    C.Source.init(U.$('#p-source'));
    C.Program.init(U.$('#p-program'));
    C.Engine.init(C.Program.canvas);
    C.TL.init(U.$('#p-timeline'));
    var right = tabPanel(U.$('#p-right'), [{ id: 'inspector', label: 'Inspector' }, { id: 'effects', label: 'Effects' }, { id: 'color', label: 'Color' }, { id: 'audio', label: 'Audio' }], 'tab.right', function (id) {
      C.ColorPanel.setVisible && C.ColorPanel.setVisible(id === 'color');
      if (C.AudioPanel) C.AudioPanel.visible = id === 'audio';
    });
    U.$('#p-right').addEventListener('pointerdown', function () { C.state.focus = 'inspector'; });
    C.Inspector.init(right.panes.inspector);
    C.EffectsPanel.init(right.panes.effects);
    C.ColorPanel.init(right.panes.color);
    C.AudioPanel.init(right.panes.audio);
    C.ui.showTab = function (id) { right.select(id); };
    // draw attention to a right-panel tab without switching to it
    C.ui.pulseTab = function (id) { var el = right.els[id]; if (!el || right.current === id) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); setTimeout(function () { el.classList.remove('pulse'); }, 1600); };
    C.ui.showLeftTab = function (id) { left.select(id); };
    left.select(U.lsGet('tab.left', 'library'));
    right.select(U.lsGet('tab.right', 'inspector'));
    C.ui.applyLayout();
    C.ui.initSplitters();
    buildStatus();
    C.TL.updateButtons();
    C.IO.startAutosave();
    // prevent the browser from navigating away when files are dropped outside a drop zone
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length && C.state.project) C.Media.importFiles(e.dataTransfer.files);
    });
    // resume audio context on first gesture (autoplay policy)
    var resume = function () { try { C.Mixer.ensure(); } catch (e) { } window.removeEventListener('pointerdown', resume, true); window.removeEventListener('keydown', resume, true); };
    window.addEventListener('pointerdown', resume, true); window.addEventListener('keydown', resume, true);
    C.bus.on('project', function () { C.Menus.updateTitle(); C.TL.renderSeqTabs(); C.Program.layout(); });
    // startup
    var params = new URLSearchParams(location.search);
    if (params.get('test') === '1') { C.IO.createProject({ projectName: 'Test Project', w: 1280, h: 720, fps: 30 }); C.ready = true; return; }
    C.IO.getRecovery().then(function (rec) {
      C.ui.welcome({ recovery: rec && rec.json ? rec : null });
      C.ready = true;
    }).catch(function () { C.ui.welcome({}); C.ready = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('error', function (e) { if (/ResizeObserver loop/.test(e.message || '')) return; console.error('[Cutline] uncaught', e.message); });
})();
