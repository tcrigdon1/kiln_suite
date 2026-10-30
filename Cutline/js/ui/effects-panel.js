/* Cutline — Effects browser: searchable categorized list of effects, transitions and title presets. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, A = C.A;
  var EP = C.EffectsPanel = { q: '', collapsed: U.lsGet('fxb.collapsed', {}) };

  EP.init = function (pane) {
    var inp = h('input', { type: 'text', placeholder: 'Search effects & transitions…' });
    inp.addEventListener('input', function () { EP.q = inp.value.trim().toLowerCase(); EP.render(); });
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { inp.value = ''; EP.q = ''; EP.render(); inp.blur(); } });
    EP.list = h('div.fxb-list');
    pane.appendChild(h('div.fxb-search', inp));
    pane.appendChild(EP.list);
    pane.appendChild(h('div.fxb-hint', 'Drag onto a clip (effects) or a cut / clip edge (transitions). Double-click to apply to the selection or the edit nearest the playhead.'));
    C.bus.on('prefs', EP.render);
    EP.render();
  };
  function groups() {
    var out = [], byCat = {};
    C.FX.list.forEach(function (d) { if (!d.audio) (byCat[d.cat] = byCat[d.cat] || []).push(d); });
    Object.keys(byCat).forEach(function (cat) { out.push({ id: 'v-' + cat, title: 'Video Effects · ' + cat, items: byCat[cat].map(function (d) { return { kind: 'fx', def: d, icon: 'fx' }; }) }); });
    var trc = {};
    C.TR.forKind('video').forEach(function (d) { (trc[d.cat] = trc[d.cat] || []).push(d); });
    Object.keys(trc).forEach(function (cat) { out.push({ id: 't-' + cat, title: 'Video Transitions · ' + cat, items: trc[cat].map(function (d) { return { kind: 'tr', def: d, icon: 'transition' }; }) }); });
    out.push({ id: 'a-fx', title: 'Audio Effects', items: C.FX.forKind('audio').map(function (d) { return { kind: 'fx', def: d, icon: 'audio', audio: true }; }) });
    out.push({ id: 'a-tr', title: 'Audio Transitions', items: C.TR.forKind('audio').map(function (d) { return { kind: 'tr', def: d, icon: 'transition', audio: true }; }) });
    out.push({ id: 'titles', title: 'Title Presets', items: C.Titles.PRESETS.map(function (p) { return { kind: 'title', def: p, icon: 'title' }; }) });
    return out;
  }
  EP.render = function () {
    if (!EP.list) return;
    U.clear(EP.list);
    var q = EP.q;
    groups().forEach(function (g) {
      var items = g.items.filter(function (it) { return !q || it.def.name.toLowerCase().indexOf(q) >= 0 || g.title.toLowerCase().indexOf(q) >= 0; });
      if (!items.length) return;
      var coll = !q && EP.collapsed[g.id];
      var head = h('div.fxb-cat' + (coll ? '.collapsed' : ''), { html: C.icon('chevdown') }, g.title + ' (' + items.length + ')');
      var ents = h('div.fxb-entries');
      var grp = h('div.fxb-group' + (coll ? '.collapsed' : ''), head, ents);
      head.addEventListener('click', function () { EP.collapsed[g.id] = !EP.collapsed[g.id]; U.lsSet('fxb.collapsed', EP.collapsed); grp.classList.toggle('collapsed'); head.classList.toggle('collapsed'); });
      items.forEach(function (it) {
        var isDef = it.kind === 'tr' && ((it.audio ? (C.prefs.defAudioTr || 'a_power') : (C.prefs.defVideoTr || 'cross')) === it.def.id);
        var row = h('div.fxb-item' + (it.kind === 'tr' ? '.tr' : '') + (it.audio ? '.au' : ''), { draggable: true, title: it.def.name, html: C.icon(it.icon) }, h('span', it.def.name), isDef ? h('span.def', 'DEFAULT') : null);
        row.addEventListener('dragstart', function (e) {
          if (it.kind === 'fx') e.dataTransfer.setData('application/x-cutline-effect', it.def.id);
          else if (it.kind === 'tr') e.dataTransfer.setData('application/x-cutline-transition', it.def.id);
          else { var m = A.newGen('title', it.def.id); e.dataTransfer.setData('application/x-cutline-media', JSON.stringify([m.id])); C.state.dragMedia = { ids: [m.id], video: true, audio: false }; }
          e.dataTransfer.effectAllowed = 'copy';
        });
        row.addEventListener('dragend', function () { C.state.dragMedia = null; C.bus.emit('dragend'); });
        row.addEventListener('dblclick', function () {
          if (!C.state.project) return;
          if (it.kind === 'fx') A.applyEffect(it.def.id);
          else if (it.kind === 'tr') A.addTransition(it.audio ? 'audio' : 'video', it.def.id);
          else A.addTitleAtPlayhead(null, null, it.def.id);
        });
        row.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          if (it.kind !== 'tr') return;
          C.ui.menu([{ label: 'Set as Default ' + (it.audio ? 'Audio' : 'Video') + ' Transition', action: function () { C.prefs[it.audio ? 'defAudioTr' : 'defVideoTr'] = it.def.id; C.savePrefs(); EP.render(); } }], e.clientX, e.clientY);
        });
        ents.appendChild(row);
      });
      EP.list.appendChild(grp);
    });
  };
})();
